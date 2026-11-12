/** 定番の主菜・主食。材料は2人分、portionは食べるときの1人分の基準です。 */
const fish = (name, allergens = [], extra = {}) => ({name,unit:'g',allergens,groups:['protein'],proteinSources:['fish'],...extra});
export const CLASSIC_MAIN_INGREDIENTS = {
  tuna_lean_sashimi: fish('まぐろ赤身（刺身用・可食部）',[],{note:'生食用として販売されたものを使用します。加熱用まぐろとは別に扱います。'}),
  tuna_mediumfat_sashimi: fish('まぐろ中トロ（刺身用・可食部）',[],{note:'脂身を含むまぐろの代表値です。部位や製品によって脂質が大きく変わります。'}),
  salmon_sashimi: fish('サーモン（刺身用・可食部）',['salmon'],{note:'生食用として販売されたものを使用します。栄養は皮なしサーモントラウトの代表値で、加熱用の生ざけとは別に扱います。'}),
  yellowtail_sashimi: fish('ぶり（刺身用・可食部）',[],{note:'生食用の切り身を使用します。季節や脂の量によって栄養値が変わります。'}),
  seabream_sashimi: fish('たい（刺身用・可食部）',[],{note:'生食用の切り身を使用します。'}),
  bonito_sashimi: fish('かつお（刺身用・可食部）',[],{note:'生食用の切り身を使用します。'}),
  horse_mackerel_sashimi: fish('あじ（刺身用・可食部）',[],{note:'生食用として販売された下処理済みのものを使用します。'}),
  squid_sashimi: fish('いか（刺身用・可食部）',['squid'],{note:'生食用として販売された下処理済みのものを使用します。'}),
  scallop_sashimi: fish('ほたて貝柱（刺身用・可食部）',[],{note:'生食用として販売されたものを使用します。'}),
  atka_mackerel_dried: fish('ほっけ（開き干し・可食部）',[],{note:'骨などを除いた可食部の重量です。塩分は製品によって変わります。'}),
  saury: fish('さんま（生・骨と内臓を除いた可食部）'),
  shishamo: fish('ししゃも（からふとししゃも・生干し・全体）',[],{note:'頭や骨を含めて食べる場合の可食量です。栄養はからふとししゃもの生干しの代表値で、魚種や製品によって変わります。'}),
  pork_loin: {name:'豚ロース（脂身付き）',unit:'g',allergens:['pork'],groups:['protein'],proteinSources:['meat'],derivedFrom:['pork']},
  dumpling_wrappers: {name:'餃子・シュウマイの皮（小麦由来）',unit:'g',allergens:['wheat'],groups:['staple'],proteinSources:[],derivedFrom:['flour'],note:'小麦粉と水を主原料とする皮の代表例です。製品の原材料表示も確認してください。'},
};
const dish = (id,name,family,variant,ingredients,steps,extra={}) => {
  const recipe={
    id:`classic-${id}`,name,role:'main',genre:'和食',minutes:20,servings:2,
    ingredients:ingredients.map(([id,amount])=>({id,amount})),steps,
    family,variantLabel:variant,portion:{amount:1,unit:'皿'},staple:false,mealBase:false,
    nature:'home-cooked',allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
    sourceNote:'家庭用の材料と作り方の一例です。基準レシピは2人分です。表示する材料と栄養は選んだ量に合わせています。',
    tags:['定番'],...extra,
  };
  recipe.tags=recipe.role==='staple'?[]:[...new Set([...recipe.tags.filter(tag=>tag!=='時短'),...(recipe.minutes<=20?['時短']:[])])];
  return recipe;
};
const fryChicken = (id,name,variant,meat,seasoning) => dish(id,name,'karaage',variant,
  [[meat,300],['starch',30],['oil',24],...seasoning],[
    '鶏肉を同じくらいの大きさに切り、調味料をもみ込む。',
    '片栗粉を薄くまぶす。フライパンに揚げ焼き用の油を熱し、肉を重ならないように並べる。',
    '両面を返しながら中心まで十分に火を通し、油を切って盛る。'],
  {minutes:25,tags:['定番','ガッツリ'],sourceNote:'栄養計算の油は食べる側へ残る量の目安です。揚げ油の吸収量によって変わります。'});
const KARAAGE = [
  fryChicken('karaage-thigh','鶏もも肉の唐揚げ','もも肉','chicken',[['soy_sauce',18],['sake',14],['ginger',8],['garlic',4]]),
  fryChicken('karaage-breast','鶏むね肉の唐揚げ','むね肉','chicken_breast',[['soy_sauce',18],['sake',14],['ginger',8],['sugar',2]]),
  fryChicken('karaage-salt','鶏むね肉の塩唐揚げ','塩味','chicken_breast',[['salt',2],['sake',16],['garlic',4],['lemon',10]]),
];
const grilledFish = (id,name,variant,ingredient,grams,salt=1) => dish(id,name,'grilled-fish',variant,
  [[ingredient,grams],...(salt>0?[['salt',salt]]:[]),['daikon',80],['lemon',8]],[
    '魚の水気を拭く。無塩の魚には分量の塩を振り、干物は表示に合わせて準備する。',
    'グリルまたは魚焼き用のフライパンで、厚みに合わせて返しながら中心まで焼く。',
    '大根おろしとレモン汁を添える。骨などを取り除き、食べられる部分を記録する。'],
  {tags:['定番'],sourceNote:['材料の魚は食べる可食部の調理前重量を基準にした概算です。盛り付けは1人1皿です。',CLASSIC_MAIN_INGREDIENTS[ingredient]?.note].filter(Boolean).join(' ')});
const GRILLED_FISH = [
  grilledFish('grilled-salmon','鮭の塩焼き','鮭','salmon',200),
  grilledFish('grilled-mackerel','さばの塩焼き','さば','mackerel',200),
  grilledFish('grilled-hokke','ほっけの開き焼き','ほっけ','atka_mackerel_dried',200,0),
  grilledFish('grilled-aji','あじの塩焼き','あじ','horse_mackerel',200),
  grilledFish('grilled-saury','さんまの塩焼き','さんま','saury',200),
  grilledFish('grilled-shishamo','ししゃもの焼き物','ししゃも','shishamo',160,0),
];
const sashimi = (id,name,variant,ingredient) => dish(id,name,'sashimi',variant,[[ingredient,200],['soy_sauce',12],['shiso',2]],[
  '刺身用・生食用として販売された魚介を用意する。実物の保存方法や期限を確認する。',
  '清潔な器具で食べやすい大きさに切る。切り身の商品は器に盛る。',
  '青じそとしょうゆを添える。食べた魚介の量を可食部のg数として記録する。'],
  {minutes:5,nature:'ready-to-eat',sourceNote:['刺身用の魚介の可食部と、別添えのしょうゆから求めた栄養の目安です。',CLASSIC_MAIN_INGREDIENTS[ingredient]?.note].filter(Boolean).join(' '),portion:{amount:100,unit:'g',label:'1人分＝魚介の可食部100g（しょうゆは別添えの目安）'},tags:['定番','さっぱり','時短']});
const SASHIMI = [
  sashimi('sashimi-tuna','まぐろ赤身の刺身','まぐろ赤身','tuna_lean_sashimi'),
  sashimi('sashimi-tuna-mediumfat','まぐろ中トロの刺身','まぐろ中トロ','tuna_mediumfat_sashimi'),
  sashimi('sashimi-salmon','サーモンの刺身','サーモン','salmon_sashimi'),
  sashimi('sashimi-yellowtail','ぶりの刺身','ぶり','yellowtail_sashimi'),
  sashimi('sashimi-seabream','たいの刺身','たい','seabream_sashimi'),
  sashimi('sashimi-bonito','かつおの刺身','かつお','bonito_sashimi'),
  sashimi('sashimi-aji','あじの刺身','あじ','horse_mackerel_sashimi'),
  sashimi('sashimi-squid','いかの刺身','いか','squid_sashimi'),
  sashimi('sashimi-octopus','ゆでだこの刺身','ゆでだこ','octopus'),
  sashimi('sashimi-scallop','ほたての刺身','ほたて','scallop_sashimi'),
  dish('sashimi-assorted','刺身の盛り合わせ','sashimi','盛り合わせ',[
    ['tuna_lean_sashimi',80],['salmon_sashimi',80],['seabream_sashimi',40],['soy_sauce',12],['shiso',2]],[
    '刺身用・生食用として販売された魚を用意し、実物の保存方法や期限を確認する。',
    '清潔な器具で切り分け、魚の種類が分かるように盛る。',
    '青じそとしょうゆを添える。魚の合計可食量をg数で記録する。'],
    {minutes:7,nature:'ready-to-eat',portion:{amount:100,unit:'g',label:'1人分＝魚介の合計可食部100g'},tags:['定番','さっぱり','時短']}),
];
const omelette=(id,name,variant,extraParts=[])=>dish(id,name,'egg-main',variant,[['egg',4],['milk',30],['butter',8],['salt',0.5],...extraParts],[
  '卵と牛乳、塩をよく混ぜる。追加の具材は食べやすく切り、必要なものは先に加熱する。',
  'フライパンでバターを溶かし、卵液を流して混ぜながら形を整える。',
  '火を弱めて中まで火を通し、人数分に分けて盛る。'],{genre:'洋食',minutes:12,tags:['定番','時短']});
const EGGS = [
  omelette('omelette-plain','プレーンオムレツ','プレーン'),
  omelette('omelette-cheese','チーズオムレツ','チーズ',[['cheese',30]]),
  omelette('omelette-spinach','ほうれん草のオムレツ','ほうれん草',[['spinach',100]]),
  omelette('omelette-bacon','ベーコンオムレツ','ベーコン',[['bacon',40],['onion',40]]),
  dish('tamagoyaki','卵焼き','egg-main','卵焼き',[['egg',4],['sugar',8],['soy_sauce',6],['oil',8]],[
    '卵を溶き、砂糖としょうゆを混ぜる。',
    '卵焼き器を温めて油を薄く引き、卵液を少量ずつ流して巻く。',
    '残りの卵液も同じように巻き、中心まで加熱してから切り分ける。'],{minutes:12,portion:{amount:1,unit:'皿',label:'1人分＝卵2個分の卵焼きを盛った小皿'},tags:['定番','時短']}),
  dish('dashimaki','だし巻き卵','egg-main','だし巻き',[['egg',4],['water',50],['bonito',2],['soy_sauce',5],['mirin',8],['oil',8]],[
    '湯でかつお節を煮出してこし、だしを冷ます。卵とだし、しょうゆ、みりんを合わせる。',
    '卵焼き器に油を引き、卵液を少量ずつ流して巻く。',
    '中心まで火を通し、形を落ち着かせてから人数分に切り分ける。'],{minutes:18,portion:{amount:1,unit:'皿',label:'1人分＝卵2個分のだし巻きを盛った小皿'},tags:['定番','時短']}),
  dish('boiled-egg','ゆで卵','egg-main','ゆで卵',[['egg',2]],[
    '卵を鍋に入れ、卵が隠れるくらいの水を注いで加熱する。',
    '沸騰後は火を調整し、黄身まで固まるようにゆでる。',
    '冷水に取って殻をむく。食べた個数を記録し、塩などを付けた場合は別に加える。'],{minutes:15,portion:{amount:1,unit:'個'},tags:['定番','時短']}),
  dish('fried-egg','目玉焼き','egg-main','目玉焼き',[['egg',2],['oil',4],['salt',0.4]],[
    'フライパンを温めて油を引き、卵を割り入れる。',
    '弱火にしてふたをし、白身と黄身に火が通るまで加熱する。',
    '塩を振って器へ移し、人数分に分ける。'],{minutes:8,portion:{amount:1,unit:'個'},tags:['定番','時短']}),
  dish('scrambled-egg','スクランブルエッグ','egg-main','スクランブル',[['egg',4],['milk',40],['butter',8],['salt',0.5]],[
    '卵を溶き、牛乳と塩を加えて混ぜる。',
    'フライパンでバターを溶かし、卵液を入れてゆっくり大きく混ぜる。',
    '全体に火を通し、炒り卵の状態で人数分に盛る。'],{genre:'洋食',minutes:10,tags:['定番','時短']}),
  dish('natto-plain','納豆','bean-main','納豆',[['natto',90],['soy_sauce',6],['scallion_garnish',4]],[
    '納豆を人数分の器へ移す。添付のたれを使う場合は表示を確認する。',
    '納豆を混ぜ、小口切りの小ねぎを加える。',
    'このレシピではしょうゆで味を付ける。実際に使った調味料に合わせて量を調整する。'],{minutes:3,nature:'ready-to-eat',portion:{amount:1,unit:'皿',label:'1人分＝納豆45gとしょうゆ3mlの小皿'},tags:['定番','時短']}),
  dish('natto-grated-daikon','おろし納豆','bean-main','大根おろし',[['natto',90],['daikon',80],['soy_sauce',6],['shiso',2]],[
    '大根をおろして軽く汁気を切り、青じそを刻む。',
    '納豆を混ぜ、しょうゆを合わせる。',
    '大根おろしと青じそをのせ、人数分に分ける。'],{minutes:7,nature:'ready-to-eat',tags:['定番','さっぱり','時短']}),
];
const OMELETTE_RICE = [
  dish('omelette-rice-cheese','チーズオムライス','omelette-rice','チーズ',[['rice',350],['chicken',100],['onion',80],['tomato_paste',30],['sugar',5],['worcestershire_sauce',8],['egg',4],['milk',20],['cheese',30],['oil',10]],[
    '玉ねぎと鶏肉を小さく切り、油半量で炒めて肉の中心まで火を通す。',
    'ご飯、トマトペースト、砂糖、ウスターソースを加えて炒める。',
    '残りの油で卵と牛乳、チーズを焼いて火を通し、人数分のチキンライスにのせる。'],{role:'staple',staple:true,mealBase:true,genre:'洋食',minutes:25,tags:['定番','ガッツリ']}),
  dish('omelette-rice-mushroom','きのこのホワイトソースオムライス','omelette-rice','きのこクリーム',[['rice',350],['chicken_breast',100],['onion',80],['mushroom',80],['egg',4],['milk',160],['flour',10],['butter',12],['salt',1]],[
    '鶏肉と玉ねぎを細かく切ってバター半量で炒め、肉の中心まで火が通ったらご飯を混ぜる。',
    '残りのバターできのこを炒め、薄力粉と牛乳を少しずつ加えてソースにする。塩で調える。',
    '別のフライパンで卵を人数分焼いて火を通し、ライスにのせてソースをかける。'],{role:'staple',staple:true,mealBase:true,genre:'洋食',minutes:30,tags:['定番']}),
  dish('omelette-rice-tomato','トマトソースのオムライス','omelette-rice','トマトソース',[['rice',350],['chicken',100],['onion',80],['egg',4],['canned_tomato',200],['tomato_paste',20],['olive_oil',12],['salt',1],['sugar',4]],[
    '鶏肉と玉ねぎを細かく切って油半量で炒め、肉に火を通してご飯とトマトペーストを合わせる。',
    'トマト缶、塩、砂糖を鍋で軽く煮詰め、トマトソースを作る。',
    '残りの油で卵を人数分焼き、中まで火を通してライスにのせ、ソースをかける。'],{role:'staple',staple:true,mealBase:true,genre:'洋食',minutes:25,tags:['定番']}),
];
const sushiRice=[['rice',360],['vinegar',24],['sugar',10],['salt',1]];
// 単種握りは1貫を基準にする。servings=2なので材料欄は2貫分です。
const nigiri=(id,name,variant,fishParts)=>dish(id,name,'sushi',variant,[...sushiRice.map(([id,amount])=>[id,amount/8]),...fishParts.map(([id,amount])=>[id,amount/8]),['soy_sauce',1]],[
  '温かいご飯に米酢、砂糖、塩を合わせ、混ぜて冷ます。作る貫数に合わせて小さく分ける。',
  '生の魚は必ず刺身用を使う。えびなど加熱用の具は十分加熱し、冷ましてから用意する。',
  '清潔な手や器具で酢飯と具を合わせ、しょうゆを添える。実際に食べた貫数で記録する。'],
  {role:'staple',staple:true,mealBase:true,portion:{amount:1,unit:'貫',label:'単種の握り1貫（ご飯約22.5g）'},minutes:25,tags:['定番'],sourceNote:['単種の握り1貫を基準にした目安です。基準レシピは2貫分です。画面の材料と栄養は選んだ貫数に合わせて換算しています。市販・外食の大きさや配合とは異なります。',...fishParts.map(([id])=>CLASSIC_MAIN_INGREDIENTS[id]?.note)].filter(Boolean).join(' ')});
const SUSHI = [
  dish('sushi-assorted','にぎり寿司の盛り合わせ','sushi','にぎり盛り合わせ',[...sushiRice,['tuna_lean_sashimi',80],['salmon_sashimi',80],['shrimp',40],['soy_sauce',8]],[
    '温かいご飯に米酢、砂糖、塩を合わせ、混ぜて冷ます。',
    'まぐろとサーモンは刺身用を使う。えびは十分加熱して冷まし、清潔な器具でネタを準備する。',
    '酢飯とネタを合わせ、種類を取り混ぜて皿へ盛り、しょうゆを添える。'],
    {role:'staple',staple:true,mealBase:true,portion:{amount:1,unit:'皿',label:'1皿＝約8貫の盛り合わせ'},minutes:25,tags:['定番'],sourceNote:'まぐろ、サーモン、えびを合わせた約8貫で1皿の目安です。単種の握りは別メニューで1貫ずつ記録できます。サーモンの栄養は皮なしサーモントラウトの代表値です。'}),
  nigiri('sushi-tuna','まぐろのにぎり寿司','まぐろ',[['tuna_lean_sashimi',200]]),
  nigiri('sushi-salmon','サーモンのにぎり寿司','サーモン',[['salmon_sashimi',200]]),
  nigiri('sushi-shrimp','えびのにぎり寿司','えび',[['shrimp',200]]),
  nigiri('sushi-squid','いかのにぎり寿司','いか',[['squid_sashimi',200]]),
  dish('sushi-roll','卵ときゅうりの巻き寿司','sushi','巻き寿司',[...sushiRice,['egg',2],['cucumber',100],['nori',6],['oil',4]],[
    'ご飯に米酢、砂糖、塩を混ぜて酢飯を作る。卵は薄く焼いて十分火を通し、きゅうりと細長く切る。',
    '巻きすに海苔を置き、酢飯を薄く広げて卵ときゅうりをのせる。',
    '手前から巻いて形を整え、食べやすく切る。食べた量を皿数で記録する。'],{role:'staple',staple:true,mealBase:true,minutes:30,tags:['定番']}),
  dish('sushi-inari','いなり寿司','sushi','いなり',[...sushiRice,['aburaage',120],['soy_sauce',18],['mirin',20],['water',100]],[
    '油揚げは油抜きして袋状に開き、しょうゆ、みりん、水で煮て味を含ませる。',
    '温かいご飯に米酢、砂糖、塩を混ぜて酢飯を作り、粗熱を取る。',
    '油揚げに酢飯を詰め、人数分に分けて盛る。'],{role:'staple',staple:true,mealBase:true,portion:{amount:3,unit:'個'},minutes:30,tags:['定番']}),
  dish('sushi-chirashi','海鮮ちらし寿司','sushi','ちらし',[...sushiRice,['tuna_lean_sashimi',80],['salmon_sashimi',80],['cucumber',80],['egg',2],['nori',2],['oil',4]],[
    'ご飯に米酢、砂糖、塩を混ぜて酢飯を作り、粗熱を取る。',
    '卵を薄く焼いて十分火を通し、細く切る。刺身用の魚ときゅうりは食べやすく切る。',
    '酢飯を器に盛り、魚、きゅうり、卵、海苔を彩りよくのせる。'],{role:'staple',staple:true,mealBase:true,minutes:25,tags:['定番']}),
];
const crumbCoating=[['flour',16],['egg',1],['breadcrumbs',35],['oil',24]];
const cutlet=(id,name,variant,baseParts,prep,minutes=30)=>dish(id,name,'cutlet',variant,[...baseParts,...crumbCoating],[
  prep,
  '具を整え、薄力粉、溶き卵、パン粉の順に衣を付ける。',
  '油で揚げるか揚げ焼きにし、中心まで十分に火を通して油を切る。'],
  {minutes,tags:['定番','ガッツリ'],sourceNote:'栄養計算の油は衣などへ残る量の目安です。実際の吸収量で変わります。'});
const CUTLETS = [
  cutlet('croquette-potato','じゃがいものコロッケ','じゃがいもコロッケ',[['potato',350],['onion',80],['beef_minced',60],['salt',1]],'じゃがいもをやわらかくしてつぶす。玉ねぎとひき肉を炒めて肉に火を通し、塩と一緒に混ぜて冷ます。'),
  cutlet('croquette-pumpkin','かぼちゃのコロッケ','かぼちゃコロッケ',[['pumpkin',350],['onion',60],['butter',8],['salt',0.8]],'かぼちゃをやわらかくしてつぶし、バターで炒めた玉ねぎと塩を混ぜて冷ます。'),
  cutlet('croquette-cream','コーンクリームコロッケ','クリームコロッケ',[['milk',250],['corn',80],['onion',60],['butter',20],['starch',25],['salt',0.8]],'バターで玉ねぎを炒め、牛乳で溶いた片栗粉とコーン、塩を加えて十分加熱する。とろみが付いたら平たく広げ、冷やして固める。',75),
  cutlet('menchi','メンチカツ','メンチカツ',[['beef_minced',150],['pork_minced',150],['onion',80],['salt',1]],'玉ねぎを細かく刻み、ひき肉と塩をよく練り合わせて、薄めの小判形にまとめる。'),
  cutlet('tonkatsu','とんかつ','とんかつ',[['pork_loin',240],['salt',0.8]],'豚ロースの筋を切り、厚みを整えて塩を振る。'),
  cutlet('chicken-katsu','チキンカツ','チキンカツ',[['chicken_breast',300],['salt',0.8]],'鶏むね肉を開いて均一な厚みにし、塩を振る。'),
  cutlet('aji-fry','アジフライ','アジフライ',[['horse_mackerel',240],['salt',0.8]],'あじの小骨などを確認して水気を拭き、塩を振る。'),
];
const FAMILIAR_MAINS = [
  dish('hamburg','合いびきハンバーグ','meat-main','ハンバーグ',[['beef_minced',150],['pork_minced',150],['onion',100],['egg',1],['breadcrumbs',20],['milk',30],['oil',8],['tomato_paste',20],['worcestershire_sauce',16],['water',40]],[
    '玉ねぎを細かく刻み、ひき肉、卵、牛乳で湿らせたパン粉とよく練る。',
    '小判形にまとめ、油を引いたフライパンで両面を焼き、ふたをして中心まで十分に火を通す。',
    '肉を取り出し、トマトペースト、ウスターソース、水を煮立ててソースにし、かける。'],{genre:'洋食',minutes:30,tags:['定番','ガッツリ']}),
  dish('chicken-nanban','チキン南蛮','meat-main','チキン南蛮',[['chicken_breast',300],['egg',2],['flour',20],['oil',20],['vinegar',20],['soy_sauce',16],['sugar',12],['mayonnaise',25],['onion',30]],[
    '卵の半量を固ゆでにして刻み、刻み玉ねぎとマヨネーズを合わせてタルタルソースにする。',
    '鶏肉に薄力粉と残りの溶き卵を付け、油で揚げ焼きにして中心まで火を通す。',
    '米酢、しょうゆ、砂糖を煮立てた甘酢に肉を絡め、タルタルソースを添える。'],{minutes:30,tags:['定番','ガッツリ']}),
  dish('meatballs-teriyaki','肉団子の照り煮','meat-main','肉団子',[['pork_minced',280],['onion',80],['starch',16],['oil',8],['soy_sauce',18],['mirin',18],['sugar',6],['water',100]],[
    '玉ねぎを細かく刻み、ひき肉と片栗粉をよく練り、食べやすい団子にする。',
    'フライパンに油を熱し、肉団子の表面を焼いて水を加え、ふたをして中心まで火を通す。',
    'しょうゆ、みりん、砂糖を加えて煮詰め、全体に照りを付ける。'],{minutes:25,tags:['定番']}),
  dish('gyoza','焼き餃子','meat-main','餃子',[['pork_minced',180],['cabbage',160],['chive',40],['dumpling_wrappers',120],['soy_sauce',10],['ginger',6],['sesame_oil',8],['water',80]],[
    'キャベツとにら、しょうがを細かく刻み、ひき肉としょうゆをよく練り合わせる。',
    '皮に具を少量ずつ包み、ごま油を引いたフライパンへ並べる。',
    '水を注いでふたをし、具の中心まで十分に火を通す。ふたを取り、水分を飛ばして焼き目を付ける。'],{genre:'中華',minutes:35,tags:['定番']}),
  dish('shumai','蒸しシュウマイ','meat-main','シュウマイ',[['pork_minced',220],['onion',120],['starch',16],['dumpling_wrappers',80],['soy_sauce',10],['sesame_oil',6],['sugar',4]],[
    '玉ねぎを細かく刻み、ひき肉、片栗粉、しょうゆ、ごま油、砂糖とよく練る。',
    '皮に具をのせ、形を整えてクッキングシートを敷いた蒸し器へ並べる。',
    '蒸気の上がった蒸し器で具の中心まで十分に火を通し、人数分に盛る。'],{genre:'中華',minutes:30,tags:['定番']}),
];
const VARIETY_MAINS = [
  dish('chicken-plum-shiso','鶏むね肉の梅しそ焼き','meat-main','鶏むね肉の梅しそ焼き',[['chicken_breast',300],['ume',20],['shiso',4],['sake',15],['starch',12],['oil',10]],[
    '鶏むね肉を薄めに切り、清酒をもみ込んで片栗粉をまぶす。梅干しは種を除いてたたく。',
    'フライパンに油を熱し、鶏肉を両面焼いて中心まで火を通す。',
    '梅と刻んだ青じそを加えて短く絡め、人数分に盛る。'],{minutes:20,tags:['さっぱり','時短']}),
  dish('chicken-negi-salt','鶏肉と長ねぎの塩炒め','meat-main','鶏肉と長ねぎの塩炒め',[['chicken',280],['negi',160],['sesame_oil',10],['sake',16],['salt',1.5],['lemon',10]],[
    '鶏肉を食べやすく、長ねぎを斜めに切る。',
    'ごま油で鶏肉を炒め、中心まで火を通してから長ねぎと清酒を加える。',
    '塩とレモン汁で味を整え、ねぎがやわらかくなったら盛る。'],{minutes:20,tags:['時短']}),
  dish('pork-mushroom-steam','豚肉ときのこのしょうが蒸し','meat-main','豚肉ときのこのしょうが蒸し',[['pork',250],['shimeji',120],['enoki',100],['ginger',10],['sake',20],['soy_sauce',14],['vinegar',10],['water',50]],[
    'きのこをほぐし、しょうがを細く切り、豚肉は大きければ切る。',
    'フライパンにきのこと豚肉を重ね、水と清酒を加えてふたをし、肉の中心まで蒸す。',
    'しょうゆと米酢を加えて全体をなじませ、人数分に盛る。'],{minutes:20,tags:['さっぱり','時短']}),
  dish('beef-tofu-sukini','牛肉と豆腐のすき煮','meat-main','牛肉と豆腐のすき煮',[['beef',220],['tofu',200],['onion',100],['negi',100],['soy_sauce',24],['mirin',24],['sugar',8],['water',150]],[
    '豆腐と野菜を食べやすく切る。しょうゆ、みりん、砂糖、水を鍋に合わせる。',
    '煮立ったら牛肉を入れて火を通し、豆腐と野菜を加えて煮る。',
    '野菜がやわらかくなったら煮汁を絡め、人数分に取り分ける。'],{minutes:25,tags:['定番']}),
  dish('pork-potato-curry','豚肉とじゃがいものカレー炒め','meat-main','豚肉とじゃがいものカレー炒め',[['pork',240],['potato',220],['onion',80],['oil',12],['curry_powder',5],['soy_sauce',14],['mirin',10]],[
    'じゃがいもを細めに切って下ゆでし、玉ねぎと豚肉も食べやすく切る。',
    'フライパンの油で豚肉を炒めて中心まで火を通し、野菜を加える。',
    'カレー粉、しょうゆ、みりんを加えて炒め合わせ、人数分に盛る。'],{minutes:25,tags:['ガッツリ']}),
  dish('chicken-lotus-sweet-sour','鶏肉とれんこんの甘酢炒め','meat-main','鶏肉とれんこんの甘酢炒め',[['chicken',260],['lotus_root',180],['carrot',60],['starch',16],['oil',14],['vinegar',22],['soy_sauce',18],['sugar',10],['water',50]],[
    'れんこんとにんじんを薄く切り、鶏肉は一口大にして片栗粉をまぶす。',
    'フライパンに油を熱し、鶏肉を十分加熱してから野菜を加えて炒める。',
    '米酢、しょうゆ、砂糖、水を加え、とろみが付くまで煮絡める。'],{minutes:30,tags:['ガッツリ']}),
  dish('pork-cabbage-millefeuille','豚肉と白菜の重ね蒸し','meat-main','豚肉と白菜の重ね蒸し',[['pork',240],['chinese_cabbage',350],['ginger',8],['sake',25],['soy_sauce',14],['vinegar',14],['water',100]],[
    '白菜と豚肉を交互に重ね、食べやすい幅に切って鍋へ並べる。',
    '細切りしょうが、清酒、水を加え、ふたをして豚肉の中心まで火を通す。',
    'しょうゆと米酢を合わせて添え、人数分に取り分ける。'],{minutes:25,tags:['さっぱり']}),
  dish('koya-egg-simmer','高野豆腐の卵とじ','bean-main','高野豆腐の卵とじ',[['tofu_dried',40],['egg',2],['carrot',80],['shiitake',60],['soy_sauce',18],['mirin',18],['water',300],['bonito',3]],[
    'かつお節でだしを取り、高野豆腐は表示に合わせて戻して食べやすく切る。',
    'だしにしょうゆとみりん、にんじん、しいたけ、高野豆腐を入れて煮る。',
    '野菜がやわらかくなったら溶き卵を回し入れ、卵全体に火を通して盛る。'],{minutes:25,tags:[]}),
  dish('tofu-negi-miso','豆腐のねぎみそ田楽','bean-main','豆腐のねぎみそ田楽',[['tofu',400],['miso',24],['mirin',16],['sugar',6],['negi',60],['oil',8]],[
    '豆腐を厚めに切って水気を切り、長ねぎを細かく刻む。',
    'みそ、みりん、砂糖、ねぎを小鍋で温めて練り、たれを作る。',
    'フライパンに油を引いて豆腐を両面焼き、ねぎみそをのせる。'],{minutes:20,tags:['時短']}),
  dish('salmon-potato-miso-butter','鮭とじゃがいものみそバター焼き','fish-main','鮭とじゃがいものみそバター焼き',[['salmon',240],['potato',200],['onion',80],['butter',12],['miso',18],['mirin',15],['water',60]],[
    'じゃがいもを薄切りにして下ゆでし、鮭と玉ねぎを食べやすく切る。',
    'フライパンでバターを溶かし、鮭と野菜を並べて水を加え、ふたをして中心まで火を通す。',
    'みそとみりんを溶いて加え、全体に絡めて盛る。'],{minutes:25,tags:[]}),
  dish('cod-komatsuna-ginger','たらと小松菜のしょうが煮','fish-main','たらと小松菜のしょうが煮',[['cod',260],['komatsuna',200],['ginger',10],['soy_sauce',16],['mirin',16],['sake',20],['water',150]],[
    'たらの水気を拭いて食べやすく切り、小松菜としょうがも切る。',
    '鍋に調味料と水、しょうがを煮立て、たらを加えて中心まで火を通す。',
    '小松菜を加えてしんなりするまで煮て、煮汁と一緒に盛る。'],{minutes:20,tags:['さっぱり','時短']}),
  dish('mackerel-daikon-vinegar','さばと大根の甘酢煮','fish-main','さばと大根の甘酢煮',[['mackerel',240],['daikon',240],['ginger',10],['vinegar',30],['soy_sauce',18],['sugar',12],['water',200]],[
    'さばを食べやすく切り、大根を薄めのいちょう切り、しょうがを薄切りにする。',
    '鍋に水と調味料、しょうがを煮立て、さばと大根を入れる。',
    '魚の中心まで火を通し、大根がやわらかくなるまで煮て盛る。'],{minutes:30,tags:['さっぱり']}),
  dish('shrimp-tofu-dumpling','えびと豆腐の蒸し団子','fish-main','えびと豆腐の蒸し団子',[['shrimp',180],['tofu',200],['negi',40],['starch',20],['ginger',6],['salt',1],['soy_sauce',8]],[
    '豆腐の水気を切る。えびを細かくたたき、ねぎとしょうがを刻む。',
    '豆腐、えび、香味野菜、片栗粉、塩をよく混ぜて小さな団子にする。',
    '蒸気の上がった蒸し器で中心まで十分に加熱し、しょうゆを添える。'],{minutes:30,tags:[]}),
  dish('squid-cabbage-ginger','いかとキャベツのしょうが炒め','fish-main','いかとキャベツのしょうが炒め',[['squid',250],['cabbage',220],['carrot',60],['ginger',10],['oil',12],['soy_sauce',16],['sake',16]],[
    'いかと野菜を食べやすく切り、しょうがを細切りにする。',
    '油を熱したフライパンでいかを中心まで加熱し、野菜としょうがを加える。',
    'しょうゆと清酒を加えて炒め合わせ、野菜がしんなりしたら盛る。'],{minutes:20,tags:['時短']}),
  dish('pork-vermicelli','豚ひき肉と春雨の炒め煮','meat-main','豚ひき肉と春雨の炒め煮',[['pork_minced',200],['mung_vermicelli',60],['carrot',60],['negi',80],['ginger',8],['sesame_oil',10],['soy_sauce',18],['miso',10],['water',250]],[
    '春雨を表示に合わせて戻し、にんじんと長ねぎ、しょうがを切る。',
    'ごま油でひき肉を十分加熱し、野菜としょうがを加えて炒める。',
    '水、しょうゆ、みそ、春雨を加え、煮汁を吸わせながら煮て盛る。'],{genre:'中華',minutes:25,tags:[]}),
  dish('beef-pepper-tomato','牛肉とピーマンのトマト炒め','meat-main','牛肉とピーマンのトマト炒め',[['beef',240],['pepper',120],['tomato',180],['garlic',4],['olive_oil',12],['soy_sauce',12],['salt',0.5]],[
    '牛肉とピーマン、トマトを食べやすく切り、にんにくを刻む。',
    'オリーブ油でにんにくを温め、牛肉を加えて中心まで火を通す。',
    'ピーマンとトマトを加えて炒め、しょうゆと塩で調える。'],{genre:'洋食',minutes:20,tags:['時短']}),
  dish('chicken-pumpkin-sesame','鶏肉とかぼちゃのごま照り焼き','meat-main','鶏肉とかぼちゃのごま照り焼き',[['chicken',260],['pumpkin',240],['oil',10],['soy_sauce',18],['mirin',18],['sugar',5],['sesame',8]],[
    'かぼちゃを薄切りにして下ゆでし、鶏肉を一口大に切る。',
    'フライパンに油を熱し、鶏肉を両面焼いて中心まで火を通す。かぼちゃを加える。',
    'しょうゆ、みりん、砂糖を加えて煮絡め、ごまを振る。'],{minutes:25,tags:['ガッツリ']}),
  dish('chicken-okara-lotus','おからとれんこんの鶏つくね','meat-main','おからとれんこんの鶏つくね',[['chicken_minced',220],['okara',100],['lotus_root',100],['egg',1],['starch',15],['oil',10],['soy_sauce',18],['mirin',18],['sugar',5]],[
    'れんこんを細かく刻み、ひき肉、おから、卵、片栗粉とよく練る。',
    '平たい小判形にして油を引いたフライパンで両面を焼き、中心まで十分に火を通す。',
    'しょうゆ、みりん、砂糖を加えて照りを付け、人数分に盛る。'],{minutes:30,tags:[]}),
  dish('pork-nira-chijimi','豚肉とにらの米粉チヂミ','meat-main','豚肉とにらの米粉チヂミ',[['pork',180],['chive',100],['onion',60],['rice_flour',100],['egg',1],['water',130],['sesame_oil',16],['soy_sauce',16],['vinegar',16]],[
    '豚肉とにら、玉ねぎを細かく切り、米粉、卵、水と合わせて生地にする。',
    'ごま油を引いたフライパンに薄く広げ、両面を焼いて豚肉の中心まで十分に火を通す。',
    '食べやすく切り分け、しょうゆと米酢を合わせたたれを添える。'],{genre:'エスニック',minutes:25,tags:['ガッツリ']}),
  dish('natto-yam-pan-fry','納豆と長いものふんわり焼き','bean-main','納豆と長いものふんわり焼き',[['natto',90],['yam',180],['egg',2],['rice_flour',35],['scallion_garnish',10],['oil',10],['soy_sauce',12]],[
    '長いもをすりおろし、納豆、卵、米粉、刻んだ小ねぎを混ぜる。',
    '油を引いたフライパンに小さく落とし、両面を焼いて卵全体に火を通す。',
    'しょうゆを添え、人数分に取り分ける。'],{minutes:20,tags:['時短']}),
];
export const CLASSIC_MAIN_RECIPES = [...KARAAGE,...GRILLED_FISH,...SASHIMI,...EGGS,...OMELETTE_RICE,...SUSHI,...CUTLETS,...FAMILIAR_MAINS,...VARIETY_MAINS];
