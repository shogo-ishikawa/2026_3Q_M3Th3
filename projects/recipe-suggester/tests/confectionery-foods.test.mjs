import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {CONFECTIONERY_INGREDIENTS,CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {recipeFamily,recipeNature,recipePortion,quantityFromAmount} from '../catalog.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe,itemNutrition,recipeNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const ownIds=new Set(CONFECTIONERY_RECIPES.map(r=>r.id));
const unknown=()=>Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null]));
const ownProfiles=Object.fromEntries(CONFECTIONERY_RECIPES.map(r=>[r.ingredients[0].id,{
  nutritionPerUnit:unknown(),nutritionSource:r.sourceNote,
}]));
const data={allergens:ALLERGENS,
  ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...CONFECTIONERY_INGREDIENTS}).map(([id,ingredient])=>[
    id,{...ingredient,...(INGREDIENT_NUTRITION[id]??ownProfiles[id])},
  ])),
  recipes:[...RECIPES.filter(r=>!ownIds.has(r.id)),...CONFECTIONERY_RECIPES]};
const get=slug=>CONFECTIONERY_RECIPES.find(r=>r.id===`confectionery-${slug}`);
const close=(a,b)=>assert.ok(typeof a==='number'&&Math.abs(a-b)<1e-8,`${a} != ${b}`);
const item=(slug,amount)=>{const r=get(slug);return itemFromRecipe(describeRecipe(r.id,data),data,quantityFromAmount(r,data,amount));};
const entries=items=>[{id:'confectionery-plan',date:'2026-11-13',meal:'snack',status:'planned',items,note:''}];
const shopping=items=>shoppingForEntries(entries(items),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});

test('お菓子34品を6種類へまとめ、公式出典と表示量を保持する',()=>{
  assert.equal(CONFECTIONERY_RECIPES.length,34);assert.equal(Object.keys(CONFECTIONERY_INGREDIENTS).length,34);
  assert.equal(new Set(data.recipes.map(r=>r.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(r=>r.name)).size,data.recipes.length);
  assert.deepEqual(Object.fromEntries(['biscuit','chocolate','candy','gummy','salty-snack','rice-snack'].map(f=>[
    f,CONFECTIONERY_RECIPES.filter(r=>recipeFamily(r)===f).length,
  ])),{biscuit:8,chocolate:7,candy:4,gummy:4,'salty-snack':8,'rice-snack':3});
  const allergens=new Set(ALLERGENS.map(a=>a.id));
  for(const r of CONFECTIONERY_RECIPES){
    assert.equal(r.role,'snack');assert.equal(r.servings,2);assert.equal(recipeNature(r),'ready-to-eat');
    assert.deepEqual(r.steps,[],r.id);assert.equal(r.ingredients.length,1,r.id);
    assert.ok(data.ingredients[r.ingredients[0].id],r.id);assert.ok(r.ingredients[0].amount>0,r.id);
    assert.doesNotThrow(()=>recipePortion(r,data),r.id);
    assert.match(r.sourceNote,/参照商品：/);assert.match(r.sourceNote,/表示基準：/);
    assert.match(r.sourceNote,/2026-11-13/);assert.match(r.sourceNote,/https:\/\//);
    assert.ok(r.sourceNote.length<=2000,r.id);assert.deepEqual(Object.keys(r.manualNutrition),NUTRIENT_KEYS);
    for(const id of data.ingredients[r.ingredients[0].id].allergens)assert.ok(allergens.has(id),id);
  }
});

test('内袋基準のポッキー半袋をg数から栄養と購入量へ一度だけ換算する',()=>{
  const half=item('pocky',14.5);close(half.quantity,.5);
  close(itemNutrition(half).kcal,71);close(itemNutrition(half).fiber,.7);close(itemNutrition(half).salt,.075);
  const purchased=shopping([half]);assert.equal(purchased.items.length,1);
  close(purchased.items[0].required,1);assert.equal(purchased.items[0].unit,'袋');
  assert.equal(purchased.items[0].id,'confectionery_pocky');
  assert.match(get('pocky').portion.label,/2袋/);
  assert.ok(!purchased.items.some(p=>['flour','milk','sugar','chocolate'].includes(p.id)));
});

test('板チョコと小さい個包装のチョコで基準を混同しない',()=>{
  close(itemNutrition(item('milk-chocolate',25)).kcal,141.5);
  close(itemNutrition(item('black-chocolate',25)).fiber,1.65);
  close(itemNutrition(item('cacao72',3)).kcal,84);
  close(itemNutrition(item('dars',3)).kcal,69);
  const purchased=shopping([item('milk-chocolate',25),item('cacao72',3)]);
  close(purchased.items.find(p=>p.id==='confectionery_milk_chocolate').required,1);
  close(purchased.items.find(p=>p.id==='confectionery_cacao72').required,6);
});

test('飴・グミの粒数と米菓の2枚小袋を表示どおり換算する',()=>{
  close(itemNutrition(item('golden-milk-candy',3)).kcal,54.9);
  close(itemNutrition(item('hi-chew',2)).protein,.14);
  close(itemNutrition(item('pure-gummy',4)).kcal,48);
  close(itemNutrition(item('soft-salad',1)).kcal,34);
  close(itemNutrition(item('kakinotane',15)).salt,.19);
  const purchased=shopping([item('soft-salad',1),item('kakinotane',15)]);
  close(purchased.items.find(p=>p.id==='confectionery_soft_salad').required,1);
  close(purchased.items.find(p=>p.id==='confectionery_kakinotane').required,1);
  assert.equal(purchased.items.find(p=>p.id==='confectionery_soft_salad').unit,'袋');
});

test('メーカーの範囲表示と未表示は不明、表示された0だけを数値0に保つ',()=>{
  const miino=recipeNutrition(get('miino'),data);
  assert.deepEqual(miino,{kcal:164,protein:null,fat:12,carbs:null,fiber:null,salt:null});
  const popcorn=itemNutrition(item('popcorn',25));close(popcorn.kcal,123);assert.equal(popcorn.fiber,null);
  assert.equal(itemNutrition(item('sayaendo',30.5)).salt,null);
  assert.equal(itemNutrition(item('marie',1)).fiber,null);
  assert.equal(itemNutrition(item('cheeza',16)).fiber,0);
  assert.equal(itemNutrition(item('kaju-gummy',27)).fat,0);
  assert.equal(itemNutrition(item('cacao72',1)).salt,0);
  for(const id of Object.keys(CONFECTIONERY_INGREDIENTS))assert.deepEqual(data.ingredients[id].nutritionPerUnit,unknown(),id);
});

test('原材料が不完全な市販菓子を自動献立の候補に加えない',()=>{
  const choices=new Set(eligibleRecipes({},data).map(r=>r.id));
  for(const r of CONFECTIONERY_RECIPES){
    assert.equal(r.allergensKnown,false);assert.equal(r.ingredientsKnown,false);assert.equal(r.shoppingKnown,true);
    assert.ok(!choices.has(r.id),r.id);
  }
});

test('量と空の調理手順・出典・不明の栄養を食事記録の保存後も保つ',()=>{
  const journal=defaultJournal('2026-11-13');
  journal.entries=[{...entries([item('pocky',14.5),item('miino',14)])[0],status:'eaten'}];
  const items=parseJournal(JSON.stringify(journal),data).entries[0].items;
  close(itemNutrition(items[0]).kcal,71);close(itemNutrition(items[1]).kcal,82);
  assert.equal(itemNutrition(items[1]).protein,null);assert.equal(itemNutrition(items[1]).carbs,null);
  for(const [i,restored] of items.entries()){
    close(restored.quantity,.5);assert.deepEqual(restored.steps,[]);
    assert.equal(restored.sourceNote,journal.entries[0].items[i].sourceNote);
    assert.equal(restored.allergensKnown,false);assert.equal(restored.ingredientsKnown,false);assert.equal(restored.shoppingKnown,true);
  }
});
