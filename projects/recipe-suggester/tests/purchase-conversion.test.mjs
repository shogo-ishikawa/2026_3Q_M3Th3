import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createCatalogEntry} from '../record-actions.js';
import {buildFoodSelection} from '../food-composer.js';
import {shoppingForEntries} from '../shopping.js';
import {purchaseDefaults,purchaseBasisNote,purchasePresets,validatePurchaseSettings,derivePurchase} from '../purchase-conversion.js';
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const item=(id,buy)=>({id,name:INGREDIENTS[id].name,unit:INGREDIENTS[id].unit,required:buy,stock:0,buy});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} vs ${expected}`);

test('炊飯済みの手持ちを差し引いた不足量だけ生米へ換算し、別状態の生米在庫は混ぜない',()=>{
  const rice=RECIPES.find(recipe=>recipe.id==='plain-rice');
  const entry=createCatalogEntry({recipeId:rice.id,date:'2026-11-16',meal:'dinner',status:'planned',amount:150},data);
  const shopping=shoppingForEntries([entry],data,{from:'2026-11-16',to:'2026-11-16',servings:2,pantry:[{id:'rice',amount:70},{id:'uncooked_rice',amount:1000}]});
  const original=structuredClone(shopping),purchase=derivePurchase(shopping.items[0],[],data);
  assert.equal(shopping.items[0].buy,230);near(purchase.amount,100);assert.equal(purchase.name,'精白米（生米）');assert.equal(purchase.unit,'g');
  assert.deepEqual(shopping,original);assert.match(purchase.explanation,/230g ÷ 2.3/);
});

test('可食部・皮付きと既に殻付きの材料を区別する',()=>{
  near(derivePurchase(item('carrot',90),[],data).amount,100);
  near(derivePurchase(item('potato',180),[],data).amount,200);
  const clams=derivePurchase(item('clam',200),[],data);assert.equal(clams.amount,200);assert.equal(clams.setting.mode,'same');
  assert.match(purchaseBasisNote('clam',data),/既に.*殻付き/);
});

test('乾パスタは乾重量のまま、ゆでうどんを乾麺で用意するときだけ参考係数を選ぶ',()=>{
  assert.equal(derivePurchase(item('pasta',180),[],data).amount,180);assert.match(purchaseBasisNote('pasta',data),/既に乾麺/);
  assert.equal(derivePurchase(item('udon',300),[],data).amount,300);
  const dry=purchasePresets('udon',data).find(preset=>preset.setting.purchaseName==='干しうどん（乾）');assert.ok(dry);near(derivePurchase(item('udon',300),[dry.setting],data).amount,100);
  const extension={...data,ingredients:{...INGREDIENTS,boiled_pasta:{name:'スパゲティ（ゆで）',unit:'g'}}};
  const preset=purchasePresets('boiled_pasta',extension).find(preset=>preset.setting.yieldFactor===2.5);assert.ok(preset);near(derivePurchase({id:'boiled_pasta',unit:'g',buy:250},[preset.setting],extension).amount,100);
});

test('刺身の切れ数は元の具材選択でgへ換算済み、魚の購入形態は個別の可食率で設定できる',()=>{
  const recipe=buildFoodSelection({kind:'sashimi',components:[{id:'salmon',amount:3,gramsPerUnit:12}]},data);
  const fish=recipe.ingredients.find(part=>INGREDIENTS[part.id].proteinSources?.includes('fish')),id=fish.id;
  const sliced=derivePurchase(item(id,fish.amount),[],data);assert.equal(sliced.unit,'g');near(sliced.amount,36);
  const setting={...purchaseDefaults(id,data),yieldFactor:.6,purchaseName:'皮・骨付きの購入品'};
  setting.mode='weight';near(derivePurchase(item(id,36),[setting],data).amount,60);
  const extension={...data,ingredients:{...INGREDIENTS,counted_fish:{name:'切り分けた魚',unit:'切れ',gramsPerUnit:12,proteinSources:['fish']}}};
  near(derivePurchase({id:'counted_fish',unit:'切れ',buy:3},[],extension).amount,36);
});

test('包装数は不足量の換算後に切り上げ、在庫で足りれば0包装',()=>{
  const setting={...purchaseDefaults('rice',data),packSize:100,packUnit:'袋'};
  const exact=derivePurchase(item('rice',230),[setting],data);assert.equal(exact.packCount,1);near(exact.packedAmount,100);
  assert.equal(derivePurchase(item('rice',231),[setting],data).packCount,2);
  assert.equal(derivePurchase(item('rice',0),[setting],data).packCount,0);
  const eggs={...purchaseDefaults('egg',data),packSize:6,packUnit:'パック'};
  assert.equal(derivePurchase(item('egg',7),[eggs],data).packCount,2);assert.equal(derivePurchase(item('egg',7),[eggs],data).unit,'個');
  assert.equal(derivePurchase(item('egg',1e-18),[eggs],data).packCount,1);
});

test('設定はJSONで往復し、未知ID・重複・0係数・未登録重量・危険な入力を拒否する',()=>{
  const raw=[{...purchaseDefaults('rice',data),yieldFactor:2.2,packSize:2000,packUnit:'袋'}];
  assert.deepEqual(validatePurchaseSettings(JSON.parse(JSON.stringify(raw)),data),raw);assert.deepEqual(validatePurchaseSettings(undefined,data),[]);
  for(const patch of [{id:'no-such-food'},{yieldFactor:0},{yieldFactor:NaN},{packSize:0},{packUnit:'bad'},{extra:true},{mode:'same',yieldFactor:2}])assert.throws(()=>validatePurchaseSettings([{...raw[0],...patch}],data));
  assert.throws(()=>validatePurchaseSettings([raw[0],raw[0]],data));
  const weightless=Object.keys(INGREDIENTS).find(id=>INGREDIENTS[id].unit!=='g'&&!INGREDIENTS[id].gramsPerUnit);assert.ok(weightless);
  assert.throws(()=>validatePurchaseSettings([{...purchaseDefaults(weightless,data),mode:'weight'}],data));
  let invoked=false;const getter={...raw[0]};Object.defineProperty(getter,'yieldFactor',{get(){invoked=true;return 2.3;},enumerable:true});assert.throws(()=>validatePurchaseSettings([getter],data));assert.equal(invoked,false);
  const array=[];Object.defineProperty(array,'0',{get(){invoked=true;return raw[0];},enumerable:true});assert.throws(()=>validatePurchaseSettings(array,data));assert.equal(invoked,false);
});

test('全食材の初期設定は検証可能で、数値や単位が異なる不足量を拒否する',()=>{
  const defaults=Object.keys(INGREDIENTS).map(id=>purchaseDefaults(id,data));assert.equal(validatePurchaseSettings(defaults,data).length,Object.keys(INGREDIENTS).length);
  assert.throws(()=>derivePurchase({...item('rice',1),unit:'個'},[],data));assert.throws(()=>derivePurchase(item('rice',-1),[],data));
  assert.throws(()=>derivePurchase(item('rice',Infinity),[],data));
});
