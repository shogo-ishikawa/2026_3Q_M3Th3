import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {arrangementIngredientOptions,buildRecipeArrangement,ingredientAmountFromInput} from '../recipe-arrangement.js';
import {NUTRIENT_KEYS,itemFromRecipe,recipeNutrition} from '../nutrition.js';
import {defaultJournal,validateJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const base=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('元レシピの1人分へ追加し、同じ食材は買物量をまとめ、元データは変更しない',()=>{
  const before=JSON.stringify(base),source=recipeNutrition(base,data),extra=recipeNutrition({servings:1,ingredients:[{id:'chicken',amount:45},{id:'shimeji',amount:60}]},data);
  const arranged=buildRecipeArrangement({baseRecipe:base,additions:[{id:'chicken',amount:20},{id:'shimeji',amount:60},{id:'chicken',amount:25}]},data);
  assert.equal(arranged.servings,1);assert.deepEqual(arranged.portion,{amount:1,unit:'皿'});
  near(arranged.ingredients.find(part=>part.id==='chicken').amount,base.ingredients.find(part=>part.id==='chicken').amount/base.servings+45);
  assert.equal(arranged.ingredients.filter(part=>part.id==='chicken').length,1);
  for(const key of NUTRIENT_KEYS)near(arranged.manualNutrition[key],source[key]+extra[key]);
  assert.deepEqual(arranged.steps.slice(0,base.steps.length),base.steps);
  assert.equal(JSON.stringify(base),before);
});

test('手入力・商品表示の栄養は再計算せず、追加栄養だけを一度加算して不明を保つ',()=>{
  const purchased={...base,servings:2,nature:'fast-food',manualNutrition:{kcal:500,protein:25,fat:30,carbs:40,fiber:null,salt:2},ingredientsKnown:false,allergensKnown:false,shoppingKnown:false};
  const arranged=buildRecipeArrangement({baseRecipe:purchased,additions:[{id:'lettuce',amount:80}]},data);
  near(arranged.manualNutrition.kcal,500+INGREDIENTS.lettuce.nutritionPerUnit.kcal*80);
  near(arranged.manualNutrition.fat,30+INGREDIENTS.lettuce.nutritionPerUnit.fat*80);
  assert.equal(arranged.manualNutrition.fiber,null);assert.equal(arranged.ingredientsKnown,false);assert.equal(arranged.allergensKnown,false);assert.equal(arranged.shoppingKnown,false);
  assert.match(arranged.sourceNote,/買い物リスト全体は確定できません/);
});

test('卵と油もgからDBの重量・密度で換算し、栄養と買物には元単位の量を使う',()=>{
  near(ingredientAmountFromInput({id:'egg',amount:25,unit:'g'},data).amount,.5);
  near(ingredientAmountFromInput({id:'oil',amount:9.13,unit:'g'},data).amount,10);
  const original=buildRecipeArrangement({name:'卵と油の料理',additions:[{id:'egg',amount:25,unit:'g'},{id:'oil',amount:9.13,unit:'g'}]},data);
  near(original.ingredients.find(part=>part.id==='egg').amount,.5);near(original.ingredients.find(part=>part.id==='oil').amount,10);
  near(original.manualNutrition.kcal,INGREDIENTS.egg.nutritionPerUnit.kcal*.5+INGREDIENTS.oil.nutritionPerUnit.kcal*10);
  const item=itemFromRecipe(original,data),shopping=shoppingForEntries([{id:'planned',date:'2026-11-13',status:'planned',items:[item]}],data,{from:'2026-11-13',to:'2026-11-13',servings:3});
  near(shopping.items.find(row=>row.id==='egg').required,1.5);near(shopping.items.find(row=>row.id==='oil').required,30);
});

test('換算がない食材はg数を捏造せず、元の単位だけを受け付ける',()=>{
  const unknown={...data,ingredients:{...INGREDIENTS,unknown_piece:{name:'大きさ不明の食品',unit:'個',allergens:[],groups:[],proteinSources:[],nutritionPerUnit:{kcal:15,protein:1,fat:1,carbs:1,fiber:0,salt:0}}}};
  const option=arrangementIngredientOptions(unknown).find(row=>row.id==='unknown_piece');assert.equal(option.unit,'個');assert.equal(option.gramsPerUnit,null);
  assert.throws(()=>ingredientAmountFromInput({id:'unknown_piece',amount:30,unit:'g'},unknown),/g換算/);
  assert.equal(ingredientAmountFromInput({id:'unknown_piece',amount:2},unknown).amount,2);
});

test('実在する本数・個数の製品に、unknownプロファイルの仮の1を1gとして使わない',()=>{
  for(const [id,unit]of [['perf_bar_manzoku','本'],['prepared_item_burger_plain','個']]){
    const option=arrangementIngredientOptions(data).find(row=>row.id===id);
    assert.equal(option.unit,unit);assert.equal(option.gramsPerUnit,null);
    assert.throws(()=>ingredientAmountFromInput({id,amount:39,unit:'g'},data),/g換算/);
    const input=ingredientAmountFromInput({id,amount:2,unit},data);assert.equal(input.amount,2);assert.equal(input.grams,null);
  }
});

test('オリジナル料理を食材・区分・手順から作り、保存後も材料と栄養を保持する',()=>{
  const recipe=buildRecipeArrangement({name:'きのこと卵の朝ごはん',role:'staple',steps:['卵を十分に加熱する。','きのこと合わせる。'],additions:[{id:'egg',amount:50},{id:'shimeji',amount:70}]},data);
  assert.equal(recipe.role,'staple');assert.equal(recipe.staple,true);assert.equal(recipe.ingredientsKnown,true);assert.equal(recipe.allergensKnown,true);assert.ok(recipe.allergens.includes('egg'));assert.ok(recipe.proteinSources.includes('egg'));
  const state=defaultJournal('2026-11-13');state.customRecipes.push(recipe);const roundTrip=validateJournal(JSON.parse(JSON.stringify(state)),data);
  assert.deepEqual(roundTrip.customRecipes[0].manualNutrition,recipe.manualNutrition);assert.deepEqual(roundTrip.customRecipes[0].ingredients,recipe.ingredients);assert.deepEqual(roundTrip.customRecipes[0].steps,recipe.steps);
});

test('名前・食材・量・単位・保存用識別子を検査する',()=>{
  const config={name:'追加料理',additions:[{id:'shimeji',amount:20}]};
  for(const amount of [0,-1,NaN,Infinity,'20',10001])assert.throws(()=>buildRecipeArrangement({...config,additions:[{id:'shimeji',amount}]},data),/追加量/);
  for(const bad of [{...config,name:''},{...config,additions:[]},{...config,additions:[{id:'not-found',amount:20}]},{...config,additions:[{id:'shimeji',amount:20,unit:'個'}]},{...config,id:'custom-<script>'},{...config,extra:true},{...config,role:'not-a-role'}])assert.throws(()=>buildRecipeArrangement(bad,data));
});

test('元料理に材料がなく栄養も不明なら、食材を足しても確認済み・0にはならない',()=>{
  const unknown={id:'custom-unknown',name:'内容未確認の料理',role:'main',servings:1,custom:true,ingredients:[],steps:[],manualNutrition:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null])),allergensKnown:false,ingredientsKnown:false};
  const result=buildRecipeArrangement({baseRecipe:unknown,additions:[{id:'shimeji',amount:20}]},data);
  assert.ok(Object.values(result.manualNutrition).every(value=>value===null));assert.equal(result.ingredientsKnown,false);assert.equal(result.allergensKnown,false);assert.equal(result.shoppingKnown,false);
  const item=itemFromRecipe(result,data);assert.equal(item.ingredients.length,1);assert.equal(item.ingredientsKnown,false);
});

test('元材料の油を半量にし、チーズを削除し、肉を替えた最終材料から栄養と買い物を再計算する',()=>{
  const source={id:'sample',name:'鶏肉のチーズ焼き',role:'main',servings:2,ingredients:[{id:'chicken',amount:200},{id:'cheese',amount:40},{id:'oil',amount:20}],steps:['鶏肉を焼いてチーズを載せる。']};
  const original=JSON.stringify(source),frozen=itemFromRecipe(source,data);
  const arranged=buildRecipeArrangement({baseRecipe:source,additions:[],ingredientEdits:[{id:'chicken',replacementId:'chicken_breast',amount:100,unit:'g'},{id:'cheese',amount:0},{id:'oil',amount:4.565,unit:'g'}]},data);
  assert.deepEqual(arranged.ingredients,[{id:'chicken_breast',amount:100},{id:'oil',amount:5}]);
  const expected=recipeNutrition({servings:1,ingredients:arranged.ingredients},data);
  for(const key of NUTRIENT_KEYS)near(arranged.manualNutrition[key],expected[key]);
  assert.ok(!arranged.allergens.includes('milk'));assert.ok(arranged.proteinSources.includes('meat'));assert.ok(!arranged.groups.includes('dairy'));
  assert.equal(JSON.stringify(source),original);assert.ok(frozen.ingredients.some(part=>part.id==='cheese'));assert.ok(frozen.allergens.includes('milk'));
  assert.match(arranged.steps.at(-1),/変更後の材料に読み替え/);
  const shopping=shoppingForEntries([{id:'planned-edit',date:'2026-11-13',status:'planned',items:[itemFromRecipe(arranged,data,2)]}],data,{from:'2026-11-13',to:'2026-11-13',servings:3});
  near(shopping.items.find(row=>row.id==='chicken_breast').required,600);near(shopping.items.find(row=>row.id==='oil').required,30);assert.ok(!shopping.items.some(row=>row.id==='cheese'));
});

test('商品表示や一部だけ飲んだスープの栄養を原材料量で減算せず、追加は従来どおり許す',()=>{
  const source={...base,manualNutrition:{kcal:10,protein:1,fat:1,carbs:1,fiber:0,salt:.1}};
  assert.throws(()=>buildRecipeArrangement({baseRecipe:source,additions:[],ingredientEdits:[{id:base.ingredients[0].id,amount:0}]},data),/商品表示やスープ摂取量/);
  const arranged=buildRecipeArrangement({baseRecipe:source,additions:[{id:'shimeji',amount:20}]},data);
  near(arranged.manualNutrition.kcal,10+INGREDIENTS.shimeji.nutritionPerUnit.kcal*20);
  const matched={...base,manualNutrition:recipeNutrition(base,data)};
  const reduced=buildRecipeArrangement({baseRecipe:matched,additions:[],ingredientEdits:[{id:base.ingredients[0].id,amount:10,unit:'g'}]},data);
  assert.deepEqual(reduced.manualNutrition,recipeNutrition({...reduced,manualNutrition:undefined},data));
});

test('不明の材料を取り除くと残った材料から計算し直すが、不明の原材料は編集しない',()=>{
  const source={name:'チーズと表示未確認のバー',role:'main',servings:1,ingredients:[{id:'cheese',amount:20},{id:'perf_bar_manzoku',amount:1}],steps:[]};
  assert.equal(recipeNutrition(source,data).kcal,null);
  const edited=buildRecipeArrangement({baseRecipe:source,additions:[],ingredientEdits:[{id:'perf_bar_manzoku',amount:0}]},data);
  near(edited.manualNutrition.kcal,INGREDIENTS.cheese.nutritionPerUnit.kcal*20);
  assert.throws(()=>buildRecipeArrangement({baseRecipe:{...source,ingredientsKnown:false},additions:[],ingredientEdits:[{id:'cheese',amount:0}]},data),/原材料が未確認/);
});

test('削除で材料が空になる操作・重複する変更・負数・不正単位・存在しない置き換え先を拒否する',()=>{
  const source={name:'卵',role:'main',servings:1,ingredients:[{id:'egg',amount:1}],steps:[]};
  for(const ingredientEdits of [[{id:'egg',amount:0}],[{id:'egg',amount:-1}],[{id:'egg',amount:10,unit:'kg'}],[{id:'egg',amount:0,unit:'kg'}],[{id:'egg',amount:25},{id:'egg',amount:20}],[{id:'egg',replacementId:'no-food',amount:25}],[{id:'egg',amount:NaN}]])assert.throws(()=>buildRecipeArrangement({baseRecipe:source,additions:[],ingredientEdits},data));
});
