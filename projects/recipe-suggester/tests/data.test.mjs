import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, DATA_VERSION, INGREDIENTS, RECIPES } from '../data.js';
import { EXTRA_INGREDIENTS, EXPANDED_RECIPES } from '../expanded-foods.js';
import { EVERYDAY_INGREDIENTS, EVERYDAY_RECIPES } from '../everyday-foods.js';

const allowedGroups = new Set(['staple','vegetable','protein','dairy','fruit']);
const allowedProteins = new Set(['meat','fish','egg','soy']);
const allergenIds = new Set(ALLERGENS.map(item => item.id));
const byId = new Map(RECIPES.map(item => [item.id,item]));
const recipeAllergens = recipe => new Set(recipe.ingredients.flatMap(item => INGREDIENTS[item.id].allergens));

test('allergen choices contain the current 9 required and 20 recommended items once', () => {
  assert.equal(ALLERGENS.length,29);
  assert.equal(allergenIds.size,29);
  assert.equal(ALLERGENS.filter(item => item.category === 'required').length,9);
  assert.equal(ALLERGENS.filter(item => item.category === 'recommended').length,20);
  assert.equal(ALLERGENS.find(item => item.id === 'milk').label,'乳');
  assert.ok(allergenIds.has('pistachio'));
  assert.equal(ALLERGENS.find(item => item.id === 'cashew').category,'required');
});

test('every ingredient explicitly describes allergens and food groups', () => {
  for (const [id,item] of Object.entries(INGREDIENTS)) {
    assert.ok(item.name && item.unit,id);
    assert.ok(Array.isArray(item.allergens),id);
    assert.ok(Array.isArray(item.groups),id);
    assert.ok(Array.isArray(item.proteinSources),id);
    assert.equal(new Set(item.allergens).size,item.allergens.length,id);
    assert.ok(item.allergens.every(value => allergenIds.has(value)),id);
    assert.ok(item.groups.every(value => allowedGroups.has(value)),id);
    assert.ok(item.proteinSources.every(value => allowedProteins.has(value)),id);
  }
});

test('the expanded collection consists of distinct complete dishes', () => {
  assert.ok(RECIPES.length >= 200);
  assert.equal(new Set(RECIPES.map(item => item.id)).size,RECIPES.length);
  assert.equal(new Set(RECIPES.map(item => item.name)).size,RECIPES.length);
  assert.ok(RECIPES.filter(item => item.role === 'main').length >= 90);
  assert.ok(RECIPES.filter(item => item.role === 'side').length >= 60);
  assert.ok(RECIPES.filter(item => item.role === 'soup').length >= 40);
  for (const recipe of RECIPES) {
    assert.ok(['main','side','soup','staple','drink','snack'].includes(recipe.role),recipe.id);
    assert.equal(recipe.servings,2,recipe.id);
    assert.ok(Number.isFinite(recipe.minutes) && recipe.minutes > 0,recipe.id);
    assert.ok(Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0,recipe.id);
    assert.equal(new Set(recipe.ingredients.map(item => item.id)).size,recipe.ingredients.length,recipe.id);
    for (const item of recipe.ingredients) {
      assert.ok(INGREDIENTS[item.id],recipe.id + ':' + item.id);
      assert.ok(Number.isFinite(item.amount) && item.amount > 0,recipe.id + ':' + item.id);
    }
    assert.ok(Array.isArray(recipe.steps),recipe.id);
    if(recipe.nature==='home-cooked'){
      assert.ok(recipe.steps.length>=1,recipe.id);
      if(['main','side','soup'].includes(recipe.role))assert.ok(recipe.steps.length>=4,recipe.id);
    }else assert.deepEqual(recipe.steps,[],recipe.id);
    assert.ok(recipe.steps.every(step => typeof step === 'string' && step.length >= 10),recipe.id);
    assert.equal(typeof recipe.staple,'boolean',recipe.id);
  }
});

test('the calendar catalogue adds meaningful staples, drinks and snacks', () => {
  assert.equal(DATA_VERSION,'3.22.0');
  assert.ok(EXPANDED_RECIPES.length >= 100);
  assert.ok(RECIPES.length >= 305);
  assert.ok(EXPANDED_RECIPES.filter(item => item.role === 'staple').length >= 20);
  assert.ok(EXPANDED_RECIPES.filter(item => item.role === 'drink').length >= 15);
  assert.ok(EXPANDED_RECIPES.filter(item => item.role === 'snack').length >= 20);
  const stapleIngredients = new Set(EXPANDED_RECIPES.filter(item => item.role === 'staple')
    .flatMap(item => item.ingredients.map(ingredient => ingredient.id)));
  for (const id of ['rice','bread','udon','pasta','soba','oatmeal','brown_rice','somen']) {
    assert.ok(stapleIngredients.has(id),id);
  }
  for (const item of EXPANDED_RECIPES.filter(item => item.role === 'staple')) assert.equal(item.staple,true,item.id);
  for (const item of EXPANDED_RECIPES.filter(item => ['drink','snack'].includes(item.role))) assert.equal(item.staple,false,item.id);
});

test('new food and beverage portions carry explicit allergen and ingredient information', () => {
  assert.ok(recipeAllergens(byId.get('drink-milk')).has('milk'));
  assert.ok(recipeAllergens(byId.get('drink-soy-milk')).has('soy'));
  assert.ok(recipeAllergens(byId.get('drink-orange-juice')).has('orange'));
  assert.ok(recipeAllergens(byId.get('drink-apple-juice')).has('apple'));
  assert.ok(recipeAllergens(byId.get('snack-almond')).has('almond'));
  assert.ok(recipeAllergens(byId.get('snack-cashew')).has('cashew'));
  assert.ok(recipeAllergens(byId.get('staple-wholegrain-bread')).has('wheat'));
  assert.ok(recipeAllergens(byId.get('staple-sesame-soba')).has('buckwheat'));
  assert.deepEqual([...recipeAllergens(byId.get('drink-water'))],[]);
  for (const item of RECIPES.filter(item => item.role === 'drink' && /無糖|砂糖無添加/.test(item.name))) {
    assert.ok(!item.ingredients.some(ingredient => ingredient.id === 'sugar'),item.id);
  }
  assert.deepEqual(byId.get('drink-milk').ingredients,[{id:'milk',amount:400}]);
  assert.deepEqual(byId.get('snack-almond').ingredients,[{id:'almond',amount:30}]);
  assert.deepEqual(EXTRA_INGREDIENTS.orange_juice.derivedFrom,['orange']);
  assert.deepEqual(EXTRA_INGREDIENTS.apple_juice.derivedFrom,['apple']);
  assert.deepEqual(EXTRA_INGREDIENTS.wholegrain_bread.derivedFrom,['bread']);
});

test('every ingredient provides nullable per-unit nutrition with source attribution', () => {
  const keys = ['kcal','protein','fat','carbs','fiber','salt'];
  for (const [id,item] of Object.entries(INGREDIENTS)) {
    assert.ok(typeof item.nutritionSource === 'string' && item.nutritionSource.length > 5,id);
    assert.deepEqual(Object.keys(item.nutritionPerUnit),keys,id);
    for (const key of keys) {
      const value = item.nutritionPerUnit[key];
      assert.ok(value === null || (Number.isFinite(value) && value >= 0),`${id}:${key}`);
    }
  }
  // 分量g/mlをそのまま掛け算できる値です。100gあたりの値を再び掛けないようにします。
  assert.ok(INGREDIENTS.rice.nutritionPerUnit.kcal > 1 && INGREDIENTS.rice.nutritionPerUnit.kcal < 2);
  assert.ok(INGREDIENTS.milk.nutritionPerUnit.kcal > 0.5 && INGREDIENTS.milk.nutritionPerUnit.kcal < 1);
  assert.equal(INGREDIENTS.water.nutritionPerUnit.kcal,0);
});

test('compound ingredients conservatively preserve their stated allergen ingredients', () => {
  const needs = {
    soy_sauce:['wheat','soy'], miso:['soy'], butter:['milk'],
    bread:['wheat','egg','milk','soy'], breadcrumbs:['wheat','egg','milk','soy'],
    mayonnaise:['egg','soy','milk','wheat'], soba:['buckwheat','wheat'],
  };
  for (const [id,expected] of Object.entries(needs)) {
    for (const allergen of expected) assert.ok(INGREDIENTS[id].allergens.includes(allergen),id + ':' + allergen);
  }
  assert.match(INGREDIENTS.curry_powder.name,/香辛料のみ/);
  assert.match(INGREDIENTS.canned_tomato.name,/トマト/);
});

test('an ingredient such as soy sauce cannot disappear from a dish allergen profile', () => {
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('wheat'));
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('soy'));
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('chicken'));
  assert.ok(recipeAllergens(byId.get('chicken-cashew')).has('cashew'));
  assert.ok(recipeAllergens(byId.get('soba-chicken')).has('buckwheat'));
  assert.ok(recipeAllergens(byId.get('pasta-milk-salmon')).has('milk'));
  assert.ok(recipeAllergens(byId.get('pasta-milk-salmon')).has('salmon'));
  assert.deepEqual([...recipeAllergens(byId.get('cod-salt-steam'))],[]);
});

test('rice is separate from mains which already include a staple', () => {
  assert.equal(byId.get('plain-rice').role,'staple');
  assert.equal(byId.get('plain-rice').ingredients[0].id,'rice');
  for (const id of ['chicken-rice-bowl','pasta-meat','udon-pork','soba-chicken','chicken-sandwich']) {
    assert.equal(byId.get(id).staple,true,id);
    assert.ok(byId.get(id).ingredients.some(item => INGREDIENTS[item.id].groups.includes('staple')),id);
  }
  assert.equal(byId.get('chicken-teriyaki').staple,false);
});

test('seasonings do not contribute a vegetable or protein serving proxy', () => {
  for (const id of ['soy_sauce','miso','tomato_paste','garlic','ginger','scallion_garnish','sesame']) {
    assert.deepEqual(INGREDIENTS[id].groups,[],id);
  }
});


test('derived ingredients refer to known ingredients without cycles', () => {
  const visit = (id, path = new Set()) => {
    assert.ok(INGREDIENTS[id],id);
    assert.ok(!path.has(id),'cycle: ' + [...path,id].join(' → '));
    const ancestors = INGREDIENTS[id].derivedFrom ?? [];
    assert.ok(Array.isArray(ancestors),id);
    const next = new Set([...path,id]);
    for (const ancestor of ancestors) visit(ancestor,next);
  };
  for (const id of Object.keys(INGREDIENTS)) visit(id);
  assert.deepEqual(INGREDIENTS.tomato_paste.derivedFrom,['tomato']);
  assert.deepEqual(INGREDIENTS.canned_tomato.derivedFrom,['tomato']);
  assert.deepEqual(INGREDIENTS.raisin.derivedFrom,['grape']);
  assert.deepEqual(INGREDIENTS.kiriboshi_daikon.derivedFrom,['daikon']);
  assert.deepEqual(INGREDIENTS.tofu.derivedFrom,['soybeans']);
  assert.deepEqual(INGREDIENTS.cheese.derivedFrom,['milk']);
});

test('instructions use proportions instead of absolute ingredient quantities', () => {
  for (const recipe of RECIPES) {
    for (const step of recipe.steps) {
      assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),recipe.id + ': ' + step);
    }
  }
});

test('the original mood choices are available on mains and have consistent meanings', () => {
  const moodTags = new Set(['さっぱり','ガッツリ','時短','定番']);
  for (const recipe of RECIPES) {
    assert.ok(recipe.tags.every(tag => moodTags.has(tag)),recipe.id);
    assert.equal(new Set(recipe.tags).size,recipe.tags.length,recipe.id);
    if (recipe.role === 'staple') assert.deepEqual(recipe.tags,[],recipe.id);
    else assert.equal(recipe.tags.includes('時短'),recipe.minutes <= 20,recipe.id);
  }
  for (const tag of moodTags) {
    assert.ok(RECIPES.filter(recipe => recipe.role === 'main' && recipe.tags.includes(tag)).length >= 5,tag);
  }
  assert.ok(byId.get('chicken-salt-lemon').tags.includes('さっぱり'));
  assert.ok(byId.get('beef-rice-bowl').tags.includes('ガッツリ'));
  assert.ok(byId.get('pork-ginger').tags.includes('時短'));
  assert.ok(byId.get('chicken-teriyaki').tags.includes('定番'));
  assert.ok(!byId.get('chicken-root-simmer').tags.includes('時短'));
});

test('five cuisine choices include explicitly classified ethnic dishes while retaining other dishes', () => {
  const genres = new Set(['和食','洋食','中華','エスニック','その他']);
  assert.deepEqual(new Set(RECIPES.map(recipe => recipe.genre)),genres);
  assert.ok(RECIPES.filter(recipe => recipe.role === 'main' && recipe.genre === 'エスニック').length >= 5);
  for (const id of ['chicken-curry-yogurt','tomato-chicken-curry','side-019','soup-021']) {
    assert.equal(byId.get(id).genre,'エスニック',id);
  }
  assert.equal(byId.get('side-033').genre,'その他');
  assert.equal(byId.get('soup-032').genre,'その他');
  assert.equal(byId.get('rice-baked-cheese').genre,'洋食');
  assert.equal(byId.get('chicken-teriyaki').genre,'和食');
});


test('daily staples separate rice from rice balls and carry usable portion units', () => {
  assert.equal(byId.get('plain-rice').family,'rice');
  assert.equal(byId.get('plain-rice').portion.amount,150);
  assert.equal(byId.get('plain-rice').portion.unit,'g');
  const rice=EVERYDAY_RECIPES.filter(r=>r.family==='rice');
  const onigiri=EVERYDAY_RECIPES.filter(r=>r.family==='onigiri');
  assert.ok(rice.length>=4);
  assert.ok(onigiri.length>=8);
  for(const r of rice){assert.equal(r.portion.unit,'g');assert.equal(r.mealBase,false);}
  for(const r of onigiri){
    assert.equal(r.portion.unit,'個');assert.equal(r.portion.amount,1);assert.equal(r.mealBase,false);
    assert.equal(r.ingredients.find(p=>p.id==='rice').amount/r.servings,100,r.id);
  }
  assert.equal(byId.get('staple-salt-onigiri').family,'onigiri');
  assert.match(byId.get('staple-salt-onigiri').variantLabel,/大きめ/);
});

test('everyday families include familiar noodles, pasta, curry, pizza and fried rice', () => {
  assert.ok(EVERYDAY_RECIPES.length>=90);
  const required={
    udon:['かけ','きつね','たぬき','わかめ','肉','天ぷら','カレー'],
    soba:['かけ','きつね','たぬき','わかめ','肉','天ぷら','カレー'],
    pasta:['ペペロンチーノ','カルボナーラ','ジェノベーゼ','ボロネーゼ','アラビアータ','ペスカトーレ'],
    yakisoba:['ソース','塩'],curry:['チキン','ポーク','ビーフ','野菜','キーマ'],
    pizza:['マルゲリータ','ミックス','照り焼きチキン'], 'fried-rice':['卵','五目','キムチ'],
  };
  for(const [family,variants]of Object.entries(required)){
    const members=EVERYDAY_RECIPES.filter(r=>r.family===family);
    for(const variant of variants)assert.ok(members.some(r=>r.variantLabel===variant),family+':'+variant);
    for(const r of members){assert.equal(r.role,'staple');assert.equal(r.mealBase,true);}
  }
  for(const r of EVERYDAY_RECIPES){
    assert.ok(r.variantLabel&&r.family,r.id);
    assert.ok(r.portion&&r.portion.amount>0,r.id);
    assert.ok(['g','ml','個','皿','杯','枚','袋'].includes(r.portion.unit),r.id);
    assert.equal(typeof r.mealBase,'boolean',r.id);
  }
});

test('drinks and soups offer common variants within their families', () => {
  const variants=family=>EVERYDAY_RECIPES.filter(r=>r.family===family).map(r=>r.variantLabel);
  assert.ok(variants('water').includes('炭酸水'));
  assert.ok(variants('water').includes('レモン炭酸水'));
  assert.ok(variants('soft-drink').includes('コーラ'));
  assert.ok(variants('miso-soup').includes('玉ねぎ'));
  assert.ok(variants('miso-soup').includes('あさり'));
  assert.ok(variants('miso-soup').includes('豚汁'));
  assert.equal(byId.get('drink-water').family,'water');
  assert.equal(byId.get('soup-001').family,'miso-soup');
});

test('ordinary snacks include sweets, desserts, cheese and hot snacks', () => {
  const wanted={snack:['ポテトチップス','せんべい'],sweets:['クッキー','チョコレート'],dessert:['バニラアイス','プリン','チョコケーキ'],cheese:['チーズ'], 'hot-snack':['チキン','唐揚げ','ポテト','たこ焼き','肉まん']};
  for(const [family,variants]of Object.entries(wanted))for(const variant of variants){
    const r=EVERYDAY_RECIPES.find(r=>r.family===family&&r.variantLabel===variant);
    assert.ok(r,family+':'+variant);assert.equal(r.role,'snack');assert.equal(r.mealBase,false);
  }
  assert.deepEqual(byId.get('daily-snack-vanilla-ice').portion,{amount:100,unit:'g'});
  assert.deepEqual(byId.get('daily-snack-chocolate').ingredients,[{id:'chocolate',amount:40}]);
});

test('prepared ingredients retain explicit product assumptions and known derived allergens', () => {
  assert.ok(Object.keys(EVERYDAY_INGREDIENTS).length>=23);
  for(const id of ['pizza_base','chocolate','rice_cracker','biscuit','vanilla_ice_cream','kimchi','steamed_pork_bun']){
    assert.ok(EVERYDAY_INGREDIENTS[id].note,id);
    assert.ok(EVERYDAY_INGREDIENTS[id].allergens.length,id);
  }
  assert.ok(recipeAllergens(byId.get('daily-udon-tempura')).has('shrimp'));
  assert.ok(recipeAllergens(byId.get('daily-pasta-carbonara')).has('egg'));
  assert.ok(recipeAllergens(byId.get('daily-pasta-carbonara')).has('milk'));
  assert.ok(recipeAllergens(byId.get('daily-fried-rice-kimchi')).has('shrimp'));
  assert.equal(byId.get('daily-pasta-genovese').ingredients.find(p=>p.id==='fresh_basil').amount,30);
});
