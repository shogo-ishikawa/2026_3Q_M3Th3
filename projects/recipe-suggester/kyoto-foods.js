// 成分表は可食部100g、材料は2人分。だしは固形物をこした液体を量る。
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const mextUrl = code => `https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${code}_7`;
const materials = [
  {id:'kyoto_namafu', name:'生麩（プレーン）', code:'1_01065', values:[161,12.7,0.8,26.2,0.5,0],
    allergens:['wheat'], note:'小麦グルテンともち粉から作る生麩の代表値。焼き麩とは水分量が異なる。'},
  {id:'kyoto_usukuchi', name:'薄口しょうゆ', code:'17_17008', values:[60,5.7,0,5.8,null,16], estimates:{fiber:0.03},
    allergens:['soy','wheat'], derivedFrom:['soy_sauce'], note:'色の薄いしょうゆ。食物繊維の推定微量は計算用に0.03g/100gとした。'},
  {id:'kyoto_kombu_dashi', name:'昆布だし（水出しの抽出液）', code:'17_17020', values:[4,0.1,null,0.9,null,0.2],
    estimates:{fat:0.03,fiber:0.1}, unit:'ml', derivedFrom:['kombu'],
    note:'昆布を取り除いた液体。1mlを約1gとする。計算用に脂質の微量を0.03g/100g、未掲載の食物繊維は昆布だし・煮出し（食品番号17132）の0.1g/100gを代用した。'},
  {id:'kyoto_kanpachi', name:'カンパチ（刺身用・背側）', code:'10_10424', values:[95,22.2,1.2,0.1,0,0.1],
    fish:true, note:'生食用に販売された背側の可食部。腹身は脂の量が異なる。'},
  {id:'kyoto_suzuki', name:'スズキ（刺身用）', code:'10_10188', values:[113,19.8,4.2,null,0,0.2],
    fish:true, estimates:{carbs:0.03}, note:'生食用に販売された可食部。炭水化物の微量は計算用に0.03g/100gとした。'},
];
export const KYOTO_INGREDIENTS = Object.fromEntries(materials.map(food => [food.id, {
  name:food.name, unit:food.unit ?? 'g', allergens:food.allergens ?? [],
  groups:food.fish ? ['protein'] : [], proteinSources:food.fish ? ['fish'] : [],
  ...(food.derivedFrom ? {derivedFrom:food.derivedFrom} : {}), note:food.note,
}]));
export const KYOTO_NUTRITION = Object.fromEntries(materials.map(food => {
  const source = `文部科学省 日本食品標準成分表（八訂）増補2023年・食品番号${food.code.split('_')[1]}の可食部100g。確認日2026-11-18。${mextUrl(food.code)} ${food.note}`;
  return [food.id,{
    gramsPerUnit:1, rawNutritionPerUnit:Object.fromEntries(keys.map((key,i)=>[key,food.values[i] === null ? null : food.values[i]/100])),
    nutritionPerUnit:Object.fromEntries(keys.map((key,i)=>[key,(food.values[i] ?? food.estimates[key])/100])),
    estimatedNutrients:Object.keys(food.estimates ?? {}), rawNutritionSource:source, nutritionSource:source,
  }];
}));

const regional = {
  udon:'京都いいとこウェブ「京都あんかけうどん4変化」 https://kyoto.graphic.co.jp/blog/archives/27878',
  taro:'京都市「えびいも」 https://www.city.kyoto.lg.jp/sankan/page/0000029297.html',
  egg:'農林水産省「だし巻き」 https://www.maff.go.jp/j/keikaku/syokubunka/traditional-foods/menu/dasimaki.html',
  roll:'京都市観光協会「名店に学ぶ『京中華』の基礎知識」 https://plus.kyoto.travel/entry/kyoto-chuka',
  tofu:'外務省『にぽにか』第26号「湯豆腐」 https://web-japan.org/niponica/pdf/niponica26/no26_ja.pdf',
  fu:'農林水産省「京麩」 https://www.maff.go.jp/j/keikaku/syokubunka/traditional-foods/menu/kyo_hu.html',
  mizuna:'京都市「水菜とお揚げの炊いたん」 https://kyo-kenko.city.kyoto.lg.jp/recipe/7539/',
  tuna:'キッコーマン「まぐろのとろたく風たたき」 https://www.kikkoman.co.jp/homecook/search/recipe/00056770/',
};
const lunchDinner = ['昼食','夕食'];
const withSupper = ['昼食','夕食','晩酌'];
const allMeals = ['朝食','昼食','夕食','晩酌'];
const period = {朝食:'breakfast', 昼食:'lunch', 夕食:'dinner'};
function dish({id,name,role,family,category,method,minutes,parts,steps,portion,occasions,reference,
  note='',genre='和食',nature='home-cooked',kyoto=true,secondary=[]}) {
  return {
    id, name, role, family, genre, nature, servings:2, minutes, portion,
    staple:role==='staple', mealBase:role==='staple', mealOccasions:[...occasions],
    mealSuitability:occasions.filter(label=>period[label]).map(label=>period[label]),
    displayCategory:category, displayMethod:method, displaySecondaryCategories:secondary,
    tags:role==='staple' ? [] : [...(occasions.includes('晩酌') ? ['晩酌'] : []), ...(minutes<=20 ? ['時短'] : [])],
    ...(kyoto ? {searchAliases:['京都','京料理',...(genre==='中華'?['京都中華']:[])]} : {}),
    ingredients:parts.map(([id,amount])=>({id,amount})), steps,
    ingredientsKnown:true, allergensKnown:true, shoppingKnown:true,
    sourceNote:`材料の可食量から1人分を計算。分量は家庭用の一例です。${note} 参考：${reference}`,
  };
}
const plate = label => ({amount:1,unit:'皿',label});
const sub = {role:'side',family:'small-dish'};
const sashimi = {role:'main',family:'sashimi',category:'fish',method:'sashimi',kyoto:false,occasions:withSupper};
const dishes = [
  dish({id:'kyoto-keiran-udon',name:'鶏卵うどん（けいらんうどん）',role:'staple',family:'udon',category:'grain',method:'boil',
    minutes:20,portion:{amount:1,unit:'杯',label:'丼1杯（ゆでうどん200g・卵1個）'},occasions:lunchDinner,reference:regional.udon,
    parts:[['udon',400],['egg',2],['soup311_awase_dashi',520],['kyoto_usukuchi',18],['mirin',12],['starch',14],['water',28],['ginger',6]],
    note:'麺と卵に加えてとろみのあるつゆをすべて食べた場合の値です。',
    steps:['しょうがをすりおろす。片栗粉は分量の水で溶き、卵は別の器でほぐす。','鍋に合わせだしと薄口しょうゆ、みりんを入れてひと煮立ちさせる。別鍋でうどんを温めて湯を切る。',
      '水溶き片栗粉を混ぜ直し、だしをかき混ぜながら加える。再び沸いてつやが出るまで混ぜる。',
      '卵を細く流し入れてふんわりと固まるのを待つ。温めた麺に卵あんをかけ、しょうがをのせる。']}),
  dish({id:'kyoto-koimo',name:'小芋のたいたん（里いもの炊いたん）',...sub,category:'vegetable',method:'simmer',
    minutes:30,portion:plate('小鉢1つ（皮をむいた小芋約100g）'),occasions:allMeals,reference:regional.taro,
    parts:[['taro',200],['soup311_awase_dashi',160],['kyoto_usukuchi',8],['mirin',10],['sugar',3]],
    note:'普通の里いもを使います。だしで炊き、仕上げに煮汁を煮含める配合です。',
    steps:['小さな里いもの皮をむく。大きいものは小さいいもと同じくらいの大きさにそろえる。',
      '別鍋でいもを軽く下ゆでする。湯を捨ててぬめりを洗い流す。','小鍋にいもとだし、薄口しょうゆ、みりん、砂糖を入れる。落としぶたをして静かに煮る。',
      '竹串がすっと通ったらふたを取り、煮汁が少し残るまで煮詰める。火を止めて味を含ませ、小鉢に盛る。']}),
  dish({id:'kyoto-dashimaki',name:'京風だし巻き',role:'main',family:'egg-main',category:'egg',method:'grill',
    minutes:15,portion:plate('だし巻き半本（卵1個半が目安）'),occasions:allMeals,reference:regional.egg,
    parts:[['egg',3],['soup311_awase_dashi',55],['kyoto_usukuchi',5],['oil',4]],
    note:'砂糖・みりんを加えず、こした合わせだしと薄口しょうゆで焼き上げます。',
    steps:['冷ましただしに薄口しょうゆを混ぜる。卵をほぐし、だしを少しずつ合わせる。',
      '卵焼き器に薄く油を引いて温める。卵液を少し流し、底が固まったところから折り畳んで芯を作る。',
      '芯を端に寄せて油を薄く塗り直す。卵液を足すたびに芯を少し持ち上げて下にも流し、焦がさず巻き重ねる。',
      '中まで火が通ったら巻きすの上で形を整える。少し休ませてから厚めに切る。']}),
  dish({id:'kyoto-egg-spring-roll',name:'京中華の卵春巻き',role:'main',family:'meat-main',genre:'中華',category:'meat',secondary:['egg','vegetable'],method:'fried',
    minutes:35,portion:plate('春巻き2本（薄焼き卵で包む）'),occasions:withSupper,reference:regional.roll,
    parts:[['egg',2],['pork',100],['bamboo_shoot_cooked',50],['shiitake',30],['soy_sauce',8],['ginger',3],['starch',8],['water',20],['oil',18]],
    note:'卵の皮で作る家庭向けの揚げ焼きです。油は炒める分と皮に残る分を合わせて1人約9gで概算します。',
    steps:['たけのことしいたけを細切りにする。豚肉は最後に細く切って野菜とは別にしておく。','油少々で豚肉をほぐしながら炒める。中まで火が通ったら野菜を加え、たけのこの水気を飛ばす。',
      'おろしたしょうがとしょうゆを混ぜる。少量の水で溶いた片栗粉の半量で具をまとめ、皿に広げて冷ます。',
      '残りの水溶き片栗粉の半分を溶き卵に加える。油を薄く引いたフライパンで小さな薄焼き卵を一人につき二枚焼く。',
      '具を薄焼き卵で包む。残った濃い水溶き片栗粉を巻き終わりに付けて留める。',
      '油を広げたフライパンに閉じ目を下にして並べる。そっと返しながら皮を色よく揚げ焼きにし、網で油を切る。']}),
  dish({id:'kyoto-yudofu',name:'京風湯豆腐（昆布だしと薬味）',role:'main',family:'bean-main',category:'bean',method:'hotpot',
    minutes:15,portion:plate('小鍋1つ（絹ごし豆腐150g）'),occasions:withSupper,reference:regional.tofu,
    parts:[['silken_tofu',300],['kyoto_kombu_dashi',140],['soy_sauce',10],['scallion_garnish',8],['ginger',4]],
    note:'絹ごし豆腐だけを少量の昆布だしで温めます。小鍋に取り分けただしと別添えのしょうゆをすべて含みます。',
    steps:['小ねぎを小口切りにして、しょうがをすりおろす。','豆腐は大きめの角切りにする。崩さないように手のひらで支えて鍋に移す。',
      '豆腐がちょうど収まる小さな鍋を使う。豆腐の脇から昆布だしを静かに注ぐ。','ふたをして弱火で温める。角が欠けやすいので豆腐は箸でかき回さない。',
      '表面に小さな泡が出たら煮立てずに火を弱める。豆腐の中心が温まったところで火を止める。',
      '豆腐と少量のだしを取り分ける。しょうゆは別皿に取り、薬味を添えていただく。']}),
  dish({id:'kyoto-namafu-dengaku',name:'生麩の田楽',...sub,category:'grain',method:'grill',
    minutes:15,portion:plate('生麩の田楽2切れ（約50g）'),occasions:withSupper,reference:regional.fu,
    parts:[['kyoto_namafu',100],['miso',14],['sugar',6],['mirin',8],['water',10],['oil',4]],
    steps:['冷やした生麩を厚めに切る。包丁を少しぬらすと刃から外しやすい。',
      '小鍋でみそと砂糖、みりん、水を混ぜる。弱火にかけ、へらの跡が残るまで練る。',
      'フライパンに薄く油を引いて生麩を並べる。両面を返しながら中まで温める。',
      '田楽みそを塗り、トースターで表面をさっと焼く。みそに香ばしい焼き目がついたら取り出す。']}),
  dish({id:'kyoto-namafu-simmered',name:'生麩としいたけの炊き合わせ',...sub,category:'grain',secondary:['mushroom'],method:'simmer',
    minutes:20,portion:plate('小鉢1つ（生麩約40gとしいたけ）'),occasions:withSupper,reference:regional.fu,
    parts:[['kyoto_namafu',80],['shiitake',60],['soup311_awase_dashi',140],['kyoto_usukuchi',7],['mirin',10]],
    steps:['しいたけは石づきを落とし、かさは半分に切る。生麩はぬらした包丁で厚めに切る。',
      '小鍋でだしと薄口しょうゆ、みりんを温める。しいたけを先に入れて落としぶたをする。',
      'しいたけが柔らかくなったら生麩を加える。切り口が崩れないよう弱火で温める。',
      '鍋を火から下ろして少し置く。しいたけと生麩を小鉢に盛り、残っただしをかける。']}),
  dish({id:'kyoto-mizuna-aburaage',name:'水菜とお揚げの炊いたん',...sub,category:'vegetable',secondary:['bean'],method:'simmer',
    minutes:15,portion:plate('小鉢1つ（水菜約60g）'),occasions:allMeals,reference:regional.mizuna,
    parts:[['simmered_mizuna',120],['aburaage',30],['soup311_awase_dashi',130],['kyoto_usukuchi',8],['mirin',8]],
    steps:['水菜は根元を落としてよく洗う。根元に入り込んだ土も落とし、水気を切る。','ひと口で食べやすい長さに切り、茎と葉に分けておく。',
      '油揚げの表面をキッチンペーパーで押さえて細く切る。','小鍋にだしとみりん、薄口しょうゆを合わせて温める。',
      '油揚げを入れて先に煮含める。水菜の茎を加え、少ししんなりしたら葉も入れる。',
      '葉の色が鮮やかなうちに火を止める。油揚げと一緒に取り分けて煮汁を添える。']}),
];
const tunaParts = [['tuna_lean_sashimi',80],['tuna_mediumfat_sashimi',40],['scallion_garnish',6],['soy_sauce',6]];
const tunaSteps = ['小ねぎを小口切りにする。盛り付けに使う器は先に冷やす。',
  '刺身用のまぐろの赤身と中トロは使う直前に冷蔵庫から出し、清潔なまな板で粗く刻む。',
  '包丁で軽くたたき、赤身の粒が少し残るところで止める。小ねぎを合わせる。'];
for (const [id,name,takuan] of [['negitoro','ネギトロ（まぐろのたたき）',false],['torotaku','とろたく（まぐろとたくあんのたたき）',true]]) {
  dishes.push(dish({...sashimi,id:`sashimi-${id}`,name,minutes:10,reference:regional.tuna,
    portion:{amount:60,unit:'g',label:'小鉢1つ（まぐろの可食部60g）'},
    parts:takuan?[...tunaParts,['palette_takuan',16]]:tunaParts,
    steps:[...tunaSteps,takuan?'細かく刻んだたくあんを混ぜる。冷やした器に盛り、しょうゆは別に添える。':'冷やした器にふんわりと盛る。しょうゆは別皿に添え、冷たいうちにいただく。'],
    note:'刺身用まぐろの赤身と脂身を重量比2対1でたたく配合です。ご飯やのりは含みません。市販の油脂入りまぐろたたきは別配合です。'}));
}
for (const [id,label,code] of [['kanpachi','カンパチ','10_10424'],['suzuki','スズキ','10_10188']]) {
  dishes.push(dish({...sashimi,id:`sashimi-${id}`,name:`${label}の刺身`,minutes:5,nature:'ready-to-eat',
    reference:`文部科学省 食品成分データベース ${mextUrl(code)}`,
    portion:{amount:100,unit:'g',label:'魚の可食部100g（しょうゆは別添え）'},
    parts:[[`kyoto_${id}`,200],['soy_sauce',12],['shiso',2]],steps:[]}));
}
export const KYOTO_RECIPES = Object.freeze(dishes);
export const KYOTO_SASHIMI_CHOICES = [
  ['negitoro','ネギトロ','盛り',50], ['torotaku','とろたく','盛り',50],
  ['kanpachi','カンパチ','切れ',12], ['suzuki','スズキ','切れ',10],
].map(([id,label,unit,gramsPerUnit])=>({id,label,unit,gramsPerUnit,recipeId:`sashimi-${id}`,
  defaultAmount:unit==='盛り'?1:3, note:`1${unit}は魚の可食部約${gramsPerUnit}gの目安です。実物の重さに合わせて変更できます。`}));
