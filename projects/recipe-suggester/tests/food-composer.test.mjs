import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {FOOD_COMPOSERS,availableFoodComponents,buildFoodSelection,defaultFoodSelection,eligibleFoodSelection,foodComposerFor} from '../food-composer.js';
import {itemFromRecipe,itemNutrition,recipeNutrition} from '../nutrition.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const compose=(kind,...components)=>buildFoodSelection({kind,components:components.map(([id,amount])=>({id,amount}))},data);
const part=(recipe,id)=>recipe.ingredients.find(part=>part.id===id)?.amount;

test('焼き鳥1本は元の2本分・2人前の材料を4で割り、味ごとの本数を加算する',()=>{
  const result=compose('yakitori',['thigh-salt',1],['breast-salt',2]);
  near(part(result,'chicken'),75);near(part(result,'chicken_breast'),150);
  near(part(result,'oil'),4);near(part(result,'salt'),1.075);near(part(result,'sake'),10);
  // もも10.65 + むね2.85 + 油3.652 + こしょう0.003 + 酒0.002997g。
  near(result.manualNutrition.fat,17.157997);
  assert.match(result.name,/もも・塩 1本/);assert.match(result.name,/むね・塩 2本/);
  assert.ok(!result.ingredients.some(part=>part.id==='sugar'),'選ばないたれを加えない');
});

test('天ぷら1個の衣と吸収油を一度だけ計算し、つゆ0は未選択と同じ',()=>{
  const plain=compose('tempura',['shrimp',1]),zero=compose('tempura',['shrimp',1],['dipping-sauce',0]);
  near(plain.manualNutrition.kcal,61.69493);near(plain.manualNutrition.fat,3.189);
  near(part(plain,'shrimp'),20);near(part(plain,'oil'),3);
  assert.deepEqual(zero.ingredients,plain.ingredients);assert.deepEqual(zero.manualNutrition,plain.manualNutrition);
  const dipped=compose('tempura',['shrimp',1],['dipping-sauce',20]);
  near(part(dipped,'soy_sauce'),2);near(part(dipped,'mirin'),1);near(part(dipped,'water'),25);
  assert.ok(dipped.manualNutrition.salt>plain.manualNutrition.salt);
});

test('おでんの汁0は具材だけになり、汁だけでは食事として作成しない',()=>{
  const base=compose('oden',['daikon',2],['egg',1]),zero=compose('oden',['daikon',2],['egg',1],['broth',0]);
  assert.deepEqual(base.ingredients,zero.ingredients);near(part(base,'daikon'),120);near(part(base,'egg'),1);
  const soup=compose('oden',['daikon',2],['egg',1],['broth',100]);
  near(part(soup,'water'),94);near(part(soup,'soy_sauce'),4);near(part(soup,'mirin'),2);near(part(soup,'bonito'),0.3);
  assert.throws(()=>compose('oden',['broth',100]),/具材/);
  assert.throws(()=>compose('tempura',['dipping-sauce',10]),/具材/);
});

test('購入品は表示の1本分を倍し、不明栄養と原材料確認を勝手に補わない',()=>{
  const source=RECIPES.find(recipe=>recipe.id==='takeaway-yakitori-momo-tare');
  const result=compose('yakitori',['takeaway-momo-tare',3]);
  const original=recipeNutrition(source,data);
  for(const[key,value]of Object.entries(original))value===null?assert.equal(result.manualNutrition[key],null):near(result.manualNutrition[key],value*3);
  assert.equal(result.allergensKnown,false);assert.equal(result.ingredientsKnown,false);assert.equal(result.shoppingKnown,true);
  near(part(result,'takeaway_yakitori_momo_tare'),3);
  const tempura=compose('tempura',['takeaway-shrimp',2]);
  assert.ok(!tempura.ingredients.some(part=>part.id==='oil'));
  assert.equal(tempura.manualNutrition.fiber,null);
});

test('マフィンは生地原材料と選んだ具材を加算し、他の具材を足さない',()=>{
  const plain=compose('muffin',['base',1]),berry=compose('muffin',['base',1],['blueberry',15]);
  near(part(plain,'flour'),24.5);near(part(plain,'egg'),0.28);near(part(berry,'blueberry'),15);
  near(berry.manualNutrition.kcal-plain.manualNutrition.kcal,7.2);
  assert.ok(!plain.ingredients.some(part=>part.id==='palette_muffin_base'),'生地の原材料を買い物へ展開する');
  assert.throws(()=>compose('muffin',['blueberry',15]),/ベース/);
  assert.throws(()=>compose('muffin',['base',2]),/量/);
  assert.throws(()=>compose('sandwich',['base',1]),/具材/);
});

test('初期値は呼ぶたび独立し、入口で選んだチーズ・ナッツの種類を引き継ぐ',()=>{
  const source=defaultFoodSelection('oden');source.components[0].amount=999;
  assert.equal(defaultFoodSelection('oden').components[0].amount,1);
  assert.deepEqual(defaultFoodSelection('cheese',{recipeId:'palette-cheese-cheddar'}).components,[{id:'cheddar',amount:20}]);
  assert.deepEqual(defaultFoodSelection('nuts',{recipeId:'palette-nuts-pistachio'}).components,[{id:'pistachio',amount:15}]);
  assert.equal(foodComposerFor(undefined),null);assert.equal(foodComposerFor('classic-sushi-tuna').kind,'sushi');
  assert.ok(Object.isFrozen(FOOD_COMPOSERS));
});

test('空・重複・不明・非有限・負数・過大量を拒否し、元のDBを変更しない',()=>{
  const original=JSON.stringify(data);
  for(const amount of [-1,NaN,Infinity,'2',10000])assert.throws(()=>compose('sushi',['tuna',amount]),/量/);
  assert.throws(()=>compose('sushi',['tuna',0]),/量/);
  assert.throws(()=>compose('sushi',['unknown',1]),/不明/);
  assert.throws(()=>compose('sushi',['tuna',1],['tuna',2]),/重複/);
  assert.throws(()=>compose('sushi'),/1つ以上/);
  assert.throws(()=>buildFoodSelection({kind:'sushi',id:'custom-<script>',components:[{id:'tuna',amount:1}]},data),/識別子/);
  assert.throws(()=>buildFoodSelection({kind:'sushi',components:[{id:'tuna',amount:1,extra:true}]},data),/種類と量/);
  assert.equal(JSON.stringify(data),original);
});

test('除外条件で安全な初期値を作り、表示候補を制限しても他の候補を復活しない',()=>{
  const safe=eligibleFoodSelection('oden',{allergens:['egg']},data);
  assert.ok(safe);assert.ok(!safe.recipe.allergens.includes('egg'));
  assert.ok(!safe.config.components.some(part=>part.id==='egg'));
  assert.equal(eligibleFoodSelection('cheese',{allergens:['milk']},data),null);
  const available=availableFoodComponents('sushi',data,{allowedRecipeIds:['classic-sushi-tuna']});
  assert.deepEqual(available.map(part=>part.id),['tuna']);
  assert.throws(()=>eligibleFoodSelection('oden',{allergens:['not-registered']},data),/アレルゲン/);
});

test('記録は確定時の材料・量・栄養を保存し、その後の再選択で変わらない',()=>{
  const one=compose('sushi',['tuna',2],['salmon',1]),item=itemFromRecipe(one,data,0.5),before=JSON.stringify(item);
  const changed=compose('sushi',['tuna',1],['salmon',4]);
  assert.notEqual(changed.manualNutrition.kcal,one.manualNutrition.kcal);
  assert.equal(JSON.stringify(item),before);
  near(itemNutrition(item).kcal,one.manualNutrition.kcal*0.5);
});
