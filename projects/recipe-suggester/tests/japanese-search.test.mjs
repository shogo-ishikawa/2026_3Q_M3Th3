import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseJapaneseSearch, matchesJapaneseQuery,japaneseQueryRank} from '../japanese-search.js';
import {catalogFamilies, catalogVariants, recipeFamily} from '../catalog.js';
import {browseDishes} from '../dish-hierarchy.js';
import {RECIPES, INGREDIENTS} from '../data.js';

const ids = values => values.map(value => value.id).sort();
const named = RECIPES.map(recipe => ({...recipe, ingredients:recipe.ingredients.map(part => ({...part, name:INGREDIENTS[part.id]?.name ?? part.id}))}));

test('文字幅・濁点・英字大小・ひらがな/カタカナの違いを検索時だけ吸収する', () => {
  assert.equal(normaliseJapaneseSearch('　ﾁｷﾝｶﾚｰ　'),normaliseJapaneseSearch('チキンカレー'));
  assert.equal(normaliseJapaneseSearch('ｐａｓｔａ'),normaliseJapaneseSearch('PASTA'));
  assert.equal(normaliseJapaneseSearch('ギョーザ'),normaliseJapaneseSearch('餃子'));
  assert.ok(matchesJapaneseQuery('ペペロンチーノ','ぺぺろんちーの'));
  assert.ok(matchesJapaneseQuery('カルボナーラ','ｶﾙﾎﾞﾅｰﾗ'));
  assert.ok(matchesJapaneseQuery('プロテイン 28g','ＰＲＯＴＥＩＮ') === false);
  assert.ok(matchesJapaneseQuery('ホエイ PROTEIN 28g','ｐｒｏｔｅｉｎ ２８Ｇ'));
});

test('定番料理の漢字・かな・慣用表記が双方向に一致する', () => {
  const groups = [
    ['シュウマイ','しゅうまい','シューマイ','焼売','シウマイ'],
    ['餃子','ギョーザ','ぎょうざ'], ['水餃子','すいぎょうざ','スイギョーザ'],
    ['唐揚げ','からあげ','カラアゲ','から揚げ'],
    ['焼き鳥','焼鳥','やきとり','ヤキトリ'], ['焼肉','焼き肉','やきにく'],
    ['春巻き','春巻','ハルマキ'], ['天ぷら','天麩羅','てんぷら'],
    ['うなぎ','鰻','ウナギ'], ['鶏皮','とりかわ'], ['牛タン','ぎゅうたん'],
    ['トマトジュース','とまとじゅーす'], ['炒飯','チャーハン','ちゃーはん'],
    ['スパゲティ','スパゲッティ','すぱげてぃー'], ['麻婆豆腐','マーボー豆腐','まーぼーどうふ'],
  ];
  for (const values of groups) for (const target of values) for (const query of values) {
    assert.ok(matchesJapaneseQuery(target,query),`${target} / ${query}`);
  }
});

test('別の料理を同一視せず、離れたフィールドをつないで架空の料理名を作らない', () => {
  assert.ok(!matchesJapaneseQuery('焼き餃子','水餃子'));
  assert.ok(!matchesJapaneseQuery('水餃子','やきぎょうざ'));
  assert.ok(matchesJapaneseQuery('焼き餃子','ぎょうざ'));
  assert.ok(matchesJapaneseQuery('水餃子','ぎょうざ'));
  assert.ok(!matchesJapaneseQuery(['水','餃子'],'水餃子'));
  assert.ok(!matchesJapaneseQuery(['焼き','鳥'],'やきとり'));
  assert.ok(!matchesJapaneseQuery('ココナッツミルク','牛乳'));
  assert.ok(!matchesJapaneseQuery('日本酒','サーモン'));
  assert.ok(!matchesJapaneseQuery('カレー','オムライス'));
});

test('空白で区切った語を順不同のAND条件として同じ料理内に適用する', () => {
  const fields = ['鶏肉と玉ねぎのトマト煮','手作り','野菜・いも'];
  assert.ok(matchesJapaneseQuery(fields,'たまねぎ トリニク'));
  assert.ok(matchesJapaneseQuery(fields,'鶏肉　トマト\nてづくり'));
  assert.ok(!matchesJapaneseQuery(fields,'鶏肉 春雨'));
  assert.ok(!matchesJapaneseQuery(fields,'トマト 即席'));
  assert.ok(matchesJapaneseQuery(fields,'  '));
  assert.ok(!matchesJapaneseQuery([], '鶏肉'));
  assert.ok(matchesJapaneseQuery('水餃子','水 ギョーザ'));
});

test('複合語と読みの濁りがあっても食材名から到達し、未知の漢字は推測しない', () => {
  for (const [target,query] of [
    ['高野豆腐','とうふ'], ['高野豆腐','こうやどうふ'], ['湯豆腐','ゆどうふ'],
    ['魚介料理','さかな'], ['焼き魚','やきざかな'], ['春雨（緑豆でん粉）','ハルサメ'],
    ['玉葱','たまねぎ'], ['鰻重','うなじゅう'], ['うな重','うなぎ'],
    ['青唐辛子','あおとうがらし'], ['ほうれん草','ホウレンソウ'],
  ]) assert.ok(matchesJapaneseQuery(target,query),`${target} / ${query}`);
  assert.equal(normaliseJapaneseSearch('未登録漢字'), '未登録漢字');
  assert.ok(!matchesJapaneseQuery('未登録漢字', 'みとうろくかんじ'));
});

test('既存DBの料理をかなで検索でき、表示名・元データ・検索順を変更しない', () => {
  const before = JSON.stringify(RECIPES);
  const expected = [
    ['シュウマイ','しゅうまい','焼売'], ['唐揚げ','からあげ','カラアゲ'],
    ['焼き鳥','やきとり','焼鳥'], ['鶏肉','とりにく','トリニク'],
    ['玉ねぎ','たまねぎ','タマネギ'], ['春雨','はるさめ','ハルサメ'],
    ['鮭','さけ','サーモン'], ['雑炊','ぞうすい','ゾウスイ'],
    ['ほうれん草','ほうれんそう','ホウレンソウ'],
  ];
  for (const values of expected) {
    const reference = browseDishes(named,{query:values[0]});
    assert.ok(reference.length,values[0]);
    for (const query of values.slice(1)) assert.deepEqual(ids(browseDishes(named,{query})),ids(reference),query);
  }
  assert.equal(JSON.stringify(RECIPES), before);
});

test('種類・役割・調理法・提供形態の絞り込みを検索が迂回しない', () => {
  const query = 'からあげ';
  const result = browseDishes(named,{section:'main',category:'meat',method:'fried',nature:'home-cooked',query});
  assert.ok(result.some(recipe => recipe.id === 'classic-karaage-thigh'));
  assert.ok(result.every(recipe => recipe.role === 'main'));
  assert.deepEqual(browseDishes(named,{section:'drink',query}),[]);
  assert.deepEqual(browseDishes(named,{method:'steam',query}),[]);
  const juice = catalogVariants(named,'juice',{query:'とまと'});
  assert.ok(juice.some(recipe => recipe.id === 'drink-tomato-juice'));
  assert.ok(juice.every(recipe => recipeFamily(recipe) === 'juice'));
  assert.deepEqual(catalogFamilies(named,{role:'drink',query:'焼売'}),[]);
  assert.deepEqual(catalogFamilies(named,{role:'main',query:'シューマイ'}),catalogFamilies(named,{role:'main',query:'焼売'}));
});

test('手持ちや除外の材料検索でも漢字・かな・カタカナを同じ照合で扱える', () => {
  const find = query => Object.entries(INGREDIENTS).filter(([id,item])=>matchesJapaneseQuery([item.name,id],query)).map(([id])=>id);
  for (const values of [['玉ねぎ','タマネギ','たまねぎ'],['牛肉','ギュウニク','ぎゅうにく'],['鶏肉','とりにく','トリニク'],['生姜','しょうが','ショウガ'],['春雨','ハルサメ','はるさめ']]) {
    const reference = find(values[0]);
    assert.ok(reference.length,values[0]);
    for(const query of values.slice(1))assert.deepEqual(find(query),reference,query);
  }
});


test('収録名の料理語を辞書で網羅し、全文のかな入力でも定番料理へ到達する', () => {
  for (const recipe of RECIPES) assert.ok(!/\p{Script=Han}/u.test(normaliseJapaneseSearch(recipe.name)),recipe.name);
  for (const ingredient of Object.values(INGREDIENTS)) assert.ok(!/\p{Script=Han}/u.test(normaliseJapaneseSearch(ingredient.name)),ingredient.name);
  for (const [name,query] of [
    ['さけと小松菜のミルク煮','さけとこまつなのみるくに'],
    ['肉団子の甘酢あん','にくだんごのあまずあん'],
    ['野菜入り厚焼き卵','やさいいりあつやきたまご'],
    ['さつまいもとりんごの重ね煮','さつまいもとりんごのかさねに'],
    ['高野豆腐の含め煮','こうやどうふのふくめに'],
    ['冷奴（薬味）','ヒヤヤッコ ヤクミ'],
    ['たけのこの土佐煮','たけのこのとさに'],
    ['崎陽軒 おいしさ長もち 昔ながらのシウマイ','きようけん むかしながらのしゅうまい'],
    ['焼鳥日本一 塩砂肝串','ヤキトリ ニホンイチ スナギモ'],
    ['かに玉の甘酢あん','かにたまのあまずあん'], ['とり天','トリテン'],
  ]) assert.ok(matchesJapaneseQuery(name,query),`${name} / ${query}`);
});


test('シュウマイ検索は共通の皮を使う餃子より料理名の一致を先にし、表記を変えても順序が一致する', () => {
  const reference = browseDishes(named,{query:'しゅうまい'});
  const dumplingIndex = reference.findIndex(recipe => recipe.id === 'classic-gyoza');
  const shumaiIndex = reference.findIndex(recipe => recipe.id === 'classic-shumai');
  assert.ok(shumaiIndex >= 0 && dumplingIndex > shumaiIndex);
  const fullNameMatches = reference.filter(recipe => matchesJapaneseQuery([recipe.name,recipe.variantLabel],'しゅうまい'));
  assert.deepEqual(reference.slice(0,fullNameMatches.length),fullNameMatches);
  for (const query of ['シュウマイ','シューマイ','焼売','シウマイ']) {
    assert.deepEqual(browseDishes(named,{query}).map(recipe => recipe.id),reference.map(recipe => recipe.id),query);
    const variants = catalogVariants(named,'meat-main',{query});
    assert.ok(variants.findIndex(recipe => recipe.id === 'classic-shumai') < variants.findIndex(recipe => recipe.id === 'classic-gyoza'),query);
    assert.deepEqual(variants.map(recipe => recipe.id),catalogVariants(named,'meat-main',{query:'しゅうまい'}).map(recipe => recipe.id),query);
  }
});

test('小分類名も優先し、空白ANDを保ち、未検索時と同順位の既存順序を維持する', () => {
  const base = named.find(recipe => recipe.id === 'classic-shumai');
  const materialOnly = {...base,id:'material-only',name:'えびの包み蒸し',variantLabel:'包み蒸し',ingredients:[{id:'dumpling_wrapper',name:'餃子・シュウマイの皮',amount:10}]};
  const variant = {...base,id:'variant',name:'えびの点心',variantLabel:'えびシュウマイ'};
  const name = {...base,id:'named',name:'えびシュウマイ',variantLabel:undefined};
  const unrelated = {...base,id:'unrelated',name:'チキンの蒸し物',variantLabel:'チキン',ingredients:[]};
  const samples = [materialOnly,variant,name,unrelated];
  assert.deepEqual(browseDishes(samples).map(recipe => recipe.id),samples.map(recipe => recipe.id));
  assert.deepEqual(catalogVariants(samples,'meat-main').map(recipe => recipe.id),samples.map(recipe => recipe.id));
  assert.deepEqual(browseDishes(samples,{query:'えび しゅうまい'}).map(recipe => recipe.id),['variant','named','material-only']);
  assert.deepEqual(catalogVariants(samples,'meat-main',{query:'えび 焼売'}).map(recipe => recipe.id),['variant','named','material-only']);
  assert.deepEqual(browseDishes(samples,{query:'えび 水餃子'}),[]);
  assert.equal(japaneseQueryRank([name.name,name.variantLabel],'エビ シウマイ'),0);
  assert.equal(japaneseQueryRank([materialOnly.name,materialOnly.variantLabel],'エビ シウマイ'),1);
  assert.equal(japaneseQueryRank([unrelated.name,unrelated.variantLabel],'エビ シウマイ'),2);
  assert.equal(japaneseQueryRank([name.name],''),0);
});
