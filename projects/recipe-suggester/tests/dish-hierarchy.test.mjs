import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {CATALOG_CATEGORIES, recipeFamily, recipeNature, recipePortion, quantityFromAmount} from '../catalog.js';
import {FOOD_CATEGORIES, COOKING_METHODS, dishSection, dishClassification,
  browseDishes, availableDishCategories, availableCookingMethods} from '../dish-hierarchy.js';

const byId = id => {
  const recipe = RECIPES.find(item => item.id === id);
  assert.ok(recipe, id);
  return recipe;
};
const displayedDishes = RECIPES.filter(recipe => ['main','side'].includes(dishSection(recipe)));
const ids = recipes => recipes.map(recipe => recipe.id);

test('表示区分は family の役割に従い、旧主菜扱いの麺や丼も主食に保つ', () => {
  const roles = new Map(CATALOG_CATEGORIES.map(item => [item.id,item.role]));
  for (const recipe of RECIPES) assert.equal(dishSection(recipe), roles.get(recipeFamily(recipe)), recipe.id);
  for (const id of ['pasta-meat','chicken-rice-bowl','udon-pork','rice-egg-omelette','rice-flour-chijimi']) {
    assert.equal(byId(id).role,'main',id);
    assert.equal(dishSection(byId(id)),'staple',id);
    assert.ok(!ids(browseDishes(RECIPES,{section:'main'})).includes(id));
  }
  assert.equal(dishSection(byId('classic-sashimi-tuna')),'main');
  assert.equal(dishSection(byId('snack-edamame')),'side');
  assert.equal(browseDishes(RECIPES).length,RECIPES.length);
});

test('表示上の主菜と副菜は全件に一意の主材料と具体的な調理法がある', () => {
  const categoryIds = new Set(FOOD_CATEGORIES.map(item => item.id));
  const methodIds = new Set(COOKING_METHODS.map(item => item.id));
  assert.equal(categoryIds.size,FOOD_CATEGORIES.length);
  assert.equal(methodIds.size,COOKING_METHODS.length);
  const reached = new Set();
  for (const recipe of displayedDishes) {
    const classification = dishClassification(recipe);
    assert.ok(categoryIds.has(classification.category),recipe.id);
    assert.ok(methodIds.has(classification.method),recipe.id);
    assert.notEqual(classification.category,'other','未監査の主材料: '+recipe.id);
    assert.notEqual(classification.method,'other','未監査の調理法: '+recipe.id);
    assert.ok(Array.isArray(classification.secondaryCategories));
    assert.equal(new Set(classification.secondaryCategories).size,classification.secondaryCategories.length,recipe.id);
    assert.ok(!classification.secondaryCategories.includes(classification.category),recipe.id);
    assert.ok(classification.secondaryCategories.every(value => categoryIds.has(value)),recipe.id);
    const result = browseDishes(RECIPES,{section:classification.section,category:classification.category,method:classification.method});
    assert.ok(result.includes(recipe),recipe.id);
    reached.add(recipe.id);
  }
  assert.equal(reached.size,displayedDishes.length);
  assert.equal(availableCookingMethods(RECIPES).reduce((sum,item) => sum+item.count,0),displayedDishes.length);
});

test('同じ揚げ物の大分類でも主材料と料理の形で正しく分ける', () => {
  const expected = [
    ['classic-croquette-potato','vegetable','croquette'],
    ['classic-croquette-pumpkin','vegetable','croquette'],
    ['classic-croquette-cream','dairy','croquette'],
    ['classic-menchi','meat','cutlet'],
    ['classic-tonkatsu','meat','cutlet'],
    ['classic-chicken-katsu','meat','cutlet'],
    ['classic-aji-fry','fish','cutlet'],
    ['classic-karaage-thigh','meat','karaage'],
    ['daily-snack-oven-karaage','meat','karaage'],
  ];
  for (const [id,category,method] of expected) {
    const result = dishClassification(byId(id));
    assert.equal(result.category,category,id);
    assert.equal(result.method,method,id);
  }
  assert.equal(recipeFamily(byId('classic-menchi')),'cutlet');
  assert.equal(recipeFamily(byId('classic-croquette-potato')),'cutlet');
  assert.equal(recipeFamily(byId('classic-aji-fry')),'cutlet');
});

test('卵・豆・野菜の小鉢は料理の実態を使い、調味料の原料では分類しない', () => {
  const expected = [
    ['classic-tamagoyaki','egg','grill'], ['classic-boiled-egg','egg','boil'],
    ['snack-edamame','bean','boil'], ['classic-side-hiyayakko','bean','cold'],
    ['classic-natto-plain','bean','cold'], ['classic-side-unohana','bean','simmer'],
    ['classic-side-potato-salad','vegetable','salad'], ['classic-side-egg-salad','egg','salad'],
    ['classic-side-vermicelli-salad','grain','salad'], ['side-029','seaweed','simmer'],
    ['side-022','mushroom','pickled'], ['classic-side-cucumber-pickle','vegetable','pickled'],
  ];
  for (const [id,category,method] of expected) {
    const result = dishClassification(byId(id));
    assert.equal(result.category,category,id);
    assert.equal(result.method,method,id);
  }
  const chicken = byId('chicken-teriyaki');
  assert.ok(chicken.ingredients.some(part => part.id === 'soy_sauce'));
  assert.deepEqual(dishClassification(chicken),{section:'main',category:'meat',secondaryCategories:[],method:'grill'});
  assert.ok(!ids(browseDishes([chicken],{category:'bean'})).includes(chicken.id));
});

test('刺身と焼き魚を魚介の調理法から選び、ソテーをムニエルとは呼ばない', () => {
  const raw = browseDishes(RECIPES,{section:'main',category:'fish',method:'sashimi'});
  assert.ok(raw.length>=10);
  assert.ok(raw.includes(byId('classic-sashimi-tuna')));
  assert.ok(raw.includes(byId('classic-sashimi-octopus')));
  assert.ok(!raw.includes(byId('classic-grilled-salmon')));
  assert.ok(browseDishes(RECIPES,{section:'main',category:'fish',method:'grill'}).includes(byId('classic-grilled-salmon')));
  assert.equal(dishClassification(byId('salmon-lemon')).method,'grill');
  assert.equal(dishClassification(byId('horse-mackerel-pan')).method,'grill');
  assert.ok(COOKING_METHODS.some(item => item.id === 'meuniere'));
  assert.deepEqual(browseDishes([byId('salmon-lemon'),byId('horse-mackerel-pan')],{method:'meuniere'}),[]);
});

test('鍋料理と煮込みを通常の煮物から区別する', () => {
  assert.equal(dishClassification(byId('chicken-tofu-pot')).method,'hotpot');
  assert.equal(dishClassification(byId('beef-tomato')).method,'stew');
  assert.equal(dishClassification(byId('cod-potato')).method,'stew');
  assert.equal(dishClassification(byId('mackerel-miso')).method,'simmer');
  assert.equal(dishClassification(byId('side-008')).method,'simmer');
});

test('追加ソースの明示分類を優先し、保存用のレシピを変更しない', () => {
  const source = Object.freeze({id:'new-source-meuniere',name:'白身魚のムニエル',role:'main',family:'fish-main',
    displayCategory:'fish',displayMethod:'meuniere',displaySecondaryCategories:Object.freeze(['vegetable'])});
  assert.deepEqual(dishClassification(source),{section:'main',category:'fish',secondaryCategories:['vegetable'],method:'meuniere'});
  assert.deepEqual(browseDishes([source],{section:'main',category:'fish',method:'meuniere'}),[source]);
  const reclassified = {...byId('chicken-teriyaki'),displayCategory:'meat',displayMethod:'stir-fry'};
  assert.equal(dishClassification(reclassified).method,'stir-fry');
  // 手入力の保存APIには表示用の新しい項目を持ち込みません。
  assert.deepEqual(dishClassification({...source,custom:true}),{section:'main',category:'other',secondaryCategories:[],method:'other'});
  for (const metadata of [
    {displayCategory:'fish'}, {displayMethod:'meuniere'},
    {displayCategory:'unregistered',displayMethod:'meuniere'},
    {displayCategory:'fish',displayMethod:'raw'},
    {displayCategory:'fish',displayMethod:'meuniere',displaySecondaryCategories:['fish']},
    {displayCategory:'fish',displayMethod:'meuniere',displaySecondaryCategories:['egg','egg']},
    {displayCategory:'fish',displayMethod:'meuniere',displaySecondaryCategories:null},
  ]) assert.throws(() => dishClassification({id:'bad-source',role:'main',family:'fish-main',...metadata}));
});

test('混合料理を補助の食材からも探せるが、一つの結果に重複しない', () => {
  const mixed = byId('classic-side-shirasu-tofu');
  assert.deepEqual(dishClassification(mixed),{section:'side',category:'bean',secondaryCategories:['fish'],method:'cold'});
  assert.deepEqual(ids(browseDishes([mixed],{category:'bean'})),[mixed.id]);
  assert.deepEqual(ids(browseDishes([mixed],{category:'fish'})),[mixed.id]);
  assert.equal(browseDishes([mixed],{category:'all'}).length,1);
  assert.deepEqual(availableDishCategories([mixed]),[
    {id:'fish',label:'魚介',count:1},{id:'bean',label:'豆・豆腐',count:1},
  ]);
  const classification = dishClassification(mixed);
  classification.secondaryCategories.push('meat');
  assert.deepEqual(dishClassification(mixed).secondaryCategories,['fish']);
});

test('食材・調理法・検索・提供形態を併用し、表示件数と実際の候補をそろえる', () => {
  const selected = {section:'main',category:'fish',method:'sashimi',query:'サーモン',nature:'ready-to-eat'};
  const filtered = browseDishes(RECIPES,selected);
  assert.deepEqual(ids(filtered),['classic-sashimi-salmon']);
  assert.deepEqual(availableDishCategories(RECIPES,selected),[{id:'fish',label:'魚介',count:1}]);
  assert.deepEqual(availableCookingMethods(RECIPES,selected),[{id:'sashimi',label:'刺身',count:1}]);
  assert.deepEqual(browseDishes(RECIPES,{...selected,nature:'instant'}),[]);
  for (const category of availableDishCategories(RECIPES,{section:'side',method:'salad'})) {
    assert.equal(category.count,browseDishes(RECIPES,{section:'side',method:'salad',category:category.id}).length);
  }
  for (const method of availableCookingMethods(RECIPES,{section:'main',category:'fish'})) {
    assert.equal(method.count,browseDishes(RECIPES,{section:'main',category:'fish',method:method.id}).length);
  }
});

test('主食・汁物・飲み物・間食を食材や調理法の「その他」へ混入させない', () => {
  const nonDishes = RECIPES.filter(recipe => !['main','side'].includes(dishSection(recipe)));
  assert.equal(browseDishes(nonDishes).length,nonDishes.length);
  assert.deepEqual(browseDishes(nonDishes,{category:'other'}),[]);
  assert.deepEqual(browseDishes(nonDishes,{method:'other'}),[]);
  assert.deepEqual(availableDishCategories(nonDishes),[]);
  assert.deepEqual(availableCookingMethods(nonDishes),[]);
  for (const section of ['staple','soup','drink','snack']) {
    const result = browseDishes(RECIPES,{section});
    assert.ok(result.length>0,section);
    assert.ok(result.every(recipe => dishSection(recipe) === section));
    assert.deepEqual(availableDishCategories(RECIPES,{section}),[]);
  }
});

test('新しい手入力を名前や調味料だけで断定せず、分類未設定でも残す', () => {
  const custom = {id:'custom-unknown',name:'しょうゆ味の私のご飯のおかず',role:'main',family:'main',
    custom:true,servings:1,ingredients:[{id:'soy_sauce',amount:5}],portion:{amount:1,unit:'人分'}};
  assert.deepEqual(dishClassification(custom),{section:'main',category:'other',secondaryCategories:[],method:'other'});
  assert.equal(recipeNature(custom),'unspecified');
  assert.deepEqual(browseDishes([custom],{section:'main',category:'other',method:'other',nature:'unspecified'}),[custom]);
  assert.deepEqual(availableCookingMethods([custom]),[{id:'other',label:'その他',count:1}]);
  assert.equal(dishClassification({...custom,id:'chicken-teriyaki'}).category,'other');
  assert.equal(browseDishes([custom],{query:'ｓｏｙ＿ｓａｕｃｅ'}).length,1);
});

test('階層表示はレシピ・保存情報・分量を変更しない', () => {
  const before = structuredClone(RECIPES);
  const rice = byId('plain-rice');
  const base = recipePortion(rice,{});
  const ratio = quantityFromAmount(rice,{},200);
  browseDishes(RECIPES,{query:'料理'});
  availableDishCategories(RECIPES);
  availableCookingMethods(RECIPES);
  assert.deepEqual(RECIPES,before);
  assert.equal(browseDishes([rice])[0],rice);
  assert.deepEqual(recipePortion(rice,{}),base);
  assert.equal(quantityFromAmount(rice,{},200),ratio);
});

test('不正な一覧と絞り込み条件を拒否する', () => {
  assert.throws(() => browseDishes(null));
  assert.throws(() => browseDishes([null]));
  assert.throws(() => dishClassification(null));
  assert.throws(() => dishSection({family:'missing'}));
  for (const options of [null,[],{section:'missing'},{category:'missing'},{method:'pickle'},{nature:'missing'},{query:4}]) {
    assert.throws(() => browseDishes(RECIPES,options));
    assert.throws(() => availableDishCategories(RECIPES,options));
    assert.throws(() => availableCookingMethods(RECIPES,options));
  }
});
