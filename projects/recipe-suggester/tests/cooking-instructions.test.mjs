import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS} from '../data.js';
import {CLASSIC_MAIN_RECIPES} from '../classics-mains.js';
import {VARIED_RECIPES} from '../varied-recipes.js';
import {decorateRecipe} from '../catalog-metadata.js';
import {decorateCookingInstructions} from '../cooking-instructions.js';

const get = id => RECIPES.find(recipe=>recipe.id===id);
const guide = id => decorateCookingInstructions(get(id),INGREDIENTS);
const withoutSteps = recipe => {const {steps,...rest}=recipe;return rest;};

test('料理手順の整理は材料・人数・量・分類・栄養などを書き換えず、元のオブジェクトを保つ',()=>{
  for(const source of RECIPES){
    const before=structuredClone(source),result=decorateCookingInstructions(source,INGREDIENTS);
    assert.deepEqual(withoutSteps(result),withoutSteps(before),source.id);
    assert.deepEqual(source,before,source.id);
    assert.ok(Array.isArray(result.steps),source.id);
    assert.ok(result.steps.length<=50,source.id);
    for(const step of result.steps){
      assert.ok(typeof step==='string'&&step.length>=10&&step.length<=2000,source.id);
      assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),source.id+': '+step);
    }
  }
});

test('購入品の4形態には作り方を作らず、利用者が保存した作り方を保持する',()=>{
  for(const nature of ['instant','retort','fast-food','ready-to-eat']){
    const source={id:'test-bought',name:'購入した食品',role:'main',nature,steps:['包材の表示に沿って温めて食べる。'],ingredients:[{id:'rice',amount:100}]};
    const result=decorateCookingInstructions(source,INGREDIENTS);
    assert.deepEqual(result.steps,[],nature);
    assert.deepEqual(source.steps,['包材の表示に沿って温めて食べる。'],nature);
    const custom={...source,custom:true};
    assert.equal(decorateCookingInstructions(custom,INGREDIENTS),custom,nature);
  }
});

test('手作りの主菜・副菜・汁物は必要な工程を詳しくし、単純な注ぐ操作は1工程で扱う',()=>{
  for(const source of RECIPES.filter(r=>r.nature==='home-cooked'&&['main','side','soup'].includes(r.role))){
    assert.ok(decorateCookingInstructions(source,INGREDIENTS).steps.length>=4,source.id);
  }
  assert.equal(guide('drink-green-tea').steps.length,1);
  assert.equal(guide('drink-coffee').steps.length,1);
  assert.equal(guide('drink-lemon-water').steps.length,2);
  assert.ok(guide('classic-shumai').steps.length>guide('drink-lemon-water').steps.length);
  assert.notEqual(guide('classic-croquette-potato').steps.length,guide('classic-shumai').steps.length);
});

test('シュウマイと餃子は練る・包む・並べる・加熱確認を区別する',()=>{
  const shumai=guide('classic-shumai').steps.join(' '),gyoza=guide('classic-gyoza').steps.join(' ');
  assert.match(shumai,/円柱状/);assert.match(shumai,/間隔/);assert.match(shumai,/蒸気/);assert.match(shumai,/75℃.*1分/);
  assert.match(gyoza,/縁に具を付けない/);assert.match(gyoza,/蒸し焼き/);assert.match(gyoza,/水分を飛ば/);assert.match(gyoza,/75℃.*1分/);
});

test('卵なしハンバーグや野菜カレーへ、登録されていない卵・乳・肉を足さない',()=>{
  const beef=guide('beef-hamburg').steps.join(' '),vegetable=guide('daily-curry-vegetable').steps.join(' ');
  assert.doesNotMatch(beef,/溶いた卵|牛乳|パン粉/);
  assert.doesNotMatch(vegetable,/肉|牛乳|バター/);
  assert.match(vegetable,/かぼちゃ|ひよこ豆/);
});

test('魚別のフライは各材料の下処理を示し、コロッケは具を冷ましてから衣を付ける',()=>{
  const white=guide('familiar-white-fish-fry').steps.join(' '),shrimp=guide('familiar-shrimp-fry').steps.join(' ');
  assert.match(white,/たらの骨/);assert.doesNotMatch(white,/えび|いか/);
  assert.match(shrimp,/背わた|腹側/);assert.doesNotMatch(shrimp,/たら|いか/);
  const croquette=guide('classic-croquette-potato').steps;
  assert.ok(croquette.findIndex(s=>/冷ます/.test(s))<croquette.findIndex(s=>/隙間ができないよう衣/.test(s)));
  assert.doesNotMatch(croquette.join(' '),/具の水気を拭/);
  assert.match(croquette.join(' '),/じゃがいも|ひき肉/);
});

test('豆乳で固めるプリンへ卵液を足さず、豆乳のポタージュへ牛乳を足さない',()=>{
  const pudding=guide('snack-soy-cocoa-pudding').steps.join(' '),potage=guide('soup-004').steps.join(' ');
  assert.doesNotMatch(pudding,/卵/);assert.match(pudding,/でん粉|コーンスターチ/);
  assert.doesNotMatch(potage,/牛乳/);assert.match(potage,/豆乳/);
  const steps=guide('soup-004').steps;
  assert.ok(steps.findIndex(s=>!s.startsWith('コツ：')&&/ブレンダー/.test(s))<steps.findIndex(s=>s.startsWith('コツ：')&&/ミキサー/.test(s)));
  assert.doesNotMatch(guide('daily-snack-custard-pudding').steps.join(' '),/具を重ならないように広げる/);
});

test('寿司の個・皿・貫と巻物の切れ数を混同せず、既存記録の旧手順を上書きしない',()=>{
  for(const id of ['classic-sushi-inari','classic-sushi-chirashi'])assert.doesNotMatch(guide(id).steps.join(' '),/作る貫数/);
  assert.match(guide('sushi-hosomaki-kappa').steps.join(' '),/切れ数/);
  const raw=CLASSIC_MAIN_RECIPES.find(r=>r.id==='classic-gyoza');
  const historical=structuredClone({...decorateRecipe(raw),steps:[...raw.steps]});
  const before=structuredClone(historical);
  decorateCookingInstructions({...historical},INGREDIENTS);
  assert.deepEqual(historical,before);
  assert.deepEqual(raw.steps,before.steps);
});

test('既に詳細な手作り手順は工程数を増やすために置き換えない',()=>{
  for(const source of VARIED_RECIPES){
    assert.deepEqual(get(source.id).steps,source.steps,source.id);
    assert.deepEqual(decorateCookingInstructions(source,INGREDIENTS).steps,source.steps,source.id);
  }
  const detailed={id:'test-detailed',name:'野菜の手作り料理',role:'side',nature:'home-cooked',steps:Array.from({length:6},(_,i)=>`具体的な工程${i}を分量に合わせて進める。`),ingredients:[{id:'carrot',amount:100}]};
  const result=decorateCookingInstructions(detailed,INGREDIENTS);
  assert.deepEqual(result.steps,detailed.steps);
  assert.notEqual(result.steps,detailed.steps);
});
