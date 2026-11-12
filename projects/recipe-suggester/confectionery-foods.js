/** 市販のお菓子を食事記録へ追加するための表示例。確認日: 2026-11-13。
 * ingredients は2人分、manualNutrition は portion に記載した1人分。
 * メーカーが表示する袋・枚・個の基準を保ち、未表示や範囲値を0にしません。
 */
const KEYS=Object.freeze(['kcal','protein','fat','carbs','fiber','salt']);
const CHECKED='2026-11-13';
const NOTICE='規格や原材料は変更されます。購入した商品の表示を優先してください。';
const PRODUCTS=[
  {slug:'pocky',name:'ポッキー チョコレート',family:'biscuit',basis:29,unit:'g',label:'内袋1袋29g。箱全体は2袋入り',purchaseUnit:'袋',reference:'江崎グリコ ポッキーチョコレート・2袋入り',nutrition:[142,2.6,6.3,19.4,1.4,.15],allergens:['milk','wheat','soy'],url:'https://www.glico.com/jp/product/chocolate/pocky/47776/'},
  {slug:'pretz',name:'プリッツ 旨サラダ',family:'biscuit',basis:32,unit:'g',label:'内袋1袋32g。箱全体は64g',purchaseUnit:'袋',reference:'江崎グリコ プリッツ＜旨サラダ＞・64g',nutrition:[158,3,7.3,20.7,.99,.45],allergens:['milk','wheat'],url:'https://www.glico.com/jp/product/snack_biscuit_cookie/pretz/45931/'},
  {slug:'bisco',name:'ビスコ ミニパック',family:'biscuit',basis:21.5,unit:'g',label:'1パック5枚・標準21.5g',purchaseUnit:'袋',reference:'江崎グリコ ビスコミニパック・5枚',nutrition:[105,1.1,4.9,14.6,1,.11],allergens:['milk','wheat'],url:'https://www.glico.com/jp/product/snack_biscuit_cookie/bisco/47543/'},
  {slug:'marie',name:'マリー ビスケット',family:'biscuit',basis:1,unit:'枚',label:'1枚・標準5.4g',purchaseUnit:'枚',reference:'森永製菓 マリー',nutrition:[24,.4,.6,4.2,null,.05],allergens:['milk','wheat','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-12-0003'},
  {slug:'moonlight',name:'ムーンライト クッキー',family:'biscuit',basis:1,unit:'枚',label:'1枚・標準8.1g',purchaseUnit:'枚',reference:'森永製菓 ムーンライト・14枚入り',nutrition:[42,.5,2.2,5.1,null,.04],allergens:['egg','milk','wheat','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-12-0005'},
  {slug:'choice',name:'チョイス ビスケット',family:'biscuit',basis:1,unit:'枚',label:'1枚・標準8.7g',purchaseUnit:'枚',reference:'森永製菓 チョイス',nutrition:[45,.6,2.1,5.8,null,.04],allergens:['egg','milk','wheat','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-12-0004'},
  {slug:'alfort',name:'アルフォート ミニチョコレート',family:'biscuit',basis:55,unit:'g',label:'1箱12個・標準55g',purchaseUnit:'箱',reference:'ブルボン アルフォートミニチョコレート・12個55g',nutrition:[287,4.6,15.7,32.9,2.1,.2],allergens:['milk','wheat','soy'],url:'https://www.bourbon.co.jp/product/detail/35360-04.html'},
  {slug:'lumonde',name:'ルマンド',family:'biscuit',basis:1,unit:'本',label:'1本・標準7.4g',purchaseUnit:'本',reference:'ブルボン ルマンド・12本入り',nutrition:[37,.4,1.6,5.3,.1,.02],allergens:['egg','milk','wheat','soy'],url:'https://www.bourbon.co.jp/product/detail/35417-03.html'},
  {slug:'milk-chocolate',name:'明治ミルクチョコレート（板）',family:'chocolate',basis:50,unit:'g',label:'板チョコ1枚50g',purchaseUnit:'枚',reference:'明治ミルクチョコレート・50g',nutrition:[283,3.8,18.4,26.7,2.2,.065],allergens:['milk','soy'],url:'https://www.meiji.co.jp/products/chocolate/04777.html'},
  {slug:'black-chocolate',name:'明治ブラックチョコレート（板）',family:'chocolate',basis:50,unit:'g',label:'板チョコ1枚50g',purchaseUnit:'枚',reference:'明治ブラックチョコレート・50g',nutrition:[288,3.3,19.7,26.1,3.3,.013],allergens:['milk','soy'],url:'https://www.meiji.co.jp/products/chocolate/04500.html'},
  {slug:'cacao72',name:'チョコレート効果 カカオ72％',family:'chocolate',basis:1,unit:'枚',label:'個包装の小さい1枚5g。板チョコ1枚とは異なります',purchaseUnit:'枚',reference:'明治 チョコレート効果 カカオ72％・65g',nutrition:[28,.5,2,2.2,.6,0],allergens:['milk','soy'],url:'https://www.meiji.co.jp/products/chocolate/4902777227771.html'},
  {slug:'almond-chocolate',name:'アーモンドチョコレート（市販品）',family:'chocolate',basis:79,unit:'g',label:'参照商品の1箱79g',purchaseUnit:'箱',reference:'明治 アーモンドチョコレート・79g',nutrition:[449,9.2,30.2,37.1,4,.1],allergens:['milk','almond','soy'],url:'https://www.meiji.co.jp/products/chocolate/20472.html'},
  {slug:'kinoko',name:'きのこの山',family:'chocolate',basis:74,unit:'g',label:'1箱74g',purchaseUnit:'箱',reference:'明治 きのこの山・74g',nutrition:[423,6.3,26.7,39.4,null,.3],allergens:['milk','wheat','soy'],url:'https://www.meiji.co.jp/products/chocolate/07067.html'},
  {slug:'dars',name:'ダース ミルク',family:'chocolate',basis:1,unit:'個',label:'1個＝標準3.9gの1粒',purchaseUnit:'個',reference:'森永製菓 ダース＜ミルク＞',nutrition:[23,.3,1.5,2,null,.01],allergens:['milk','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2014-06-0013'},
  {slug:'chocoball',name:'チョコボール ピーナッツ',family:'chocolate',basis:28,unit:'g',label:'1箱28g',purchaseUnit:'箱',reference:'森永製菓 チョコボール＜ピーナッツ＞・28g',nutrition:[162,3.1,10.6,13.5,null,.036],allergens:['peanut','milk','wheat','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2018-10-0054'},
  {slug:'milk-caramel',name:'ミルクキャラメル',family:'candy',basis:1,unit:'個',label:'1個＝標準4.9gの1粒',purchaseUnit:'個',reference:'森永製菓 ミルクキャラメル・12粒入り',nutrition:[21,.19,.51,3.8,null,.012],allergens:['milk','wheat','soy'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-08-0300'},
  {slug:'hi-chew',name:'ハイチュウ グレープ',family:'candy',basis:1,unit:'個',label:'1個＝標準4.6gの1粒',purchaseUnit:'個',reference:'森永製菓 ハイチュウ＜グレープ＞',nutrition:[19,.07,.4,3.8,null,0],allergens:['apple','gelatin'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2022-01-0030'},
  {slug:'ramune',name:'ラムネ菓子（ボトル）',family:'candy',basis:29,unit:'g',label:'参照商品のボトル1本29g',purchaseUnit:'本',reference:'森永製菓 ラムネ・29g',nutrition:[108,0,.34,26.3,null,0],allergens:['milk','gelatin'],url:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-08-0326'},
  {slug:'golden-milk-candy',name:'金のミルクキャンディ',family:'candy',basis:1,unit:'個',label:'1個＝4gの1粒',purchaseUnit:'個',reference:'カンロ 金のミルクキャンディ・80g（個装紙込み）',nutrition:[18.3,.1,.6,3.12,null,.01],allergens:['milk'],url:'https://kanro.jp/products/6675846496461'},
  {slug:'kaju-gummy',name:'果汁グミ ぶどう',family:'gummy',basis:54,unit:'g',label:'1袋54g',purchaseUnit:'袋',reference:'明治 果汁グミぶどう・54g',nutrition:[179,3.3,0,41.4,null,.02],allergens:['apple','gelatin'],url:'https://www.meiji.co.jp/products/candy_gum/13974.html'},
  {slug:'pure-gummy',name:'ピュレグミ グレープ',family:'gummy',basis:1,unit:'個',label:'1個＝3.5gの1粒',purchaseUnit:'個',reference:'カンロ ピュレグミグレープ・56g',nutrition:[12,.15,0,2.84,null,.01],allergens:['gelatin'],url:'https://kanro.jp/products/14624917750128'},
  {slug:'cororo',name:'コロロ 巨峰',family:'gummy',basis:48,unit:'g',label:'1袋48g',purchaseUnit:'袋',reference:'UHA味覚糖 コロロ 巨峰・48g',nutrition:[132,.4,0,33.7,null,.02],allergens:['beef','apple','gelatin'],url:'https://www.uha-mikakuto.co.jp/catalog/gummy/gu25.html',note:'取得した公式ページの現行表示はたんぱく質0.4g・炭水化物33.7gです。検索結果に残る旧表示とは区別します。'},
  {slug:'tough-gummy',name:'タフグミ',family:'gummy',basis:100,unit:'g',label:'1袋100g。食べたg数で減らせます',purchaseUnit:'袋',reference:'カバヤ食品 タフグミ・100g',nutrition:[319,8.6,.4,73.9,null,.12],allergens:['wheat','gelatin'],url:'https://www.kabaya.co.jp/products/catalog/gummy/3140.html'},
  {slug:'jagarico',name:'じゃがりこ サラダ（Lサイズ）',family:'salty-snack',basis:68,unit:'g',label:'1カップ68g',purchaseUnit:'個',reference:'カルビー じゃがりこ サラダ Lサイズ・68g',nutrition:[339,5,16.3,43.1,null,.8],allergens:['milk','soy'],url:'https://www.calbee.co.jp/products/detail/?p=20120924153557'},
  {slug:'kappa-ebisen',name:'かっぱえびせん',family:'salty-snack',basis:77,unit:'g',label:'1袋77g',purchaseUnit:'袋',reference:'カルビー かっぱえびせん・77g',nutrition:[380,5.1,17,51.6,null,1.7],allergens:['wheat','shrimp'],url:'https://www.calbee.co.jp/products/detail/?p=20230410102049'},
  {slug:'sayaendo',name:'さやえんどう しお味',family:'salty-snack',basis:61,unit:'g',label:'1袋61g',purchaseUnit:'袋',reference:'カルビー さやえんどう しお味・61g',nutrition:[293,10.5,15,32.2,6.5,null],allergens:['wheat','soy'],url:'https://www.calbee.co.jp/products/detail/?p=20230112151500',note:'食塩相当量は0.4〜0.9gという範囲表示のため不明として保存します。'},
  {slug:'miino',name:'miino そら豆 しお味',family:'salty-snack',basis:28,unit:'g',label:'1袋28g',purchaseUnit:'袋',reference:'カルビー miino そら豆 しお味・28g',nutrition:[164,null,12,null,null,null],allergens:[],url:'https://www.calbee.co.jp/products/detail/?p=20230420131757',note:'範囲表示のたんぱく質4.0〜7.7g・炭水化物7.2〜12.1g・食物繊維0.08〜4.6g・食塩相当量0.2〜0.3gは不明として保存します。'},
  {slug:'cheeza',name:'チーザ カマンベール',family:'salty-snack',basis:32,unit:'g',label:'1袋32g',purchaseUnit:'袋',reference:'江崎グリコ チーザ＜カマンベール＞・32g',nutrition:[168,4.4,9.2,16.8,0,.99],allergens:['milk','wheat','soy'],url:'https://www.glico.com/jp/product/snack_biscuit/cheeza/24661'},
  {slug:'karamucho',name:'カラムーチョチップス ホットチリ味',family:'salty-snack',basis:55,unit:'g',label:'1袋55g。大袋の100g表示とは区別',purchaseUnit:'袋',reference:'湖池屋 カラムーチョチップス ホットチリ味・55g',nutrition:[309,3.2,19.8,29.4,null,.8],allergens:['milk','wheat','soy','chicken','pork','gelatin'],url:'https://koikeya.co.jp/karamucho/'},
  {slug:'sucorn',name:'スコーン 絶品焼きとうもろこし',family:'salty-snack',basis:73,unit:'g',label:'1袋73g。大袋の100g表示とは区別',purchaseUnit:'袋',reference:'湖池屋 スコーン 絶品焼きとうもろこし・73g',nutrition:[415,3.8,25.8,41.8,null,1.1],allergens:['milk','wheat','soy','chicken'],url:'https://koikeya.co.jp/sucorn_item/'},
  {slug:'popcorn',name:'マイクポップコーン バターしょうゆ味',family:'salty-snack',basis:50,unit:'g',label:'1袋50g',purchaseUnit:'袋',reference:'ジャパンフリトレー製造・カルビー販売 マイクポップコーン バターしょうゆ味・50g',nutrition:[246,4.3,13,30.5,null,.9],allergens:['milk','wheat','soy'],url:'https://www.calbee.co.jp/products/detail/?p=20260901155719',note:'食物繊維は3.4〜7.0gという範囲表示のため不明として保存します。'},
  {slug:'kakinotane',name:'柿の種（ピーナッツ入り）',family:'rice-snack',basis:30,unit:'g',label:'参照商品の小袋1袋30g（180gの6袋詰）',purchaseUnit:'袋',reference:'亀田製菓 180g 亀田の柿の種 6袋詰',nutrition:[136,3.6,4.2,20.9,null,.38],allergens:['wheat','egg','peanut','soy','chicken','pork'],url:'https://www.kamedaseika.co.jp/product/1025/'},
  {slug:'happy-turn',name:'ハッピーターン',family:'rice-snack',basis:28,unit:'g',label:'1袋28g',purchaseUnit:'袋',reference:'亀田製菓 28g ハッピーターン',nutrition:[145,1.3,7.3,18.6,null,.41],allergens:['soy'],url:'https://www.kamedaseika.co.jp/product/976/'},
  {slug:'soft-salad',name:'ソフトサラダ せんべい',family:'rice-snack',basis:2,unit:'枚',label:'2枚入りの個包装1袋。栄養も2枚分',purchaseUnit:'袋',reference:'亀田製菓 20枚 ソフトサラダ・1個包装2枚',nutrition:[68,.6,2.5,10.8,null,.24],allergens:['soy'],url:'https://www.kamedaseika.co.jp/product/1470/'},
];

export const CONFECTIONERY_INGREDIENTS=Object.fromEntries(PRODUCTS.map(product=>[
  `confectionery_${product.slug.replaceAll('-','_')}`,
  {name:`${product.name}（購入品${product.slug==='soft-salad'?'・2枚入り小袋':''}）`,unit:product.purchaseUnit,
    allergens:product.allergens,groups:[],proteinSources:[],
    note:`完成品の購入数量です。参照商品：${product.reference}。${NOTICE}確認日${CHECKED}。${product.url}`},
]));

export const CONFECTIONERY_RECIPES=PRODUCTS.map(product=>({
  id:`confectionery-${product.slug}`,name:product.name,role:'snack',genre:'その他',
  family:product.family,variantLabel:product.name,nature:'ready-to-eat',servings:2,minutes:1,
  ingredients:[{id:`confectionery_${product.slug.replaceAll('-','_')}`,amount:2}],
  portion:{amount:product.basis,unit:product.unit,label:product.label},
  staple:false,mealBase:false,processed:true,
  allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,tags:['時短'],steps:[],
  manualNutrition:Object.fromEntries(KEYS.map((key,index)=>[key,product.nutrition[index]])),
  sourceNote:`参照商品：${product.reference}。表示基準：${product.label}。${product.note??''}${product.nutrition[4]===null&&!product.note?.includes('食物繊維')?'食物繊維は未表示です。':''}${NOTICE}全原材料の登録ではないためアレルギー確認済みや自動献立の候補とは扱いません。確認日${CHECKED}。出典: ${product.url}`,
}));
