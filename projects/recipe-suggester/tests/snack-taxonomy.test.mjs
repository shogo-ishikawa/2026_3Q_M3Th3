import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_CATEGORIES,recipeFamily,recipeNature,recipePortion,quantityFromAmount,catalogFamilies,catalogVariants,isCompleteMeal} from '../catalog.js';
import {decorateRecipe} from '../catalog-metadata.js';
import {matchesJapaneseQuery,normaliseJapaneseSearch} from '../japanese-search.js';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {EVERYDAY_RECIPES} from '../everyday-foods.js';
import {recipeNutrition} from '../nutrition.js';
import {defaultJournal,parseJournal} from '../journal.js';

const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const sample=(name,extra={})=>({id:`sample-${name}`,name,role:'snack',servings:1,minutes:1,staple:false,ingredients:[],steps:[],nature:'ready-to-eat',...extra});
const familyIds=['chocolate','candy','gummy','biscuit','salty-snack','rice-snack','donut','cake','japanese-sweet','ice-dessert'];
const legacyMoves={
  'daily-snack-potato-chips':'salty-snack','daily-snack-rice-cracker':'rice-snack',
  'daily-snack-butter-cookie':'biscuit','daily-snack-chocolate-cookie':'biscuit',
  'daily-snack-chocolate':'chocolate','daily-snack-vanilla-ice':'ice-dessert',
  'daily-snack-cocoa-ice':'ice-dessert','daily-snack-banana-cake':'cake','daily-snack-chocolate-cake':'cake',
};

test('お菓子の種類を間食の中へまとめ、旧分類も読み込み用に残す',()=>{
  const categories=new Map(CATALOG_CATEGORIES.map(f=>[f.id,f]));
  for(const id of [...familyIds,'snack','sweets','dessert'])assert.equal(categories.get(id)?.role,'snack',id);
  assert.equal(categories.size,CATALOG_CATEGORIES.length);
  const recipes=familyIds.map(family=>sample(family,{family}));
  assert.equal(catalogFamilies(recipes,{role:'snack'}).length,familyIds.length);
  assert.deepEqual(catalogFamilies(recipes,{role:'main'}),[]);
  assert.deepEqual(catalogFamilies(recipes,{role:'staple'}),[]);
  assert.deepEqual(catalogFamilies(recipes,{role:'snack',query:'わがし'}).map(f=>f.id),['japanese-sweet']);
  assert.deepEqual(catalogFamilies(recipes,{role:'snack',query:'すなっくがし'}).map(f=>f.id),['salty-snack']);
  for(const recipe of recipes)assert.equal(isCompleteMeal(recipe),false,recipe.id);
});

test('料理名を優先し、チーズケーキやアーモンドチョコを材料だけの種類にしない',()=>{
  const cases=[['チーズケーキ','cake'],['ヨーグルトケーキ','cake'],['アーモンドチョコレート','chocolate'],
    ['チョコがけクッキー','biscuit'],['ポッキー','biscuit'],['プロテインチョコバー','functional-snack'],
    ['パンケーキ','dessert'],['焼きチーズせんべい','rice-snack'],['rice-cracker','rice-snack'],['コーンスナック','salty-snack'],
    ['果汁グミ','gummy'],['ミルクキャラメル','candy'],['ラムネ菓子','candy'],['ドーナッツ','donut'],
    ['大福','japanese-sweet'],['どら焼き','japanese-sweet'],['アイスキャンディー','ice-dessert']];
  for(const [name,family]of cases)assert.equal(recipeFamily(sample(name)),family,name);
  assert.equal(recipeFamily(sample('ラムネ',{role:'drink'})),'soft-drink');
  assert.equal(recipeFamily(sample('牛乳',{role:'drink'})),'milk');
  assert.equal(recipeFamily(sample('ナチュラルチーズ')),'cheese');
  assert.equal(recipeFamily(sample('素焼きアーモンド')),'nuts');
});

test('既存9品はID・材料・量・栄養と提供形態を変えずに表示分類だけを整理する',()=>{
  for(const [id,family]of Object.entries(legacyMoves)){
    const current=RECIPES.find(r=>r.id===id),source=EVERYDAY_RECIPES.find(r=>r.id===id);
    assert.ok(current&&source,id);assert.equal(current.family,family,id);assert.equal(current.role,'snack',id);
    assert.deepEqual(current.ingredients,source.ingredients,id);assert.deepEqual(current.portion,source.portion,id);
    assert.deepEqual(recipeNutrition(current,data),recipeNutrition(source,data),id);
    assert.equal(quantityFromAmount(current,data,recipePortion(source,data).amount),1,id);
  }
  assert.equal(recipeNature(RECIPES.find(r=>r.id==='daily-snack-butter-cookie')),'ready-to-eat');
  assert.equal(recipeNature(RECIPES.find(r=>r.id==='daily-snack-chocolate-cookie')),'home-cooked');
  assert.equal(recipeNature(RECIPES.find(r=>r.id==='daily-snack-cocoa-ice')),'home-cooked');
});

test('同じケーキの分類から手作りと購入品を別々に絞り、両者の基準量を保つ',()=>{
  const homemade=RECIPES.find(r=>r.id==='daily-snack-chocolate-cake');
  const bought=sample('チョコレートケーキ（市販品）',{family:'cake',portion:{amount:1,unit:'切れ'}});
  const recipes=[homemade,bought];
  assert.deepEqual(catalogVariants(recipes,'cake',{nature:'home-cooked'}).map(r=>r.id),[homemade.id]);
  assert.deepEqual(catalogVariants(recipes,'cake',{nature:'ready-to-eat'}).map(r=>r.id),[bought.id]);
  assert.equal(recipePortion(homemade,data).unit,'g');assert.equal(recipePortion(bought,data).unit,'切れ');
  assert.equal(quantityFromAmount(bought,data,2),2);
});

test('旧3分類と新しいお菓子分類のマイメニューを同じv3形式で復元する',()=>{
  const state=defaultJournal('2026-11-13');
  state.customRecipes=[...familyIds,'snack','sweets','dessert'].map(family=>({id:`custom-${family}`,name:`自分のお菓子 ${family}`,role:'snack',family}));
  const restored=parseJournal(JSON.stringify(state),data);
  assert.equal(restored.version,3);
  assert.deepEqual(restored.customRecipes.map(r=>r.family),[...familyIds,'snack','sweets','dessert']);
  for(const recipe of restored.customRecipes){assert.equal(recipe.role,'snack');assert.equal(recipe.allergensKnown,false);assert.equal(recipe.ingredientsKnown,false);}
  const manual={...sample('自分の分類'),id:'daily-snack-chocolate',custom:true,family:'dessert'};
  assert.equal(decorateRecipe(manual).family,'dessert','利用者の明示分類をID補正で上書きしない');
});

test('菓子名もかな・漢字・慣用表記で同じ候補へ到達する',()=>{
  const groups=[['ドーナツ','ドーナッツ','どーなつ'],['チョコレート','チョコ','ちょこ'],['飴','あめ','キャンディー'],
    ['柿の種','かきのたね','カキノタネ'],['どら焼き','どらやき'],['大福','だいふく'],
    ['米菓','べいか'],['氷菓','ひょうか'],['市販品','しはんひん']];
  for(const words of groups)for(const target of words)for(const query of words)assert.ok(matchesJapaneseQuery(target,query),`${target}/${query}`);
  assert.equal(normaliseJapaneseSearch('きのこの山'),normaliseJapaneseSearch('きのこのやま'));
  assert.ok(matchesJapaneseQuery('板チョコレート（市販品）','いたちょこ'));
  for(const [name,query] of [['明治ミルクチョコレート（板）','めいじみるくちょこ'],
    ['コロロ 巨峰','ころろ きょほう'],['miino そら豆','ミーノ そらまめ'],
    ['ラムネ菓子（ボトル）','らむねがし'],['スコーン 絶品焼きとうもろこし','すこーん ぜっぴん'],
    ['ソフトサラダ（2枚入り小袋）','2まいいりこぶくろ']])assert.ok(matchesJapaneseQuery(name,query),`${name}/${query}`);
  assert.ok(!matchesJapaneseQuery('スコーン','とうもろこし'),'コーンを含む別の料理名をとうもろこしと同一視しない');
  assert.ok(!matchesJapaneseQuery('チーズケーキ','ちーず くっきー'));
});

test('新しい定番料理もかなと料理の別表記から探せる',()=>{
  const cases=[['肉豆腐（豚肉）','にくどうふ'],['肉豆腐（豚肉）','ニクトウフ'],
    ['もつ煮込み（豚白もつ）','モツ煮'],['もつ煮込み（豚白もつ）','ホルモン煮'],
    ['ぼっかけ','牛筋煮込み'],['牛すじ煮込み','ぼっかけ'],['そばめし','ソバメシ'],
    ['牛タン塩焼き','ぎゅうたんしおやき'],['牛すじ（腱・茹で）','ぎゅうすじ けん ゆで'],
    ['豚白もつ（小腸・ゆで）','しょうちょう'],['小倉ようかん（市販品）','おぐらようかん']];
  for(const [name,query] of cases)assert.ok(matchesJapaneseQuery(name,query),`${name}/${query}`);
});
