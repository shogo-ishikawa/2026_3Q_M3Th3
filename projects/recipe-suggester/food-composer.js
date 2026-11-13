/** 選んだ種類と量だけを合計し、記録できる1皿へ変換します。 */
import {recipePortion} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';

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
  formula('broth','飲むおでんの汁',[['water',0.94],['soy_sauce',0.04],['mirin',0.02],['bonito',0.003]],'汁','ml',150,
    {food:false,maxAmount:1000,note:'実際に飲む量だけを選びます。具材に染みる汁はこの量に含める概算です。0mlなら選択を外せます。'}),
];
const cheeses = [
  material('gouda','ゴーダ系ナチュラルチーズ','cheese','チーズ','g',20),
  material('mozzarella','モッツァレラ','mozzarella','チーズ','g',30),
  material('parmesan','パルメザン','parmesan_cheese','チーズ','g',10),
  ...[['camembert','カマンベール'],['cheddar','チェダー'],['cream-cheese','クリームチーズ'],['blue-cheese','ブルーチーズ'],['processed-cheese','プロセスチーズ']]
    .map(([id,label])=>material(id,label,`palette_${id.replaceAll('-','_')}`,'チーズ','g',20)),
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
  material('ham','ハム','ready_sliced_ham','具材','g',20,1,{food:false}),
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
const sashimi = [['tuna','まぐろ赤身'],['tuna-mediumfat','まぐろ中トロ'],['salmon','サーモン'],['yellowtail','ぶり'],['seabream','たい'],['bonito','かつお'],['aji','あじ'],['squid','いか'],['octopus','ゆでだこ'],['scallop','ほたて']]
  .map(([id,label])=>choice(id,label,`classic-sashimi-${id}`,'刺身','g',30));

const COMPOSER_DESCRIPTIONS = {
  oden:'大根・卵・練り物と、飲む汁の量を選ぶ',
  sushi:'握り11種・軍艦・巻き寿司を一皿に',
  sashimi:'魚介10種を好きな量で盛り合わせる',
  yakitori:'部位、塩・たれ、本数を選ぶ',
  tempura:'具材の種類と個数、天つゆの量を選ぶ',
  cheese:'8種類のチーズを好きなg数で',
  nuts:'ナッツとレーズンを好きなg数で',
  bagel:'ベース1個に好みの具材とトッピング',
  waffle:'フルーツ・クリーム・シロップを選ぶ',
  muffin:'プレーン生地に混ぜ込む具材を選ぶ',
  sandwich:'パン2枚に具材とソースを組み合わせる',
};

export const FOOD_COMPOSERS = freeze([
  {kind:'oden',label:'おでん',recipeIds:['palette-oden'],role:'main',family:'main',genre:'和食',minutes:40,components:oden,
    defaults:[['daikon',1],['egg',1],['konjac',1],['chikuwa',1],['broth',150]],
    intro:'食べる具材の個数と、実際に飲む汁の量を選びます。具材は表示した標準重量の目安です。',
    instructions:['大根は皮をむいて切り、やわらかく下ゆでする。卵は固ゆでして殻をむく。こんにゃくは下ゆでし、油揚げや厚揚げは湯通しする。',
      '選んだ具材をだし汁で静かに煮る。牛すじは下ゆで済みのものを使い、餅巾着は油揚げに表示量の餅を包む。',
      '練り物やはんぺんは煮崩れないよう後から加え、餅も中までやわらかくなるまで加熱する。食べた具材と飲んだ汁の量で記録する。']},
  {kind:'sushi',label:'お寿司',recipeIds:[...sushi.map(part=>part.recipeId),'classic-sushi-assorted'],role:'staple',family:'sushi',genre:'和食',mealBase:true,minutes:20,components:sushi,
    defaults:[['tuna',2],['salmon',2],['shrimp',1],['egg',1]],intro:`握り・軍艦は貫数、細巻き・太巻きは切れ数で選べます。細巻きは1本6切れ、太巻きは1本8切れの目安です。${countNote}`,
    instructions:['食べる寿司の種類と数を選ぶ。魚は刺身用を使用し、えびや玉子など加熱する具は中まで火を通してから冷ます。']},
  {kind:'sashimi',label:'刺身の盛り合わせ',recipeIds:[...sashimi.map(part=>part.recipeId),'classic-sashimi-assorted'],role:'main',family:'sashimi',nature:'ready-to-eat',genre:'和食',minutes:10,components:sashimi,
    defaults:[['tuna',30],['salmon',30],['seabream',30]],intro:'種類ごとに食べる魚介の可食部g数を選びます。しょうゆは元の各刺身レシピに含まれる目安量を同じ割合で計算します。',
    instructions:['刺身用として販売された魚介を清潔な器具で盛り付ける。ゆでだこは加熱済みを使い、食べるまで冷蔵する。']},
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
    role:'snack',family:'cheese',nature:'ready-to-eat',genre:'その他',minutes:5,components:cheeses,defaults:[['gouda',20]],intro:'種類ごとに食べるg数を選びます。包材や外皮など食べない部分を除いた重さです。',instructions:['選んだチーズを表示量に切り分けて盛る。保存方法と期限は商品表示に従う。']},
  {kind:'nuts',label:'ナッツのミックス',recipeIds:['snack-almond','snack-walnut','snack-cashew','snack-peanut','snack-nuts-raisin','palette-nuts-pistachio','palette-nuts-macadamia','palette-nuts-pine'],
    role:'snack',family:'nuts',nature:'ready-to-eat',genre:'その他',minutes:5,components:nuts,defaults:[['almond',10],['walnut',10]],intro:'殻を除いたナッツをg数で選びます。アーモンド・くるみ・カシューナッツは無塩、ピスタチオ・マカダミアは成分表の味付け品が基準です。実際の塩分は商品表示を優先してください。レーズンも追加できます。',instructions:['殻を除いた食べる部分だけを計量し、選んだ種類を混ぜる。']},
  {kind:'bagel',label:'ベーグル',recipeIds:['palette-bagel'],role:'staple',family:'bread',genre:'その他',minutes:10,unit:'個',baseRequired:true,
    components:[material('base','プレーンベーグル（約100g）','palette_bagel','ベース','個',1,100,{base:true,maxAmount:1}),...savouryFillings,...sweetToppings.filter(part=>!savouryFillings.some(other=>other.id===part.id))],
    defaults:[['base',1]],intro:'ベーグル1個に加える具材とトッピングを選びます。各g数はこの1個に使う量です。',instructions:['ベーグルを横半分に切り、好みで軽くトーストする。ゆで卵を選んだ場合は固ゆでして殻を除く。', '選んだ具材とトッピングを表示量に用意し、はさむか添える。']},
  {kind:'waffle',label:'ワッフル',recipeIds:['palette-waffle'],role:'snack',family:'cake',genre:'その他',minutes:10,unit:'個',baseRequired:true,
    components:[material('base','プレーンワッフル（約70g）','palette_waffle','ベース','個',1,70,{base:true,maxAmount:1}),...sweetToppings],defaults:[['base',1]],
    intro:'焼き上がったワッフル1個に、食べるトッピングだけを加えます。各g数は1個分です。',instructions:['焼き上がったプレーンワッフルを用意し、必要なら商品の方法で温める。', '選んだ果物やトッピングを表示量に用意してのせる。シロップやクリームも食べる量だけを加える。']},
  {kind:'muffin',label:'マフィン',recipeIds:['palette-muffin'],role:'snack',family:'cake',genre:'その他',minutes:30,unit:'個',baseRequired:true,
    components:[choice('base','プレーン生地（焼成前約70g）','palette-muffin','ベース','個',1,{base:true,maxAmount:1}),
      ...[['blueberry','ブルーベリー','blueberry',15],['banana','バナナ','banana',20],['chocolate','チョコレート','chocolate',10],['walnut','くるみ','walnut',8],['almond','アーモンド','almond',8],['cheese','チーズ','cheese',10]]
        .map(([id,label,ingredientId,amount])=>material(id,label,ingredientId,'混ぜ込む具材','g',amount,1,{food:false}))],
    defaults:[['base',1],['blueberry',15]],intro:'プレーン生地70gを1個分として、混ぜ込む具材を選びます。焼いた後の重量は水分の変化で変わります。',
    instructions:['プレーンのマフィン生地を1個分用意する。具材は食べない部分を除き、ナッツやチョコレートは小さく刻む。', '選んだ具材を生地に混ぜて型に入れ、180℃に予熱したオーブンで約20〜25分焼く。竹串に生の生地が付かず中心まで火が通ったことを確認する。']},
  {kind:'sandwich',label:'サンドイッチ',recipeIds:['palette-sandwich'],role:'staple',family:'bread',mealBase:true,genre:'その他',minutes:15,unit:'個',baseRequired:true, fillingRequired:true,
    components:[material('base','食パン2枚（合計約60g）','bread','ベース','個',1,60,{base:true,maxAmount:1}),...savouryFillings],
    defaults:[['base',1],['ham',20],['lettuce',15],['mayonnaise',5]],intro:'パン2枚で作る1組を1個として、具材とソースを選びます。各g数は1個分です。',
    instructions:['パン2枚と選んだ具材を用意する。ゆで卵を選んだ場合は固ゆでし、殻を除いて切る。野菜は洗って十分に水気を切る。', 'ソースを塗り、選んだ具材を重ねてはさむ。食べやすく切り、食べるまで冷蔵する。']},
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
    ...(has('daikon')?['大根は皮をむいて表示量に切り、やわらかく下ゆでする。']:[]),
    ...(has('egg')?['卵は固ゆでして殻をむく。']:[]),
    ...(has('konjac')?['こんにゃくは表示量に切って下ゆでする。']:[]),
    ...(has('atsuage')?['厚揚げは湯通しして食べやすく切る。']:[]),
    ...(has('mochi-pouch')?['油揚げを湯通しし、切り餅を包んで餅巾着にする。']:[]),
    ...(has('beef-tendon')?['牛すじは下ゆで済みの可食部を表示量に計る。']:[]),
    '鍋に調理用のだし汁を適量用意し、選んだ具材を静かに煮て中まで温める。栄養には具材と、選択した飲む汁の量を計上する概算で、鍋の汁全量は加算しない。',
    ...(has('chikuwa')||has('hanpen')||has('ganmodoki')?['選んだ練り物やがんもどきは煮崩れないよう後から加える。']:[]),
    ...(has('mochi-pouch')?['餅の中心までやわらかくなったことを確認する。']:[]),
    '食べた具材と実際に飲んだ汁の量に合わせて記録する。',
  ];
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
  if(['bagel','sandwich'].includes(definition.kind))return [
    definition.kind==='bagel'?'ベーグルを横半分に切り、好みで軽くトーストする。':'食パン2枚と選んだ具材を用意する。野菜は洗って水気を切る。',
    ...(has('boiled-egg')?['卵は固ゆでして殻を除き、食べやすく切る。']:[]),
    ...(selected.length>1?['選んだ具材とソースを表示量に用意し、はさむか添える。食べるまで冷蔵する。']:[]),
  ];
  return [...definition.instructions];
}

export function foodComposerFor(recipeId) {return typeof recipeId==='string'?byRecipe.get(recipeId)??null:null;}
export function foodComposerDefinition(kind) {
  const definition=byKind.get(kind);
  if(!definition)throw Error('組み合わせる料理の種類が見つかりません。');
  return definition;
}
export function defaultFoodSelection(kind,{recipeId}={}) {
  const definition=foodComposerDefinition(kind), selected=typeof recipeId==='string'?definition.components.find(part=>part.recipeId===recipeId):null;
  const mapping={
    'varied-shrimp-tempura':[['shrimp',4]],'varied-squid-tempura':[['squid',4]],'varied-whitefish-tempura':[['whitefish',4]],
    'varied-shimeji-tempura':[['shimeji',4]],'varied-vegetable-tempura':[['aubergine',2],['pumpkin',2],['lotus-root',2]],
    'daily-snack-plain-cheese':[['gouda',20]],'daily-snack-mozzarella':[['mozzarella',30]],
    'palette-cheese-camembert':[['camembert',20]],'palette-cheese-cheddar':[['cheddar',20]],'palette-cheese-cream':[['cream-cheese',20]],
    'palette-cheese-blue':[['blue-cheese',20]],'palette-cheese-processed':[['processed-cheese',20]],'palette-cheese-parmesan':[['parmesan',10]],
    'snack-almond':[['almond',15]],'snack-walnut':[['walnut',15]],'snack-cashew':[['cashew',15]],'snack-peanut':[['peanut',15]],
    'snack-nuts-raisin':[['almond',7.5],['walnut',7.5],['raisin',10]],
    'palette-nuts-pistachio':[['pistachio',15]],'palette-nuts-macadamia':[['macadamia',15]],'palette-nuts-pine':[['pine',15]],
  };
  const defaults=selected?[[selected.id,selected.defaultAmount]]:mapping[recipeId]??definition.defaults;
  return {kind,components:defaults.map(([id,amount])=>({id,amount}))};
}

/** 元レシピは書き換えず、確認情報も選んだ料理からだけ引き継ぎます。 */
export function buildFoodSelection(config,data) {
  if(!isRecord(config)||Object.keys(config).some(key=>!['id','kind','components'].includes(key)))throw Error('組み合わせと量を確認してください。');
  const definition=foodComposerDefinition(config.kind), id=own(config,'id')?config.id:newId();
  if(typeof id!=='string'||!/^custom-[A-Za-z0-9_-]+$/.test(id)||id.length>120)throw Error('組み合わせの識別子を確認してください。');
  if(!Array.isArray(config.components)||!config.components.length||config.components.length>definition.components.length||Object.keys(config.components).length!==config.components.length)throw Error('食べる種類を1つ以上選んでください。');
  if(!isRecord(data?.ingredients)||!Array.isArray(data?.recipes))throw Error('食材と料理のデータを確認してください。');
  const selected=[],seen=new Set(),parts=new Map(),totals=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0])),allergens=[],groups=[],proteins=[],steps=[];
  let allergensKnown=true,ingredientsKnown=true,shoppingKnown=true,hasPurchased=false;
  for(const part of config.components){
    if(!isRecord(part)||Object.keys(part).some(key=>!['id','amount'].includes(key)))throw Error('種類と量を確認してください。');
    const component=definition.components.find(option=>option.id===part.id);
    if(!component||seen.has(part.id))throw Error('選んだ種類が不明か、重複しています。');
    seen.add(part.id);
    if(part.amount===0&&component.food===false)continue;
    const maximum=component.maxAmount??(['g','ml'].includes(component.unit)?1000:50);
    if(!valid(part.amount,maximum))throw Error(`${component.label}の量は0より大きく${maximum}${component.unit}以下で入力してください。`);
    let nutrition,ingredients,metadata;
    if(component.recipeId){
      const source=data.recipes.find(recipe=>recipe.id===component.recipeId);
      if(!source||!valid(source.servings,1000)||!Array.isArray(source.ingredients)||!source.ingredients.length)throw Error(`${component.label}の基準レシピが見つかりません。`);
      const portion=recipePortion(source,data),denominator=component.recipeAmount??portion.amount;
      if(component.recipeAmount===undefined&&portion.unit!==component.unit)throw Error(`${component.label}の分量単位を確認してください。`);
      const multiplier=part.amount/denominator;
      nutrition=recipeNutrition(source,data);
      nutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,nutrition[key]===null?null:nutrition[key]*multiplier]));
      ingredients=source.ingredients.map(item=>({id:item.id,amount:item.amount/source.servings*multiplier}));
      metadata=itemFromRecipe(source,data);
      const confirmed=recipeConfirmation(source);
      allergensKnown&&=confirmed.allergensKnown;ingredientsKnown&&=confirmed.ingredientsKnown;
      shoppingKnown&&=source.shoppingKnown===true||confirmed.ingredientsKnown;
      hasPurchased||=['instant','retort','fast-food','ready-to-eat'].includes(source.nature)&&!confirmed.ingredientsKnown;
      if(source.steps?.length)steps.push(`${component.label}：${source.steps.join(' ')}`);
    }else{
      ingredients=component.ingredients.map(item=>({id:item.id,amount:item.amount*part.amount}));
      const source={servings:1,ingredients,role:definition.role,name:component.label,steps:[]};
      nutrition=recipeNutrition(source,data);metadata=itemFromRecipe(source,data);
      for(const item of ingredients){
        const ingredient=data.ingredients[item.id];
        allergensKnown&&=ingredient.allergensKnown!==false;ingredientsKnown&&=ingredient.ingredientsKnown!==false;
        shoppingKnown&&=ingredient.shoppingKnown!==false;
      }
    }
    for(const ingredient of ingredients){
      if(!own(data.ingredients,ingredient.id)||!valid(ingredient.amount,1e6))throw Error('材料の種類と分量を確認してください。');
      parts.set(ingredient.id,(parts.get(ingredient.id)??0)+ingredient.amount);
    }
    for(const key of NUTRIENT_KEYS)totals[key]=totals[key]===null||nutrition[key]===null?null:totals[key]+nutrition[key];
    allergens.push(...metadata.allergens);groups.push(...metadata.groups);proteins.push(...metadata.proteinSources);
    selected.push({...component,amount:part.amount});
  }
  if(!selected.some(part=>part.food!==false&&!part.base)){
    if(!definition.baseRequired)throw Error('汁やソースだけでは記録できません。食べる具材を1つ以上選んでください。');
  }
  if(definition.baseRequired&&(selected.filter(part=>part.base).length!==1||selected.find(part=>part.base)?.amount!==1))throw Error('ベースは1個分を選んでください。');
  if(definition.fillingRequired&&!selected.some(part=>!part.base&&part.section==='具材'))throw Error('サンドイッチの具材を1種類以上選んでください。');
  if(selected.filter(part=>['g','ml'].includes(part.unit)).reduce((sum,part)=>sum+part.amount,0)>3000)throw Error('1皿の合計量を確認してください。');
  if(selected.filter(part=>!['g','ml'].includes(part.unit)).reduce((sum,part)=>sum+part.amount,0)>100)throw Error('1皿の個数は合計100以下で入力してください。');
  const labels=selected.map(part=>`${part.label} ${quantityLabel(part.amount)}${part.unit}`),nameLabels=labels.slice(0,5).join('・');
  const suffix=labels.length>5?`ほか${labels.length-5}種`:'';
  const description=`${definition.label}の1皿分です。選んだ内容：${labels.join('、')}。材料と栄養は選んだ量から求めた概算です。${hasPurchased?'購入品は参照商品の表示値を使い、原材料とアレルギー情報は実物の表示を確認してください。':'材料は各食品の代表値を使います。'}記録した後は、その時点の量と栄養を保持します。`;
  const recipe={id,name:`${definition.label}（${nameLabels}${suffix?`・${suffix}`:''}）`.slice(0,200),role:definition.role,family:definition.family,genre:definition.genre,minutes:definition.minutes,servings:1,
    ingredients:[...parts].map(([id,amount])=>({id,amount})),steps:[...selectedInstructions(definition,selected),...steps],custom:true,
    nature:hasPurchased?'ready-to-eat':definition.nature??'home-cooked',staple:definition.role==='staple',mealBase:definition.mealBase===true,
    portion:{amount:1,unit:'皿'},variantLabel:labels.slice(0,4).join('・').slice(0,200),
    allergensKnown,ingredientsKnown,shoppingKnown,allergens:unique(allergens),groups:unique(groups),proteinSources:unique(proteins),
    manualNutrition:totals,sourceNote:description.slice(0,2000)};
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
