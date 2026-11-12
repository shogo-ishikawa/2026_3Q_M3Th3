/** 酒類・清涼飲料水・プロテイン・補食の記録例。確認日: 2026-11-13。
 * 材料は2人分、manualNutritionとportionは1人分です。
 * 商品の変更と利用者の包材表示は別に確認します。
 */
import {INGREDIENT_NUTRITION} from './ingredient-nutrients.js';

const CHECKED='2026-11-13';
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const notice='掲載時の参考例です。味・容量・販売地域や仕様が異なる場合は購入した商品の表示を優先してください。原材料とアレルギー情報は個別に確認してください。';
const ALCOHOL=[
  {
    "id": "perf_beer",
    "name": "ビール（淡色・一般例）",
    "code": "16006",
    "basisAmount": 350,
    "variantLabel": "ビール・淡色",
    "densityGPerMl": 1.008,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_black_beer",
    "name": "黒ビール（一般例）",
    "code": "16007",
    "basisAmount": 350,
    "variantLabel": "ビール・黒",
    "densityGPerMl": 1.01,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_sake",
    "name": "日本酒・普通酒（飲用・一般例）",
    "code": "16001",
    "basisAmount": 180,
    "variantLabel": "日本酒・普通酒",
    "densityGPerMl": 0.999,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_wine_red",
    "name": "赤ワイン（一般例）",
    "code": "16011",
    "basisAmount": 150,
    "variantLabel": "赤ワイン",
    "densityGPerMl": 0.996,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_wine_white",
    "name": "白ワイン（一般例）",
    "code": "16010",
    "basisAmount": 150,
    "variantLabel": "白ワイン",
    "densityGPerMl": 0.998,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_shochu",
    "name": "焼酎・単式蒸留25度（一般例）",
    "code": "16015",
    "basisAmount": 60,
    "variantLabel": "焼酎・25度",
    "densityGPerMl": 0.97,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_whisky",
    "name": "ウイスキー40度（一般例）",
    "code": "16016",
    "basisAmount": 30,
    "variantLabel": "ウイスキー・40度",
    "densityGPerMl": 0.952,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_umeshu",
    "name": "梅酒（一般例）",
    "code": "16022",
    "basisAmount": 60,
    "variantLabel": "梅酒",
    "densityGPerMl": 1.039,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  },
  {
    "id": "perf_chuhai",
    "name": "缶チューハイ・レモン風味（一般例）",
    "code": "16059",
    "basisAmount": 350,
    "variantLabel": "チューハイ・レモン",
    "densityGPerMl": 1.001,
    "sourceURL": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html"
  }
];

const PRODUCTS=[
  {
    "id": "perf_soy_powder",
    "name": "ザバス ソイプロテイン100 ココア味（粉末）",
    "unit": "g",
    "basisAmount": 28,
    "basisUnit": "g",
    "nutritionAtBasis": {
      "kcal": 103,
      "protein": 20,
      "fat": 1.4,
      "carbs": 3,
      "fiber": null,
      "salt": null
    },
    "sourceURL": "https://www.meiji.co.jp/sports/savas/products/shape_wellness/soy100.html",
    "allergens": [
      "milk",
      "soy"
    ],
    "ingredientSummary": "大豆たんぱく、ココアなど。乳成分と大豆を含む。",
    "kind": "powder",
    "variantLabel": "ソイ・ココア",
    "unknownNote": "食物繊維0.57〜1.51gと食塩0.63〜1.45gは範囲表示のため単一点の値は未登録。"
  },
  {
    "id": "perf_whey_powder",
    "name": "ザバス ホエイプロテイン100 リッチショコラ味（粉末）",
    "unit": "g",
    "basisAmount": 28,
    "basisUnit": "g",
    "nutritionAtBasis": {
      "kcal": 108,
      "protein": 19.5,
      "fat": 2,
      "carbs": 3.7,
      "fiber": 1.4,
      "salt": null
    },
    "sourceURL": "https://www.meiji.co.jp/sports/savas/products/muscle_sports/whey100.html",
    "allergens": [
      "milk",
      "soy"
    ],
    "ingredientSummary": "乳清たんぱく、ココアなど。乳成分と大豆を含む。",
    "kind": "powder",
    "variantLabel": "ホエイ・リッチショコラ",
    "unknownNote": "食塩0.31〜0.76gは範囲表示のため単一点の値は未登録。"
  },
  {
    "id": "perf_milk_protein",
    "name": "ザバス MILK PROTEIN 脂肪0 ココア風味（200ml）",
    "unit": "ml",
    "basisAmount": 200,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 103,
      "protein": 15,
      "fat": 0,
      "carbs": 10.8,
      "fiber": null,
      "salt": 0.26
    },
    "sourceURL": "https://www.meiji.co.jp/products/sports/4902705014541.html",
    "allergens": [
      "milk"
    ],
    "ingredientSummary": "乳製品と乳たんぱく質など。乳成分を含む。",
    "kind": "protein-ready",
    "variantLabel": "乳たんぱく・ココア",
    "unknownNote": "食物繊維0〜0.7gは範囲表示のため単一点の値は未登録。"
  },
  {
    "id": "perf_cola_zero",
    "name": "コカ・コーラ ゼロ",
    "unit": "ml",
    "basisAmount": 100,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 0,
      "protein": 0,
      "fat": 0,
      "carbs": 0,
      "fiber": null,
      "salt": 0.01
    },
    "sourceURL": "https://www.coca-cola.com/jp/ja/brands/coca-cola/products",
    "allergens": [],
    "ingredientSummary": "炭酸、甘味料、香料、カフェインなど。",
    "kind": "soft",
    "variantLabel": "コーラ・ゼロ",
    "unknownNote": "食物繊維は表示なし。"
  },
  {
    "id": "perf_ion_water",
    "name": "ポカリスエット イオンウォーター（液体）",
    "unit": "ml",
    "basisAmount": 100,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 11,
      "protein": 0,
      "fat": 0,
      "carbs": 2.7,
      "fiber": null,
      "salt": 0.1
    },
    "sourceURL": "https://www.otsuka.co.jp/nutraceutical/products/ionwater/",
    "allergens": [],
    "ingredientSummary": "糖類、果汁、食塩、各種電解質など。",
    "kind": "soft",
    "variantLabel": "スポーツ・低糖タイプ",
    "unknownNote": "食物繊維は表示なし。通常のポカリスエットや粉末タイプとは別。"
  },
  {
    "id": "perf_energy",
    "name": "レッドブル エナジードリンク",
    "unit": "ml",
    "basisAmount": 100,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 46,
      "protein": 0,
      "fat": 0,
      "carbs": 10.7,
      "fiber": null,
      "salt": 0.2
    },
    "sourceURL": "https://www.redbull.com/jp-ja/energydrink/products/red-bull-energy-drink-ingredients-list",
    "allergens": [],
    "ingredientSummary": "水、糖類、アルギニン、カフェインなど。",
    "kind": "soft",
    "variantLabel": "エナジー・通常",
    "unknownNote": "食物繊維は表示なし。カフェイン32mg/100mlの表示があるが、本アプリの6成分集計には含めない。"
  },
  {
    "id": "perf_energy_zero",
    "name": "レッドブル シュガーフリー",
    "unit": "ml",
    "basisAmount": 100,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 0,
      "protein": 0,
      "fat": 0,
      "carbs": 0,
      "fiber": null,
      "salt": 0.2
    },
    "sourceURL": "https://www.redbull.com/jp-ja/energydrink/products/red-bull-sugarfree-ingredients-list",
    "allergens": [],
    "ingredientSummary": "水、甘味料、アルギニン、カフェインなど。",
    "kind": "soft",
    "variantLabel": "エナジー・シュガーフリー",
    "unknownNote": "食物繊維は表示なし。カフェイン32mg/100mlの表示があるが、本アプリの6成分集計には含めない。"
  },
  {
    "id": "perf_ginger_ale",
    "name": "カナダドライ ジンジャーエール",
    "unit": "ml",
    "basisAmount": 100,
    "basisUnit": "ml",
    "nutritionAtBasis": {
      "kcal": 36,
      "protein": 0,
      "fat": 0,
      "carbs": 9,
      "fiber": null,
      "salt": 0
    },
    "sourceURL": "https://www.coca-cola.com/jp/ja/brands/canada-dry",
    "allergens": [],
    "ingredientSummary": "果糖ぶどう糖液糖、ジンジャーエキス、炭酸など。",
    "kind": "soft",
    "variantLabel": "ジンジャーエール",
    "unknownNote": "食物繊維は表示なし。製品ページの表示を使用し、過去のニュースリリースとは混ぜない。"
  },
  {
    "id": "perf_bar_baked_choco",
    "name": "inバープロテイン ベイクドチョコ（42g）",
    "unit": "本",
    "basisAmount": 1,
    "basisUnit": "本",
    "nutritionAtBasis": {
      "kcal": 199,
      "protein": 15.8,
      "fat": 9.8,
      "carbs": 12.5,
      "fiber": null,
      "salt": null
    },
    "sourceURL": "https://www.morinaga.co.jp/products/detail.php?id=PRD2009-09-0164",
    "allergens": [
      "wheat",
      "milk",
      "almond",
      "soy"
    ],
    "ingredientSummary": "大豆・乳清たんぱく、チョコレート原料など。",
    "kind": "bar",
    "variantLabel": "プロテインバー・ベイクドチョコ",
    "unknownNote": "食物繊維0.6〜2.5gと食塩0.17〜0.72gは範囲表示のため未登録。"
  },
  {
    "id": "perf_bar_baked_bitter",
    "name": "inバープロテイン ベイクドビター（42g）",
    "unit": "本",
    "basisAmount": 1,
    "basisUnit": "本",
    "nutritionAtBasis": {
      "kcal": 205,
      "protein": 15.9,
      "fat": 12.6,
      "carbs": 10.7,
      "fiber": 6.9,
      "salt": null
    },
    "sourceURL": "https://www.morinaga.co.jp/products/detail.php?id=PRD2018-02-0014",
    "allergens": [
      "wheat",
      "milk",
      "almond",
      "soy"
    ],
    "ingredientSummary": "大豆・乳清たんぱく、チョコレート原料など。",
    "kind": "bar",
    "variantLabel": "プロテインバー・ベイクドビター",
    "unknownNote": "食塩0.14〜0.60gは範囲表示のため未登録。"
  },
  {
    "id": "perf_bar_manzoku",
    "name": "1本満足バー プロテインチョコ（39g）",
    "unit": "本",
    "basisAmount": 1,
    "basisUnit": "本",
    "nutritionAtBasis": {
      "kcal": 181,
      "protein": 16,
      "fat": 8.3,
      "carbs": 11.45,
      "fiber": null,
      "salt": 0.49
    },
    "sourceURL": "https://www.asahi-gf.co.jp/products/health/support-food/1pon-manzoku/protein/4946842526345.html",
    "allergens": [
      "wheat",
      "milk",
      "soy"
    ],
    "ingredientSummary": "大豆パフ、乳清・大豆たんぱく、チョコレート原料など。",
    "kind": "bar",
    "variantLabel": "プロテインバー・1本満足",
    "unknownNote": "食物繊維1.4〜2.5gは範囲表示のため未登録。"
  },
  {
    "id": "perf_chicken_plain",
    "name": "ローソン サラダチキン プレーン（110g）",
    "unit": "袋",
    "basisAmount": 1,
    "basisUnit": "袋",
    "nutritionAtBasis": {
      "kcal": 141,
      "protein": 30.3,
      "fat": 2.1,
      "carbs": 0.2,
      "fiber": 0,
      "salt": 0.9
    },
    "sourceURL": "https://www.lawson.co.jp/sp/recommend/original/detail/1507463_2168.html",
    "allergens": [
      "chicken"
    ],
    "ingredientSummary": "公式説明で鶏肉と塩を確認。実際の包材表示を優先する。",
    "kind": "chicken",
    "variantLabel": "サラダチキン・プレーン",
    "unknownNote": "仕様や地域で変わるため、利用者の商品の全原材料を確認した扱いにはしない。"
  },
  {
    "id": "perf_chicken_herb",
    "name": "ローソン サラダチキン ハーブ（110g）",
    "unit": "袋",
    "basisAmount": 1,
    "basisUnit": "袋",
    "nutritionAtBasis": {
      "kcal": 119,
      "protein": 23.1,
      "fat": 1.8,
      "carbs": 2.7,
      "fiber": 0.4,
      "salt": 1.7
    },
    "sourceURL": "https://mldata.lawson.co.jp/recommend/original/detail/1390764_1996.html",
    "allergens": [
      "chicken"
    ],
    "ingredientSummary": "公式説明で鶏むね肉、塩味、ハーブを確認。全原材料の転記ではない。",
    "kind": "chicken",
    "variantLabel": "サラダチキン・ハーブ",
    "unknownNote": "全原材料とアレルゲンの詳細は商品表示を確認。"
  },
  {
    "id": "perf_chicken_smoke",
    "name": "ローソン サラダチキン スモーク（110g）",
    "unit": "袋",
    "basisAmount": 1,
    "basisUnit": "袋",
    "nutritionAtBasis": {
      "kcal": 120,
      "protein": 23.8,
      "fat": 1.4,
      "carbs": 3,
      "fiber": 0.1,
      "salt": 1.3
    },
    "sourceURL": "https://mldata.lawson.co.jp/recommend/original/detail/1450533_1996.html",
    "allergens": [
      "chicken"
    ],
    "ingredientSummary": "公式説明で鶏むね肉、塩味、スモーク加工を確認。全原材料の転記ではない。",
    "kind": "chicken",
    "variantLabel": "サラダチキン・スモーク",
    "unknownNote": "全原材料とアレルゲンの詳細は商品表示を確認。"
  },
  {
    "id": "perf_calorie_block_choco",
    "name": "カロリーメイト ブロック チョコレート味（4本80g）",
    "unit": "箱",
    "basisAmount": 1,
    "basisUnit": "箱",
    "nutritionAtBasis": {
      "kcal": 400,
      "protein": 8.7,
      "fat": 22.4,
      "carbs": 41.7,
      "fiber": 2,
      "salt": 0.81
    },
    "sourceURL": "https://www.otsuka.co.jp/nutraceutical/products/caloriemate/",
    "allergens": [
      "egg",
      "milk",
      "wheat",
      "soy",
      "almond"
    ],
    "ingredientSummary": "小麦、卵、乳、大豆、アーモンドなどを使用。",
    "kind": "block",
    "variantLabel": "ブロック・チョコレート",
    "unknownNote": "この購入品は4本80g入り1箱。画面では4本を基準にし、2本食べた場合は2本と入力。"
  },
  {
    "id": "perf_calorie_block_cheese",
    "name": "カロリーメイト ブロック チーズ味（4本80g）",
    "unit": "箱",
    "basisAmount": 1,
    "basisUnit": "箱",
    "nutritionAtBasis": {
      "kcal": 400,
      "protein": 8.4,
      "fat": 22.2,
      "carbs": 42.7,
      "fiber": 2,
      "salt": 0.94
    },
    "sourceURL": "https://www.otsuka.co.jp/nutraceutical/products/caloriemate/",
    "allergens": [
      "egg",
      "milk",
      "wheat",
      "soy",
      "almond"
    ],
    "ingredientSummary": "小麦、チーズ、卵、大豆、アーモンドなどを使用。",
    "kind": "block",
    "variantLabel": "ブロック・チーズ",
    "unknownNote": "この購入品は4本80g入り1箱。画面では4本を基準にし、2本食べた場合は2本と入力。"
  },
  {
    "id": "perf_calorie_jelly_apple",
    "name": "カロリーメイト ゼリー アップル味（215g）",
    "unit": "袋",
    "basisAmount": 1,
    "basisUnit": "袋",
    "nutritionAtBasis": {
      "kcal": 200,
      "protein": 8.2,
      "fat": 4.4,
      "carbs": 33.2,
      "fiber": 2,
      "salt": 0.08
    },
    "sourceURL": "https://www.otsuka.co.jp/nutraceutical/products/caloriemate/",
    "allergens": [
      "milk",
      "apple",
      "gelatin"
    ],
    "ingredientSummary": "りんご果汁、乳製品、ホエイたんぱく、ゼラチンなど。",
    "kind": "jelly",
    "variantLabel": "ゼリー・アップル",
    "unknownNote": ""
  }
];

// 食品名と参照した店舗を分け、量や栄養の出典は説明へ残します。
const CHICKEN_RECORD_NAMES=Object.freeze({
  perf_chicken_plain:'サラダチキン（プレーン・市販品110g）',
  perf_chicken_herb:'サラダチキン（ハーブ・市販品110g）',
  perf_chicken_smoke:'サラダチキン（スモーク・市販品110g）',
});
const recordName=item=>CHICKEN_RECORD_NAMES[item.id]??item.name;
const referenceNote=item=>CHICKEN_RECORD_NAMES[item.id]?`栄養値の参照商品：${item.name}。出典の商品を参考にした記録例で、同じ料理でも量や栄養は異なります。`:'';

const ingredient=(name,unit,allergens,groups=[],proteinSources=[],note='')=>({name,unit,allergens,groups,proteinSources,note});
export const PERFORMANCE_INGREDIENTS={};
for(const item of ALCOHOL){
  PERFORMANCE_INGREDIENTS[item.id]=ingredient(item.name,'ml',[],[],[],`食品成分表の一般例。食品番号${item.code}、1ml=${item.densityGPerMl}gとして換算。実商品の全原材料を表すものではありません。${notice}`);
}
for(const item of PRODUCTS){
  const dairy=['powder','protein-ready'].includes(item.kind)&&item.id!=='perf_soy_powder';
  const protein=['powder','protein-ready','bar','chicken'].includes(item.kind);
  PERFORMANCE_INGREDIENTS[item.id]=ingredient(recordName(item),item.unit,item.allergens,[...(protein?['protein']:[]),...(dairy?['dairy']:[])],item.kind==='chicken'?['meat']:item.id==='perf_soy_powder'?['soy']:[],`${referenceNote(item)}${item.ingredientSummary} ${item.unknownNote} 商品単体の栄養はこの辞書では未登録です。メニューの基準量に対する公式表示を使います。${notice}`);
}
function menu(slug,name,family,variant,items,portion,{manualNutrition,sourceNote,nature='ready-to-eat',role=family==='functional-snack'?'snack':'drink',steps}={}){
  return {id:`performance-${slug}`,name,role,genre:'その他',minutes:2,servings:2,
    ingredients:items.map(([id,amount])=>({id,amount})),steps:steps??[
      '商品名と内容量を確認し、購入した包材の原材料、アレルゲンと栄養表示を確かめる。',
      '表示された基準量と実際に飲食した量を比べ、食べた分や飲んだ分だけ量を入力する。',
      '参考値と表示が違う場合は手入力で登録する。残した分を含めず記録を保存する。',
    ],tags:['時短'],staple:false,mealBase:false,family,variantLabel:variant,portion,nature,
    allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,
    sourceNote:`確認日${CHECKED}。${sourceNote} ${notice}`,
    ...(manualNutrition?{manualNutrition}:{})};
}
function scaled(values,multiplier){return Object.fromEntries(KEYS.map(key=>[key,values[key]===null?null:Number((values[key]*multiplier).toFixed(10))]));}
function plus(values,ingredientId,amount){
  const profile=INGREDIENT_NUTRITION[ingredientId]?.nutritionPerUnit;
  if(!profile)throw Error('混ぜる飲料の栄養を確認してください。');
  return Object.fromEntries(KEYS.map(key=>[key,values[key]===null||profile[key]===null?null:Number((values[key]+profile[key]*amount).toFixed(10))]));
}
const DRINKS=ALCOHOL.map(item=>menu(item.id.replace('perf_',''),item.name,'alcohol',item.variantLabel,[[item.id,item.basisAmount*2]],
  {amount:item.basisAmount,unit:'ml',label:`1人分の基準＝${item.basisAmount}ml。氷や割り材は含みません。`},
  {sourceNote:`食品成分表の食品番号${item.code}、1ml=${item.densityGPerMl}gの一般値です。度数や糖分が違う商品にはそのまま当てはめません。${item.sourceURL}`}));
DRINKS.push(menu('highball','ハイボール（ウイスキー45ml＋炭酸水135ml）','alcohol','ハイボール',
  [['perf_whisky',90],['carbonated_water',270]],{amount:1,unit:'杯',label:'1杯＝ウイスキー40度45ml＋無糖炭酸水135ml。氷を除く配合例。'},
  {sourceNote:'ウイスキーの食品成分表16016と無糖炭酸水の配合例です。完成容量を実測した値ではありません。甘い缶ハイボールとは区別します。 https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html'}));
const POWDERS=PRODUCTS.filter(item=>item.kind==='powder').flatMap(item=>['water','milk'].map(liquid=>{
  const milk=liquid==='milk',mixed=milk?plus(item.nutritionAtBasis,'milk',200):item.nutritionAtBasis;
  return menu(`${item.id.replace('perf_','')}-${liquid}`,`${item.name.replace('（粉末）','')}（${milk?'牛乳':'水'}200ml割）`,'protein-drink',`${item.variantLabel}・${milk?'牛乳':'水'}割`,
    [[item.id,56],[liquid,400]],{amount:1,unit:'杯',label:`1杯＝粉末28g＋${milk?'牛乳':'水'}200ml。完成容量は未測定。`},
    {manualNutrition:{...mixed},sourceNote:`粉末28gの公式表示に${milk?'成分表の普通牛乳200mlを加算':'水を加えた例'}。${item.ingredientSummary} ${item.unknownNote} ${item.sourceURL}`,
    steps:['粉末と水または牛乳を、表示された材料の量でそれぞれ量って用意する。','清潔な容器で混ぜる。ここで示した配合は記録例なので、実際の調製方法は商品の案内に従う。','飲み残した場合は、用意した全量に対して飲んだ割合で記録する。']});
}));
const PACKAGED=PRODUCTS.filter(item=>item.kind!=='powder').map(item=>{
  const liquid=['soft','protein-ready'].includes(item.kind),amount=liquid?(item.kind==='soft'?250:200):item.kind==='block'?4:1;
  const multiplier=liquid?amount/item.basisAmount:1;
  const portion={amount,unit:liquid?'ml':item.kind==='block'?'本':item.unit,
    label:liquid?`基準${amount}ml。公式の${item.basisAmount}ml表示から換算。`:item.kind==='block'?'4本80g（4本入り1箱）が基準。2本食べた場合は2本と入力。':`1${item.unit}が基準。${recordName(item)}`};
  return menu(item.id.replace('perf_',''),recordName(item),liquid?(item.kind==='soft'?'soft-drink':'protein-drink'):'functional-snack',item.variantLabel,
    [[item.id,liquid?amount*2:2]],portion,
    {manualNutrition:scaled(item.nutritionAtBasis,multiplier),sourceNote:`${referenceNote(item)}公式表示の${item.basisAmount}${item.basisUnit}当たりの値を基準にしています。${item.ingredientSummary} ${item.unknownNote} ${item.sourceURL}`});
});
export const PERFORMANCE_RECIPES=[...DRINKS,...POWDERS,...PACKAGED];
