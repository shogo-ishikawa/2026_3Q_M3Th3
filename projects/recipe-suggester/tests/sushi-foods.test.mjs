import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {CLASSIC_MAIN_RECIPES} from '../classics-mains.js';
import {SUSHI_INGREDIENTS,SUSHI_RECIPES} from '../sushi-foods.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {recipePortion,quantityFromAmount,isCompleteMeal} from '../catalog.js';
import {itemFromRecipe,itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';
const ownIds=new Set([...CLASSIC_MAIN_RECIPES,...SUSHI_RECIPES].map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...SUSHI_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...CLASSIC_MAIN_RECIPES,...SUSHI_RECIPES]};
const classic=id=>CLASSIC_MAIN_RECIPES.find(recipe=>recipe.id===`classic-${id}`),fresh=id=>SUSHI_RECIPES.find(recipe=>recipe.id===`sushi-${id}`);
const part=(recipe,id)=>recipe.ingredients.find(part=>part.id===id)?.amount;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const shop=(recipe,amount,servings=1)=>{
  const item=itemFromRecipe(describeRecipe(recipe.id,data),data,quantityFromAmount(recipe,data,amount));
  return shoppingForEntries([{id:'sushi-plan',date:'2026-11-13',meal:'dinner',status:'planned',items:[item],note:''}],data,{from:'2026-11-13',to:'2026-11-13',servings,pantry:[]});
};

test('既存寿司8件のIDを保ち、単種の握り4件だけを1貫にする',()=>{
  const expected=['sushi-assorted','sushi-tuna','sushi-salmon','sushi-shrimp','sushi-squid','sushi-roll','sushi-inari','sushi-chirashi'];
  for(const id of expected)assert.ok(classic(id),id);
  for(const id of ['tuna','salmon','shrimp','squid']){
    const recipe=classic(`sushi-${id}`),portion=recipePortion(recipe,data);
    assert.equal(recipe.servings,2);assert.equal(portion.amount,1);assert.equal(portion.unit,'貫');
    close(part(recipe,'rice'),45);close(part(recipe,'vinegar'),3);close(part(recipe,'sugar'),1.25);close(part(recipe,'salt'),0.125);close(part(recipe,'soy_sauce'),1);
    assert.match(recipe.sourceNote,/画面の材料と栄養は選んだ貫数に合わせて換算/);assert.equal(quantityFromAmount(recipe,data,4),4);
  }
  close(part(classic('sushi-salmon'),'salmon_sashimi'),25);
});

test('盛り合わせは約8貫で1皿、巻き・いなり・ちらしは従来の食事量を保つ',()=>{
  const assorted=classic('sushi-assorted');assert.equal(assorted.portion.amount,1);assert.equal(assorted.portion.unit,'皿');assert.match(assorted.portion.label,/8貫/);
  close(part(assorted,'rice'),360);close(part(assorted,'tuna_lean_sashimi'),80);close(part(assorted,'salmon_sashimi'),80);close(part(assorted,'shrimp'),40);
  assert.equal(classic('sushi-roll').portion.unit,'皿');assert.deepEqual(classic('sushi-inari').portion,{amount:3,unit:'個'});assert.equal(classic('sushi-chirashi').portion.unit,'皿');
});

test('細巻5・太巻3・軍艦7を既存メニューと重複させず追加する',()=>{
  assert.equal(SUSHI_RECIPES.length,15);
  for(const [prefix,count] of [['細巻',5],['太巻',3],['軍艦',7]])assert.equal(SUSHI_RECIPES.filter(recipe=>recipe.variantLabel.startsWith(prefix)).length,count);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  for(const recipe of SUSHI_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);assert.equal(recipe.role,'staple',recipe.id);assert.equal(recipe.family,'sushi',recipe.id);assert.equal(isCompleteMeal(recipe),true,recipe.id);
    assert.equal(recipe.staple,true,recipe.id);assert.equal(recipe.mealBase,true,recipe.id);assert.deepEqual(recipe.tags,[],recipe.id);
    assert.equal(recipe.portion.amount,1,recipe.id);assert.ok(['貫','切れ'].includes(recipe.portion.unit),recipe.id);
    assert.ok(recipe.steps.length>=3&&recipe.minutes>0,recipe.id);assert.ok(recipe.sourceNote,recipe.id);
    for(const ingredient of recipe.ingredients){assert.ok(data.ingredients[ingredient.id],`${recipe.id}/${ingredient.id}`);assert.ok(Number.isFinite(ingredient.amount)&&ingredient.amount>0,recipe.id);}
    assert.equal(new Set(recipe.ingredients.map(p=>p.id)).size,recipe.ingredients.length,recipe.id);
    assert.doesNotThrow(()=>describeRecipe(recipe.id,data),recipe.id);
  }
});

test('細巻6切れを1本として、ご飯100g・海苔1.5gと具と酢飯調味料を買い物へ渡す',()=>{
  const recipe=fresh('hosomaki-tekka');assert.match(recipe.portion.label,/1本を6切れ/);
  const list=shop(recipe,6).items;
  close(list.find(item=>item.id==='rice').required,100);close(list.find(item=>item.id==='nori').required,1.5);
  close(list.find(item=>item.id==='tuna_lean_sashimi').required,50);close(list.find(item=>item.id==='vinegar').required,7);
  close(list.find(item=>item.id==='sugar').required,3);close(list.find(item=>item.id==='salt').required,0.3);
});

test('太巻8切れを1本として、ご飯200g・海苔3gと卵を含む具を換算する',()=>{
  const recipe=fresh('futomaki-egg-vegetable');assert.match(recipe.portion.label,/1本を8切れ/);
  const list=shop(recipe,8).items;
  close(list.find(item=>item.id==='rice').required,200);close(list.find(item=>item.id==='nori').required,3);close(list.find(item=>item.id==='egg').required,1);
  close(list.find(item=>item.id==='dried_shiitake').required,4);close(list.find(item=>item.id==='vinegar').required,14);
});

test('いくら軍艦3貫を2人分なら、ご飯135g・いくら60g・海苔2.4gになる',()=>{
  const recipe=fresh('gunkan-ikura'),list=shop(recipe,3,2).items;
  close(list.find(item=>item.id==='rice').required,135);close(list.find(item=>item.id==='ikura_salted').required,60);close(list.find(item=>item.id==='nori').required,2.4);
  close(list.find(item=>item.id==='vinegar').required,9);close(list.find(item=>item.id==='sugar').required,3.75);
});

test('いくら・大豆・マヨネーズ由来のアレルゲンを避け、生の魚は刺身用を参照する',()=>{
  const eligible=allergens=>new Set(eligibleRecipes({allergens},data).map(recipe=>recipe.id));
  assert.ok(!eligible(['salmon_roe']).has(fresh('gunkan-ikura').id));assert.ok(eligible(['salmon_roe']).has(fresh('hosomaki-kappa').id));
  assert.ok(!eligible(['soy']).has(fresh('hosomaki-natto').id));assert.ok(!eligible(['egg']).has(fresh('gunkan-tuna-mayo').id));
  assert.ok(!eligible(['wheat']).has(fresh('gunkan-corn-mayo').id));
  for(const id of ['hosomaki-tekka','futomaki-seafood','gunkan-negitoro']){
    const recipe=fresh(id);assert.ok(recipe.ingredients.some(part=>part.id.endsWith('_sashimi')),id);assert.ok(recipe.steps.some(step=>/刺身用/.test(step)),id);
  }
  assert.deepEqual(SUSHI_INGREDIENTS.ikura_salted.allergens,['salmon_roe']);assert.match(SUSHI_INGREDIENTS.ikura_salted.name,/塩蔵/);
});

test('酢飯・ネタ・海苔の栄養を1切れ/1貫から計算し、数量変更で比例させる',()=>{
  assert.match(INGREDIENT_NUTRITION.ikura_salted.nutritionSource,/10140/);
  close(INGREDIENT_NUTRITION.ikura_salted.nutritionPerUnit.kcal*100,252);
  for(const recipe of SUSHI_RECIPES){
    const described=describeRecipe(recipe.id,data),one=itemFromRecipe(described,data,1),three=itemFromRecipe(described,data,3);
    assert.ok(one.nutrition.kcal>0,recipe.id);assert.ok(Number.isFinite(one.nutrition.protein),recipe.id);
    for(const key of ['kcal','protein','fat','carbs','fiber','salt'])if(one.nutrition[key]!==null)close(itemNutrition(three)[key],one.nutrition[key]*3);
    assert.ok(one.ingredients.some(part=>part.id==='nori'&&part.amount>0),recipe.id);assert.ok(one.ingredients.some(part=>part.id==='rice'&&part.amount>0),recipe.id);
  }
});

test('旧8貫基準の記録は現在の1貫レシピへ置換せず、数量と栄養snapshotを維持する',()=>{
  const current=classic('sushi-salmon');
  const oldRecipe={...current,ingredients:current.ingredients.map(part=>({...part,amount:part.amount*8})),portion:{amount:8,unit:'貫',label:'1人分＝8 貫'}};
  const oldItem={...itemFromRecipe(oldRecipe,data,0.5),portion:{...oldRecipe.portion}};
  const state=defaultJournal('2026-11-13');state.entries=[{id:'old-sushi',date:'2026-11-12',meal:'dinner',status:'eaten',note:'',items:[oldItem]}];
  const imported=parseJournal(JSON.stringify(state),data),kept=imported.entries[0].items[0];
  assert.deepEqual(kept,oldItem);assert.equal(kept.portion.amount,8);assert.equal(kept.quantity,0.5);
  close(kept.nutrition.kcal,itemFromRecipe(current,data).nutrition.kcal*8);
  close(itemNutrition(kept).kcal,itemNutrition(itemFromRecipe(current,data,4)).kcal);
  assert.equal(recipePortion(current,data).amount,1);
});

test('新しい巻き寿司の切れ数と栄養snapshotも保存往復で保持する',()=>{
  const recipe=fresh('hosomaki-kappa'),item={...itemFromRecipe(recipe,data,3),portion:recipePortion(recipe,data)};
  const state=defaultJournal('2026-11-13');state.entries=[{id:'sliced-sushi',date:'2026-11-13',meal:'lunch',status:'eaten',note:'',items:[item]}];
  const clean=parseJournal(JSON.stringify(state),data);assert.deepEqual(clean.entries[0].items[0],item);assert.equal(clean.entries[0].items[0].portion.unit,'切れ');
});
