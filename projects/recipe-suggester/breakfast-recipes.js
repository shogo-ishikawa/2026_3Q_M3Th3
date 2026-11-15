/** 朝食用の卵料理とパン。市販材料は確認した製品を明記し、一般品の情報を上書きしません。 */
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;};
const KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const CHECKED = '確認日2026-11-15。';
const product = (name, unit, allergens, groups, proteinSources, derivedFrom, values, basis, source, note, gramsPerUnit) => {
  const nutrition = Object.fromEntries(KEYS.map((key, i) => [key, values[i] === null ? null : values[i] / basis]));
  const nutritionSource = `${source} ${CHECKED} 食物繊維は未掲載のため未登録のまま保持。`;
  return {name, unit, allergens, groups, proteinSources, derivedFrom, ingredientsKnown:true, allergensKnown:true, shoppingKnown:true,
    ...(gramsPerUnit === undefined ? {} : {gramsPerUnit}), nutritionPerUnit:{...nutrition}, rawNutritionPerUnit:{...nutrition},
    nutritionSource, rawNutritionSource:nutritionSource, estimatedNutrients:[], note:`${note} 実際に使う商品の原材料・アレルゲン表示を確認してください。別製品への変更時は表示値も異なります。`};
};
export const BREAKFAST_INGREDIENTS = freeze({
  breakfast_bagel:product('プレーンベーグル（BAGEL&BAGEL公式通販の例）','個',['wheat','milk','soy'],['staple'],[],['flour','sugar','salt','soybeans'],
    [204,7.8,1,42.2,null,1.1],1,'BAGEL&BAGEL公式通販「プレーンベーグル」1製品当たりの表示。https://www.shop.bagelbagel.jp/view/item/000000000001',
    '原材料は小麦粉、砂糖、食塩、麦芽エキス、醸造調味料、小麦たん白、パン酵母、小麦粉調製品（大豆油を含む）、酵母エキス、醸造酢等。公式表示に乳成分も含む。1個単位で使い、製品重量の推定はしません。'),
  breakfast_english_muffin:product('イングリッシュマフィン（Pasco焼成aの例）','個',['wheat','milk','soy'],['staple'],[],['flour','sugar','corn','rice_flour','salt','soybeans'],
    [151,5.1,.8,30.9,null,.8],1,'Pasco業務用冷凍パン「焼成イングリッシュマフィンa」1個当たりの表示。https://pasco-frozen.com/product.php?id=772',
    '標準重量は1個67g。小麦粉、サワー種、糖類、コーングリッツ、パン酵母、食塩、醸造酢、ショートニング、小麦たんぱく、米粉を使用。',67),
  breakfast_ham:product('ロースハム（伊藤ハム 朝のフレッシュの例）','g',['egg','milk','soy','pork'],['protein'],['meat'],['pork','sugar','egg','soybeans','salt','milk'],
    [46,6.6,1.2,2.1,null,1.1],39,'伊藤ハム「朝のフレッシュ ロースハム」1パック39g当たりの推定表示。https://www.itoham.co.jp/product/product/detail.html?pdid=5',
    '期間限定増量中の39gパックの表示を1gへ換算。豚ロース肉、糖類、卵たん白、植物性たん白、食塩、乳たん白、ポークエキス調味料等を含む。共用設備による付着の注意書きも製品表示で確認。',1),
  breakfast_bacon:product('ハーフベーコン（伊藤ハム 朝のフレッシュの例）','g',['egg','milk','soy','pork'],['protein'],['meat'],['pork','sugar','egg','soybeans','salt','milk'],
    [65,4.3,4.4,2,null,.9],31,'伊藤ハム「朝のフレッシュ ハーフベーコン」1パック31g当たりの推定表示。https://www.itoham.co.jp/product/product/detail.html?pdid=6',
    '期間限定増量中の31gパックの表示を1gへ換算。豚ばら肉、糖類、卵たん白、植物性たん白、食塩、乳たん白、ポークエキス調味料等を含む。共用設備による付着の注意書きも製品表示で確認。',1),
  breakfast_chashu:product('チャーシュー（日本ハム もう切ってますよ！焼豚の例）','g',['egg','milk','wheat','sesame','soy','pork'],['protein'],['meat'],['pork','sugar','salt','soybeans','soy_sauce','sake','fish_sauce','egg','milk','sesame'],
    [152,12.6,6.1,11.6,null,4.2],100,'日本ハム「もう切ってますよ！焼豚」100g当たりの公式表示。https://www.nipponham.co.jp/products/ham_sausages/roast_pig/2699/',
    '豚肉、砂糖、食塩、大豆たん白、たれ、魚醤、卵たん白、乳たん白、香辛料等を含む味付け済み製品。追加のたれは計上しません。',1),
});
export const BREAKFAST_NUTRITION = freeze(Object.fromEntries(Object.entries(BREAKFAST_INGREDIENTS).map(([id,item]) => [id,
  Object.fromEntries(['gramsPerUnit','nutritionPerUnit','rawNutritionPerUnit','nutritionSource','rawNutritionSource','estimatedNutrients'].filter(key => item[key] !== undefined).map(key => [key,item[key]]))])));

const recipe = (id,name,role,family,minutes,items,steps,extra={}) => ({id:`breakfast-${id}`,name,role,family,genre:'洋食',minutes,servings:2,
  nature:'home-cooked',staple:role==='staple',mealBase:false,mealSuitability:['breakfast','lunch','dinner'],
  portion:{amount:1,unit:role==='staple'?'個':'皿'},ingredients:items.map(([id,amount])=>({id,amount})),steps,
  allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,tags:role==='staple'?[]:minutes<=20?['時短']:[],
  displayCategory:role==='staple'?'grain':'egg',displayMethod:'grill',displaySecondaryCategories:role==='main'?['meat']:[],
  sourceNote:`朝食の家庭向け配合例です。材料表は2人分。市販材料は一覧に記載した製品の公式表示を使い、同じ種類の全商品へ一般化しません。${CHECKED} 詳細は docs/breakfast-recipes.md。`,...extra});
const eggSteps = meat => [
  `${meat}を人数分へ分ける。卵は別の小さな器へ割り入れ、殻が入っていないことを確かめる。`,
  `油を薄く引いたフライパンを中火で温め、${meat}の両面を軽く焼く。焦げそうなら火を弱める。`,
  '卵を低い位置からそっと加える。水を鍋肌へ注いでふたをし、弱火で白身と黄身が固まるまで蒸し焼きにする。',
  'こしょうを振って皿へ移す。肉の味付けがあるので塩は加えず、主食やサラダは別の料理として付ける。',
];
const splitBread = name => `${name}を横半分に割り、製品の保存・解凍方法に従って切り口を軽くトーストする。`;
const eggBreadSteps = name => [splitBread(name),
  'フライパンへ油を薄く引き、卵を割り入れる。弱火でふたをして黄身と白身が固まるまで加熱する。',
  'パンの下半分へチーズと目玉焼きを重ねて上半分ではさむ。チーズを溶かしたい場合は余熱で温め、熱いうちに食べる。'];
const hamBreadSteps = name => [splitBread(name),
  'レタスを洗ってよく水気を切る。ハムは製品の表示を確認し、必要な場合は中心まで温めてから粗熱を取る。',
  'パンの下半分へハム・チーズ・レタスを重ねてはさむ。作ったら早めに食べ、すぐ食べない場合は冷蔵する。'];
export const BREAKFAST_RECIPES = freeze([
  recipe('ham-egg','ハムエッグ','main','egg-main',10,[['breakfast_ham',40],['egg',2],['oil',4],['water',20],['black_pepper',.1]],eggSteps('ハム')),
  recipe('bacon-egg','ベーコンエッグ','main','egg-main',10,[['breakfast_bacon',40],['egg',2],['oil',2],['water',20],['black_pepper',.1]],eggSteps('ベーコン')),
  recipe('chashu-egg','チャーシューエッグ','main','egg-main',10,[['breakfast_chashu',100],['egg',2],['oil',2],['water',20],['black_pepper',.1]],eggSteps('チャーシュー'),{genre:'和食'}),
  recipe('bagel-plain','プレーンベーグル','staple','bread',5,[['breakfast_bagel',2]],[],{nature:'ready-to-eat'}),
  recipe('bagel-egg-cheese','たまごチーズベーグル','staple','bread',15,[['breakfast_bagel',2],['egg',2],['cheese',30],['oil',2]],eggBreadSteps('ベーグル'),{mealBase:true}),
  recipe('bagel-ham-cheese','ハムチーズベーグル','staple','bread',10,[['breakfast_bagel',2],['breakfast_ham',40],['cheese',30],['lettuce',20]],hamBreadSteps('ベーグル'),{mealBase:true}),
  recipe('english-muffin-egg','目玉焼きとチーズのイングリッシュマフィン','staple','bread',15,[['breakfast_english_muffin',2],['egg',2],['cheese',30],['oil',2]],eggBreadSteps('イングリッシュマフィン'),{mealBase:true}),
  recipe('english-muffin-ham-cheese','ハムチーズのイングリッシュマフィン','staple','bread',10,[['breakfast_english_muffin',2],['breakfast_ham',40],['cheese',30],['lettuce',20]],hamBreadSteps('イングリッシュマフィン'),{mealBase:true}),
]);
