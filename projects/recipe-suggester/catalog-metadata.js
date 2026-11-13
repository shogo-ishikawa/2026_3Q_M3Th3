import {isCompleteMeal, recipeFamily, recipeNature, storedSoupFamily} from './catalog.js';

// 旧版の ID はカレンダーや保存済み献立から参照されます。名前や材料を
// 作り直さず、料理を確認したうえで一覧上の分類だけを整えます。
const auditedFamilies = {
  'egg-main': `omelette-vegetable egg-potato egg-tomato crab-omelette
    breakfast-tomato-scramble breakfast-spinach-omelette
    breakfast-cheese-mushroom-egg breakfast-shrimp-pea shrimp-egg`,
  'bean-main': `tofu-steak tofu-mapo tofu-vegetable tofu-burger soybeans-tomato
    tofu-egg pork-tofu tofu-dried-simmer okara-vegetable-patty soy-hijiki-patty
    tofu-sesame-crust breakfast-tofu-scramble breakfast-lentil-potato
    breakfast-tofu-broccoli`,
  'meat-main': `chicken-teriyaki chicken-tomato chicken-steam chicken-salt-lemon
    chicken-cashew chicken-miso chicken-curry-yogurt chicken-meatball
    chicken-oyako chicken-rice-flour chicken-broccoli chicken-lotus
    pork-ginger pork-cabbage pork-vinegar pork-daikon pork-beansprout
    pork-meatball pork-roll pork-salt-cabbage pork-aubergine beef-onion
    beef-pepper beef-potato beef-tomato beef-hamburg beef-burdock beef-broccoli
    pork-cabbage-roll pork-chive-egg chicken-root-simmer chicken-nanban-pickle
    chicken-tofu-pot pork-stuffed-pepper breakfast-chicken-cabbage
    breakfast-pork-pumpkin`,
  'fish-main': `salmon-foil salmon-miso salmon-milk salmon-lemon mackerel-miso
    mackerel-tomato cod-salt-steam cod-sweet-vinegar cod-potato
    horse-mackerel-pan sardine-ginger shrimp-chilli squid-pepper scallop-broccoli
    clam-sake-steam squid-daikon-simmer cod-fishball mackerel-curry-roast
    cod-cheese-bake breakfast-salmon-spinach breakfast-sardine-tomato`,
  'grilled-fish': 'tuna-cube',
  'omelette-rice': 'rice-egg-omelette',
  'other-staple': 'rice-flour-chijimi breakfast-banana-pancake',
  'karaage': 'daily-snack-oven-karaage',
  'small-dish': `kiriboshi-cucumber daikon-leaf-tofu sweet-potato-apple
    aubergine-tomato-cold side-001 side-002 side-004 side-005 side-006 side-008
    side-011 side-012 side-013 side-014 side-015 side-027 side-028 side-029
    side-030 side-031 side-032 side-037 side-041 side-042 side-043 side-044
    side-046 side-049 side-051 side-054 side-055 side-056 side-060
    calendar-side-komatsuna-walnut calendar-side-aubergine-sesame
    calendar-side-lotus-edamame calendar-side-okra-corn calendar-side-turnip-leaf
    snack-edamame snack-pumpkin snack-soybean snack-cheese-tomato
    snack-sesame-potato breakfast-natto-okra daily-snack-bacon-cheese-roll
    classic-boiled-egg classic-natto-plain classic-natto-grated-daikon`,
  // 元のIDと量を保ち、既存のお菓子も新しい選択肢から探せるようにする。
  'salty-snack': 'daily-snack-potato-chips',
  'rice-snack': 'daily-snack-rice-cracker',
  'biscuit': 'daily-snack-butter-cookie daily-snack-chocolate-cookie',
  'chocolate': 'daily-snack-chocolate',
  'ice-dessert': 'daily-snack-vanilla-ice daily-snack-cocoa-ice',
  'cake': 'daily-snack-banana-cake daily-snack-chocolate-cake',
};

const readyToEatIds = new Set(`
  staple-plain-bread staple-wholegrain-bread
  drink-water drink-milk drink-soy-milk drink-orange-juice drink-apple-juice
  drink-tomato-juice daily-drink-sparkling-water daily-drink-cola daily-drink-sports
  snack-apple snack-orange snack-kiwi snack-banana snack-peach snack-grape
  snack-strawberry snack-blueberry snack-fruit-plate snack-plain-yogurt
  snack-almond snack-walnut snack-cashew snack-peanut snack-nuts-raisin
  daily-snack-potato-chips daily-snack-rice-cracker daily-snack-butter-cookie
  daily-snack-chocolate daily-snack-vanilla-ice daily-snack-plain-cheese
  daily-snack-mozzarella daily-snack-pork-bun
`.trim().split(/\s+/));

const overrides = Object.fromEntries(Object.entries(auditedFamilies)
  .flatMap(([family, ids]) => ids.trim().split(/\s+/).map(id => [id, {family}])));

// この料理群は旧版で一律「その他」だったもの。調理内容が明確なもの
// に限って料理の系統を補い、水・果物・ナッツなどは「その他」のままです。
const westernIds = `
  staple-sesame-toast daily-snack-butter-cookie daily-snack-chocolate
  daily-snack-chocolate-cookie daily-snack-vanilla-ice daily-snack-cocoa-ice
  daily-snack-custard-pudding daily-snack-yoghurt-parfait daily-snack-plain-pancake
  daily-snack-strawberry-crepe daily-snack-banana-cake daily-snack-chocolate-cake
  daily-snack-sweet-french-toast daily-snack-cheese-crisp daily-snack-plain-cheese
  daily-snack-mozzarella daily-snack-oven-chicken daily-snack-oven-fries
  daily-snack-bacon-cheese-roll daily-snack-hash-brown daily-snack-apple-cookie-bowl
`;
for (const id of westernIds.trim().split(/\s+/)) overrides[id] = {...overrides[id], genre:'洋食'};
for (const id of ['daily-snack-rice-cracker', 'daily-snack-oven-karaage', 'daily-snack-takoyaki']) {
  overrides[id] = {...overrides[id], genre:'和食'};
}
overrides['daily-snack-pork-bun'] = {genre:'中華'};
overrides['daily-snack-oven-karaage'] = {
  ...overrides['daily-snack-oven-karaage'], role:'main', staple:false,
  mealBase:false, variantLabel:'オーブン調理',
};
overrides['snack-edamame'] = {...overrides['snack-edamame'], variantLabel:'枝豆（薄塩）'};
overrides['breakfast-natto-okra'] = {...overrides['breakfast-natto-okra'], variantLabel:'納豆とオクラの冷ややっこ'};

/**
 * 公開レシピに一覧用のメタデータを付ける純関数です。
 * 原材料・栄養値・手順・IDには触れず、明示済みの提供形態も維持します。
 * 手入力には性質を推測せず「分類未設定」を用います。
 */
export function decorateRecipe(recipe) {
  // recipeFamily / recipeNature と共通の形式検査を先に行います。
  recipeFamily(recipe);
  const next = {...recipe, ...(recipe?.custom ? {} : overrides[recipe?.id])};
  const family = recipeFamily(next);
  const nature = recipeNature({
    ...next,
    ...(next.nature === undefined && !next.custom && readyToEatIds.has(next.id) ? {nature:'ready-to-eat'} : {}),
  });
  const smallDish = family === 'small-dish';
  const result = {
    ...next, family: next.role === 'soup' ? storedSoupFamily(next) : family, nature,
    variantLabel: typeof next.variantLabel === 'string' && next.variantLabel.trim() ? next.variantLabel.trim() : next.name,
    role: smallDish ? 'side' : next.role,
    staple: smallDish ? false : next.staple,
    mealBase: smallDish ? false : isCompleteMeal(next),
  };
  // 分量オブジェクトも共有しないため、元のレシピを書き換えずに使えます。
  if (next.portion !== undefined && next.portion && typeof next.portion === 'object') result.portion = {...next.portion};
  return result;
}
