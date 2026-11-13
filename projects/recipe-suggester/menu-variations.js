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
const dish = (id, label, recipeIds, extra = {}) => meal(id, label, recipeIds,
  {role:'main', staple:false, mealBase:false, ...extra});
const drink = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'drink', ...extra});
const snack = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'snack', ...extra});

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
  meal('nigiri', 'にぎり寿司', [
    'classic-sushi-tuna','classic-sushi-salmon','classic-sushi-shrimp','classic-sushi-squid',
    'palette-nigiri-chutoro','palette-nigiri-seabream','palette-nigiri-yellowtail','palette-nigiri-scallop',
    'palette-nigiri-octopus','palette-nigiri-egg','palette-nigiri-anago',
    'classic-sushi-assorted',
  ]),
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
  // 同じ料理の味・主材料の違いを詳細の選択肢へまとめます。
  // 旧main-roleの主食は、既存の区分を保つため別の明示グループです。
  meal('pizza', 'ピザ', ['daily-pizza-margherita','daily-pizza-mixed','daily-pizza-teriyaki','daily-pizza-seafood']),
  meal('fried-rice', 'チャーハン', ['daily-fried-rice-egg','daily-fried-rice-gomoku','daily-fried-rice-kimchi','daily-fried-rice-shrimp']),
  meal('ramen', 'ラーメン', ['daily-ramen-soy','daily-ramen-salt','daily-ramen-miso','daily-ramen-tanmen']),
  meal('donburi', '丼もの', [
    'daily-donburi-oyako','daily-donburi-pork','daily-donburi-mapo','daily-donburi-chinese','daily-donburi-teriyaki',
    'familiar-katsudon','familiar-sauce-katsudon','familiar-chicken-katsudon','familiar-tendon','familiar-kakiage-don',
    'familiar-tenshinhan','familiar-kaisen-don','familiar-tekka-don','familiar-salmon-don',
    'varied-yakitori-don','varied-yakiniku-don','varied-unadon',
  ]),
  meal('rice-bowls', '具だくさんの丼', [
    'chicken-rice-bowl','beef-rice-bowl','pork-rice-bowl','tofu-rice-bowl','tofu-natto-rice',
  ], {role:'main'}),
  meal('omelette-rice', 'オムライス', ['classic-omelette-rice-cheese','classic-omelette-rice-mushroom','classic-omelette-rice-tomato']),
  meal('retort-donburi', 'レトルト丼', [
    'prepared-retort-gyudon','prepared-retort-oyakodon','prepared-retort-chukadon','prepared-retort-mapodon',
  ], {nature:'retort'}),
  meal('burger', 'ハンバーガー', [
    'prepared-burger-plain','prepared-burger-cheese','prepared-burger-teriyaki',
    'prepared-burger-chicken','prepared-burger-fish','prepared-burger-double',
  ], {nature:'fast-food'}),
  meal('bought-sandwich', 'サンドイッチ（購入品の一般例）', [
    'prepared-sandwich-egg','prepared-sandwich-ham','prepared-sandwich-tuna','prepared-sandwich-vegetable',
  ], {nature:'ready-to-eat'}),
  meal('hot-sandwich', 'ホットサンド', ['chicken-sandwich','breakfast-egg-sandwich'], {role:'main'}),
  meal('toast', 'トースト', [
    'staple-butter-toast','staple-garlic-toast','staple-cheese-toast','staple-sesame-toast','staple-avocado-toast',
  ], {mealBase:false}),
  meal('sliced-bread', '食パン', ['staple-plain-bread','staple-wholegrain-bread'], {nature:'ready-to-eat', mealBase:false}),
  meal('oatmeal', 'オートミールがゆ', ['staple-oatmeal-water','staple-oatmeal-milk','staple-oatmeal-soy'], {mealBase:false}),
  dish('hamburg', 'ハンバーグ', [
    'beef-hamburg','tofu-burger','classic-hamburg','familiar-hamburg-oroshi','familiar-hamburg-stew','familiar-hamburg-cheese',
  ]),
  dish('gyoza', '餃子', ['classic-gyoza','varied-boiled-gyoza','varied-shrimp-boiled-gyoza','varied-fried-gyoza']),
  dish('karaage', '鶏の唐揚げ', ['daily-snack-oven-karaage','classic-karaage-thigh','classic-karaage-breast','classic-karaage-salt']),
  dish('grilled-fish', '焼き魚', [
    'tuna-cube','classic-grilled-salmon','classic-grilled-mackerel','classic-grilled-hokke',
    'classic-grilled-aji','classic-grilled-saury','classic-grilled-shishamo','familiar-buri-teriyaki',
  ]),
  dish('sashimi', '刺身', [
    'classic-sashimi-tuna','classic-sashimi-tuna-mediumfat','classic-sashimi-salmon','classic-sashimi-yellowtail',
    'classic-sashimi-seabream','classic-sashimi-bonito','classic-sashimi-aji','classic-sashimi-squid',
    'classic-sashimi-octopus','classic-sashimi-scallop','classic-sashimi-assorted',
  ], {nature:'ready-to-eat'}),
  dish('croquette', 'コロッケ', ['classic-croquette-potato','classic-croquette-pumpkin','classic-croquette-cream']),
  dish('stew', 'シチュー', ['familiar-beef-stew','familiar-chicken-cream-stew','familiar-pork-cream-stew']),
  dish('nabe', '鍋料理', ['familiar-yose-nabe','familiar-kimchi-nabe','familiar-sesame-soy-nabe','familiar-chanko-nabe']),
  dish('yakitori', '焼き鳥', [
    'familiar-yakitori-negima','varied-yakitori-thigh-salt','varied-yakitori-thigh-tare','varied-yakitori-breast-salt',
    'varied-yakitori-skin','varied-yakitori-tsukune','varied-yakitori-tsukune-cheese','varied-yakitori-ume-shiso',
  ]),
  dish('takeaway-yakitori', '焼き鳥（テイクアウト）', [
    'takeaway-yakitori-momo-tare','takeaway-yakitori-momo-salt','takeaway-yakitori-negima-tare',
    'takeaway-yakitori-tsukune-tare','takeaway-yakitori-kawa-tare','takeaway-yakitori-sunagimo-salt',
  ], {nature:'ready-to-eat'}),
  dish('tempura', '天ぷら', ['familiar-tempura-assorted','varied-shrimp-tempura','varied-squid-tempura','varied-whitefish-tempura']),
  dish('vegetable-tempura', '野菜・きのこの天ぷら', ['varied-vegetable-tempura','varied-shimeji-tempura'], {role:'side'}),
  dish('takeaway-tempura', '天ぷら（外食）', ['takeaway-tempura-shrimp','takeaway-tempura-squid'], {nature:'ready-to-eat'}),
  dish('potage', 'ポタージュ', [
    'soup-004','soup-006','soup-008','calendar-soup-cauliflower-potato','familiar-side-corn-potage',
  ], {role:'soup'}),
  dish('instant-potage', 'カップスープ', [
    'takeaway-knorr-corn','takeaway-knorr-potage','takeaway-knorr-mushroom','takeaway-knorr-spinach','takeaway-knorr-pumpkin','takeaway-knorr-tomato',
  ], {role:'soup', nature:'instant'}),
  dish('instant-harusame', '春雨スープ（即席）', [
    'takeaway-harusame-wonton','takeaway-harusame-egg','takeaway-harusame-tantan',
    'takeaway-harusame-wakame-vegetable','takeaway-harusame-wakame-gomtang',
  ], {role:'soup', nature:'instant'}),
  snack('yoghurt', 'ヨーグルト（トッピング）', [
    'snack-banana-yogurt','snack-kiwi-yogurt','snack-berry-yogurt','snack-apple-raisin-yogurt','snack-sweet-potato-yogurt',
  ]),
  snack('cheese', 'チーズ', [
    'daily-snack-plain-cheese','daily-snack-mozzarella','palette-cheese-camembert','palette-cheese-cheddar',
    'palette-cheese-cream','palette-cheese-blue','palette-cheese-processed','palette-cheese-parmesan',
  ], {nature:'ready-to-eat'}),
  snack('nuts', 'ナッツ', [
    'snack-almond','snack-walnut','snack-cashew','snack-peanut','snack-nuts-raisin',
    'palette-nuts-pistachio','palette-nuts-macadamia','palette-nuts-pine',
  ], {nature:'ready-to-eat'}),
  drink('milk', '牛乳・豆乳', ['drink-milk','drink-soy-milk'], {nature:'ready-to-eat'}),
  drink('flavoured-milk', 'フルーツミルク・豆乳', ['drink-banana-soy','drink-strawberry-milk']),
  drink('juice', '果汁・野菜ジュース', ['drink-orange-juice','drink-apple-juice','drink-tomato-juice'], {nature:'ready-to-eat'}),
  drink('tomato-juice-product', 'トマトジュース（市販品）', ['takeaway-tomato-unsalted','takeaway-tomato-low-salt'], {nature:'ready-to-eat'}),
  drink('water', '水・無糖炭酸水', ['drink-water','daily-drink-sparkling-water'], {nature:'ready-to-eat'}),
  drink('lemon-water', 'レモン水・レモン炭酸水', ['drink-lemon-water','daily-drink-lemon-sparkling']),
  // 選択式の料理は1つの入口を用意し、具材の組み合わせ自体はDBへ列挙しません。
  dish('oden', 'おでん', ['palette-oden']),
  meal('bagel', 'ベーグル', ['palette-bagel'], {nature:'ready-to-eat', mealBase:false}),
  snack('waffle', 'ワッフル', ['palette-waffle']),
  snack('muffin', 'マフィン', ['palette-muffin']),
  meal('sandwich', 'サンドイッチ', ['palette-sandwich']),
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
