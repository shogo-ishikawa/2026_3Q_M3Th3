/** 刺身の追加分。材料は2人分、可食部100gを1人分の計算基準にします。 */
const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const details = {
  mizudako: {
    name:'ミズダコ（生・刺身用・可食部）', label:'ミズダコ（生）', code:'10432',
    values:[61,13.4,0.9,0.1,0,1.1], gramsPerUnit:5, defaultAmount:6,
    note:'生食用として販売されたミズダコの生の可食部です。マダコのボイルとは別の魚種・状態で、ゆでたミズダコの値ではありません。',
  },
  amaebi: {
    name:'甘えび（生・刺身用・むき身）', label:'甘えび', code:'10319',
    values:[85,19.8,1.5,0.1,0,0.8], gramsPerUnit:5, defaultAmount:6, unit:'尾', allergens:['shrimp'],
    note:'ほっこくあかえび（甘えび）の代表値です。生食用として販売されたむき身を使用し、頭・殻・尾の殻は重量に含めません。',
  },
  inada: {
    name:'イナダ（生・刺身用・可食部）', label:'イナダ', code:'10411',
    values:[180,21.0,12.0,0.3,0,0.1], gramsPerUnit:12, defaultAmount:3, estimatedNutrients:keys,
    note:'イナダは若いブリの呼び名です。専用の成分項目がないため、成魚のブリではなく、同種の若魚「はまち・養殖・皮なし・生」の値を代用した推定です。天然のイナダは季節や個体で特に脂質が変わります。',
  },
  hirame: {
    name:'ヒラメ（生・刺身用・皮なし可食部）', label:'ヒラメ', code:'10410',
    values:[100,21.2,2.5,0.1,0,0.1], gramsPerUnit:8, defaultAmount:4,
    note:'養殖ヒラメ・皮なし・生の代表値です。生食用として販売された身を使用します。天然物や縁側だけの値ではありません。',
  },
  tsubu: {
    name:'つぶ貝（生・刺身用・むき身）', label:'つぶ貝', code:'10304',
    values:[81,16.3,0.6,3.1,0,0.6], gramsPerUnit:5, defaultAmount:6,
    note:'「ばい・生」（別名つぶ）の可食部を代表値とします。種類による差があります。刺身用に下処理されたむき身を使用し、殻・内臓は重量に含めません。ボイル製品とは区別します。',
  },
  shimesaba: {
    name:'しめさば（酢締め済み・可食部）', label:'しめさば（酢締め）', code:'10163',
    values:[292,18.6,26.9,1.7,0,1.6], gramsPerUnit:15, defaultAmount:2, allergens:['mackerel'],
    note:'さばを酢締めした加工品の代表値です。生のさばとは別項目で、加工由来の塩分・糖分を含みます。市販品の原材料や調味料は商品表示も確認してください。',
  },
  iwashi: {
    name:'イワシ（生・刺身用・可食部）', label:'イワシ', code:'10047',
    values:[156,19.2,9.2,0.2,0,0.2], gramsPerUnit:10, defaultAmount:3,
    note:'まいわし・生の可食部を代表値とします。生食用として販売された身を使用し、頭・骨・内臓は重量に含めません。季節や脂の量によって変わります。',
  },
  sanma: {
    name:'サンマ（生・刺身用・皮なし可食部）', label:'サンマ', code:'10407',
    values:[277,17.8,25.0,0.2,0,0.3], gramsPerUnit:10, defaultAmount:3,
    note:'さんま・皮なし・生の刺身用の代表値です。生食用として販売された身を使用し、皮・頭・骨・内臓は重量に含めません。焼き魚用の皮付きサンマとは区別します。',
  },
  akaebi: {
    name:'赤えび（アルゼンチン・生・刺身用・むき身）', label:'赤えび', code:'10467',
    values:[73,19.1,0.7,0.03,0,0.8], gramsPerUnit:15, defaultAmount:2, unit:'尾', allergens:['shrimp'],
    rawValues:[73,19.1,0.7,null,null,0.8], estimatedNutrients:['carbs','fiber'],
    note:'アルゼンチンあかえび・生の代表値です。生食用として販売されたむき身を使用し、頭・殻は重量に含めません。炭水化物Trは0.03g/100g、未収載の食物繊維は動物性可食部として0g/100gを計算用に推定します。',
  },
  hiramasa: {
    name:'ヒラマサ（生・刺身用・可食部）', label:'ヒラマサ', code:'10233',
    values:[128,22.6,4.9,0.1,0,0.1], gramsPerUnit:15, defaultAmount:2,
    note:'ひらまさ・生の可食部の代表値です。生食用として販売された身を使用します。ぶり・はまちとは別種として扱います。',
  },
};

export const SEAFOOD_INGREDIENTS = freeze(Object.fromEntries(Object.entries(details).map(([id, food]) => [`seafood_${id}`, {
  name:food.name, unit:'g', allergens:food.allergens??[], groups:['protein'], proteinSources:['fish'], note:food.note,
}])));

export const SEAFOOD_NUTRITION = freeze(Object.fromEntries(Object.entries(details).map(([id, food]) => {
  const source = `日本食品標準成分表（八訂）増補2023年・食品番号${food.code}の可食部100g値を1gへ換算。食物繊維(0)は0として登録。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_${food.code}_7 ${food.note}`;
  // 代用品は対象食材の実測値ではありません。Tr・未収載も元データ側ではnullに保ちます。
  const rawValues=food.rawValues??(id==='inada'?keys.map(()=>null):food.values);
  return [`seafood_${id}`, {
    gramsPerUnit:1,
    nutritionPerUnit:Object.fromEntries(keys.map((key,index)=>[key,food.values[index]/100])),
    rawNutritionPerUnit:Object.fromEntries(keys.map((key,index)=>[key,rawValues[index]===null?null:rawValues[index]/100])),
    nutritionSource:source,
    rawNutritionSource:id==='inada'?`イナダ自体の成分値は未収載。計算値には若魚のはまち（養殖・皮なし・生、食品番号10411）を代用。${source}`:source,
    estimatedNutrients:food.estimatedNutrients??[],
  }];
})));

export const SEAFOOD_RECIPES = freeze(Object.entries(details).map(([id,food])=>({
  id:`seafood-sashimi-${id}`, name:id==='shimesaba'?'しめさば':`${food.label}の刺身`,
  role:'main', genre:'和食', minutes:5, servings:2,
  ingredients:[{id:`seafood_${id}`,amount:200},{id:'soy_sauce',amount:12},{id:'shiso',amount:2}],
  steps:[], family:'sashimi', variantLabel:food.label,
  portion:{amount:100,unit:'g',label:'1人分＝魚介の可食部100g（しょうゆは別添えの目安）'},
  staple:false, mealBase:false, nature:'ready-to-eat',
  allergensKnown:true, ingredientsKnown:true, shoppingKnown:true,
  sourceNote:`魚介の可食部と別添えしょうゆの概算です。${food.note}`,
  tags:['定番','さっぱり','時短'], displayCategory:'fish', displayMethod:'sashimi',
})));

/** 尾数・切れ数は重量入力を助ける目安で、栄養計算と買い物は常に可食部gです。 */
export const SEAFOOD_SASHIMI_CHOICES = freeze(Object.entries(details).map(([id,food])=>({
  id, label:food.label, recipeId:`seafood-sashimi-${id}`, unit:food.unit??'切れ',
  gramsPerUnit:food.gramsPerUnit, defaultAmount:food.defaultAmount,
  note:`${food.unit==='尾'?'頭・殻を除いたむき身1尾':'切り分けた可食部1切れ'}を約${food.gramsPerUnit}gとする目安です。厚さや実物の重量に合わせて変更できます。${food.note}`,
})));
