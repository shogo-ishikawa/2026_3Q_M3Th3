/** 外食でも見かける一般料理を家庭向けに構成した例。材料は2人分、portionは1人分です。 */
export const FAMILIAR_MAIN_INGREDIENTS = {
  flounder:{name:'かれい（生・骨を除く可食部）',unit:'g',allergens:[],groups:['protein'],proteinSources:['fish'],note:'まがれいの可食部を代表値にしています。切り身の骨は食べる量に含めません。'},
  yellowtail:{name:'ぶり（加熱用・生・可食部）',unit:'g',allergens:[],groups:['protein'],proteinSources:['fish'],note:'刺身用とは別の加熱用材料です。'},
  beef_stew_cut:{name:'牛肩ロース（かたまり・脂身付き・生）',unit:'g',allergens:['beef'],groups:['protein'],proteinSources:['meat'],derivedFrom:['beef'],note:'煮込み用のかたまり肉。既存の牛薄切り肉と形状を分けています。'},
  pork_belly:{name:'豚ばら肉（かたまり・脂身付き・生）',unit:'g',allergens:['pork'],groups:['protein'],proteinSources:['meat'],derivedFrom:['pork'],note:'角煮などに使うかたまり肉です。'},
  shirataki:{name:'しらたき（無調味）',unit:'g',allergens:[],groups:[],proteinSources:[],note:'水を切った重量です。表示に合わせて下ゆでします。'},
};
const recipe=(id,name,category,method,family,ingredients,steps,extra={})=>{
  const combined=new Map();for(const [id,amount] of ingredients)combined.set(id,(combined.get(id)??0)+amount);
  const r={id:`familiar-${id}`,name,role:'main',genre:'和食',minutes:25,servings:2,ingredients:[...combined].map(([id,amount])=>({id,amount})),steps,
    staple:false,mealBase:false,family,variantLabel:name,portion:{amount:1,unit:'皿'},nature:'home-cooked',allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
    sourceNote:'一般的な料理名を参考にした家庭向けの一例です。店舗の商品や栄養値を再現したものではありません。栄養は材料から求めた目安です。',
    displayCategory:category,displayMethod:method,displaySecondaryCategories:[],tags:['定番'],...extra};
  r.tags=r.role==='staple'?[]:[...new Set([...r.tags.filter(tag=>tag!=='時短'),...(r.minutes<=20?['時短']:[])])];return r;
};
const meuniere=(id,name,fish)=>recipe(id,name,'fish','meuniere','fish-main',[[fish,260],['flour',18],['butter',20],['oil',6],['salt',1],['lemon',12],['parsley',2]],[
  '魚の水気を拭いて塩を振り、薄力粉を全体へ薄くまぶす。',
  'フライパンで油とバター半量を温め、魚を両面焼いて中心まで火を通す。',
  '残りのバターとレモン汁を加えて魚に絡め、パセリを振って盛る。'],{genre:'洋食',minutes:20});
const coating=[['flour',18],['egg',1],['breadcrumbs',35],['oil',24]];
const breadedFish=(id,name,fish,grams)=>recipe(id,name,'fish','cutlet','cutlet',[[fish,grams],['salt',0.8],...coating],[
  '魚介を下処理して水気を拭く。えびは背わたを取り、いかや魚は食べやすく切る。',
  '塩を振り、薄力粉、溶き卵、パン粉の順に衣を付ける。',
  '油で揚げるか揚げ焼きにして中心まで十分に火を通し、油を切って盛る。'],{genre:'洋食',sourceNote:'家庭用の魚介フライです。油は食べる部分に残る量の目安で、揚げ方によって栄養値が変わります。'});
const FISH=[
  meuniere('salmon-meuniere','鮭のムニエル','salmon'),
  meuniere('cod-meuniere','たらのムニエル','cod'),
  meuniere('aji-meuniere','あじのムニエル','horse_mackerel'),
  recipe('flounder-simmer','かれいの煮付け','fish','simmer','fish-main',[['flounder',280],['ginger',10],['soy_sauce',22],['mirin',24],['sake',30],['sugar',8],['water',160]],[
    'かれいの水気を拭き、しょうがを薄切りにする。',
    '鍋で水と調味料、しょうがを煮立て、かれいを重ならないように入れる。',
    '落としぶたをして魚の中心まで火を通し、煮汁をかけながら軽く煮詰める。']),
  recipe('buri-daikon','ぶり大根','fish','simmer','fish-main',[['yellowtail',260],['daikon',350],['ginger',10],['soy_sauce',24],['mirin',24],['sake',30],['sugar',10],['water',350]],[
    '大根を厚めに切って下ゆでし、ぶりは水気を拭いて食べやすく切る。',
    '鍋で水と調味料、しょうがを温め、ぶりを入れて火を通す。',
    '大根を加えてやわらかくなるまで煮て、煮汁を含ませて盛る。'],{minutes:45,displaySecondaryCategories:['vegetable']}),
  recipe('buri-teriyaki','ぶりの照り焼き','fish','grill','grilled-fish',[['yellowtail',260],['soy_sauce',18],['mirin',20],['sake',15],['sugar',6],['oil',6]],[
    'ぶりの水気を拭き、しょうゆ、みりん、清酒、砂糖を合わせる。',
    'フライパンに油を引き、ぶりを両面焼いて中心まで火を通す。',
    '調味液を加えて軽く煮詰め、魚に照りが付くように絡める。'],{minutes:20}),
  recipe('mackerel-tatsuta','さばの竜田揚げ','fish','karaage','karaage',[['mackerel',280],['ginger',10],['soy_sauce',18],['sake',16],['starch',30],['oil',24]],[
    'さばの骨を確認して切り、しょうが、しょうゆ、清酒で下味を付ける。',
    '余分な汁を切って片栗粉をまぶし、熱した油に入れる。',
    '中心まで十分に火を通して油を切り、人数分に盛る。'],{tags:['定番','ガッツリ'],sourceNote:'油は魚や衣へ残る量の目安です。骨を除いた魚の可食部から栄養を計算します。'}),
  breadedFish('shrimp-fry','エビフライ','shrimp',240),
  breadedFish('white-fish-fry','白身魚のフライ','cod',280),
  breadedFish('squid-rings','いかリングフライ','squid',260),
  recipe('tempura-assorted','えびと野菜の天ぷら','fish','fry','fish-main',[['shrimp',160],['aubergine',100],['pumpkin',100],['green_beans',60],['flour',70],['egg',1],['water',100],['oil',28],['salt',0.8]],[
    'えびの背わたを取り、野菜を火が通りやすい厚さに切る。すべての水気を拭く。',
    '薄力粉、卵、冷水を軽く混ぜ、具材をくぐらせる。',
    '油で具材の中心まで火を通して揚げ、油を切って塩を添える。'],{displaySecondaryCategories:['vegetable'],sourceNote:'天ぷらの家庭用配合例です。油は衣へ残る量の目安で、吸収量によって栄養値が変わります。'}),
];
const patty=[['beef_minced',150],['pork_minced',150],['onion',100],['egg',1],['breadcrumbs',20],['milk',30],['oil',8]];
const pattySteps=[
  '刻み玉ねぎ、ひき肉、卵、牛乳で湿らせたパン粉をよく練り、小判形にする。',
  'フライパンに油を引いて両面を焼き、ふたをして中まで十分に火を通す。',
];
const MEAT=[
  recipe('hamburg-oroshi','和風おろしハンバーグ','meat','grill','meat-main',[...patty,['daikon',160],['soy_sauce',16],['vinegar',12],['mirin',10]],
    [...pattySteps,'しょうゆ、米酢、みりんを軽く煮立ててたれを作る。大根おろしと一緒にハンバーグへ添える。'],{displaySecondaryCategories:['vegetable'],tags:['定番','さっぱり']}),
  recipe('hamburg-stew','煮込みハンバーグ','meat','stew','meat-main',[...patty,['mushroom',100],['canned_tomato',220],['tomato_paste',20],['worcestershire_sauce',20],['sugar',5],['water',100]],
    [pattySteps[0],'フライパンに油を引いてハンバーグの両面を焼き、きのことソースの材料を加える。','ふたをして中心まで十分に煮込み、ソースを絡めて盛る。'],{genre:'洋食',minutes:35,displaySecondaryCategories:['mushroom'],tags:['定番','ガッツリ']}),
  recipe('hamburg-cheese','チーズハンバーグ','meat','grill','meat-main',[...patty,['cheese',50],['tomato_paste',25],['worcestershire_sauce',18],['water',40]],
    [...pattySteps,'チーズをのせて溶かす。別に温めたトマトペースト、ウスターソース、水のソースをかける。'],{genre:'洋食',displaySecondaryCategories:['dairy'],tags:['定番','ガッツリ']}),
  recipe('beef-stew','ビーフシチュー','meat','stew','meat-main',[['beef_stew_cut',300],['onion',180],['carrot',120],['potato',200],['mushroom',80],['canned_tomato',250],['tomato_paste',30],['flour',18],['butter',15],['worcestershire_sauce',20],['salt',1],['water',500]],[
    '牛肉を食べやすく切って薄力粉をまぶし、バターで表面を焼く。野菜を大きめに切る。',
    '玉ねぎ、にんじん、トマト缶、調味料、水を加えて、肉がやわらかくなるまで弱火で煮る。',
    'じゃがいもときのこを加えて火を通し、煮汁を整えて盛る。'],{genre:'洋食',minutes:100,displaySecondaryCategories:['vegetable','mushroom'],tags:['定番','ガッツリ']}),
  recipe('chicken-cream-stew','チキンクリームシチュー','meat','stew','meat-main',[['chicken',260],['onion',160],['carrot',120],['potato',200],['broccoli',120],['milk',350],['flour',25],['butter',18],['salt',2],['water',250]],[
    '鶏肉と野菜を食べやすく切り、ブロッコリーは下ゆでする。',
    '鍋でバターを溶かし、鶏肉と玉ねぎを炒める。薄力粉をなじませ、水と残りの野菜を加えて肉の中心まで煮る。',
    '野菜がやわらかくなったら牛乳を少しずつ混ぜ、塩で味を整え、ブロッコリーを加える。'],{genre:'洋食',minutes:40,displaySecondaryCategories:['vegetable','dairy']}),
  recipe('pork-cream-stew','ポーククリームシチュー','meat','stew','meat-main',[['pork_loin',260],['onion',160],['carrot',100],['potato',180],['shimeji',100],['milk',350],['flour',25],['butter',18],['salt',2],['water',250]],[
    '豚ロースを小さめに切り、野菜を一口大にして、しめじをほぐす。',
    '鍋でバターを溶かして肉と玉ねぎを炒め、薄力粉をなじませ、水と野菜を加えて中心まで煮る。',
    'じゃがいもがやわらかくなったら牛乳ときのこを加えて温め、塩で味を整える。'],{genre:'洋食',minutes:45,displaySecondaryCategories:['vegetable','dairy','mushroom']}),
  recipe('pork-kakuni','豚の角煮','meat','simmer','meat-main',[['pork_belly',320],['ginger',15],['negi',60],['soy_sauce',24],['mirin',24],['sake',50],['sugar',14],['water',600]],[
    '豚ばら肉を大きめに切り、しょうがと長ねぎ、分量外の湯で下ゆでする。',
    'ゆで汁を切り、肉、水、清酒を鍋に入れて弱火でやわらかくなるまで煮る。',
    'しょうゆ、みりん、砂糖を加え、味を含ませて人数分に盛る。'],{minutes:120,tags:['定番','ガッツリ'],sourceNote:'脂身付きの生肉を基準にした概算です。下ゆでによる脂の流出や残した煮汁は補正していません。'}),
  recipe('cabbage-roll','ロールキャベツ','meat','stew','meat-main',[['pork_minced',220],['beef_minced',80],['cabbage',400],['onion',120],['egg',1],['breadcrumbs',20],['canned_tomato',250],['salt',1.5],['water',300]],[
    'キャベツの葉をやわらかくゆで、刻み玉ねぎ、ひき肉、卵、パン粉を練って肉だねを作る。',
    '葉で肉だねを包んで鍋へ隙間なく並べ、トマト缶、水、塩を加える。',
    '落としぶたをして肉だねの中心まで十分に煮込み、煮汁と一緒に盛る。'],{genre:'洋食',minutes:50,displaySecondaryCategories:['vegetable']}),
  recipe('pork-saute','ポークソテー','meat','grill','meat-main',[['pork_loin',280],['salt',1],['black_pepper',0.2],['flour',12],['oil',8],['butter',10],['soy_sauce',10],['lemon',10]],[
    '豚ロースの筋を切って厚みを整え、塩、こしょう、薄力粉を薄く付ける。',
    'フライパンに油を熱し、肉を両面焼いて中心まで十分に火を通す。',
    'バター、しょうゆ、レモン汁を加えて短く絡め、人数分に切り分ける。'],{genre:'洋食',minutes:20}),
  recipe('pork-kimchi','豚キムチ','meat','stir-fry','meat-main',[['pork',250],['kimchi',180],['bean_sprout',150],['chive',60],['sesame_oil',10],['soy_sauce',10]],[
    '豚肉、にら、キムチを食べやすく切り、もやしの水気を切る。',
    'ごま油で豚肉を炒めて中心まで火を通し、キムチともやしを加える。',
    'にらとしょうゆを加えて炒め合わせ、全体が熱くなったら盛る。'],{genre:'エスニック',minutes:15,displaySecondaryCategories:['vegetable'],tags:['定番','ガッツリ']}),
  recipe('happosai','八宝菜','vegetable','stir-fry','main',[['pork',140],['shrimp',100],['squid',100],['chinese_cabbage',260],['carrot',70],['bamboo_shoot_cooked',80],['shiitake',60],['oyster_sauce',18],['soy_sauce',10],['sake',15],['starch',18],['sesame_oil',10],['water',150]],[
    '肉、魚介、野菜を同じくらいの大きさに切り、片栗粉を水の一部で溶く。',
    'ごま油で豚肉と魚介を十分加熱し、野菜を加えて炒める。',
    '水と調味料を加えて具に火を通し、水溶き片栗粉でとろみを付ける。'],{genre:'中華',displaySecondaryCategories:['meat','fish','mushroom']}),
  recipe('sweet-sour-pork','酢豚','meat','fry','meat-main',[['pork_loin',280],['onion',140],['pepper',100],['carrot',100],['starch',28],['oil',24],['vinegar',25],['soy_sauce',18],['sugar',14],['tomato_paste',20],['water',80]],[
    '豚肉を一口大にして片栗粉の大部分をまぶす。野菜を切り、にんじんは下ゆでする。',
    '肉を油で揚げるか揚げ焼きにして中心まで火を通し、油を切る。野菜を別に炒める。',
    '米酢、しょうゆ、砂糖、トマトペースト、水、残りの片栗粉を合わせて加え、肉と野菜に絡める。'],{genre:'中華',minutes:30,displaySecondaryCategories:['vegetable'],sourceNote:'既存の「揚げない酢豚」とは別に、衣を付けて揚げる作り方です。油の残留量は目安です。'}),
  recipe('yurinchi','油淋鶏','meat','karaage','karaage',[['chicken',300],['starch',30],['oil',24],['soy_sauce',22],['sake',15],['vinegar',20],['sugar',10],['negi',60],['ginger',8],['sesame_oil',4]],[
    '鶏肉に清酒としょうゆの一部で下味を付け、刻みねぎ、しょうが、残りの調味料でたれを作る。',
    '鶏肉へ片栗粉をまぶし、油で揚げ焼きにして中心まで十分に火を通す。',
    '油を切って切り分け、ねぎだれをかける。'],{genre:'中華',minutes:30,tags:['定番','ガッツリ'],sourceNote:'唐揚げにねぎの甘酢だれを添える家庭用配合です。油の残留量は目安です。'}),
  recipe('bangbangji','棒々鶏','meat','steam','meat-main',[['chicken_breast',300],['cucumber',160],['tomato',160],['sake',15],['ginger',8],['water',80],['ground_sesame',25],['soy_sauce',16],['vinegar',16],['sugar',6],['sesame_oil',6]],[
    '鶏むね肉にしょうがと清酒、水を加え、ふたをして中心まで十分に蒸す。',
    '肉を清潔な器具で細く裂き、きゅうりとトマトを切る。',
    'すりごまと残りの調味料を混ぜ、野菜に肉を盛ってたれをかける。'],{genre:'中華',minutes:25,displaySecondaryCategories:['vegetable'],tags:['定番','さっぱり']}),
  recipe('mapo-aubergine','麻婆なす','vegetable','stir-fry','main',[['pork_minced',220],['aubergine',300],['negi',80],['garlic',6],['ginger',8],['miso',22],['soy_sauce',14],['sugar',6],['chilli',1],['starch',15],['oil',18],['water',160]],[
    'なすを細長く切り、長ねぎ、にんにく、しょうがを刻む。片栗粉を水の一部で溶く。',
    '油でなすを焼いて取り出し、ひき肉と香味野菜を十分炒める。',
    'なすを戻して調味料と水を加え、ひと煮してから水溶き片栗粉でまとめる。'],{genre:'中華',displaySecondaryCategories:['meat'],tags:['定番','ガッツリ']}),
];
MEAT.push(
  recipe('meat-vegetable-stir-fry','肉野菜炒め','meat','stir-fry','meat-main',[['pork',240],['cabbage',240],['bean_sprout',180],['carrot',70],['chive',50],['soy_sauce',16],['oyster_sauce',12],['sake',15],['oil',12]],[
    '豚肉と野菜を食べやすく切り、もやしは水気を切る。',
    'フライパンに油を熱し、豚肉を中心まで炒め、にんじん、キャベツ、もやしを順に加える。',
    'にらと調味料を加えて手早く炒め合わせ、野菜の食感が残るうちに盛る。'],{genre:'中華',minutes:20,displaySecondaryCategories:['vegetable']}),
  recipe('yakitori-negima','焼き鳥（ねぎま）','meat','grill','meat-main',[['chicken',300],['negi',150],['soy_sauce',20],['mirin',20],['sake',15],['sugar',6],['oil',6]],[
    '鶏肉と長ねぎを同じくらいの大きさに切り、串に交互に刺す。調味料を合わせる。',
    'フライパンに油を薄く引き、串を返しながら焼く。ふたをして鶏肉の中心まで十分に火を通す。',
    'たれを加えて軽く煮詰め、肉とねぎに照りが付いたら盛る。'],{minutes:25,displaySecondaryCategories:['vegetable']})
);
const pot=(id,name,category,family,parts,extra={})=>recipe(id,name,category,'hotpot',family,parts,[
  '肉や魚介、豆腐、野菜を食べやすく切り、下処理が必要な材料は表示に合わせて準備する。',
  '鍋に水分と調味料を温め、火の通りにくい具材から加える。肉や魚介の中心まで十分に火を通す。',
  '葉物など残りの具材を加えて煮る。取り分けて食べ、追加のご飯や麺は別のメニューとして記録する。'],
  {minutes:30,portion:{amount:1,unit:'皿',label:'具と汁を人数で分けた1人分'},sourceNote:'鍋の具と汁を人数で分けた概算です。汁を残した量は補正していません。締めのご飯・麺や追加のたれは含みません。',...extra});
const HOTPOTS=[
  pot('yose-nabe','寄せ鍋','fish','fish-main',[['cod',160],['shrimp',100],['chicken',140],['tofu',180],['chinese_cabbage',280],['negi',100],['shiitake',60],['kombu',3],['soy_sauce',22],['mirin',20],['sake',25],['water',650]],{displaySecondaryCategories:['meat','bean','vegetable','mushroom']}),
  pot('kimchi-nabe','キムチ鍋','meat','meat-main',[['pork',240],['kimchi',200],['tofu',200],['chinese_cabbage',200],['bean_sprout',150],['chive',60],['miso',20],['sesame_oil',8],['water',550]],{genre:'エスニック',displaySecondaryCategories:['bean','vegetable'],tags:['定番','ガッツリ']}),
  pot('mizutaki','水炊き','meat','meat-main',[['chicken',320],['chinese_cabbage',300],['negi',100],['carrot',60],['shiitake',60],['kombu',3],['water',700],['soy_sauce',18],['vinegar',18],['lemon',10]],{displaySecondaryCategories:['vegetable','mushroom'],steps:[
    '鶏肉と野菜を食べやすく切る。しょうゆ、米酢、レモン汁を別の器で合わせ、付けだれを作る。',
    '鍋で昆布と水を温め、煮立つ直前に昆布を取り出す。鶏肉を加えて中心まで十分に煮る。',
    '野菜を加えて火を通し、清潔な器具で具と汁を取り分け、付けだれを添える。'],sourceNote:'骨なし鶏肉を使う家庭向けの水炊きです。しょうゆ、酢、レモン汁は付けだれとして別に合わせます。締めは含みません。'}),
  pot('sukiyaki','すき焼き','meat','meat-main',[['beef',280],['tofu',250],['shirataki',180],['negi',160],['chinese_cabbage',200],['shiitake',60],['egg',2],['soy_sauce',35],['mirin',35],['sake',30],['sugar',16],['water',180]],{displaySecondaryCategories:['bean','vegetable','egg','mushroom'],steps:[
    '牛肉と野菜、豆腐を食べやすく切り、しらたきは表示どおり下ゆでして水を切る。',
    '鍋に水と調味料を温め、牛肉、しらたき、野菜、豆腐を加えて中心まで煮る。',
    '卵は鍋へ溶き入れて十分に火を通す。この例では付け卵も加熱して食べる。'],tags:['定番','ガッツリ']}),
  pot('pork-shabu','豚しゃぶしゃぶ','meat','meat-main',[['pork',280],['chinese_cabbage',320],['negi',100],['enoki',100],['carrot',60],['kombu',3],['water',800],['soy_sauce',20],['vinegar',20],['lemon',10]],{displaySecondaryCategories:['vegetable','mushroom'],steps:[
    '野菜を薄く切り、鍋で昆布と水を温める。しょうゆ、酢、レモン汁を合わせて付けだれにする。',
    '煮立つ直前に昆布を取り出し、野菜を火が通るまで煮る。',
    '豚肉を重ならないように広げて加え、中心まで十分に火を通す。清潔な器具で取り分け、たれを付ける。']}),
  pot('sesame-soy-nabe','ごま豆乳鍋','meat','meat-main',[['pork',240],['tofu',200],['chinese_cabbage',280],['negi',100],['shimeji',100],['soy_milk',400],['water',300],['miso',22],['ground_sesame',24],['soy_sauce',12]],{displaySecondaryCategories:['bean','vegetable','mushroom'],steps:[
    '豚肉と豆腐、野菜を食べやすく切り、きのこをほぐす。',
    '鍋に水とみそ、しょうゆを温め、肉と野菜を入れて中心まで火を通す。',
    '豆腐、豆乳、すりごまを加えて弱火で温め、人数分に取り分ける。']}),
  pot('chanko-nabe','鶏つくねのちゃんこ鍋','meat','meat-main',[['chicken_minced',260],['negi',120],['starch',18],['ginger',10],['chinese_cabbage',300],['carrot',80],['shimeji',100],['aburaage',60],['soy_sauce',24],['mirin',20],['sake',20],['salt',1],['water',700]],{displaySecondaryCategories:['vegetable','bean','mushroom'],steps:[
    'ひき肉に刻みねぎの一部、しょうが、片栗粉を混ぜてつくねの種を作り、野菜と油揚げを切る。',
    '鍋に水と調味料を煮立て、種を小さな団子にして落とし、中心まで十分に火を通す。',
    '野菜と油揚げを加えて煮る。具と汁を人数分に分け、締めは別に記録する。']}),
  pot('yudofu','湯豆腐','bean','bean-main',[['tofu',500],['negi',100],['chinese_cabbage',200],['kombu',3],['water',700],['soy_sauce',18],['vinegar',12],['scallion_garnish',8]],{minutes:20,displaySecondaryCategories:['vegetable'],steps:[
    '豆腐を大きめに切り、白菜と長ねぎを切る。しょうゆ、酢、小ねぎで付けだれを作る。',
    '鍋で昆布と水を温め、昆布を取り出して野菜をやわらかく煮る。',
    '豆腐を入れて中まで温め、人数分に取り分けてたれを添える。']}),
  pot('sundubu','スンドゥブ','bean','bean-main',[['silken_tofu',400],['clam',250],['pork',100],['kimchi',120],['egg',2],['negi',80],['miso',18],['chilli',1],['sesame_oil',8],['water',450]],{genre:'エスニック',displaySecondaryCategories:['fish','meat','egg'],steps:[
    '砂抜き済みあさりの殻を洗い、豚肉とねぎ、キムチを食べやすく切る。',
    '鍋にごま油を引いて豚肉を炒め、水、キムチ、みそ、とうがらし、あさりを加えて十分加熱する。',
    '豆腐とねぎ、卵を加え、肉と魚介、卵の中心まで火を通して盛る。']}),
];
const staple=(id,name,family,parts,steps,extra={})=>recipe(id,name,'grain','other',family,parts,steps,{role:'staple',staple:true,mealBase:true,...extra});
const katsuBase=[['pork_loin',240],['flour',18],['egg',1],['breadcrumbs',35],['oil',24]];
const cutletFirst='肉の厚みを整えて薄力粉、溶き卵、パン粉の順に付け、油で中心まで十分に揚げ焼きにする。';
const STAPLES=[
  staple('katsudon','カツ丼','donburi',[...katsuBase,['rice',400],['egg',2],['onion',140],['soy_sauce',20],['mirin',24],['sugar',6],['water',140]],
    [cutletFirst.replace('溶き卵','溶き卵の一部'),'玉ねぎを水と調味料で煮て、切ったカツをのせる。','残りの卵を溶いて加え、中まで火が通ったら人数分のご飯にのせる。'],{minutes:35,displayMethod:'simmer',displaySecondaryCategories:['meat','egg']}),
  staple('sauce-katsudon','ソースカツ丼','donburi',[...katsuBase,['rice',400],['cabbage',160],['worcestershire_sauce',35],['tomato_paste',15],['sugar',6],['water',25]],
    [cutletFirst,'ウスターソース、トマトペースト、砂糖、水を温め、カツに絡める。','ご飯に千切りキャベツを敷き、食べやすく切ったカツをのせる。'],{minutes:30,displayMethod:'cutlet',displaySecondaryCategories:['meat','vegetable']}),
  staple('chicken-katsudon','チキンカツ丼','donburi',[['chicken_breast',280],['flour',18],['egg',3],['breadcrumbs',35],['oil',24],['rice',400],['onion',140],['soy_sauce',20],['mirin',24],['water',140]],
    ['鶏むね肉を開き、薄力粉、卵の一部、パン粉を付けて中心まで揚げ焼きにする。','玉ねぎを水としょうゆ、みりんで煮て、切ったチキンカツを加える。','残りの溶き卵でとじて中まで火を通し、ご飯にのせる。'],{minutes:35,displayMethod:'simmer',displaySecondaryCategories:['meat','egg']}),
  staple('tendon','天丼','donburi',[['rice',400],['shrimp',160],['aubergine',100],['pumpkin',100],['flour',60],['egg',1],['water',130],['oil',28],['soy_sauce',22],['mirin',24],['sugar',8]],
    ['えびの背わたを取り、野菜を薄く切る。薄力粉、卵、水の大部分を混ぜて衣を作る。','具を衣にくぐらせ、油で中心まで火を通して揚げる。残りの水と調味料を煮立ててたれを作る。','ご飯に天ぷらをのせ、たれをかける。'],{minutes:30,displayMethod:'fry',displaySecondaryCategories:['fish','vegetable'],sourceNote:'家庭用の天丼です。揚げ油は衣に残る量の目安です。店の配合や商品重量とは異なります。'}),
  staple('kakiage-don','野菜かき揚げ丼','donburi',[['rice',400],['onion',180],['carrot',80],['green_beans',60],['flour',70],['egg',1],['water',130],['oil',28],['soy_sauce',22],['mirin',24],['sugar',8]],
    ['野菜を細く切り、薄力粉の一部を全体へまぶす。残りの粉と卵、水の大部分で衣を作る。','野菜を衣でまとめて小さく落とし、中心まで揚げて油を切る。残りの水と調味料を煮立てる。','ご飯にかき揚げをのせてたれをかける。'],{minutes:30,displayMethod:'fry',displaySecondaryCategories:['vegetable']}),
  staple('tenshinhan','天津飯','donburi',[['rice',400],['egg',4],['crab',80],['negi',40],['oil',12],['soy_sauce',18],['vinegar',18],['sugar',10],['starch',18],['water',220]],
    ['卵にほぐしたかにと刻みねぎを混ぜ、油を引いたフライパンで人数分に分けて焼く。','水としょうゆ、酢、砂糖を煮立て、水溶き片栗粉であんを作る。','ご飯に中まで火を通した卵焼きをのせ、甘酢あんをかける。'],{genre:'中華',minutes:20,displayMethod:'grill',displaySecondaryCategories:['egg','fish']}),
  staple('kaisen-don','海鮮丼','donburi',[['rice',400],['tuna_lean_sashimi',100],['salmon_sashimi',100],['seabream_sashimi',80],['cucumber',80],['nori',2],['soy_sauce',16]],
    ['温かいご飯を器に盛って粗熱を取り、きゅうりと海苔を切る。','刺身用として販売された魚を清潔な器具で切り、保存方法と期限を確認する。','ご飯に魚ときゅうり、海苔を盛り、しょうゆを添える。'],{minutes:10,displayMethod:'sashimi',displaySecondaryCategories:['fish'],sourceNote:'酢飯を使うちらし寿司とは別に、白飯に刺身をのせた例です。サーモンの栄養は皮なしサーモントラウトの代表値です。'}),
  staple('tekka-don','鉄火丼','donburi',[['rice',400],['tuna_lean_sashimi',240],['nori',2],['soy_sauce',16]],
    ['ご飯を器に盛って粗熱を取り、海苔を刻む。','刺身用のまぐろを用意し、清潔な器具で食べやすく切る。','ご飯にまぐろと海苔を盛り、しょうゆを添える。'],{minutes:10,displayMethod:'sashimi',displaySecondaryCategories:['fish']}),
  staple('salmon-don','サーモン丼','donburi',[['rice',400],['salmon_sashimi',240],['nori',2],['soy_sauce',16]],
    ['ご飯を器に盛って粗熱を取り、海苔を刻む。','刺身用のサーモンを用意し、清潔な器具で食べやすく切る。','ご飯にサーモンと海苔を盛り、しょうゆを添える。'],{minutes:10,displayMethod:'sashimi',displaySecondaryCategories:['fish'],sourceNote:'白飯に刺身用サーモンをのせた家庭用の例です。栄養は皮なしサーモントラウトの代表値です。'}),
  staple('loco-moco','ロコモコ','donburi',[...patty,['rice',400],['egg',2],['lettuce',60],['tomato',100],['tomato_paste',25],['worcestershire_sauce',18],['water',50]],
    [pattySteps[0].replace('卵、','卵の一部、'),pattySteps[1]+'残りの卵も別に焼いて中まで火を通す。','トマトペースト、ウスターソース、水を温め、ご飯にハンバーグ、卵、野菜を盛ってソースをかける。'],{genre:'洋食',minutes:35,displayMethod:'grill',displaySecondaryCategories:['meat','egg','vegetable']}),
  staple('hayashi-rice','ハヤシライス','rice',[['rice',400],['beef',220],['onion',220],['mushroom',100],['butter',16],['flour',20],['canned_tomato',250],['tomato_paste',25],['worcestershire_sauce',20],['sugar',8],['salt',0.8],['water',250]],
    ['牛肉を食べやすく、玉ねぎときのこを薄切りにする。','鍋でバターを溶かして玉ねぎと牛肉を炒め、薄力粉をなじませてトマト缶と調味料、水を加える。','肉と野菜に火が通ってソースにとろみが付いたら、きのこを煮てご飯に添える。'],{genre:'洋食',minutes:35,displayMethod:'stew',displaySecondaryCategories:['meat','vegetable','mushroom']}),
  staple('chicken-macaroni-gratin','チキンマカロニグラタン','other-staple',[['macaroni',140],['chicken',200],['onion',120],['mushroom',80],['milk',350],['flour',25],['butter',20],['cheese',60],['salt',1.5]],
    ['マカロニを表示どおりゆでる。鶏肉と野菜を切り、バターで炒めて肉の中心まで火を通す。','薄力粉をなじませ、牛乳を少しずつ混ぜてソースを作り、マカロニを合わせる。','耐熱皿へ移してチーズをのせ、オーブンやトースターで中まで熱く焼く。'],{genre:'洋食',minutes:40,displayMethod:'grill',displaySecondaryCategories:['meat','dairy','mushroom']}),
  staple('seafood-doria','シーフードドリア','rice',[['rice',360],['shrimp',140],['squid',100],['onion',120],['milk',350],['flour',25],['butter',20],['cheese',60],['salt',1.5]],
    ['魚介と玉ねぎを食べやすく切り、バターで炒めて中心まで火を通す。','薄力粉をなじませ、牛乳を少しずつ加えてソースを作り、塩で調える。','耐熱皿へご飯とソース、チーズを重ね、中まで熱くなるよう焼く。'],{genre:'洋食',minutes:35,displayMethod:'grill',displaySecondaryCategories:['fish','dairy']}),
];
export const FAMILIAR_MAIN_RECIPES=[...FISH,...MEAT,...HOTPOTS,...STAPLES];
