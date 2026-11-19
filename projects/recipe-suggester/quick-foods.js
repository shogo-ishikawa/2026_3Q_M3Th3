import {CONVENIENCE_RECIPES} from './convenience-staples.js';
import {INGREDIENT_NUTRITION} from './ingredient-nutrients.js';
import {TAKEAWAY_RECIPES} from './takeaway-foods.js';
import {householdAllowsRecipe} from './household-preferences.js';
import {pastEatenRecipeMeals, uniqueRecipesById} from './taste-history.js';

const allMeals = ['breakfast', 'lunch', 'dinner', 'snack'];
const meals = allMeals.slice(0, 3), lunchDinner = ['lunch', 'dinner'];
const references = new Map([...CONVENIENCE_RECIPES, ...TAKEAWAY_RECIPES].map(recipe => [recipe.id, recipe]));
const categories = new Map();

function define(slug, name, unit, role, course, family, genre, times, stapleTypes, referenceIds) {
  const id = 'quick-food-' + slug;
  categories.set(id, {id, name, unit, role, course, family, genre, meals: times, stapleTypes,
    ingredientId: 'quick_purchase_' + slug.replaceAll('-', '_'), referenceIds});
}
define('onigiri','おにぎり','個','staple','base','onigiri','和食',allMeals,['rice','handheld'],
  ['convenience-salmon-onigiri','convenience-tuna-mayo-onigiri']);
define('sandwich','サンドイッチ','袋','staple','base','bread','洋食',allMeals,['bread','handheld'],['convenience-egg-sandwich']);
define('bento','ご飯弁当','食','staple','base','other-staple','和食',lunchDinner,['rice','rice-meal'],['convenience-nori-bento']);
define('chilled-noodles','冷たいそば','食','staple','base','soba','和食',lunchDinner,['noodle'],['convenience-zaru-soba']);
define('pasta','パスタ','食','staple','base','pasta','洋食',lunchDinner,['noodle'],['convenience-napolitan']);
define('sweet-bread','菓子パン','個','staple','base','sweet-bread','洋食',['breakfast','snack'],['bread','handheld'],
  ['convenience-melon-pan','convenience-strawberry-coppe','convenience-milk-france']);
define('steamed-bun','中華まん','個','staple','base','other-staple','中華',allMeals,['handheld'],
  ['convenience-pork-bun','convenience-pizza-bun']);
define('salad','野菜サラダ','袋','side','side','side','洋食',meals,[],['convenience-vegetable-salad']);
define('boiled-egg','ゆで卵','個','side','side','small-dish','和食',allMeals,[],['convenience-salted-egg']);
define('chicken','フライドチキン','個','main','side','meat-main','洋食',['lunch','dinner','snack'],[],
  ['convenience-famichiki','convenience-l-chiki']);
define('grilled-skewer','焼き鳥','本','main','side','meat-main','和食',lunchDinner,[],
  ['takeaway-yakitori-momo-salt','takeaway-yakitori-momo-tare','takeaway-yakitori-negima-tare']);
define('cup-soup','カップスープ','杯','soup','extra','soup','洋食',meals,[],
  ['takeaway-knorr-corn','takeaway-knorr-potage']);

define('pack-rice','パックご飯','個','staple','base','rice','和食',meals,['rice'],['rice']);
define('retort-curry','レトルトカレーの具（ご飯なし）','袋','main','side','main','洋食',lunchDinner,[],
  ['retort_beef_curry','retort_pork_curry','retort_chicken_curry']);
define('retort-rice-topping','レトルトの丼の具（ご飯なし）','袋','main','side','main','和食',lunchDinner,[],
  ['retort_oyakodon_topping']);
for (const id of ['quick-food-retort-curry','quick-food-retort-rice-topping']) {
  Object.assign(categories.get(id), {pairWithRice:true, referenceGrams:200, nature:'retort'});
}
categories.get('quick-food-pack-rice').referenceGrams = 180;
Object.assign(categories.get('quick-food-cup-soup'), {purchaseUnit:'袋', nature:'instant'});

/** 同じ購入量（1個・1包装・1本・調製後1杯）の実例から単純平均する。欠測値は推定しない。 */
function modelNutrition(category) {
  const profiles = category.referenceIds.map(id => {
    if (category.referenceGrams) {
      const perGram = INGREDIENT_NUTRITION[id].nutritionPerUnit;
      return Object.fromEntries(Object.entries(perGram).map(([key, value]) =>
        [key, value === null ? null : value * category.referenceGrams]));
    }
    const recipe = references.get(id);
    if (!recipe || recipe.portion.amount !== 1) throw Error('市販ジャンルの栄養例と1単位の分量を確認してください。');
    return recipe.manualNutrition;
  });
  return Object.fromEntries(Object.keys(profiles[0]).map(key => {
    const values = profiles.map(profile => profile[key]);
    const mean = values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return [key, mean === null ? null : Number(mean.toFixed(3))];
  }));
}

export const QUICK_FOOD_INGREDIENTS = {};
export const QUICK_FOOD_RECIPES = [];
for (const category of categories.values()) {
  const {id, name, unit, ingredientId, role, family, genre, referenceIds} = category;
  const values = modelNutrition(category);
  const label = category.referenceGrams ? '1' + unit + '（' + category.referenceGrams + 'g）' :
    id === 'quick-food-cup-soup' ? '1杯（粉末1袋を調製）' :
    id === 'quick-food-salad' ? '1袋（別売りドレッシングを除く）' : '1' + unit;
  const reference = category.referenceGrams ? '食品成分表に基づく登録食材' + referenceIds.length + '例' : '市販品' + referenceIds.length + '例';
  const sourceNote = label + 'あたりの栄養は' + reference + 'をもとにした目安です。' +
    (category.pairWithRice ? 'ご飯は別に計上します。' : '') + '原材料・分量は選ぶ商品によって変わります。';
  const sources = category.referenceGrams
    ? referenceIds.map(ref => INGREDIENT_NUTRITION[ref].nutritionSource)
    : referenceIds.map(ref => references.get(ref).sourceNote).flatMap(note => note.match(/https?:\/\/[\w./?&=%#-]+/gu) ?? []);
  QUICK_FOOD_INGREDIENTS[ingredientId] = {
    name, unit:category.purchaseUnit ?? unit, allergens: [], groups: [], proteinSources: [], ingredientsKnown: false, allergensKnown: false, shoppingKnown: true,
    nutritionPerUnit: {...values}, rawNutritionPerUnit: Object.fromEntries(Object.keys(values).map(key => [key, null])),
    estimatedNutrients: Object.keys(values).filter(key => values[key] !== null),
    nutritionSource: [sourceNote, ...new Set(sources)].join(' '), rawNutritionSource: '商品を指定していないため、実物の表示値は未登録です。',
  };
  QUICK_FOOD_RECIPES.push({
    id, name: category.pairWithRice ? name : name + '（市販）', variantLabel: name, role, family, genre, nature:category.nature ?? 'ready-to-eat',
    servings: 2, minutes: 1, staple: role === 'staple', mealBase: category.course === 'base',
    ingredients: [{id: ingredientId, amount: 2}], steps: [], tags: role === 'staple' ? [] : ['時短'], processed: true,
    ingredientsKnown: false, allergensKnown: false, shoppingKnown: true, nutritionBasis: 'estimate',
    portion: {amount: 1, unit, label}, manualNutrition: {...values}, sourceNote,
    mealOccasions: category.meals.map(meal => ({breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'})[meal]),
  });
}

export function quickFoodCategory(recipeId) {
  return categories.get(recipeId) ?? null;
}

function historyGenres(entries, byId, date, meal) {
  const counts = new Map();
  for (const ids of pastEatenRecipeMeals(entries, {date:date || undefined, meal})) {
    const genres = new Set();
    for (const id of ids) {
      const recipe = byId.get(id);
      if (recipe && !recipe.custom && recipe.genre) genres.add(recipe.genre);
    }
    for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return counts;
}

// 日付とシードで同じ条件なら同じ順序にする。店名・商品銘柄の嗜好は推定しない。
function rotation(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function quickFoodOptions(data, settings = {}, {meal = 'lunch', entries = [], date = '', seed = 0, historyRecipes = data.recipes} = {}) {
  // 市販のジャンルには商品ごとの配合がないため、原材料に依存する除外条件は確認できない。
  if (settings.allergens?.length || settings.excludedIngredients?.length || settings.dislikedIngredients?.length) return [];
  const byId = uniqueRecipesById(data.recipes);
  const evidence = historyRecipes === data.recipes ? byId : uniqueRecipesById(historyRecipes);
  const counts = historyGenres(entries, evidence, date, meal);
  const prefs = settings.preferences ?? {};
  const options = [];
  for (const category of categories.values()) {
    const recipe = byId.get(category.id);
    if (!recipe || recipe.custom || !data.ingredients[category.ingredientId] || !category.meals.includes(meal) ||
        recipe.ingredientsKnown !== false || recipe.allergensKnown !== false || recipe.ingredients?.length !== 1 ||
        recipe.ingredients[0].id !== category.ingredientId || !householdAllowsRecipe(recipe, settings.household, data)) continue;
    const history = counts.get(category.genre) ?? 0;
    const preferred = prefs.genreMode === 'single' && prefs.genre === category.genre;
    const ratio = prefs.genreMode === 'ratio' ? (prefs.genreRatios?.[category.genre] ?? 0) : 0;
    const reason = preferred || ratio > 0 ? '希望した料理ジャンル（' + category.genre + '）' :
      history > 0 ? '食べた記録にある料理ジャンル（' + category.genre + '）' : '';
    options.push({recipe, category, reason, preferred, ratio, history,
      tie: rotation([date, meal, seed, category.id].join('/'))});
  }
  return options.sort((a,b) => Number(b.preferred) - Number(a.preferred) || b.ratio - a.ratio ||
    b.history - a.history || a.tie - b.tie).map(({recipe, category, reason}) => ({recipe, category, reason}));
}
