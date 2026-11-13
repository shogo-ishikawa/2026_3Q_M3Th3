import {originalNutrients} from './helpers/original-nutrients.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe,itemNutrition} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {defaultJournal,parseJournal} from '../journal.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const store=/日本一|てんや|崎陽軒|ローソン|セブン|ファミリーマート|ファミマ|マクドナルド|モスバーガー|吉野家|すき家|松屋|餃子の王将|大阪王将|ミスタードーナツ|鳥貴族|牛角/;
const labels={
  'performance-chicken_plain':['サラダチキン（プレーン・市販品110g）','ローソン サラダチキン プレーン（110g）'],
  'performance-chicken_herb':['サラダチキン（ハーブ・市販品110g）','ローソン サラダチキン ハーブ（110g）'],
  'performance-chicken_smoke':['サラダチキン（スモーク・市販品110g）','ローソン サラダチキン スモーク（110g）'],
  'takeaway-yakitori-momo-tare':['焼き鳥・もも（たれ・テイクアウト）','焼鳥日本一 もも串（たれ）'],
  'takeaway-yakitori-momo-salt':['焼き鳥・もも（塩・テイクアウト）','焼鳥日本一 塩もも串'],
  'takeaway-yakitori-negima-tare':['焼き鳥・ねぎま（たれ・テイクアウト）','焼鳥日本一 ももねぎ串（たれ）'],
  'takeaway-yakitori-tsukune-tare':['つくね串（たれ・テイクアウト）','焼鳥日本一 つくね串（たれ）'],
  'takeaway-yakitori-kawa-tare':['焼き鳥・皮（たれ・テイクアウト）','焼鳥日本一 かわ串（たれ）'],
  'takeaway-yakitori-sunagimo-salt':['焼き鳥・砂肝（塩・テイクアウト）','焼鳥日本一 塩砂肝串'],
  'takeaway-eel-kabayaki':['うなぎの蒲焼き（テイクアウト・中串）','うなぎ日本一 うなぎ蒲焼（中串）'],
  'takeaway-unaju':['うな重（テイクアウト）','うなぎ日本一 うな重（中）'],
  'takeaway-shumai':['シュウマイ（惣菜）','崎陽軒 おいしさ長もち 昔ながらのシウマイ'],
  'takeaway-frozen-suigyoza':['水餃子（冷凍・12個入り）','セブンプレミアム 水餃子（冷凍・12個入）'],
  'takeaway-spring-roll':['五目春巻き（惣菜）','セブン‐イレブン 五目春巻'],
  'takeaway-tempura-shrimp':['えびの天ぷら（外食・単品）','てんや 海老の天ぷら（単品）'],
  'takeaway-tempura-squid':['いかの天ぷら（外食・単品）','てんや いかの天ぷら（単品）'],
  'takeaway-tempura-maitake':['まいたけの天ぷら（外食・単品）','てんや まいたけの天ぷら（単品）'],
  'takeaway-beef-karubi':['牛カルビ焼き（惣菜）','セブンプレミアム 牛カルビ焼き'],
};
const changedIds=new Set(Object.keys(labels));
const ingredientId=id=>id.startsWith('performance-')?'perf_'+id.slice(12):'takeaway_'+id.slice(9).replaceAll('-','_');
const changedIngredients=new Set([...changedIds].map(ingredientId));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('店舗名は一覧・食材名・小分類・基準量の表示から外し、料理の種類を残す',()=>{
  for(const r of RECIPES)assert.doesNotMatch([r.name,r.variantLabel,r.portion?.label].join(' '),store,r.id);
  for(const[id,ingredient]of Object.entries(INGREDIENTS))assert.doesNotMatch(ingredient.name,store,id);
  for(const[id,[name]]of Object.entries(labels))assert.equal(RECIPES.find(r=>r.id===id)?.name,name,id);
});

test('一般的な表示名にしても、参照商品・店舗・URLと値の適用範囲を出典へ残す',()=>{
  for(const[id,[,reference]]of Object.entries(labels)){
    const r=RECIPES.find(r=>r.id===id);
    assert.ok(r.sourceNote.includes(reference),id);
    assert.match(r.sourceNote,/出典の商品を参考にした記録例/);
    assert.match(r.sourceNote,/同じ料理でも量や栄養は異なります/);
    assert.match(r.sourceNote,/https:\/\//);
    assert.match(INGREDIENTS[ingredientId(id)].note,/栄養値の参照商品/);
  }
  assert.match(RECIPES.find(r=>r.id==='takeaway-tempura-shrimp').sourceNote,/店内/);
  assert.match(RECIPES.find(r=>r.id==='takeaway-tempura-shrimp').name,/外食/);
});

test('18品は表示名と出典だけを改訂し、元の数量・栄養・原材料と確認状況を保つ',()=>{
  const recipes=RECIPES.filter(r=>changedIds.has(r.id)).map(({name,variantLabel,sourceNote,portion,...r})=>({...r,portion:{amount:portion.amount,unit:portion.unit}}));
  const ingredients=Object.fromEntries(Object.entries(INGREDIENTS).filter(([id])=>changedIngredients.has(id)).map(([id,item])=>[id,originalNutrients(item)]).map(([id,{name,note,...i}])=>[id,i]));
  assert.equal(recipes.length,18);assert.equal(Object.keys(ingredients).length,18);
  // v3.4.0の独立した固定値。表示名・出典の変更で、数量や栄養を入れ替えない。
  assert.equal(hash(recipes),'78e59388d4ddf46f0806ce66abe5fcc18f8f7488490a0d3c4a67f459dcb3ce99');
  assert.equal(hash(ingredients),'b505ab3f3c62c9c6ab587faa795dde358236573d82a588c5cf0a8da4eac22ad0');
  const eligible=new Set(eligibleRecipes({},data).map(r=>r.id));
  for(const id of changedIds){assert.ok(!eligible.has(id),id);const r=RECIPES.find(r=>r.id===id);assert.equal(r.allergensKnown,false);assert.equal(r.ingredientsKnown,false);}
});

test('旧記録の店舗付き料理名は当時の量・栄養とともに復元し、新しい記録にだけ表示名を使う',()=>{
  const recipe=RECIPES.find(r=>r.id==='takeaway-yakitori-momo-tare');
  const fresh={...itemFromRecipe(describeRecipe(recipe.id,data),data,3),portion:recipePortion(recipe,data)};
  const historic=structuredClone(fresh);historic.id='historic-yakitori';historic.name='焼鳥日本一 もも串（たれ）';
  const state=defaultJournal('2026-11-13');state.entries=[{id:'historic-meal',date:'2026-11-13',meal:'dinner',status:'eaten',items:[historic],note:''}];
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored,state);
  assert.equal(restored.entries[0].items[0].name,'焼鳥日本一 もも串（たれ）');
  assert.equal(fresh.name,'焼き鳥・もも（たれ・テイクアウト）');
  assert.equal(itemNutrition(fresh).kcal,282);
});
