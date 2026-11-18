/** 外で食べた一品を、献立と共通の料理・材料・食事履歴から探します。 */
import {CATALOG_CATEGORIES, grilledFishAliases, recipeFamily, recipeNature} from './catalog.js';
import {matchesJapaneseQuery, normaliseJapaneseSearch} from './japanese-search.js';
import {MENU_VARIATION_GROUPS, variationSearchAliases} from './menu-variations.js';

const familyLabels = new Map(CATALOG_CATEGORIES.map(({id, label}) => [id, label]));
const standardVariants = new Set(MENU_VARIATION_GROUPS.map(group => group.defaultRecipeId));
const examples = ['classic-grilled-salmon', 'pork-ginger', 'classic-karaage-thigh', 'daily-donburi-oyako',
  'daily-ramen-soy', 'daily-udon-plain', 'plain-rice', 'soup-001'];
const terms = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];

function recipeRow(recipe, data, byId) {
  const restaurant = recipe.restaurant;
  const nature = recipeNature(recipe);
  const section = restaurant ? '店別メニュー' : recipe.custom ? 'マイメニュー' :
    nature === 'home-cooked' ? '登録レシピ' : '商品・外食の例';
  const familyId = recipeFamily(recipe), family = familyLabels.get(familyId);
  const ingredients = (recipe.ingredients ?? []).map(part => data.ingredients?.[part.id]?.name ?? part.name);
  const names = terms([recipe.name, restaurant && recipe.name.split('｜').at(-1)]);
  const aliases = terms([...grilledFishAliases(recipe, familyId), recipe.variantLabel, ...(recipe.searchAliases ?? []), ...variationSearchAliases(recipe),
    restaurant?.storeName, restaurant?.sizeName, byId.get(restaurant?.genericRecipeId)?.name, family]);
  return {choice:{key:`recipe-${recipe.id}`, name:recipe.name, section, recipe, approximate:false},
    names, aliases, fields:terms([...names, ...aliases, ...ingredients]),
    priority:restaurant ? 0 : recipe.custom ? 1 : nature === 'home-cooked' ? 2 : 3,
    standard:standardVariants.has(recipe.id)};
}

function historyRows(entries, byId) {
  const rows = [], recentRecipeIds = new Set(), seen = new Set();
  const recent = [...entries].reverse().filter(entry => entry.status === 'eaten')
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of recent) {
    for (const item of entry.items) {
      const match = item.diningMatch;
      if (!match && !item.restaurant && entry.note !== '外食') continue;
      const live = byId.get(item.recipeId), shop = match?.storeName || item.restaurant?.storeName;
      // 同じ店別メニューを再度選ぶ場合は改訂後の表示値を使います。
      // 別の店・別の料理を参照値で記録した履歴は、元の料理と区別して残します。
      if (live && !item.ingredientEdit && (!match || (live.restaurant && match.mode === 'menu' &&
          (!shop || shop === live.restaurant.storeName) && (!match.actualName || item.name === live.name)))) {
        recentRecipeIds.add(live.id);
        continue;
      }
      // 別のトッピングや材料の量で記録した同名の食事も履歴から選び直せます。
      const composition = item.ingredientEdit ? item.ingredients.map(part => [part.id, part.amount]) : null;
      const key = JSON.stringify([shop, item.name, item.recipeId, match?.referenceName, match?.mode, composition]);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = shop && !item.name.startsWith(`${shop}｜`) ? `${shop}｜${item.name}` : item.name;
      const names = terms([item.name, name, match?.actualName]);
      const aliases = terms([shop, match?.referenceName, live?.name]);
      rows.push({choice:{key:`history-${item.id}`, name, section:item.ingredientEdit ? '最近の外食・食材変更あり' : '最近の外食', item, approximate:false},
        names, aliases, fields:terms([...names, ...aliases, ...(item.ingredients ?? []).map(part => part.name)]),
        priority:1, standard:false});
    }
  }
  return {rows, recentRecipeIds};
}

// 店頭名に付く「定食」「ランチ」などは、参照できる単品を探すときだけ外します。
// 応じる一品のない「日替わり定食」だけで具体的な料理を推測しません。
function diningQueries(query) {
  const original = query.normalize('NFKC').trim();
  const result = [original];
  const withoutSize = original.replace(/\s*(?:[（(]\s*)?(?:大盛(?:り)?|並盛(?:り)?|小盛(?:り)?|おおもり|なみもり|こもり|単品|一人前|1人前)(?:\s*[）)])?$/u, '').trim();
  if (withoutSize) result.push(withoutSize);
  const dish = withoutSize.replace(/^(?:本日の|ほんじつの|日替[わり]*の?|ひがわりの?|特製の?|とくせいの?)\s*/u, '')
    .replace(/\s*(?:定食|ていしょく|ランチ(?:セット)?|らんち(?:せっと)?|セット|せっと)\s*$/u, '').trim();
  if (dish) {
    result.push(dish);
    // 「鯖の塩焼き」「鯖塩焼き」のような注文名にも対応します。
    const compact = normaliseJapaneseSearch(dish).replaceAll('の', '');
    if (compact.length >= 3) result.push(compact);
    if (dish.includes('の')) result.push(dish.split('の').filter(Boolean).join(' '));
  }
  return terms(result);
}

function matchScore(row, query) {
  if (!matchesJapaneseQuery(row.fields, query)) return null;
  if (row.exactNames.includes(normaliseJapaneseSearch(query))) return 0;
  if (matchesJapaneseQuery(row.names, query)) return 1;
  if (matchesJapaneseQuery([...row.names, ...row.aliases], query)) return 2;
  return 3;
}

/**
 * 候補に含まれる recipe または item だけを記録画面へ渡します。
 * approximate は入力文字から近い単品を探した場合の印です。選ぶ操作は利用者が行います。
 */
export function createDiningSearch(data, entries = []) {
  const byId = new Map(data.recipes.map(recipe => [recipe.id, recipe]));
  const catalog = data.recipes.map(recipe => recipeRow(recipe, data, byId));
  const history = historyRows(entries, byId);
  const rows = [...history.rows, ...catalog];
  for (const row of rows) {
    row.exactNames = row.names.map(normaliseJapaneseSearch);
    row.compactNames = row.exactNames.map(name => name.replaceAll('の', ''));
    const variations = row.choice.recipe ? variationSearchAliases(row.choice.recipe) : [];
    row.dishNames = terms([...row.exactNames, ...variations.map(normaliseJapaneseSearch)])
      .filter(name => name.length >= 3);
  }
  const recipes = new Map(catalog.map(row => [row.choice.recipe.id, row]));
  const defaults = [...new Set([...history.rows, ...[...history.recentRecipeIds].map(id => recipes.get(id)),
    ...catalog.filter(row => row.choice.recipe.restaurant), ...examples.map(id => recipes.get(id)).filter(Boolean)])];

  return function find(query, {limit = 40} = {}) {
    if (!query.trim()) return defaults.slice(0, limit).map(row => row.choice);
    const queries = diningQueries(query);
    const ranked = [];
    const dishName = normaliseJapaneseSearch(queries.at(-1));
    for (const row of rows) {
      let match = null;
      for (const [index, phrase] of queries.entries()) {
        let score = matchScore(row, phrase);
        let approximate = index > 0;
        if (score === null && !phrase.includes(' ') && row.compactNames.includes(phrase)) {
          score = 1;
          approximate = true;
        }
        if (score === null) continue;
        match = {row, score:score + (approximate ? 4 : 0), length:0, approximate};
        break;
      }
      // 「濃厚みそラーメン」「チーズ牛丼」など、店独自の呼び名の末尾にある料理も候補にします。
      if (!match && !dishName.includes(' ')) {
        const length = row.dishNames.reduce((longest, name) =>
          dishName.endsWith(name) ? Math.max(longest, name.length) : longest, 0);
        if (length) match = {row, score:8, length, approximate:true};
      }
      if (match) ranked.push(match);
    }
    ranked.sort((a, b) => a.score - b.score || b.length - a.length || a.row.priority - b.row.priority ||
      Number(b.row.standard) - Number(a.row.standard));
    return ranked.slice(0, limit).map(({row, approximate}) =>
      approximate ? {...row.choice, approximate:true} : row.choice);
  };
}
