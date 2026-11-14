/** 選んだ種類と量だけを合計し、記録できる1皿へ変換します。 */
import {recipePortion} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';
import {SEAFOOD_SASHIMI_CHOICES} from './seafood-foods.js';
import {BREAD_PRESETS, BREAD_COMPONENT_INGREDIENTS, BREAD_BASE_INGREDIENTS} from './bread-foods.js';

const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const choice = (id, label, recipeId, section, unit, defaultAmount = 1, extra = {}) =>
  ({id, label, recipeId, section, unit, defaultAmount, ...extra});
const material = (id, label, ingredientId, section, unit = 'g', defaultAmount = 10, amountPerUnit = 1, extra = {}) =>
  ({id, label, section, unit, defaultAmount, ingredients:[{id:ingredientId, amount:amountPerUnit}], ...extra});
const formula = (id, label, ingredients, section, unit = '個', defaultAmount = 1, extra = {}) =>
  ({id, label, section, unit, defaultAmount, ingredients:ingredients.map(([id,amount])=>({id,amount})), ...extra});
const countNote = '量は選んだ種類ごとの個数です。小数で半分の量も指定できます。';

const sushi = [
  choice('tuna','まぐろ赤身','classic-sushi-tuna','握り','貫',2),
  choice('salmon','サーモン','classic-sushi-salmon','握り','貫',2),
  choice('shrimp','えび','classic-sushi-shrimp','握り','貫',1),
  choice('squid','いか','classic-sushi-squid','握り','貫',1),
  ...[['chutoro','中トロ'],['seabream','たい'],['yellowtail','ぶり'],['scallop','ほたて'],['octopus','ゆでだこ'],['egg','玉子'],['anago','穴子']]
    .map(([id,label])=>choice(id,label,`palette-nigiri-${id}`,'握り','貫',1)),
  ...[['ikura','いくら'],['negitoro','ねぎとろ'],['tuna-mayo','ツナマヨ'],['corn-mayo','コーンマヨ'],['natto','納豆'],['crab','かにサラダ'],['shirasu','しらす']]
    .map(([id,label])=>choice(`gunkan-${id}`,label,`sushi-gunkan-${id}`,'軍艦','貫',1)),
  ...[['kappa','かっぱ'],['tekka','鉄火'],['natto','納豆'],['ume-shiso','梅しそ'],['tuna-mayo','ツナマヨ']]
    .map(([id,label])=>choice(`hosomaki-${id}`,label,`sushi-hosomaki-${id}`,'細巻き','切れ',3)),
  ...[['egg-vegetable','卵としいたけ'],['seafood','海鮮'],['salad','サラダ']]
    .map(([id,label])=>choice(`futomaki-${id}`,label,`sushi-futomaki-${id}`,'太巻き','切れ',2)),
];
const yakitori = [
  ...[['thigh-salt','もも・塩'],['thigh-tare','もも・たれ'],['breast-salt','むね・塩'],['skin','皮・塩'],['tsukune','つくね・たれ'],['tsukune-cheese','つくねチーズ'],['ume-shiso','むね・梅しそ']]
    .map(([id,label])=>choice(id,label,`varied-yakitori-${id}`,'手作りの配合','本',1)),
  choice('negima','ねぎま','familiar-yakitori-negima','手作りの配合','本',1,{recipeAmount:2,note:'元の1皿を2本の串として換算した目安です。'}),
  ...[['momo-tare','もも・たれ'],['momo-salt','もも・塩'],['negima-tare','ねぎま・たれ'],['tsukune-tare','つくね・たれ'],['kawa-tare','皮・たれ'],['sunagimo-salt','砂肝・塩']]
    .map(([id,label])=>choice(`takeaway-${id}`,`${label}（購入品）`,`takeaway-yakitori-${id}`,'購入品の記録例','本',1,{note:'参照商品の1本。原材料と商品表示の確認が必要です。'})),
];
const tempuraPart = (id,label,ingredientId,grams,section='手作りの配合') => formula(id,label,
  [[ingredientId,grams],['flour',5],['egg',0.05],['water',8],['oil',3],['salt',0.03]],section,'個',1,
  {note:`1個の材料は可食部${grams}g＋衣。油3mlは吸収量の目安で、揚げ鍋の全量ではありません。`});
const tempura = [
  tempuraPart('shrimp','えび','shrimp',20),tempuraPart('squid','いか','squid',25),tempuraPart('whitefish','白身魚','cod',30),
  tempuraPart('aubergine','なす','aubergine',20),tempuraPart('pumpkin','かぼちゃ','pumpkin',25),
  tempuraPart('lotus-root','れんこん','lotus_root',20),tempuraPart('sweet-potato','さつまいも','sweet_potato',25),
  tempuraPart('shimeji','しめじ','shimeji',20),tempuraPart('green-beans','いんげん','green_beans',15),
  ...[['shrimp','えび'],['squid','いか'],['maitake','まいたけ']].map(([id,label])=>
    choice(`takeaway-${id}`,`${label}（外食）`,`takeaway-tempura-${id}`,'購入品の記録例','個',1,{note:'参照商品の単品。衣と吸収油を含み、別の油を加算しません。'})),
  formula('dipping-sauce','天つゆ',[['water',0.85],['soy_sauce',0.1],['mirin',0.05]],'つゆ・薬味','ml',30,{food:false,maxAmount:300,note:'実際に口にする量。不要なら選択を外せます。'}),
  material('grated-daikon','大根おろし','daikon','つゆ・薬味','g',20,1,{food:false}),
];
const oden = [
  material('daikon','大根（1切れ約60g）','daikon','具材','切れ',1,60),
  material('egg','卵','egg','具材','個',1,1),
  material('konjac','こんにゃく（1切れ約50g）','konjac','具材','個',1,50),
  material('chikuwa','ちくわ（半分約30g）','palette_chikuwa','具材','個',1,30),
  material('hanpen','はんぺん（1切れ約30g）','palette_hanpen','具材','個',1,30),
  material('atsuage','厚揚げ（1切れ約50g）','palette_atsuage','具材','個',1,50),
  material('ganmodoki','がんもどき（1個約30g）','palette_ganmodoki','具材','個',1,30),
  formula('mochi-pouch','餅巾着',[['aburaage',8],['dish_mochi',25]],'具材','個',1,{note:'油揚げ8gと切り餅25gを包む1個の目安です。'}),
  material('beef-tendon','牛すじ串（下ゆで済み40g）','beef_tendon_boiled','具材','本',1,40),
  ...[
    ['potato','じゃがいも','potato','個',70,'皮を除いた小さめ1個の調理前可食部です。'],
    ['taro','里いも','taro','個',40,'皮を除いた1個の調理前可食部です。'],
    ['sausage','ウインナー','palette_wiener','本',20,'1本の製品重量の目安。実物の原材料表示を確認してください。'],
    ['shirataki','結びしらたき','shirataki','個',30,'水切りした無調味のしらたき1個の目安です。'],
    ['kombu-knot','結び昆布','kombu','個',2,'戻す前の乾燥昆布の重さです。戻した後のg数とは異なり、結んだ昆布も食べます。'],
    ['octopus','たこ串（ボイル）','octopus','本',30,'ゆでたマダコの可食部を串に刺した1本の目安です。'],
    ['satsumaage','さつま揚げ','simmered_satsumaage','枚',30,'1枚の製品重量の目安。衣や吸収油を重ねて加算しません。'],
    ['chikuwabu','ちくわぶ','simmered_chikuwabu','切れ',30,'小麦で作るちくわぶの1切れ。魚肉のちくわとは別の食材です。'],
    ['tsumire','魚のつみれ','simmered_tsumire','個',18,'加熱済み製品1粒の目安。生の魚肉だねではありません。'],
    ['gobomaki','ごぼう巻き','simmered_gobomaki','本',27,'ごぼう入り揚げかまぼこ1本の目安です。'],
    ['quail-egg','うずら卵（ゆで）','simmered_quail_egg_boiled','個',9,'ゆでて殻を除いた1個の可食部です。'],
  ].map(([id,label,ingredientId,unit,gramsPerUnit,note])=>material(id,label,ingredientId,'具材',unit,1,1,{gramsPerUnit,note:`${note} 実物に合わせて1${unit}の重さを変更できます。`})),
  formula('cabbage-roll','ロールキャベツ',[['cabbage',30],['pork_minced',20],['onion',8],['starch',2],['salt',0.05]],'具材','個',1,
    {note:'小さめ1個分の家庭用配合。キャベツ30g・豚ひき肉20g・玉ねぎ8g・片栗粉2g・塩0.05gで、調理前の材料合計は約60gです。'}),
  formula('broth','飲むおでんの汁',[['water',0.94],['soy_sauce',0.04],['mirin',0.02],['bonito',0.003]],'汁','ml',150,
    {food:false,maxAmount:1000,note:'実際に飲む量だけを選びます。具材に染みる汁はこの量に含める概算です。0mlなら選択を外せます。'}),
];
// ポトフは選んだ食材と煮汁を全量食べるモデルです。水と塩を分け、薄味にも調整できます。
const potAuFeu = [
  ...[['bacon','ベーコン','bacon',35],['sausage','ウインナー','palette_wiener',40],
    ['chicken','鶏もも肉（皮付き）','chicken',100],['chicken-breast','鶏むね肉（皮なし）','chicken_breast',100],
    ['pork','豚薄切り肉','pork',100]].map(([id,label,ingredientId,amount])=>
      material(id,label,ingredientId,'肉・加工肉','g',amount,1,{note:'材料表の状態の可食部重量です。肉は調理前、加工肉は製品の重量で量ります。'})),
  ...[['cabbage','キャベツ','cabbage',100],['potato','じゃがいも','potato',90],['carrot','にんじん','carrot',60],
    ['onion','玉ねぎ','onion',60],['celery','セロリ','celery',25],['turnip','かぶ','turnip',80],
    ['broccoli','ブロッコリー','broccoli',60],['mushroom','マッシュルーム','mushroom',40],
    ['shimeji','しめじ','shimeji',50],['tomato','トマト','tomato',80]].map(([id,label,ingredientId,amount])=>
      material(id,label,ingredientId,'野菜・きのこ','g',amount,1,{note:'皮や根など食べない部分を除いた、調理前の重量です。'})),
  material('water','煮汁の水','water','煮汁・調味料','ml',350,1,
    {food:false,note:'用意する煮汁の水。買い物には全量を使い、食べた分の栄養は汁の摂取割合で調整できます。少量で作る場合は具材が浸る小さめの鍋を使います。'}),
  material('salt','食塩','salt','煮汁・調味料','g',0.7,1,{food:false,note:'加工肉にも塩分が含まれます。薄味にする場合は量を減らすか選択を外してください。'}),
  material('black-pepper','黒こしょう','black_pepper','煮汁・調味料','g',0.1,1,{food:false}),
  material('parsley','パセリ','parsley','仕上げ','g',1.5,1,{food:false}),
];
// 個数は入力の便宜のための目安です。実物に合わせて1個・1枚・1杯のg数を変更できます。
const weighedMaterial=(id,label,ingredientId,unit,gramsPerUnit,note,defaultAmount=1)=>
  material(id,label,ingredientId,'チーズ',unit,defaultAmount,1,{gramsPerUnit,note});
const cheeses = [
  weighedMaterial('gouda','ゴーダ系ナチュラルチーズ','cheese','個',20,'ひと口の切り分け1個を約20gとする目安です。'),
  weighedMaterial('mozzarella','モッツァレラ','mozzarella','個',15,'切り分け1個を約15gとする目安です。丸ごとの塊1個の重量ではありません。',2),
  weighedMaterial('parmesan','パルメザン（粉）','parmesan_cheese','杯',2,'小さじ1杯を約2gとする目安です。粉の詰め方でも変わります。',5),
  weighedMaterial('camembert','カマンベール','palette_camembert','個',15,'90gを6等分した切り分け1個を約15gとする目安です。'),
  weighedMaterial('cheddar','チェダー','palette_cheddar','枚',18,'スライス1枚を約18gとする目安です。厚さや商品によって異なります。'),
  weighedMaterial('cream-cheese','クリームチーズ','palette_cream_cheese','個',16.3,'個包装1個を約16.3gとする目安です。容器入りは食べる分の重量に合わせてください。'),
  weighedMaterial('blue-cheese','ブルーチーズ','palette_blue_cheese','個',15,'ひと口の切り分け1個を約15gとする目安です。'),
  weighedMaterial('processed-cheese','プロセスチーズ','palette_processed_cheese','個',17,'102gを6等分した6Pタイプの1個を約17gとする目安です。'),
];
const nuts = [
  ...[['almond','アーモンド','almond'],['walnut','くるみ','walnut'],['cashew','カシューナッツ','cashew'],['pine','松の実','pine_nuts'],
    ['peanut','落花生','peanut'],['pistachio','ピスタチオ','palette_pistachio'],['macadamia','マカダミアナッツ','palette_macadamia']]
    .map(([id,label,ingredientId])=>material(id,label,ingredientId,'ナッツ','g',10)),
  material('raisin','レーズン','raisin','ドライフルーツ','g',10),
];
const sweetToppings = [
  material('cream-cheese','クリームチーズ','palette_cream_cheese','トッピング','g',15,1,{food:false}),
  material('maple','メープルシロップ','palette_maple_syrup','トッピング','g',10,1,{food:false}),
  material('honey','はちみつ','palette_honey','トッピング','g',10,1,{food:false}),
  material('whipped-cream','ホイップクリーム','palette_whipped_cream','トッピング','g',15,1,{food:false}),
  material('butter','バター','butter','トッピング','g',5,1,{food:false}),
  material('strawberry','いちご','strawberry','トッピング','g',30,1,{food:false}),
  material('blueberry','ブルーベリー','blueberry','トッピング','g',20,1,{food:false}),
  material('banana','バナナ','banana','トッピング','g',30,1,{food:false}),
  material('chocolate','チョコレート','chocolate','トッピング','g',10,1,{food:false}),
  material('almond','アーモンド','almond','トッピング','g',5,1,{food:false}),
];
const savouryFillings = [
  material('ham','ハム','ready_sliced_ham','具材','g',20,1,{food:false,ingredientsKnown:false,allergensKnown:false}),
  material('prosciutto','生ハム','palette_prosciutto','具材','g',15,1,{food:false}),
  material('cheese','チーズ','cheese','具材','g',20,1,{food:false}),
  material('cream-cheese','クリームチーズ','palette_cream_cheese','具材','g',20,1,{food:false}),
  material('tuna','ツナ（水煮）','tuna_canned','具材','g',30,1,{food:false}),
  formula('boiled-egg','ゆで卵',[['egg',1]],'具材','個',1,{food:false,note:'固ゆでして殻を除いた卵1個の目安です。'}),
  material('lettuce','レタス','lettuce','具材','g',15,1,{food:false}),
  material('tomato','トマト','tomato','具材','g',30,1,{food:false}),
  material('cucumber','きゅうり','cucumber','具材','g',20,1,{food:false}),
  material('avocado','アボカド','avocado','具材','g',30,1,{food:false}),
  material('mayonnaise','マヨネーズ','mayonnaise','ソース','g',5,1,{food:false}),
  material('butter','バター','butter','ソース','g',5,1,{food:false}),
];
// Presets and the freely editable choices share exactly the same ingredient formulas.
const additionalBreadComponents=Object.entries(BREAD_COMPONENT_INGREDIENTS).map(([id,part])=>formula(id,part.label,
  part.ingredients,part.section??'具材',part.unit??'g',part.defaultAmount??10,{food:false,
    ...(part.ingredientsKnown===false?{ingredientsKnown:false}:{}),...(part.allergensKnown===false?{allergensKnown:false}:{}),
    ...(part.note?{note:part.note}:{})}));
const breadExtras=[
  material('olive-oil','オリーブ油','olive_oil','調味料・薬味','ml',3,1,{food:false}),
  material('oil','植物油','oil','調味料・薬味','ml',2,1,{food:false}),
  material('garlic','にんにく','garlic','調味料・薬味','g',1.5,1,{food:false}),
  material('parsley','パセリ','parsley','調味料・薬味','g',1,1,{food:false}),
  material('sesame','ごま','sesame','調味料・薬味','g',4,1,{food:false}),
  material('black-pepper','黒こしょう','black_pepper','調味料・薬味','g',0.1,1,{food:false}),
  material('lemon','レモン汁','lemon','調味料・薬味','g',2.5,1,{food:false}),
  material('salt','塩','salt','調味料・薬味','g',0.2,1,{food:false}),
  material('yogurt','ヨーグルト','yogurt','ソース','g',20,1,{food:false}),
  material('chicken-plain','鶏むね肉（調味前）','chicken_breast','具材','g',50,1,{food:false,note:'加熱する前の皮なし可食部です。中心まで十分に加熱します。'}),
  formula('scrambled-egg','牛乳入り卵焼き',[['egg',1],['milk',10],['oil',2],['salt',0.25]],'具材','個',1,
    {food:false,note:'卵1個・牛乳10ml・油2ml・塩0.25gの配合です。中まで固めて焼きます。'}),
];
const breadFillings=[...savouryFillings,...additionalBreadComponents,...sweetToppings,...breadExtras]
  .filter((part,index,all)=>all.findIndex(other=>other.id===part.id)===index);
const legacyBreadPresets={
  'hot-sandwich':[
    {id:'legacy-chicken-cabbage',label:'鶏肉とキャベツ（パン多め）',recipeId:'chicken-sandwich',components:[['base-large',1],['chicken-plain',110],['cabbage',90],['yogurt',20],['lemon',5],['salt',1],['oil',5]]},
    {id:'legacy-egg-lettuce',label:'卵とレタス（牛乳入り卵焼き）',recipeId:'breakfast-egg-sandwich',components:[['base',1],['scrambled-egg',1],['lettuce',20]]},
  ],
  toast:[
    {id:'legacy-garlic',label:'ガーリックトースト',recipeId:'staple-garlic-toast',components:[['base',1],['olive-oil',4],['garlic',1.5],['parsley',1]]},
    {id:'legacy-sesame',label:'黒こしょうとごま',recipeId:'staple-sesame-toast',components:[['base',1],['olive-oil',3],['sesame',4],['black-pepper',0.1]]},
    {id:'legacy-wholegrain-avocado',label:'全粒粉のアボカドレモン',recipeId:'staple-avocado-toast',components:[['base-wholegrain',1],['avocado',50],['lemon',2.5],['salt',0.2]]},
  ],
};
const breadPresets=kind=>{
  const presets=BREAD_PRESETS[kind]??[],custom=presets.filter(part=>part.id==='custom');
  return [...presets.filter(part=>part.id!=='custom'),...(legacyBreadPresets[kind]??[]),...custom];
};
const breadBase=(kind,label)=>formula('base',label,BREAD_BASE_INGREDIENTS[kind],'ベース','個',1,{base:true,maxAmount:1});
const breadRecipeIds=kind=>breadPresets(kind).map(part=>part.recipeId);
const sashimi = [['tuna','まぐろ赤身',15,2],['tuna-mediumfat','まぐろ中トロ',15,2],['salmon','サーモン',15,2],['yellowtail','ぶり',15,2],['seabream','たい',15,2],['bonito','かつお',15,2],['aji','あじ',10,3],['squid','いか',5,6],['octopus','マダコ（ボイル）',5,6],['scallop','ほたて',10,3]]
  .map(([id,label,gramsPerUnit,defaultAmount])=>choice(id,label,`classic-sashimi-${id}`,'刺身','切れ',defaultAmount,
    {gramsPerUnit,note:`切り分けた可食部1切れを約${gramsPerUnit}gとする目安です。厚さや実物の重量に合わせて変更できます。`}))
  .concat(SEAFOOD_SASHIMI_CHOICES.map(({id,label,recipeId,unit,defaultAmount,gramsPerUnit,note})=>
    choice(id,label,recipeId,'刺身',unit,defaultAmount,{gramsPerUnit,note})));

const COMPOSER_DESCRIPTIONS = {
  oden:'大根・練り物・ロールキャベツなど21種と飲む汁を選ぶ',
  'pot-au-feu':'肉・野菜・きのこと煮汁の量を自由に選ぶ',
  sushi:'握り11種・軍艦・巻き寿司を一皿に',
  sashimi:'魚介20種を切れ数・尾数で選び、重さへ換算する',
  yakitori:'部位、塩・たれ、本数を選ぶ',
  tempura:'具材の種類と個数、天つゆの量を選ぶ',
  cheese:'8種類を個数で選び、1個の重さも調整',
  nuts:'ナッツとレーズンを好きなg数で',
  bagel:'ベース1個に好みの具材とトッピング',
  waffle:'フルーツ・クリーム・シロップを選ぶ',
  muffin:'プレーン生地に混ぜ込む具材を選ぶ',
  'english-muffin':'朝食や昼食に、具材をはさむマフィン',
  sandwich:'パン2枚に具材とソースを組み合わせる',
  'hot-sandwich':'定番の組み合わせを選び、具材や量を調整',
  toast:'バター・ジャム・チーズやピザトーストを選ぶ',
};

export const FOOD_COMPOSERS = freeze([
  {kind:'oden',label:'おでん',recipeIds:['palette-oden'],role:'main',family:'main',genre:'和食',minutes:40,components:oden,
    nutritionNote:'汁の栄養と買い物量は、選択した実際に飲む量だけを計上します。調理の鍋に用意する汁全量とは異なり、具に染みた汁や煮て移った成分は精密には補正しません。',
    defaults:[['daikon',1],['egg',1],['konjac',1],['chikuwa',1],['broth',150]],
    intro:'食べる具材21種と実際に飲む汁の量を選びます。個数から重量へ換算し、新しい具材は1個の重さも変更できます。結び昆布は戻す前の乾燥重量です。汁は飲む量だけを含む概算で、買い物の汁量もこの量が基準です。鍋に用意する汁の全量とは異なります。',
    instructions:['大根は皮をむいて切り、やわらかく下ゆでする。卵は固ゆでして殻をむく。こんにゃくは下ゆでし、油揚げや厚揚げは湯通しする。',
      '選んだ具材をだし汁で静かに煮る。牛すじは下ゆで済みのものを使い、餅巾着は油揚げに表示量の餅を包む。',
      '練り物やはんぺんは煮崩れないよう後から加え、餅も中までやわらかくなるまで加熱する。食べた具材と飲んだ汁の量で記録する。']},
  {kind:'pot-au-feu',label:'ポトフ',recipeIds:['familiar-side-pot-au-feu'],role:'soup',family:'soup',genre:'洋食',minutes:35,components:potAuFeu,
    nutritionNote:'ここでは選択した具材・煮汁・調味料の全量を表示します。汁や具を残す場合は、記録前に摂取割合を調整できます。買い物には用意する全量を使います。',
    defaults:[['bacon',35],['cabbage',100],['potato',90],['carrot',60],['onion',60],['celery',25],['water',350],['salt',0.7],['black-pepper',0.1],['parsley',1.5]],
    intro:'肉・野菜・きのこを好きなg数で選びます。ベーコンと野菜の初期量は元のポトフ1人分です。水・塩も調整でき、肉や野菜のうまみで煮る家庭用の配合です。まず調理する全量を選び、食べた分は汁と具の摂取割合で調整します。コンソメや油は使わず、追加する場合は「食材を追加してアレンジ」から加えてください。',
    instructions:['選んだ肉と野菜を材料表の量に用意し、小さめの鍋で煮る。食べる量は出来上がりの皿数で調整する。']},
  {kind:'sushi',label:'お寿司',recipeIds:[...sushi.map(part=>part.recipeId),'classic-sushi-assorted'],role:'staple',family:'sushi',genre:'和食',mealBase:true,minutes:20,components:sushi,
    defaults:[['tuna',2],['salmon',2],['shrimp',1],['egg',1]],intro:`握り・軍艦は貫数、細巻き・太巻きは切れ数で選べます。細巻きは1本6切れ、太巻きは1本8切れの目安です。${countNote}`,
    instructions:['食べる寿司の種類と数を選ぶ。魚は刺身用を使用し、えびや玉子など加熱する具は中まで火を通してから冷ます。']},
  {kind:'sashimi',label:'刺身の盛り合わせ',recipeIds:[...sashimi.map(part=>part.recipeId),'classic-sashimi-assorted'],role:'main',family:'sashimi',nature:'ready-to-eat',genre:'和食',minutes:10,components:sashimi,
    defaults:[['tuna',2],['salmon',2],['seabream',2]],intro:'種類ごとの切れ数・えびの尾数を選ぶと、可食部のg数へ換算します。1切れ・1尾の重さも変更できます。しょうゆは換算した魚介の重量に応じた目安量を含みます。買い物リストはgで集計します。しめさばは酢締め済み、マダコはボイル、ミズダコは生の別項目です。',
    instructions:['生で食べる魚介は刺身用として販売されたものを使い、清潔な器具で盛り付ける。マダコはボイル済み、しめさばは酢締め済みを使い、食べるまで冷蔵する。']},
  {kind:'yakitori',label:'焼き鳥',recipeIds:yakitori.map(part=>part.recipeId),role:'main',family:'meat-main',genre:'和食',minutes:25,components:yakitori,
    defaults:[['thigh-salt',1],['thigh-tare',1],['tsukune',1]],intro:`部位と塩・たれを選び、それぞれ食べる本数を指定します。手作りと購入品は別の配合・表示値で計算します。${countNote}`,
    instructions:['手作りの串は選んだ部位と味付けを別々に用意し、肉の重なりをほぐして中心まで十分に加熱する。厚い部分の中心75℃で1分以上を確認する。']},
  {kind:'tempura',label:'天ぷら',recipeIds:['varied-shrimp-tempura','varied-squid-tempura','varied-whitefish-tempura','varied-vegetable-tempura','varied-shimeji-tempura','familiar-tempura-assorted',...tempura.filter(part=>part.recipeId).map(part=>part.recipeId)],
    role:'main',family:'main',genre:'和食',minutes:30,components:tempura,defaults:[['shrimp',2],['pumpkin',1],['aubergine',1]],
    intro:'種類ごとに個数を選びます。手作りの衣・吸収油は1個分の家庭用配合です。天つゆは実際に口にするml数だけを加えます。',
    instructions:['選んだ魚介や野菜の食べない部分を除き、水気を十分に拭いて、表示した1個分の目安量に切る。',
      '選んだ手作り具材の分だけ薄力粉、卵、水を混ぜて衣にする。160〜180℃を目安に少量ずつ揚げ、中まで火を通す。油3ml/個は吸収量の概算で、鍋に張る油量ではない。',
      '油を切って盛り、選んだ天つゆや大根おろしを添える。購入品は実際の商品表示と温め方に従う。']},
  {kind:'cheese',label:'チーズの盛り合わせ',recipeIds:['daily-snack-plain-cheese','daily-snack-mozzarella','palette-cheese-camembert','palette-cheese-cheddar','palette-cheese-cream','palette-cheese-blue','palette-cheese-processed','palette-cheese-parmesan'],
    role:'snack',family:'cheese',nature:'ready-to-eat',genre:'その他',minutes:5,components:cheeses,defaults:[['gouda',1]],intro:'個数や枚数で選び、g数へ換算します。チーズは大きさが異なるため、1個・1枚の重さを商品表示や実測値に合わせて変更してください。粉チーズは小さじの杯数です。包材など食べない部分は含めません。',instructions:['選んだチーズを表示量に切り分けて盛る。保存方法と期限は商品表示に従う。']},
  {kind:'nuts',label:'ナッツのミックス',recipeIds:['snack-almond','snack-walnut','snack-cashew','snack-peanut','snack-nuts-raisin','palette-nuts-pistachio','palette-nuts-macadamia','palette-nuts-pine'],
    role:'snack',family:'nuts',nature:'ready-to-eat',genre:'その他',minutes:5,components:nuts,defaults:[['almond',10],['walnut',10]],intro:'殻を除いたナッツをg数で選びます。アーモンド・くるみ・カシューナッツは無塩、ピスタチオ・マカダミアは成分表の味付け品が基準です。実際の塩分は商品表示を優先してください。レーズンも追加できます。',instructions:['殻を除いた食べる部分だけを計量し、選んだ種類を混ぜる。']},
  {kind:'bagel',label:'ベーグル',recipeIds:['palette-bagel'],role:'staple',family:'bread',genre:'その他',minutes:10,unit:'個',baseRequired:true,
    components:[material('base','プレーンベーグル（約100g）','palette_bagel','ベース','個',1,100,{base:true,maxAmount:1}),...savouryFillings,...sweetToppings.filter(part=>!savouryFillings.some(other=>other.id===part.id))],
    defaults:[['base',1]],intro:'ベーグル1個に加える具材とトッピングを選びます。各g数はこの1個に使う量です。',instructions:['ベーグルを横半分に切り、好みで軽くトーストする。ゆで卵を選んだ場合は固ゆでして殻を除く。', '選んだ具材とトッピングを表示量に用意し、はさむか添える。']},
  {kind:'english-muffin',label:'イングリッシュマフィン',recipeIds:breadRecipeIds('english-muffin'),presets:breadPresets('english-muffin'),role:'staple',family:'bread',mealBase:true,genre:'洋食',minutes:15,unit:'個',baseRequired:true,
    components:[breadBase('english-muffin','プレーンイングリッシュマフィン（約60g）'),...breadFillings],
    defaults:[['base',1],['ham',20],['cheese',20]],intro:'最初に定番や朝食向けの組み合わせを選び、その下で具材を外したり量を変えたりできます。「具材を指定する」はパン1個だけから始めます。焼き菓子のマフィンは別メニューです。',
    instructions:['イングリッシュマフィンを横半分に割り、切り口を軽くトーストする。','選んだ具材とソースを用意してはさむ。ゆで卵は固ゆでして殻を除き、野菜は洗って水気を切る。食べるまで冷蔵する。']},
  {kind:'waffle',label:'ワッフル',recipeIds:['palette-waffle'],role:'snack',family:'cake',genre:'その他',minutes:10,unit:'個',baseRequired:true,
    components:[material('base','プレーンワッフル（約70g）','palette_waffle','ベース','個',1,70,{base:true,maxAmount:1}),...sweetToppings],defaults:[['base',1]],
    intro:'焼き上がったワッフル1個に、食べるトッピングだけを加えます。各g数は1個分です。',instructions:['焼き上がったプレーンワッフルを用意し、必要なら商品の方法で温める。', '選んだ果物やトッピングを表示量に用意してのせる。シロップやクリームも食べる量だけを加える。']},
  {kind:'muffin',label:'マフィン',recipeIds:['palette-muffin'],role:'snack',family:'cake',genre:'その他',minutes:30,unit:'個',baseRequired:true,
    components:[choice('base','プレーン生地（焼成前約70g）','palette-muffin','ベース','個',1,{base:true,maxAmount:1}),
      ...[['blueberry','ブルーベリー','blueberry',15],['banana','バナナ','banana',20],['chocolate','チョコレート','chocolate',10],['walnut','くるみ','walnut',8],['almond','アーモンド','almond',8],['cheese','チーズ','cheese',10]]
        .map(([id,label,ingredientId,amount])=>material(id,label,ingredientId,'混ぜ込む具材','g',amount,1,{food:false}))],
    defaults:[['base',1],['blueberry',15]],intro:'プレーン生地70gを1個分として、混ぜ込む具材を選びます。焼いた後の重量は水分の変化で変わります。',
    instructions:['プレーンのマフィン生地を1個分用意する。具材は食べない部分を除き、ナッツやチョコレートは小さく刻む。', '選んだ具材を生地に混ぜて型に入れ、180℃に予熱したオーブンで約20〜25分焼く。竹串に生の生地が付かず中心まで火が通ったことを確認する。']},
  {kind:'sandwich',label:'サンドイッチ',recipeIds:breadRecipeIds('sandwich'),presets:breadPresets('sandwich'),role:'staple',family:'bread',mealBase:true,genre:'洋食',minutes:15,unit:'個',baseRequired:true,
    components:[breadBase('sandwich','食パン2枚（合計約60g）'),...breadFillings],
    defaults:[['base',1],['ham',20],['lettuce',10],['mayonnaise',5]],intro:'定番の組み合わせを選んでから、具材・ソースと量を調整できます。「具材を指定する」はパンだけから始めます。パン2枚で作る1組を1個とし、各g数はこの1個分です。',
    instructions:['パン2枚と選んだ具材を用意する。ゆで卵を選んだ場合は固ゆでし、殻を除いて切る。野菜は洗って十分に水気を切る。', 'ソースを塗り、選んだ具材を重ねてはさむ。食べやすく切り、食べるまで冷蔵する。']},
  {kind:'hot-sandwich',label:'ホットサンド',recipeIds:breadRecipeIds('hot-sandwich'),presets:breadPresets('hot-sandwich'),role:'staple',family:'bread',mealBase:true,genre:'洋食',minutes:20,unit:'個',baseRequired:true,
    components:[breadBase('hot-sandwich','食パン2枚（合計約60g）'),formula('base-large','厚めの食パン2枚（合計約120g）',[['bread',120]],'ベース','個',1,{base:true,maxAmount:1}),...breadFillings],
    defaults:[['base',1],['ham',20],['cheese',20]],intro:'ハムチーズや卵、ツナ、鶏肉などから最初の組み合わせを選び、具材の削除・追加と量を調整できます。「具材を指定する」はパンだけから作れます。',
    instructions:['加熱が必要な具材は先に中まで火を通し、食パンではさんでホットサンドメーカーやフライパンで焼く。']},
  {kind:'toast',label:'トースト',recipeIds:breadRecipeIds('toast'),presets:breadPresets('toast'),role:'staple',family:'bread',mealBase:false,genre:'洋食',minutes:10,unit:'個',baseRequired:true,
    components:[breadBase('toast','食パン1枚（厚切り約60g）'),formula('base-wholegrain','全粒粉食パン（約60g）',[['wholegrain_bread',60]],'ベース','個',1,{base:true,maxAmount:1}),...breadFillings],
    defaults:[['base',1],['butter',5]],intro:'バターやジャム、チーズ、ピザトーストなどを選び、塗るもの・具材と量を調整します。「具材を指定する」は食パンだけから始めます。ピザトーストは食パンを使うトーストで、ピザ生地の料理とは別です。',
    instructions:['食パンに選んだ具材をのせてトースターで焼く。ジャムやはちみつは好みで焼いた後に塗る。']},
].map(definition=>({...definition,description:COMPOSER_DESCRIPTIONS[definition.kind]??definition.intro})));

const byKind = new Map(FOOD_COMPOSERS.map(definition=>[definition.kind,definition]));
const byRecipe = new Map(FOOD_COMPOSERS.flatMap(definition=>definition.recipeIds.map(id=>[id,definition])));
const own = (value,key) => Object.hasOwn(value,key);
const isRecord = value => value !== null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const valid = (value,max) => typeof value==='number' && Number.isFinite(value) && value>0 && value<=max;
const unique = values => [...new Set(values)];
const newId = () => `custom-food-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const quantityLabel = value => Number(value.toFixed(3)).toLocaleString('ja-JP');

function selectedInstructions(definition,selected) {
  const has=id=>selected.some(part=>part.id===id);
  if(definition.kind==='oden')return [
    ...(has('daikon')?['大根は皮をむき、厚さ約2cmの輪切りにして面取りをする。片面に浅く十字の切り込みを入れ、竹串が通るまで別鍋で下ゆでする。']:[]),
    ...(has('egg')?['卵は沸いた湯で10〜12分ゆでて固ゆでにし、冷水に取って殻をむく。']:[]),
    ...(has('quail-egg')?['うずら卵はゆでて殻を除いた製品を使い、表示量を量る。']:[]),
    ...(has('konjac')?['こんにゃくは表面を洗い、浅い切り込みを入れて切る。製品表示に従って下ゆでし、湯を切る。']:[]),
    ...(has('shirataki')?['結びしらたきは表面を洗い、製品表示に従って下ゆでして湯を切る。']:[]),
    ...(has('atsuage')?['厚揚げは熱湯をかけて水気を切り、食べやすく切る。']:[]),
    ...(has('mochi-pouch')?['油揚げに熱湯をかけて水気を切る。表示量の切り餅を包み、口を閉じて餅巾着にする。']:[]),
    ...(has('beef-tendon')?['牛すじは下ゆで済みの可食部を表示量に量り、必要なら食べやすく切る。']:[]),
    ...(has('potato')||has('taro')?[`${has('potato')?'じゃがいも':''}${has('potato')&&has('taro')?'・':''}${has('taro')?'里いも':''}は皮をむき、煮崩れにくい大きさに切る。別鍋で竹串が通る手前まで下ゆでして湯を切る。`]:[]),
    ...(has('kombu-knot')?['結び昆布は材料表の乾燥重量を量り、水で戻して柔らかくしてから結ぶ。戻し水は調理用のだし汁へ使える。結んだ昆布も食べる。']:[]),
    ...(has('cabbage-roll')?['ロールキャベツ用の玉ねぎはみじん切りにし、豚ひき肉・片栗粉・塩とよく練る。キャベツの葉を柔らかくゆで、太い芯を薄くそぎ、肉だねを包んで巻き終わりを下にして置く。']:[]),
    ...(has('chikuwabu')?['ちくわぶは表示量を食べやすく切り、熱湯で3〜5分下ゆでして湯を切る。']:[]),
    '鍋に具材が浸る調理用のだし汁を用意する。下ごしらえした火の通りにくい具材から入れ、沸いたら弱火にしてふたを少しずらし、静かに20〜30分煮る。汁が減ったら湯を足し、強く煮立てない。',
    ...(has('cabbage-roll')?['ロールキャベツは肉だねの中心75℃で1分以上を確認する。中心まで火が通る前に味見しない。']:[]),
    ...(has('chikuwa')||has('ganmodoki')||has('satsumaage')||has('tsumire')||has('gobomaki')?[`${selected.filter(part=>['chikuwa','ganmodoki','satsumaage','tsumire','gobomaki'].includes(part.id)).map(part=>part.label).join('・')}は仕上げの10〜15分で加え、中まで温める。揚げ練り物を湯通しした場合も、油の流出量は栄養計算では補正しない。`]:[]),
    ...(has('sausage')||has('octopus')?[`${has('sausage')?'ウインナー':''}${has('sausage')&&has('octopus')?'・':''}${has('octopus')?'ゆでだこ':''}は後半に加え、中まで温める。長く強く煮立てない。`]:[]),
    ...(has('mochi-pouch')?['餅巾着は餅の中心まで柔らかくなるまで煮る。']:[]),
    ...(has('hanpen')?['はんぺんは食べる直前に加え、汁をかけながらさっと温める。']:[]),
    '食べた具材と実際に飲んだ汁の量に合わせて記録する。栄養と買い物の汁量は選択した飲む量が基準で、調理の鍋に張る全量ではない。具に染みた汁や加熱中の成分移動は精密には補正しない。',
  ];
  if(definition.kind==='pot-au-feu'){
    const rawMeat=has('chicken')||has('chicken-breast')||has('pork');
    const selectedNames=(ids)=>selected.filter(part=>ids.includes(part.id)).map(part=>part.label).join('・');
    const firm=selectedNames(['carrot','potato','onion','cabbage','celery']),late=selectedNames(['turnip','mushroom','shimeji','tomato']);
    return [
      ...(has('carrot')?['にんじんは皮など食べない部分を除き、厚さ1.5〜2cmを目安に大きさをそろえて切る。']:[]),
      ...(has('potato')?['じゃがいもは皮をむいて3〜4cm程度に切り、さっと水にさらす。調理前の可食部を量る。']:[]),
      ...(has('onion')?['玉ねぎは芯の硬い部分と皮を除き、形が残るくし形に切る。']:[]),
      ...(has('cabbage')?['キャベツは硬い芯の先端を薄く切り、葉がばらばらにならないくし形にする。']:[]),
      ...(has('celery')?['セロリは太い筋を除き、長さ3〜4cmを目安に切る。']:[]),
      ...(has('turnip')?['かぶは皮をむいてくし形に切る。葉や茎は選択量に含めず、根の可食部を量る。']:[]),
      ...(has('mushroom')?['マッシュルームは汚れと硬い根元を除き、半分に切る。']:[]),
      ...(has('shimeji')?['しめじは石づきを取り、食べやすい小房に分ける。']:[]),
      ...(has('tomato')?['トマトはへたを取り、煮崩れすぎない大きめのくし形に切る。']:[]),
      ...(has('broccoli')?['ブロッコリーは小房に分け、茎を使う場合は硬い皮を除いて薄めに切る。']:[]),
      ...(has('bacon')?['ベーコンは食べやすい長さに切る。脂や塩分もうまみとして煮汁へ移るため、煮汁を捨てずに使う。']:[]),
      ...(has('chicken')||has('chicken-breast')?['選んだ鶏肉は厚さが均等な2〜3cmの一口大に切る。生肉を扱った包丁とまな板は野菜用と分けるか洗浄する。']:[]),
      ...(has('pork')?['豚薄切り肉は食べやすい長さに切り、重なりをほぐしておく。']:[]),
      ...(has('sausage')?['ウインナーは加熱済み製品を表示量に量り、必要なら食べやすく切る。追加の油は使わない。']:[]),
      `材料表の水を小さめの鍋へ入れる。${has('bacon')?'ベーコンと、':''}${has('chicken')?'鶏もも肉と、':''}${firm?`選んだ${firm}を加える。`:'選んだ具材を加える準備をする。'}中火にかけ、沸いたらあくを取り、弱火にする。具材が水面から大きく出る場合は小さい鍋へ移すか、水を追加して記録量も合わせる。`,
      ...(firm||has('chicken')||has('bacon')?['ふたを少しずらし、軽く煮立つ火加減で15〜20分煮る。選んだ硬い野菜に竹串がすっと通るまで加熱する。']:[]),
      ...(late||has('chicken-breast')||has('pork')?[
        `${late?`選んだ${late}と、`:''}${has('chicken-breast')?'鶏むね肉と、':''}${has('pork')?'ほぐした豚肉を、':''}鍋へ加え、弱火でさらに8〜10分を目安に煮る。生の肉を選んだ場合は重なりをほぐし、加えた具材の中心まで十分に加熱する。`]:[]),
      ...(has('sausage')||has('broccoli')?[`${has('sausage')?'ウインナーと、':''}${has('broccoli')?'ブロッコリーを、':''}仕上げの3〜5分に加え、中まで温める。ブロッコリーを選んだ場合は茎も柔らかくする。`]:[]),
      ...(rawMeat?['選んだ生の肉は中心75℃で1分以上の加熱を確認する。時間は肉の厚さで変わるため、火が通っていなければ追加で加熱する。']:[]),
      ...(has('salt')||has('black-pepper')?[`火を止める前に${selectedNames(['salt','black-pepper'])}を材料表の量で加えて味を調える。加工肉の塩分も含まれるので、調味料は入力した量を超えて足さない。`]:[]),
      `${has('parsley')?'刻んだパセリを仕上げに散らす。':''}具と煮汁を合わせて一皿に盛る。汁や具を残した場合は、食べた割合に合わせて記録する。`,
    ];
  }
  if(['sushi','sashimi'].includes(definition.kind))return ['選んだ種類の材料と量を用意し、以下の選んだ料理の手順で盛り付ける。'];
  if(definition.kind==='yakitori'&&selected.every(part=>part.recipeId?.startsWith('takeaway-')))return ['購入品を選んだ本数用意する。保存方法と必要な再加熱は実際の商品表示に従う。'];
  if(definition.kind==='tempura'){
    const raw=selected.some(part=>part.ingredients&&part.food!==false);
    return [
      ...(raw?definition.instructions.slice(0,2):['選んだ購入品を用意する。衣と吸収油を含むため、別の油を材料へ加算しない。']),
      ...(has('dipping-sauce')?['選んだ天つゆを混ぜ、実際に口にする量だけを添える。']:[]),
      ...(has('grated-daikon')?['表示量の大根をすりおろして添える。']:[]),
      '油を切って盛る。購入品の温め方は商品表示に従う。',
    ];
  }
  if(definition.kind==='muffin')return [
    'プレーンのマフィン生地を1個分用意し、選んだ具材を表示量に計る。',
    ...(has('walnut')||has('almond')||has('chocolate')?['選んだナッツやチョコレートは小さく刻む。']:[]),
    '選んだ具材を生地に混ぜて型に入れ、180℃に予熱したオーブンで約20〜25分焼く。竹串に生の生地が付かず中心まで火が通ったことを確認する。',
  ];
  if(definition.kind==='waffle'&&selected.length===1)return [definition.instructions[0]];
  if(['bagel','sandwich','english-muffin','hot-sandwich','toast'].includes(definition.kind))return [
    definition.kind==='bagel'?'ベーグルを横半分に切り、好みで軽くトーストする。':definition.kind==='english-muffin'?'イングリッシュマフィンを横半分に割り、切り口を軽くトーストする。':definition.kind==='toast'?'選んだ食パン1人分を用意する。':'選んだ食パン2枚分と具材を用意する。野菜は洗って水気を切る。',
    ...(has('boiled-egg')?['卵は固ゆでして殻を除き、食べやすく切る。']:[]),
    ...(has('fried-egg')?['目玉焼きは材料に含まれる油で焼き、ふたをして白身と黄身が固まるまで加熱する。']:[]),
    ...(has('scrambled-egg')?['卵へ表示量の牛乳と塩を混ぜ、材料に含まれる油で中まで固まるまで焼く。']:[]),
    ...(has('sausage-patty')?['ソーセージパティは材料表の豚ひき肉と塩・黒こしょうを混ぜて平たく成形する。材料に含まれる油で両面を焼き、中心75℃で1分以上を確認する。']:[]),
    ...(has('chicken')||has('chicken-plain')?['鶏むね肉は加熱前の可食部を表示量に量り、薄めに切る。選んだ調味料と油を使って両面を焼き、最も厚い部分の中心75℃で1分以上を確認する。鶏肉のソテーには表示した配合の油と塩を含むため、別の油を重ねて加算しない。']:[]),
    ...(has('bacon')?['ベーコンは製品に表示された調理方法に従い、中まで熱くなるまで加熱する。']:[]),
    ...(has('shimeji')?['しめじは石づきを除いて小房に分け、材料に含まれるオリーブ油と塩で中まで火が通るまで炒める。']:[]),
    ...(has('corn')?['生のコーンは先にやわらかくなるまで加熱する。加熱済み製品は表示に従って用意する。']:[]),
    ...(has('pizza-sauce')?['表示量のケチャップとトマトペーストを混ぜ、簡易ピザソースを作る。']:[]),
    ...(has('onion')||has('green-pepper')?['玉ねぎやピーマンは薄切りにする。']:[]),
    ...(definition.kind==='hot-sandwich'?['加熱済みの具材と選んだソースをパンではさむ。バターは好みで外側に薄く塗り、ホットサンドメーカーの説明に従って両面を焼く。フライパンなら弱めの中火で押さえながら両面を焼き、具も十分に温める。熱い具と溶けたチーズに注意して切る。']:
      definition.kind==='toast'?['選んだバターやソース、加熱済みの具材を食パンに広げてトースターで焼く。チーズは溶けるまで加熱する。焦げそうなら時間や火力を調整し、ジャム・はちみつは好みで焼いた後に塗る。']:
      selected.length>1?['選んだ具材とソースを表示量に用意し、はさむか添える。作ったら早めに食べ、すぐ食べない分は冷蔵する。']:[]),
  ];
  return [...definition.instructions];
}

export function foodComposerFor(recipeId) {return typeof recipeId==='string'?byRecipe.get(recipeId)??null:null;}
export function foodComposerDefinition(kind) {
  const definition=byKind.get(kind);
  if(!definition)throw Error('組み合わせる料理の種類が見つかりません。');
  return definition;
}
/** 標準の組み合わせも、自由入力と同じ材料・量の配列へ変換します。 */
export function foodPresetSelection(kind,presetId,{id}={}) {
  const definition=foodComposerDefinition(kind),preset=definition.presets?.find(part=>part.id===presetId);
  if(!preset)throw Error('最初の組み合わせを選んでください。');
  return {kind,...(id===undefined?{}:{id}),components:preset.components.map(([id,amount])=>({id,amount}))};
}
export function matchingFoodPreset(kind,selection) {
  const normalise=parts=>JSON.stringify(parts.map(part=>[part.id,part.amount,part.gramsPerUnit??null]).sort(([a],[b])=>a.localeCompare(b)));
  if(!selection||selection.kind!==kind||!Array.isArray(selection.components))return null;
  const key=normalise(selection.components);
  return foodComposerDefinition(kind).presets?.find(preset=>normalise(preset.components.map(([id,amount])=>({id,amount})))===key)??null;
}
export function availableFoodPresets(kind,data,options={}) {
  const available=new Set(availableFoodComponents(kind,data,options).map(part=>part.id));
  return (foodComposerDefinition(kind).presets??[]).filter(preset=>preset.components.every(([id])=>available.has(id)));
}
export function defaultFoodSelection(kind,{recipeId}={}) {
  const definition=foodComposerDefinition(kind), selected=typeof recipeId==='string'?definition.components.find(part=>part.recipeId===recipeId):null;
  const preset=definition.presets?.find(part=>part.recipeId===recipeId);
  if(preset)return foodPresetSelection(kind,preset.id);
  const mapping={
    'varied-shrimp-tempura':[['shrimp',4]],'varied-squid-tempura':[['squid',4]],'varied-whitefish-tempura':[['whitefish',4]],
    'varied-shimeji-tempura':[['shimeji',4]],'varied-vegetable-tempura':[['aubergine',2],['pumpkin',2],['lotus-root',2]],
    'daily-snack-plain-cheese':[['gouda',1]],'daily-snack-mozzarella':[['mozzarella',2]],
    'palette-cheese-camembert':[['camembert',1]],'palette-cheese-cheddar':[['cheddar',1]],'palette-cheese-cream':[['cream-cheese',1]],
    'palette-cheese-blue':[['blue-cheese',1]],'palette-cheese-processed':[['processed-cheese',1]],'palette-cheese-parmesan':[['parmesan',5]],
    'snack-almond':[['almond',15]],'snack-walnut':[['walnut',15]],'snack-cashew':[['cashew',15]],'snack-peanut':[['peanut',15]],
    'snack-nuts-raisin':[['almond',7.5],['walnut',7.5],['raisin',10]],
    'palette-nuts-pistachio':[['pistachio',15]],'palette-nuts-macadamia':[['macadamia',15]],'palette-nuts-pine':[['pine',15]],
  };
  const defaults=selected?[[selected.id,selected.defaultAmount]]:mapping[recipeId]??definition.presets?.find(part=>!part.custom)?.components??definition.defaults;
  return {kind,components:defaults.map(([id,amount])=>({id,amount}))};
}

/** 元レシピは書き換えず、確認情報も選んだ料理からだけ引き継ぎます。 */
export function buildFoodSelection(config,data) {
  if(!isRecord(config)||Object.keys(config).some(key=>!['id','kind','components'].includes(key)))throw Error('組み合わせと量を確認してください。');
  const definition=foodComposerDefinition(config.kind), id=own(config,'id')?config.id:newId();
  if(typeof id!=='string'||!/^custom-[A-Za-z0-9_-]+$/.test(id)||id.length>120)throw Error('組み合わせの識別子を確認してください。');
  if(!Array.isArray(config.components)||!config.components.length||config.components.length>definition.components.length||Object.keys(config.components).length!==config.components.length)throw Error('食べる種類を1つ以上選んでください。');
  if(!isRecord(data?.ingredients)||!Array.isArray(data?.recipes))throw Error('食材と料理のデータを確認してください。');
  const selected=[],seen=new Set(),parts=new Map(),totals=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0])),allergens=[],groups=[],proteins=[],steps=[],basisParts=[];
  let allergensKnown=true,ingredientsKnown=true,shoppingKnown=true,hasPurchased=false;
  for(const part of config.components){
    if(!isRecord(part)||Object.keys(part).some(key=>!['id','amount','gramsPerUnit'].includes(key)))throw Error('種類と量を確認してください。');
    const component=definition.components.find(option=>option.id===part.id);
    if(!component||seen.has(part.id))throw Error('選んだ種類が不明か、重複しています。');
    seen.add(part.id);
    if(part.amount===0&&component.food===false)continue;
    const maximum=component.maxAmount??(['g','ml'].includes(component.unit)?1000:50);
    if(!valid(part.amount,maximum))throw Error(`${component.label}の量は0より大きく${maximum}${component.unit}以下で入力してください。`);
    if(own(part,'gramsPerUnit')&&component.gramsPerUnit===undefined)throw Error('この種類は1個の重さを変更できません。');
    const gramsPerUnit=component.gramsPerUnit===undefined?null:(own(part,'gramsPerUnit')?part.gramsPerUnit:component.gramsPerUnit);
    if(gramsPerUnit!==null&&!valid(gramsPerUnit,500))throw Error(`${component.label}の1${component.unit}の重さは0より大きく500g以下で入力してください。`);
    let nutrition,ingredients,metadata,sourceNote='';
    if(component.recipeId){
      const source=data.recipes.find(recipe=>recipe.id===component.recipeId);
      if(!source||!valid(source.servings,1000)||!Array.isArray(source.ingredients)||!source.ingredients.length)throw Error(`${component.label}の基準レシピが見つかりません。`);
      const portion=recipePortion(source,data),denominator=component.recipeAmount??portion.amount;
      if(component.recipeAmount===undefined&&portion.unit!==(gramsPerUnit===null?component.unit:'g'))throw Error(`${component.label}の分量単位を確認してください。`);
      const multiplier=part.amount*(gramsPerUnit??1)/denominator;
      nutrition=recipeNutrition(source,data);
      nutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,nutrition[key]===null?null:nutrition[key]*multiplier]));
      ingredients=source.ingredients.map(item=>({id:item.id,amount:item.amount/source.servings*multiplier}));
      metadata=itemFromRecipe(source,data);
      if(typeof source.sourceNote==='string')sourceNote=source.sourceNote.trim();
      const confirmed=recipeConfirmation(source);
      allergensKnown&&=confirmed.allergensKnown;ingredientsKnown&&=confirmed.ingredientsKnown;
      shoppingKnown&&=source.shoppingKnown===true||confirmed.ingredientsKnown;
      hasPurchased||=['instant','retort','fast-food','ready-to-eat'].includes(source.nature)&&!confirmed.ingredientsKnown;
      if(source.steps?.length)steps.push(`${component.label}：${source.steps.join(' ')}`);
    }else{
      ingredients=component.ingredients.map(item=>({id:item.id,amount:item.amount*part.amount*(gramsPerUnit??1)}));
      const source={servings:1,ingredients,role:definition.role,name:component.label,steps:[]};
      nutrition=recipeNutrition(source,data);metadata=itemFromRecipe(source,data);
      for(const item of ingredients){
        const ingredient=data.ingredients[item.id];
        allergensKnown&&=ingredient.allergensKnown!==false;ingredientsKnown&&=ingredient.ingredientsKnown!==false;
        shoppingKnown&&=ingredient.shoppingKnown!==false;
      }
    }
    // Some representative prepared ingredients predate explicit confirmation flags.
    // A component can retain an unconfirmed product state, never promote one.
    allergensKnown&&=component.allergensKnown!==false;ingredientsKnown&&=component.ingredientsKnown!==false;
    shoppingKnown&&=component.shoppingKnown!==false;
    for(const ingredient of ingredients){
      if(!own(data.ingredients,ingredient.id)||!valid(ingredient.amount,1e6))throw Error('材料の種類と分量を確認してください。');
      parts.set(ingredient.id,(parts.get(ingredient.id)??0)+ingredient.amount);
    }
    for(const key of NUTRIENT_KEYS)totals[key]=totals[key]===null||nutrition[key]===null?null:totals[key]+nutrition[key];
    allergens.push(...metadata.allergens);groups.push(...metadata.groups);proteins.push(...metadata.proteinSources);
    basisParts.push({kind:metadata.nutritionBasis,label:component.label,sourceNote});
    selected.push({...component,amount:part.amount,...(gramsPerUnit===null?{}:{gramsPerUnit})});
  }
  if(!selected.some(part=>part.food!==false&&!part.base)){
    if(!definition.baseRequired)throw Error('汁やソースだけでは記録できません。食べる具材を1つ以上選んでください。');
  }
  if(definition.kind==='pot-au-feu'&&!selected.some(part=>part.id==='water'))throw Error('ポトフの煮汁の水を選び、0より大きい量を入力してください。');
  if(definition.baseRequired&&(selected.filter(part=>part.base).length!==1||selected.find(part=>part.base)?.amount!==1))throw Error('ベースは1個分を選んでください。');
  if(definition.fillingRequired&&!selected.some(part=>!part.base&&part.section==='具材'))throw Error('サンドイッチの具材を1種類以上選んでください。');
  if(selected.reduce((sum,part)=>sum+(part.gramsPerUnit!==undefined?part.amount*part.gramsPerUnit:['g','ml'].includes(part.unit)?part.amount:0),0)>3000)throw Error('1皿の合計量を確認してください。');
  if(selected.filter(part=>!['g','ml'].includes(part.unit)).reduce((sum,part)=>sum+part.amount,0)>100)throw Error('1皿の個数は合計100以下で入力してください。');
  const labels=selected.map(part=>`${part.label} ${quantityLabel(part.amount)}${part.unit}${part.gramsPerUnit===undefined?'':`（約${quantityLabel(part.amount*part.gramsPerUnit)}g）`}`),nameLabels=labels.slice(0,5).join('・');
  const suffix=labels.length>5?`ほか${labels.length-5}種`:'';
  const description=`${definition.label}の1皿分です。${definition.nutritionNote??''}選んだ内容：${labels.join('、')}。材料と栄養は選んだ量から求めた概算です。${hasPurchased?'購入品は参照商品の表示値を使い、原材料とアレルギー情報は実物の表示を確認してください。':'材料は各食品の代表値を使います。'}記録した後は、その時点の量と栄養を保持します。`;
  const references=basisParts.filter(part=>part.kind!=='ingredients'&&part.sourceNote).map(part=>`参照元（${part.label}）：${part.sourceNote}`);
  const fullSourceNote=[description,...references].join('\n');
  // 合算前の分類を残します。不明な元データを、配合やURLの存在だけで昇格させません。
  const kinds=new Set(basisParts.map(part=>part.kind));
  const completeOfficialSources=basisParts.every(part=>part.kind==='official'&&part.sourceNote)&&fullSourceNote.length<=2000;
  let nutritionBasis='ingredients';
  if(kinds.has('unknown'))nutritionBasis='unknown';
  else if(kinds.has('official')||kinds.has('mixed'))nutritionBasis=completeOfficialSources?'official':'mixed';
  else if(kinds.has('estimate')||kinds.has('manual')&&kinds.size>1)nutritionBasis='estimate';
  else if(kinds.has('manual'))nutritionBasis='manual';
  const recipe={id,name:`${definition.label}（${nameLabels}${suffix?`・${suffix}`:''}）`.slice(0,200),role:definition.role,family:definition.family,genre:definition.genre,minutes:definition.minutes,servings:1,
    ingredients:[...parts].map(([id,amount])=>({id,amount})),steps:[...selectedInstructions(definition,selected),...steps],custom:true,
    nature:hasPurchased?'ready-to-eat':definition.nature??'home-cooked',staple:definition.role==='staple',mealBase:definition.mealBase===true,
    portion:{amount:1,unit:'皿'},variantLabel:labels.slice(0,4).join('・').slice(0,200),
    allergensKnown,ingredientsKnown,shoppingKnown,allergens:unique(allergens),groups:unique(groups),proteinSources:unique(proteins),
    manualNutrition:totals,nutritionBasis,sourceNote:fullSourceNote.slice(0,2000)};
  // 最後に共通の原料参照検査も通し、アレルゲン継承や循環の検査を省略しません。
  itemFromRecipe(recipe,data);
  return recipe;
}

/** DBに実在する選択肢だけを返し、呼び出し元の候補制限を尊重します。 */
export function availableFoodComponents(kind,data,{allowedRecipeIds}={}) {
  const definition=foodComposerDefinition(kind),available=new Set((data?.recipes??[]).map(recipe=>recipe.id));
  if(allowedRecipeIds!==undefined&&(!Array.isArray(allowedRecipeIds)||allowedRecipeIds.some(id=>typeof id!=='string')))throw Error('選択できる料理の条件を確認してください。');
  const allowed=allowedRecipeIds===undefined?null:new Set(allowedRecipeIds);
  return definition.components.filter(component=>component.recipeId?
    available.has(component.recipeId)&&(!allowed||allowed.has(component.recipeId)):
    component.ingredients.every(part=>own(data?.ingredients??{},part.id)));
}

/** 除外条件を満たす具材から初期値を作り、卵を避けたおでん等も選べます。 */
export function eligibleFoodSelection(kind,settings,data,{recipeId}={}) {
  eligibleRecipes(settings,{...data,recipes:[]});
  const definition=foodComposerDefinition(kind), components=availableFoodComponents(kind,data);
  const allowed=components.filter(component=>{
    let recipe=component.recipeId?data.recipes.find(row=>row.id===component.recipeId):null;
    if(!recipe){
      const ingredients=component.ingredients.map(part=>({...part}));
      const metadata=ingredients.map(part=>data.ingredients[part.id]);
      recipe={id:`custom-component-${component.id}`,name:component.label,role:definition.role,genre:definition.genre,servings:1,minutes:1,
        ingredients,steps:[],custom:true,nature:'home-cooked',staple:definition.role==='staple',
        ingredientsKnown:metadata.every(item=>item.ingredientsKnown!==false),allergensKnown:metadata.every(item=>item.allergensKnown!==false)};
    }
    return eligibleRecipes(settings,{...data,recipes:[recipe]}).length>0;
  });
  const allowedIds=new Set(allowed.map(component=>component.id));
  let config=defaultFoodSelection(kind,{recipeId});
  config.components=config.components.filter(component=>allowedIds.has(component.id));
  if(definition.baseRequired&&!config.components.some(part=>allowed.find(component=>component.id===part.id)?.base)){
    const base=allowed.find(component=>component.base);
    if(!base)return null;
    config.components.unshift({id:base.id,amount:1});
  }
  if(definition.fillingRequired&&!config.components.some(part=>allowed.find(component=>component.id===part.id)?.section==='具材')){
    const filling=allowed.find(component=>component.section==='具材');
    if(!filling)return null;
    config.components.push({id:filling.id,amount:filling.defaultAmount});
  }
  if(!definition.baseRequired&&!config.components.some(part=>allowed.find(component=>component.id===part.id)?.food!==false)){
    const food=allowed.find(component=>component.food!==false&&!component.base);
    if(!food)return null;
    config.components.unshift({id:food.id,amount:food.defaultAmount});
  }
  try{
    const recipe=buildFoodSelection(config,data);
    return eligibleRecipes(settings,{...data,recipes:[recipe]}).length?{config,recipe}:null;
  }catch{return null;}
}
