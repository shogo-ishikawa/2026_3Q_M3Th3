/** 市販スイーツの記録例。確認日: 2026-11-13。
 * 表示名は一般名、出典は実際に参照した商品名で管理します。
 * 材料は2人分、portionとmanualNutritionは1人分です。
 */
const KEYS=Object.freeze(['kcal','protein','fat','carbs','fiber','salt']);
const CHECKED='2026-11-13';
const DONUT_SOURCE='https://www.misterdonut.jp/m_menu/eiyou/eiyou.pdf';
const DONUT_ALLERGEN_SOURCE='https://www.misterdonut.jp/m_menu/eiyou/allergy.pdf';
const NOTICE='参照商品の規格を基準にした記録例です。同じ料理名でも大きさ・原材料・栄養は異なります。実物の表示を優先してください。';
const donut=(slug,name,reference,nutrients)=>({slug,name,family:'donut',reference:`ミスタードーナツ ${reference}`,
  nutrients,source:DONUT_SOURCE,allergenSource:DONUT_ALLERGEN_SOURCE,
  allergens:['wheat','milk','egg','soy'],basis:'1商品（1個）',
  portionLabel:'1個＝出典のドーナツ1商品。重さは商品によって異なります。',
  note:'栄養成分表・アレルギー情報はいずれも2026年11月1日版です。食物繊維は未表示です。'});
const cake=(slug,name,reference,page,nutrients,extra=[])=>({slug,name,family:'cake',
  reference:`銀座コージーコーナー ${reference}`,source:`https://www.cozycorner.co.jp/product/cutcake/${page}.html`,
  nutrients,allergens:['wheat','egg','milk',...extra],basis:'カットケーキ1個',portionUnit:'切れ',
  portionLabel:'1切れ＝出典のカットケーキ1個。ホールケーキ1台ではありません。',
  note:'カットケーキ1個当たりの表示値です。重量は未掲載のためグラム数へ換算しません。食物繊維は未表示です。'});

const PRODUCTS=[
  donut('old-fashioned','オールドファッション（市販品）','オールドファッション',[294,3,18.8,28.2,null,.8]),
  donut('french-cruller','フレンチクルーラー（市販品）','フレンチクルーラー',[147,1.5,9.5,13.9,null,.3]),
  donut('cream-doughnut','ホイップクリーム入りドーナツ（市販品）','エンゼルクリーム',[192,3.3,10.9,20,null,.5]),
  donut('honey-glazed','ハニーグレーズドーナツ（市販品）','ハニーディップ',[217,3.9,11.8,24,null,.6]),
  donut('chewy-ring','もちもちリングドーナツ（市販品）','ポン・デ・リング',[218,1.2,12,26.5,null,.6]),
  donut('honey-churro','チュロス（はちみつ風味・市販品）','ハニーチュロ',[201,3.2,10.2,24.4,null,.6]),
  cake('strawberry-shortcake','苺のショートケーキ（市販品）','苺のショートケーキ','85369',[335,3.9,24.4,25.3,null,.2],['soy']),
  cake('souffle-cheesecake','スフレチーズケーキ（市販品）','チーズケーキ（北海道産チーズ）','44723',[249,8.5,13,24.2,null,.5],['soy','gelatin']),
  cake('mont-blanc','モンブラン（市販品）','モンブラン','40160',[381,5.9,16.5,52.5,null,.2],['soy','gelatin']),
  cake('rare-cheesecake','レアチーズケーキ（市販品）','北海道産5種のチーズを使ったこだわりレアチーズ','63639',[392,5.7,27.8,30.2,null,.3],['soy','gelatin']),
  {...cake('chocolate-mousse-cake','チョコムースケーキ（市販品）','ガトーショコラ','29850',[448,6.6,31.6,34.1,null,.2],['almond','soy']),
    note:'参照商品はチョコムースとココアスポンジを重ねたタイプです。焼き菓子タイプのガトーショコラとは区別します。食物繊維は未表示です。'},
  cake('chocolate-shortcake','チョコレートショートケーキ（市販品）','ミルクチョコショート','91951',[371,5,26.9,27.8,null,.2],['soy']),
  cake('apple-pie','アップルパイ（市販品）','アップルパイ','2238',[344,2.9,10.9,59.1,null,.3],['orange','apple','gelatin']),
  cake('chocolate-mille-crepe','チョコミルクレープ（市販品）','紗々ミルクレープ','52754',[509,6.3,36.9,38.3,null,.3],['soy','gelatin']),
  {slug:'custard-cream-puff',name:'カスタードシュークリーム（市販品）',family:'dessert',
    reference:'銀座コージーコーナー ジャンボシュークリーム（カスタード）',basis:'1個',
    source:'https://www.cozycorner.co.jp/product/daily/85476.html',nutrients:[245,5.6,14.1,23.7,null,.2],
    allergens:['wheat','egg','milk','soy'],portionLabel:'1個＝出典のカスタード入りシュークリーム1個。',
    note:'食物繊維は未表示です。'},
  {slug:'custard-eclair',name:'カスタードエクレア（市販品）',family:'dessert',
    reference:'銀座コージーコーナー エクレア（カスタード）',basis:'1個',
    source:'https://www.cozycorner.co.jp/product/daily/40284.html',nutrients:[225,4.7,13.9,19.9,null,.2],
    allergens:['wheat','egg','milk','almond','soy'],portionLabel:'1個＝出典のチョコ掛けカスタードエクレア1個。',
    note:'食物繊維は未表示です。'},
  {slug:'dorayaki',name:'どら焼き（市販品）',family:'japanese-sweet',genre:'和食',
    reference:'セブン‐イレブン ７プレミアム どら焼',basis:'1包装（1個）',
    source:'https://www.sej.co.jp/products/a/item/310528/',nutrients:[268,5.4,1.7,58.9,2.4,.1],
    allergens:['egg','wheat'],portionLabel:'1個＝出典のつぶあん入りどら焼1包装。',
    note:'公式ページの当該1包装分を使用します。小さなどら焼2個入り商品とは別の規格です。'},
  {slug:'salt-bean-daifuku',name:'塩豆大福（市販品）',family:'japanese-sweet',genre:'和食',
    reference:'セブン‐イレブン ごろっと塩豆大福',basis:'1包装（1個）',
    source:'https://www.sej.co.jp/products/a/item/115568',nutrients:[180,5.3,.7,40.4,4.4,.73],
    allergens:[],portionLabel:'1個＝出典の塩豆大福1包装。',
    note:'当該掲載商品の1包装分です。表示対象の特定原材料8品目が「なし」という情報だけで、すべてのアレルゲンがないとは判断しません。'},
  {slug:'ogura-yokan',name:'小倉ようかん（市販品・50g）',family:'japanese-sweet',genre:'和食',
    reference:'とらや 小形羊羹 夜の梅',basis:'1本（50g）',
    source:'https://www.toraya-group.co.jp/products/nutrition',nutrients:[148,2,0,35,null,0],
    allergens:[],purchaseUnit:'本',portionUnit:'本',portionLabel:'1本＝50gの小形ようかん1本。',
    note:'栄養成分値一覧表の「小形羊羹 夜の梅」を参照します。食物繊維は未表示です。全原材料のアレルギー確認は未完了です。'},
  {slug:'chocolate-monaka',name:'チョコ入りモナカアイス（市販品・冬仕様）',family:'ice-dessert',
    reference:'森永製菓 チョコモナカジャンボ＜冬限定＞',basis:'1個（150ml）',
    source:'https://www.morinaga.co.jp/products/detail.php?id=PRD2009-09-0001&no_redirect=true',nutrients:[319,3.5,18.2,35.2,null,.15],
    allergens:['egg','milk','wheat','soy'],portionLabel:'1個＝150mlの冬仕様モナカアイス1個。',
    note:'確認時の冬限定仕様の値です。通常仕様の表示へ流用しません。食物繊維は未表示です。'},
  {slug:'soda-ice-lolly',name:'ソーダアイスキャンディー（市販品・105ml）',family:'ice-dessert',
    reference:'赤城乳業 ガリガリ君 ソーダ（スティック）',basis:'1本（105ml）',
    source:'https://www.akagi.com/products/garigari/soda_stick.html',nutrients:[66,0,0,16.8,null,.042],
    allergens:['apple'],purchaseUnit:'本',portionUnit:'本',portionLabel:'1本＝105mlのソーダ味アイスキャンディー1本。',
    note:'2026年5月18日発売の105ml規格の1本当たり表示値です。食物繊維は未表示です。'},
  {slug:'grape-ice-bites',name:'ひとくちぶどう氷菓（市販品・12個入り）',family:'ice-dessert',
    reference:'江崎グリコ アイスの実 ぶどうマスカット',basis:'1袋84ml（7ml×12個）',
    source:'https://www.glico.com/jp/product/ice/icenomi/46461/',nutrients:[104,.24,1.5,22.4,null,.0084],
    allergens:[],purchaseUnit:'袋',basisAmount:12,portionUnit:'個',portionLabel:'12個＝1袋84ml（1個7ml）。個数で平均の栄養を換算します。',
    note:'2026年6月25日更新の1袋当たり表示値です。個数で比例換算しますが、ぶどう・マスカット別の栄養内訳は未掲載です。食物繊維の原材料使用と含有量の表示は別のため、未表示の含有量は不明のまま残します。'},
  {slug:'baked-pudding',name:'焼きプリン（市販品・140g）',family:'dessert',
    reference:'森永乳業 森永の焼プリン',basis:'1個（140g）',
    source:'https://www.morinagamilk.co.jp/products/dessert/yaki/127.html',nutrients:[189,6.5,6.5,26,null,.22],
    allergens:['egg','milk'],portionLabel:'1個＝140gのカップ入り焼きプリン1個。',
    note:'確認時の公式商品ページの値を使用します。食物繊維は未表示です。'},
  {slug:'mandarin-jelly',name:'みかんゼリー（市販品・160g）',family:'dessert',
    reference:'たらみ くだもの屋さんみかんゼリー',basis:'1個（160g）',
    source:'https://www.tarami.co.jp/products/kudamono_orange/',nutrients:[93,.2,0,23,null,.1],
    allergens:['apple','orange'],portionLabel:'1個＝160gのみかん果肉入りゼリー1個。',
    note:'JAN 4955129037016の規格を参照します。食物繊維は未表示です。'},
];

const ingredientId=product=>`dessert_${product.slug.replaceAll('-','_')}`;
const referenceNote=product=>`栄養値の参照商品：${product.reference}。表示の基準：${product.basis}。`;

export const DESSERT_INGREDIENTS=Object.fromEntries(PRODUCTS.map(product=>[
  ingredientId(product),{
    name:`${product.name}（購入品）`,unit:product.purchaseUnit??'個',allergens:product.allergens,
    groups:[],proteinSources:[],
    note:`購入する完成品の数量です。${referenceNote(product)}${NOTICE}確認日${CHECKED}。${product.source}`,
  },
]));

export const DESSERT_RECIPES=PRODUCTS.map(product=>({
  id:`dessert-${product.slug}`,name:product.name,role:'snack',genre:product.genre??'洋食',
  family:product.family,variantLabel:product.name,nature:'ready-to-eat',servings:2,minutes:2,
  ingredients:[{id:ingredientId(product),amount:2}],
  portion:{amount:product.basisAmount??1,unit:product.portionUnit??'個',label:product.portionLabel},
  staple:false,mealBase:false,processed:true,
  allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,
  tags:['時短'],steps:[],
  manualNutrition:Object.fromEntries(KEYS.map((key,index)=>[key,product.nutrients[index]])),
  sourceNote:`${referenceNote(product)}${product.note} ${NOTICE}全原材料を登録したDBではないため、アレルギー確認済みや自動提案の候補とは扱いません。確認日${CHECKED}。出典: ${product.source}${product.allergenSource?` アレルギー情報: ${product.allergenSource}`:''}`,
}));
