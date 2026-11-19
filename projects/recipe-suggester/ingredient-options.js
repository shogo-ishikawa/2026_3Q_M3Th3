import {matchesJapaneseQuery} from './japanese-search.js';
import {PANTRY_SUBGROUPS} from './pantry-catalog.js';

// 手持ち一覧には弁当や市販菓子もある。食材を選ぶ設定には料理で使う材料だけを載せる。
const cookingDrinks = new Set([
  'green_tea', 'roasted_tea', 'barley_tea', 'oolong_tea', 'black_tea', 'coffee', 'cocoa_powder',
  'orange_juice', 'apple_juice', 'tomato_juice', 'carbonated_water', 'perf_wine_red', 'perf_wine_white',
]);
const finishedDishes = new Set([
  'burger_meat_patty', 'burger_chicken_patty', 'ready_breaded_fish', 'shrimp_tempura',
  'palette_chicken_nugget', 'palette_oyster_fry', 'palette_waffle',
]);
const ingredientIds = Object.entries(PANTRY_SUBGROUPS).flatMap(([group, subgroups]) => {
  const ids = subgroups.flatMap(row => row.ingredientIds);
  if (group === 'prepared') return [];
  if (group === 'snack') return ids.filter(id => id === 'chocolate');
  if (group === 'drink') return ids.filter(id => cookingDrinks.has(id));
  return ids.filter(id => !finishedDishes.has(id));
});

// 缶詰や肉・魚の部位は括弧内で区別する。アレルゲン注記・メーカー例は検索語にしない。
function optionName(name) {
  return name.replace(/（([^）]+)）$/u, (whole, detail) => {
    if (detail.includes('を含む想定') || detail.includes('を含む代表') || detail.endsWith('の例') ||
        detail.endsWith('由来') || /^(?:小麦・大豆|大豆|卵・乳・小麦)を含む$/u.test(detail)) return '';
    return whole;
  });
}

// 同名の食材の加工状態や部位は検索できるようにし、原材料表示の文章では照合しない。
const formTerms = /水煮|油漬け|刺身用|加熱用|薄切り|かたまり|粉末|小腸|ミノ|第一胃|ナンプラー|焼き豚|すなぎも|背脂|取り出す分|こす分/gu;
const sesameReading = value => value.replaceAll('胡麻', 'ごま');

/** IDは選択の新規候補にだけ使う。旧版で設定済みの商品IDは保存・解除できる。 */
export function ingredientOptions(data, query = '', {selectedIds = [], limit = Infinity} = {}) {
  const selected = new Set(selectedIds), results = [];
  const text = sesameReading(query.trim());
  if (limit <= 0) return results;
  for (const id of ingredientIds) {
    const food = data.ingredients[id];
    if (!food || selected.has(id)) continue;
    const name = optionName(food.name);
    if (text) {
      const [primary, detail = ''] = food.name.split('（');
      if (!matchesJapaneseQuery([primary, id, ...(detail.match(formTerms) ?? [])], text)) continue;
    }
    results.push({id, name, unit: food.unit});
    if (results.length >= limit) break;
  }
  return results;
}
