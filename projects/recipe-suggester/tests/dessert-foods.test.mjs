import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {DESSERT_INGREDIENTS,DESSERT_RECIPES} from '../dessert-foods.js';
import {recipeFamily,recipeNature,recipePortion,quantityFromAmount} from '../catalog.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe,itemNutrition,recipeNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const ownIds=new Set(DESSERT_RECIPES.map(r=>r.id));
const unknown=()=>Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null]));
const ownProfiles=Object.fromEntries(DESSERT_RECIPES.map(r=>[r.ingredients[0].id,{
  nutritionPerUnit:unknown(),nutritionSource:r.sourceNote,
}]));
const data={allergens:ALLERGENS,
  ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...DESSERT_INGREDIENTS}).map(([id,ingredient])=>[
    id,{...ingredient,...(INGREDIENT_NUTRITION[id]??ownProfiles[id])},
  ])),
  recipes:[...RECIPES.filter(r=>!ownIds.has(r.id)),...DESSERT_RECIPES]};
const get=slug=>DESSERT_RECIPES.find(r=>r.id===`dessert-${slug}`);
const close=(a,b)=>assert.ok(typeof a==='number'&&Math.abs(a-b)<1e-8,`${a} != ${b}`);
const item=(slug,amount)=>{const r=get(slug);return itemFromRecipe(describeRecipe(r.id,data),data,quantityFromAmount(r,data,amount));};
const planned=items=>[{id:'dessert-plan',date:'2026-11-13',meal:'snack',status:'planned',items,note:''}];
const shopping=items=>shoppingForEntries(planned(items),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});

test('市販スイーツ24品をドーナツ・ケーキ・和菓子・氷菓などへ整理する',()=>{
  assert.equal(DESSERT_RECIPES.length,24);assert.equal(Object.keys(DESSERT_INGREDIENTS).length,24);
  assert.equal(new Set(data.recipes.map(r=>r.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(r=>r.name)).size,data.recipes.length);
  const families=Object.fromEntries(['donut','cake','japanese-sweet','ice-dessert','dessert'].map(id=>[id,DESSERT_RECIPES.filter(r=>recipeFamily(r)===id).length]));
  assert.deepEqual(families,{donut:6,cake:8,'japanese-sweet':3,'ice-dessert':3,dessert:4});
  for(const r of DESSERT_RECIPES){
    assert.equal(r.role,'snack');assert.equal(r.servings,2);assert.equal(recipeNature(r),'ready-to-eat');
    assert.deepEqual(r.steps,[],r.id);assert.equal(r.ingredients.length,1,r.id);
    assert.ok(data.ingredients[r.ingredients[0].id],r.id);assert.ok(r.ingredients[0].amount>0,r.id);
    assert.doesNotThrow(()=>recipePortion(r,data),r.id);
  }
});

test('店舗名と参照商品名は出典に残し、料理の表示名は一般名にする',()=>{
  const stores=/ミスタードーナツ|コージーコーナー|セブン|とらや|森永|赤城|グリコ|たらみ|ポン・デ・|ガリガリ君|チョコモナカジャンボ|紗々/;
  for(const r of DESSERT_RECIPES){
    for(const label of [r.name,r.variantLabel,r.portion.label,data.ingredients[r.ingredients[0].id].name])assert.doesNotMatch(label,stores,r.id);
    assert.match(r.sourceNote,stores,r.id);assert.match(r.sourceNote,/参照商品：/);assert.match(r.sourceNote,/表示の基準：/);
    assert.match(r.sourceNote,/同じ料理名でも大きさ・原材料・栄養は異なります/);
    assert.match(r.sourceNote,/2026-11-13/);assert.match(r.sourceNote,/https:\/\//);assert.ok(r.sourceNote.length<=2000,r.id);
    assert.deepEqual(Object.keys(r.manualNutrition),NUTRIENT_KEYS);
  }
});

test('カットケーキ半切れを半分の栄養と完成品の買い物量へ換算する',()=>{
  const half=item('strawberry-shortcake',.5),nutrition=itemNutrition(half);
  close(nutrition.kcal,167.5);close(nutrition.protein,1.95);close(nutrition.salt,.1);assert.equal(nutrition.fiber,null);
  const purchased=shopping([half]);assert.equal(purchased.items.length,1);
  close(purchased.items[0].required,1);assert.equal(purchased.items[0].unit,'個');
  assert.equal(purchased.items[0].id,'dessert_strawberry_shortcake');
  assert.ok(!purchased.items.some(p=>['flour','egg','sugar','cream'].includes(p.id)));
});

test('ドーナツ2個と表示規格の異なるチーズケーキを正しく集計する',()=>{
  close(itemNutrition(item('old-fashioned',2)).kcal,588);close(itemNutrition(item('french-cruller',2)).fat,19);
  close(recipeNutrition(get('souffle-cheesecake'),data).kcal,249);
  close(recipeNutrition(get('rare-cheesecake'),data).kcal,392);
  close(shopping([item('old-fashioned',2)]).items[0].required,4);
});

test('12個入り氷菓は1袋の平均値を個数換算し、買い物は袋単位にする',()=>{
  const halfBag=item('grape-ice-bites',6),nutrition=itemNutrition(halfBag);
  close(halfBag.quantity,.5);close(nutrition.kcal,52);close(nutrition.protein,.12);close(nutrition.salt,.0042);
  assert.equal(nutrition.fiber,null);assert.match(get('grape-ice-bites').sourceNote,/味|別の栄養内訳/);
  const purchased=shopping([halfBag]);assert.equal(purchased.items[0].unit,'袋');close(purchased.items[0].required,1);
});

test('未表示の食物繊維と表示値0を区別し、和菓子の表示繊維は残す',()=>{
  for(const r of DESSERT_RECIPES.filter(r=>!['dessert-dorayaki','dessert-salt-bean-daifuku'].includes(r.id)))assert.equal(recipeNutrition(r,data).fiber,null,r.id);
  close(recipeNutrition(get('dorayaki'),data).fiber,2.4);close(recipeNutrition(get('salt-bean-daifuku'),data).fiber,4.4);
  assert.equal(itemNutrition(item('ogura-yokan',1)).fat,0);assert.equal(itemNutrition(item('ogura-yokan',1)).salt,0);
  assert.equal(itemNutrition(item('soda-ice-lolly',1)).protein,0);assert.equal(itemNutrition(item('soda-ice-lolly',1)).fat,0);
  assert.equal(itemNutrition(item('mandarin-jelly',1)).fat,0);
  close(recipeNutrition(get('chocolate-monaka'),data).kcal,319);assert.match(get('chocolate-monaka').sourceNote,/冬限定/);
  close(recipeNutrition(get('baked-pudding'),data).kcal,189);
  for(const id of Object.keys(DESSERT_INGREDIENTS))assert.deepEqual(data.ingredients[id].nutritionPerUnit,unknown(),id);
});

test('全原材料を登録していない購入品を自動献立に入れない',()=>{
  const choices=new Set(eligibleRecipes({},data).map(r=>r.id));
  for(const r of DESSERT_RECIPES){
    assert.equal(r.allergensKnown,false);assert.equal(r.ingredientsKnown,false);assert.equal(r.shoppingKnown,true);
    assert.ok(!choices.has(r.id),r.id);
  }
});

test('量・空手順・出典・購入品の確認状態をv3の食事記録へ保存できる',()=>{
  const journal=defaultJournal('2026-11-13');
  journal.entries=[{...planned([item('grape-ice-bites',6),item('chocolate-mousse-cake',.5)])[0],status:'eaten'}];
  const items=parseJournal(JSON.stringify(journal),data).entries[0].items;
  close(itemNutrition(items[0]).kcal,52);close(itemNutrition(items[1]).kcal,224);
  for(const [index,restored] of items.entries()){
    assert.deepEqual(restored.steps,[]);assert.equal(restored.quantity,.5);
    assert.equal(restored.allergensKnown,false);assert.equal(restored.ingredientsKnown,false);assert.equal(restored.shoppingKnown,true);
    assert.equal(restored.sourceNote,journal.entries[0].items[index].sourceNote);
    assert.equal(restored.nutrition.fiber,null);
  }
});
