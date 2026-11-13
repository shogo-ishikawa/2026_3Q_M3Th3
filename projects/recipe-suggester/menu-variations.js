/** 同じ料理の違いを選択肢へまとめます。元のレシピや保存済みの記録は変更しません。 */
import {recipeNature} from './catalog.js';
import {japaneseQueryRank} from './japanese-search.js';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const meal = (id, label, recipeIds, extra = {}) => ({
  id, label, recipeIds, role: 'staple', nature: 'home-cooked', staple: true, mealBase: true, ...extra,
});

/** 明示した既存IDだけをまとめます。新しい料理を名前だけで自動所属させません。 */
export const MENU_VARIATION_GROUPS = freeze([
  meal('nikujaga', '肉じゃが', ['beef-potato'], {role:'main', staple:false, mealBase:false, customiserKind:'nikujaga'}),
  meal('okonomiyaki', 'お好み焼き', ['seafood-okonomiyaki'], {role:'main', customiserKind:'okonomiyaki'}),
  meal('rice', 'ご飯', [
    'plain-rice','staple-brown-rice','staple-mixed-rice','staple-barley-rice','staple-wakame-rice',
    'staple-corn-rice','staple-mushroom-rice','staple-turmeric-rice','daily-rice-gomoku',
    'daily-rice-chicken-burdock','daily-rice-green-peas','daily-rice-hijiki',
  ], {mealBase:false}),
  meal('onigiri', 'おにぎり', [
    'staple-salt-onigiri','staple-grilled-onigiri','daily-onigiri-salt','daily-onigiri-salmon',
    'daily-onigiri-plum','daily-onigiri-tuna-mayo','daily-onigiri-kombu','daily-onigiri-okaka',
    'daily-onigiri-sesame','daily-onigiri-grilled',
  ], {mealBase:false}),
  meal('udon', 'うどん', [
    'staple-plain-udon','staple-chilled-udon','daily-udon-plain','daily-udon-kitsune','daily-udon-tanuki',
    'daily-udon-wakame','daily-udon-meat','daily-udon-tempura','daily-udon-curry',
  ]),
  meal('soba', 'そば', [
    'staple-sesame-soba','staple-warm-soba','daily-soba-plain','daily-soba-kitsune','daily-soba-tanuki',
    'daily-soba-wakame','daily-soba-meat','daily-soba-tempura','daily-soba-curry',
  ]),
  meal('pasta', 'パスタ', [
    'staple-olive-pasta','staple-tomato-pasta','daily-pasta-peperoncino','daily-pasta-carbonara',
    'daily-pasta-genovese','daily-pasta-bolognese','daily-pasta-arrabbiata','daily-pasta-pescatore',
    'daily-pasta-napolitan','daily-pasta-japanese-mushroom','daily-pasta-tuna-tomato','daily-pasta-vongole',
  ]),
  meal('curry', 'カレーライス', [
    'daily-curry-chicken','daily-curry-pork','daily-curry-beef','daily-curry-vegetable','daily-curry-keema',
    'varied-green-curry-rice','varied-butter-chicken-rice',
  ]),
  meal('retort-curry', 'レトルトカレーライス', [
    'prepared-retort-beef-curry','prepared-retort-pork-curry','prepared-retort-chicken-curry',
    'prepared-retort-vegetable-curry','prepared-retort-keema-curry',
  ], {nature:'retort'}),
  meal('yakisoba', '焼きそば', ['daily-yakisoba-sauce','daily-yakisoba-salt','daily-yakisoba-seafood']),
  meal('cup-yakisoba', 'カップ焼きそば', ['prepared-cup-yakisoba-sauce','prepared-cup-yakisoba-salt'], {nature:'instant'}),
  meal('cup-udon', 'カップうどん', ['prepared-cup-udon-kitsune','prepared-cup-udon-tempura'], {nature:'instant'}),
  meal('cup-ramen', 'カップラーメン', [
    'prepared-cup-ramen-soy','prepared-cup-ramen-salt','prepared-cup-ramen-miso','prepared-cup-ramen-tonkotsu',
    'prepared-cup-ramen-seafood','prepared-cup-ramen-nonfried-soy','prepared-cup-ramen-nonfried-salt',
  ], {nature:'instant'}),
  meal('bag-ramen', '袋入り即席ラーメン', [
    'prepared-bag-ramen-soy','prepared-bag-ramen-miso','prepared-bag-ramen-salt','prepared-bag-ramen-nonfried',
  ], {nature:'instant'}),
  meal('miso-soup', 'みそ汁', [
    'soup-001','soup-002','soup-003','calendar-soup-cabbage-egg','daily-miso-onion','daily-miso-clam',
    'daily-miso-tonjiru','daily-miso-potato','daily-miso-aburaage-daikon',
  ], {role:'soup', staple:false, mealBase:false}),
  meal('omelette', 'オムレツ', [
    'classic-omelette-plain','classic-omelette-cheese','classic-omelette-spinach','classic-omelette-bacon',
  ], {role:'main', staple:false, mealBase:false}),
  meal('nigiri', 'にぎり寿司', ['classic-sushi-tuna','classic-sushi-salmon','classic-sushi-shrimp','classic-sushi-squid']),
  meal('hosomaki', '細巻き', [
    'sushi-hosomaki-kappa','sushi-hosomaki-tekka','sushi-hosomaki-natto','sushi-hosomaki-ume-shiso','sushi-hosomaki-tuna-mayo',
  ]),
  meal('futomaki', '太巻き', ['sushi-futomaki-egg-vegetable','sushi-futomaki-seafood','sushi-futomaki-salad']),
  meal('gunkan', '軍艦巻き', [
    'sushi-gunkan-ikura','sushi-gunkan-negitoro','sushi-gunkan-tuna-mayo','sushi-gunkan-corn-mayo',
    'sushi-gunkan-natto','sushi-gunkan-crab','sushi-gunkan-shirasu',
  ]),
  meal('tea', 'お茶・紅茶', [
    'drink-green-tea','drink-roasted-tea','drink-barley-tea','drink-oolong-tea','drink-black-tea','drink-milk-tea','drink-ginger-tea',
  ], {role:'drink', staple:false, mealBase:false}),
  meal('coffee', 'コーヒー', ['drink-coffee','drink-cafe-au-lait','drink-soy-latte'], {role:'drink', staple:false, mealBase:false}),
]);

/** 追加時の重複所属を検知し、ある料理が複数の入口へ消えることを防ぎます。 */
export function validateVariationDefinitions(definitions = MENU_VARIATION_GROUPS) {
  if (!Array.isArray(definitions)) throw Error('メニューの種類の一覧を確認してください。');
  const groups = new Set(), recipes = new Set();
  for (const group of definitions) {
    if (!group || typeof group !== 'object' || typeof group.id !== 'string' || !group.id.trim() || groups.has(group.id) ||
        typeof group.label !== 'string' || !group.label.trim() || !Array.isArray(group.recipeIds) || !group.recipeIds.length) {
      throw Error('メニューの種類の名前と識別子を確認してください。');
    }
    groups.add(group.id);
    for (const id of group.recipeIds) {
      if (typeof id !== 'string' || !id.trim() || recipes.has(id)) throw Error('同じ料理を複数の種類に登録できません。');
      recipes.add(id);
    }
  }
  return true;
}
validateVariationDefinitions();
const definitionByRecipe = new Map(MENU_VARIATION_GROUPS.flatMap(group => group.recipeIds.map(id => [id, group])));

function checkedRecipes(recipes) {
  if (!Array.isArray(recipes)) throw Error('メニューの一覧を確認してください。');
  const ids = new Set();
  for (const recipe of recipes) {
    if (!recipe || typeof recipe !== 'object' || typeof recipe.id !== 'string' || !recipe.id ||
        typeof recipe.name !== 'string' || !recipe.name || ids.has(recipe.id)) throw Error('メニューの識別子と料理名を確認してください。');
    ids.add(recipe.id);
  }
  return recipes;
}

function definitionFor(recipe) {
  if (recipe.custom === true) return null;
  const definition = definitionByRecipe.get(recipe.id);
  if (!definition || recipe.role !== definition.role || recipeNature(recipe) !== definition.nature ||
      recipe.staple !== definition.staple || recipe.mealBase !== definition.mealBase) return null;
  return definition;
}

/** 表示用の検索データへ足す見出し名。元レシピの名前や読みは変更しません。 */
export function variationSearchAliases(recipe) {
  if (!recipe || typeof recipe !== 'object' || typeof recipe.id !== 'string') throw Error('料理の情報を確認してください。');
  const definition = definitionFor(recipe);
  return definition ? [definition.label] : [];
}

/** 元の小分類名を尊重します。量の単位や別のレシピ名へ置き換えません。 */
export function variantLabel(recipe) {
  if (!recipe || typeof recipe !== 'object' || typeof recipe.name !== 'string') throw Error('料理の名前を確認してください。');
  return typeof recipe.variantLabel === 'string' && recipe.variantLabel.trim() ? recipe.variantLabel : recipe.name;
}

function selection(recipes, definition, selectedRecipeId) {
  const recipe = recipes.find(item => item.id === selectedRecipeId) ?? recipes[0];
  return {
    key: definition ? `group:${definition.id}` : `recipe:${recipe.id}`,
    label: definition?.label ?? recipe.name,
    recipes: [...recipes], recipe, selectedRecipeId: recipe.id,
    groupId: definition?.id ?? null, variantCount: recipes.length, isGroup: Boolean(definition),
    ...(definition?.customiserKind ? {customiserKind: definition.customiserKind} : {}),
  };
}

/**
 * すでに絞った候補だけをまとめ、同じ種類を1つの入口へ表示します。
 * allRecipesを渡しても、非表示・除外済みの候補を補って戻すことはありません。
 * recipesの順序は候補の順を保ち、検索中の代表だけは料理名の一致を優先します。
 */
export function groupMenuRecipes(candidates, {query = ''} = {}) {
  checkedRecipes(candidates);
  if (typeof query !== 'string') throw Error('検索する料理名を確認してください。');
  const entries = [], byKey = new Map();
  for (const recipe of candidates) {
    const definition = definitionFor(recipe), key = definition ? `group:${definition.id}` : `recipe:${recipe.id}`;
    if (!byKey.has(key)) {
      const entry = {definition, recipes: []}; byKey.set(key, entry); entries.push(entry);
    }
    byKey.get(key).recipes.push(recipe);
  }
  return entries.map(entry => {
    const ranked = query.trim() ? entry.recipes.map((recipe, index) => ({recipe, index,
      rank:japaneseQueryRank([recipe.name, variantLabel(recipe)], query)}))
      .sort((a,b) => a.rank - b.rank || a.index - b.index) : [];
    return selection(entry.recipes, entry.definition, ranked[0]?.recipe.id ?? entry.recipes[0].id);
  });
}

/** 詳細を開いたレシピと、渡された一覧に残る同じ種類の料理を返します。 */
export function getVariationGroup(recipeId, allRecipes) {
  const list = checkedRecipes(allRecipes), source = list.find(recipe => recipe.id === recipeId);
  if (!source) return null;
  const definition = definitionFor(source);
  if (!definition) return null;
  return selection(list.filter(recipe => definitionFor(recipe)?.id === definition.id), definition, recipeId);
}
