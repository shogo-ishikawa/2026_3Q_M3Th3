import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_CATEGORIES, FOOD_NATURES, recipeFamily, recipeNature, recipePortion, quantityFromAmount, catalogFamilies, catalogVariants, isCompleteMeal} from '../catalog.js';
import {RECIPES, INGREDIENTS} from '../data.js';
const data = {ingredients: INGREDIENTS, recipes: RECIPES};
const byId = id => RECIPES.find(recipe => recipe.id === id);
const meal = (id, name, role = 'staple', extra = {}) => ({id, name, role, servings: 2, ingredients: [], staple: role === 'staple', ...extra});

test('every built-in menu has exactly one registered family', () => {
  const ids = new Set(CATALOG_CATEGORIES.map(category => category.id));
  assert.equal(ids.size, CATALOG_CATEGORIES.length);
  for (const recipe of RECIPES) assert.ok(ids.has(recipeFamily(recipe)), recipe.id);
  assert.equal(catalogFamilies(RECIPES).reduce((sum, family) => sum + family.count, 0), RECIPES.length);
});

test('rice and onigiri are distinct top-level groups without losing old IDs', () => {
  assert.equal(recipeFamily(byId('plain-rice')), 'rice');
  assert.equal(recipeFamily(byId('staple-wakame-rice')), 'rice');
  assert.equal(recipeFamily(byId('staple-salt-onigiri')), 'onigiri');
  assert.equal(recipeFamily(byId('staple-grilled-onigiri')), 'onigiri');
  const riceIds = catalogVariants(RECIPES, 'rice').map(recipe => recipe.id);
  assert.ok(riceIds.includes('plain-rice'));
  assert.ok(!riceIds.includes('staple-salt-onigiri'));
  assert.ok(catalogFamilies(RECIPES, {role: 'staple'}).some(family => family.id === 'onigiri'));
});

test('old main dishes remain discoverable under noodle, pasta, curry and rice families', () => {
  assert.equal(recipeFamily(byId('udon-pork')), 'udon');
  assert.equal(recipeFamily(byId('soba-chicken')), 'soba');
  assert.equal(recipeFamily(byId('pasta-meat')), 'pasta');
  assert.equal(recipeFamily(byId('tomato-chicken-curry')), 'curry');
  assert.equal(recipeFamily(byId('egg-fried-rice')), 'fried-rice');
  // このIDは歴史的にfried-riceですが、実際のレシピ名は混ぜご飯です。
  assert.equal(recipeFamily(byId('salmon-fried-rice')), 'rice');
  const families = catalogFamilies([byId('udon-pork'), byId('pasta-meat')], {role:'staple'});
  assert.deepEqual(families.map(family => family.id), ['udon', 'pasta']);
  assert.equal(catalogFamilies([byId('udon-pork')], {role:'main'}).length, 0);
});

test('miso soup fillings and water variants stay inside their broad family', () => {
  assert.equal(recipeFamily(meal('sample-miso', '豆腐とわかめのみそ汁', 'soup')), 'miso-soup');
  assert.equal(recipeFamily(meal('sample-pork', '豚汁', 'soup')), 'miso-soup');
  assert.equal(recipeFamily(meal('sample-other', 'トマトスープ', 'soup')), 'vegetable-soup');
  for (const name of ['水', 'レモン水', '炭酸水']) assert.equal(recipeFamily(meal('custom-'+name, name, 'drink')), 'water');
  assert.equal(recipeFamily(meal('custom-cafe', 'カフェオレ', 'drink')), 'coffee');
  assert.equal(recipeFamily(meal('custom-ramen', '中華そば')), 'ramen');
  assert.equal(recipeFamily(meal('custom-udon', 'カレーうどん')), 'udon');
});

test('common foods sort before unusual rice variants and menu search is normalised', () => {
  const recipes = [meal('odd','ターメリック混ぜご飯'), meal('plain','白米'), meal('brown','玄米ご飯'), meal('riceball','塩むすび')];
  assert.equal(catalogVariants(recipes, 'rice')[0].id, 'plain');
  assert.ok(catalogVariants(recipes, 'rice').findIndex(r => r.id === 'brown') < catalogVariants(recipes, 'rice').findIndex(r => r.id === 'odd'));
  assert.equal(catalogFamilies([meal('p','PASTA ナポリタン')], {query:'ｐａｓｔａ'})[0].id, 'pasta');
  assert.deepEqual(catalogVariants(recipes, 'missing'), []);
});

test('rice uses grams while onigiri uses piece counts', () => {
  const rice = byId('plain-rice'), onigiri = byId('staple-salt-onigiri');
  assert.equal(recipePortion(rice, data).amount, 150);
  assert.equal(recipePortion(rice, data).unit, 'g');
  assert.equal(quantityFromAmount(rice, data, 75), 0.5);
  assert.equal(recipePortion(onigiri, data).unit, '個');
  assert.equal(quantityFromAmount(onigiri, data, 2), 2);
});

test('explicit completed portions override raw ingredient weights, including half a pizza', () => {
  const mixed = meal('mixed','炊き込みご飯','staple',{family:'rice',ingredients:[{id:'rice',amount:240},{id:'carrot',amount:60}],portion:{amount:150,unit:'g'}});
  assert.equal(quantityFromAmount(mixed, data, 225), 1.5);
  const pizza = meal('pizza','マルゲリータ','staple',{family:'pizza',portion:{amount:0.5,unit:'枚'}});
  assert.equal(quantityFromAmount(pizza, data, 1), 2);
  assert.equal(quantityFromAmount(pizza, data, 0.25), 0.5);
  const custom = meal('personal','手入力メニュー','main',{portion:{amount:1,unit:'人分'}});
  assert.equal(quantityFromAmount(custom,data,0.5),0.5);
});

test('drink volumes add ml ingredients and never count grams as millilitres', () => {
  const drink = meal('sample','カフェオレ','drink',{ingredients:[{id:'coffee',amount:200},{id:'milk',amount:200},{id:'sugar',amount:10}]});
  assert.equal(recipePortion(drink,data).amount,200);
  assert.equal(recipePortion(drink,data).unit,'ml');
  assert.equal(quantityFromAmount(drink,data,100),0.5);
  assert.equal(recipePortion(meal('x','飲み物','drink'),data).unit,'杯');
});

test('blended fruit, yoghurt and cocoa drinks use cups when finished volume is unknown', () => {
  for (const id of ['drink-banana-soy', 'drink-strawberry-milk', 'drink-yogurt', 'drink-milk-cocoa', 'drink-soy-cocoa']) {
    const recipe = byId(id);
    assert.ok(recipe, id);
    assert.equal(recipe.portion, undefined, id);
    assert.deepEqual(recipePortion(recipe, data), {amount:1, unit:'杯', label:'1人分＝1 杯'}, id);
    assert.equal(quantityFromAmount(recipe, data, 1), 1, id);
    assert.equal(quantityFromAmount(recipe, data, 0.5), 0.5, id);
  }
  // バナナ70g/人を液体150mlの外へ無視して150ml/人とは表示しません。
  const banana = byId('drink-banana-soy');
  assert.equal(banana.ingredients.find(part => part.id === 'soy_milk').amount / banana.servings, 150);
  assert.equal(banana.ingredients.find(part => part.id === 'banana').amount / banana.servings, 70);
});

test('finished-volume metadata wins while pure beverages and light flavouring retain ml', () => {
  for (const id of ['drink-green-tea', 'drink-coffee', 'drink-cafe-au-lait', 'drink-ginger-tea', 'drink-water']) {
    assert.equal(recipePortion(byId(id), data).unit, 'ml', id);
  }
  const explicit = {...byId('drink-banana-soy'), portion:{amount:220, unit:'ml', label:'出来上がりを量った220 ml'}};
  assert.deepEqual(recipePortion(explicit, data), {amount:220, unit:'ml', label:'出来上がりを量った220 ml'});
  assert.equal(quantityFromAmount(explicit, data, 110), 0.5);
  const verySweet = meal('sweet','シロップ飲料','drink',{ingredients:[{id:'water',amount:400},{id:'sugar',amount:200}]});
  assert.equal(recipePortion(verySweet, data).unit, '杯');
  const combined = meal('mixed-flavour','混合飲料','drink',{ingredients:[{id:'water',amount:400},{id:'sugar',amount:16},{id:'ginger',amount:16}]});
  assert.equal(recipePortion(combined, data).unit, '杯');
});

test('water used to boil noodles is not treated as an edible completed weight', () => {
  assert.deepEqual(recipePortion(byId('staple-warm-soba'),data),{amount:1,unit:'皿',label:'1人分＝1 皿'});
  assert.equal(recipePortion(byId('staple-oatmeal-water'),data).unit,'皿');
  assert.equal(recipePortion(meal('s','みそ汁','soup'),data).unit,'杯');
  assert.equal(recipePortion(byId('staple-rice-porridge'),data).unit,'杯');
  assert.equal(recipePortion(byId('soy-milk-risotto'),data).unit,'杯');
});

test('complete meals skip extra main dishes and explicit mealBase wins', () => {
  for(const family of ['pasta','curry','udon','soba','yakisoba','ramen','somen','pizza','fried-rice','donburi','sushi','omelette-rice','burger']) assert.equal(isCompleteMeal(meal(family,family,'staple',{family})),true);
  for(const family of ['rice','onigiri','bread']) assert.equal(isCompleteMeal(meal(family,family,'staple',{family})),false);
  assert.equal(isCompleteMeal(byId('chicken-sandwich')),true);
  assert.equal(isCompleteMeal(meal('explicit','明示','staple',{family:'rice',mealBase:true})),true);
  assert.equal(isCompleteMeal(meal('explicit','明示','staple',{family:'pasta',mealBase:false})),false);
});

test('ordinary main dishes and complete staples have their own discoverable families', () => {
  const expected = [
    ['鶏の唐揚げ','karaage'], ['さばの塩焼き','grilled-fish'], ['まぐろのお刺身','sashimi'],
    ['プレーンオムレツ','egg-main'], ['ハンバーグ','meat-main'], ['麻婆豆腐','bean-main'],
    ['えびのチリソース','fish-main'], ['メンチカツ','cutlet'],
    ['にぎり寿司','sushi'], ['オムライス','omelette-rice'], ['ハンバーガー','burger'],
  ];
  for (const [name,family] of expected) {
    const role = ['sushi','omelette-rice','burger'].includes(family) ? 'staple' : 'main';
    assert.equal(recipeFamily(meal('custom-'+name,name,role)),family,name);
  }
  // 米粉という材料名や rice という旧IDを、炊いたご飯と取り違えません。
  assert.equal(recipeFamily(byId('rice-flour-chijimi')),'other-staple');
  assert.equal(recipePortion(byId('rice-flour-chijimi'),data).unit,'皿');
});

test('sushi piece counts and packaged meal counts scale the original serving', () => {
  const sushi = meal('sushi','にぎり寿司','staple',{family:'sushi',portion:{amount:8,unit:'貫'}});
  assert.equal(quantityFromAmount(sushi,data,4),0.5);
  const instant = meal('cup','カップ麺','staple',{family:'ramen',portion:{amount:1,unit:'食'}});
  assert.equal(quantityFromAmount(instant,data,2),2);
  const maki = meal('maki','細巻き','staple',{family:'sushi',portion:{amount:1,unit:'切れ'}});
  assert.equal(quantityFromAmount(maki,data,3),3);
  const bar = meal('bar','補食バー','snack',{family:'functional-snack',portion:{amount:1,unit:'本'}});
  assert.equal(quantityFromAmount(bar,data,0.5),0.5);
});

test('清涼飲料水と酒・プロテイン飲料・その他の飲み物を分ける', () => {
  const categories = new Map(CATALOG_CATEGORIES.map(category=>[category.id,category]));
  assert.equal(categories.get('soft-drink').label,'清涼飲料水');
  for (const family of ['alcohol','protein-drink','other-drink']) assert.equal(categories.get(family).role,'drink');
  assert.equal(categories.get('functional-snack').role,'snack');
  for (const name of ['コーラ','スポーツドリンク','エナジードリンク','レモネード']) {
    assert.equal(recipeFamily(meal('custom-'+name,name,'drink')),'soft-drink',name);
  }
  for (const name of ['ビール','赤ワイン','日本酒','焼酎','ウイスキー','ハイボール']) {
    const recipe=meal('custom-'+name,name,'drink');
    assert.equal(recipeFamily(recipe),'alcohol',name);
    assert.equal(isCompleteMeal(recipe),false,name);
  }
  assert.equal(recipeFamily(meal('non-alcoholic-beer','ノンアルコールビール','drink')),'soft-drink');
  for (const name of ['ホエイプロテイン','ソイプロテイン']) {
    assert.equal(recipeFamily(meal('custom-'+name,name,'drink')),'protein-drink',name);
  }
  for (const id of ['drink-milk-cocoa','drink-soy-cocoa','drink-yogurt']) assert.equal(recipeFamily(byId(id)),'other-drink',id);
  for (const id of ['daily-drink-cola','daily-drink-sports','daily-drink-lemonade']) assert.equal(recipeFamily(byId(id)),'soft-drink',id);
  for (const name of ['プロテインバー','サラダチキン','バランス栄養食品']) {
    assert.equal(recipeFamily(meal('custom-'+name,name,'snack')),'functional-snack',name);
  }
});

test('新飲料の量は元の基準量を使い、プロテインの粉gを完成mlへ足さない', () => {
  const beer=meal('beer','ビール','drink',{family:'alcohol',portion:{amount:350,unit:'ml'}});
  assert.equal(quantityFromAmount(beer,data,175),0.5);
  const ingredients={...INGREDIENTS,protein_powder:{unit:'g'}};
  const mixed=meal('soy-protein','ソイプロテイン','drink',{family:'protein-drink',ingredients:[{id:'water',amount:400},{id:'protein_powder',amount:60}]});
  assert.equal(recipePortion(mixed,{ingredients}).unit,'杯');
  const ready={...mixed,portion:{amount:200,unit:'ml'}};
  assert.equal(quantityFromAmount(ready,{ingredients},100),0.5);
  assert.equal(catalogVariants([beer,mixed], 'protein-drink').length,1);
  assert.deepEqual(catalogFamilies([beer,mixed],{role:'snack'}),[]);
});

test('cooking form filters refine dish families without replacing them', () => {
  const recipes = [
    meal('home','手作りチキンカレー','staple',{family:'curry',nature:'home-cooked'}),
    meal('pack','レトルトビーフカレー','staple',{family:'curry',nature:'retort'}),
    meal('cup','カップうどん','staple',{family:'udon',nature:'instant'}),
    meal('own','自分の料理','main',{family:'main',custom:true}),
  ];
  assert.deepEqual(catalogFamilies(recipes,{nature:'retort'}),[{id:'curry',label:'カレー',count:1}]);
  assert.deepEqual(catalogVariants(recipes,'curry',{nature:'retort'}).map(r=>r.id),['pack']);
  assert.deepEqual(catalogVariants(recipes,'curry',{nature:'instant'}),[]);
  assert.equal(catalogFamilies(recipes,{role:'staple',nature:'home-cooked',query:'カレー'})[0].count,1);
  assert.equal(catalogFamilies(recipes,{nature:'unspecified'})[0].id,'main');
  assert.equal(catalogFamilies(recipes,{query:'即席'})[0].id,'udon');
  assert.equal(recipeNature(recipes[3]),'unspecified');
  assert.equal(recipeNature(meal('default','家庭の料理','main')),'home-cooked');
  assert.equal(new Set(FOOD_NATURES.map(n=>n.id)).size,FOOD_NATURES.length);
  for (const nature of ['unknown',null,42]) assert.throws(()=>recipeNature({nature}));
});

test('invalid portions and nonpositive amounts are rejected', () => {
  for(const n of [0,-1,NaN,Infinity,'150']) assert.throws(()=>quantityFromAmount(byId('plain-rice'),data,n));
  for(const p of [{amount:0,unit:'g'},{amount:150,unit:'kg'},null]) assert.throws(()=>recipePortion(meal('x','ご飯','staple',{portion:p}),data));
  assert.throws(()=>recipeFamily({family:'unknown'}));
  assert.throws(()=>isCompleteMeal({mealBase:'yes'}));
  assert.throws(()=>catalogFamilies(null));
});
