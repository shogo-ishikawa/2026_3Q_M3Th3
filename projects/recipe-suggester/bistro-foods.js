/** 洋食店の料理構成を参考にした家庭用の配合。全材料は2人分です。 */
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const profiles={
  bistro_lamb_loin:{
    name:'ラム（ロース・脂身つき・生）',groups:['protein'],proteinSources:['meat'],
    values:[287,15.6,25.9,.2,0,.2],code:'11202',group:'11',
    note:'子羊のロース脂身つきの可食重量。成羊のマトンや脂身を除いたラムとは別の値です。串に刺す前の重量を量ります。',
  },
  bistro_mussel_raw:{
    name:'ムール貝（いがいの代表値・生・可食部）',groups:['protein'],proteinSources:['fish'],
    values:[63,10.3,1.6,3.2,0,1.4],code:'10289',group:'10',
    note:'成分表の「いがい・生」をムール貝の代表値に使用します。パーナ貝等は別種で、商品によって差があります。殻を除いた身の生重量。成分表の廃棄率60%を目安にすると殻付き購入重量は可食重量の約2.5倍です。塩分を加えた加熱済み品とは異なります。',
  },
  bistro_escargot_canned:{
    name:'エスカルゴ（水煮缶詰・液を切った身）',groups:['protein'],proteinSources:['fish'],
    values:[75,16.5,1,.8,0,.7],code:'10291',group:'10',
    note:'食用エスカルゴの水煮缶詰を液切りした可食重量。生のカタツムリや味付きバター入り製品ではありません。缶の汁と殻は含みません。',
  },
};
export const BISTRO_INGREDIENTS=freeze(Object.fromEntries(Object.entries(profiles).map(([id,row])=>[id,{
  name:row.name,unit:'g',allergens:[],groups:row.groups,proteinSources:row.proteinSources,note:row.note,
}])));
export const BISTRO_NUTRITION=freeze(Object.fromEntries(Object.entries(profiles).map(([id,row])=>{
  const perUnit=Object.fromEntries(KEYS.map((key,index)=>[key,row.values[index]/100]));
  const source=`日本食品標準成分表（八訂）増補2023年、食品番号${row.code}の可食部100g値を1gへ換算。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${row.group}_${row.code}_7 ${row.note}`;
  return[id,{gramsPerUnit:1,nutritionPerUnit:perUnit,rawNutritionPerUnit:{...perUnit},nutritionSource:source,rawNutritionSource:source,estimatedNutrients:[]}];
})));

const urls={
  gusto:'https://takeout.skylark.co.jp/brand/GT/menu?category=GT16_05',
  gustoChicken:'https://www.skylark.co.jp/gusto/menu/menu_detail.html?mid=290_30903',
  royalSeafood:'https://www.royalhost.jp/menu/grand/yoshoku/sizzling-grilled-red-sea-bream-shrimp-and-oysters-with-warm-vegetable.html',
  royalSide:'https://www.royalhost.jp/menu/grand/side/',
  royalPumpkin:'https://www.royalhost.jp/menu/grand/side/pumpkin-gratin.html',
  royalCabbage:'https://www.royalhost.jp/menu/grand/side/red-cabbage-marinade-with-two-cheeses.html',
  cocosChicken:'https://www.cocos-jpn.co.jp/menu/grand/steak/mushroom_chicken2609.html',
  cocosSteak:'https://www.cocos-jpn.co.jp/menu/grand/steak/',
  cocosAjillo:'https://www.cocos-jpn.co.jp/menu/grand/pizza/ajillo_seafood_broccoli2609.html',
  cocosPotato:'https://www.cocos-jpn.co.jp/menu/grand/pizza/bakedpotato_mentaiko_cheese2609.html',
  cocosChilli:'https://www.cocos-jpn.co.jp/menu/grand/pizza/chili_con_carne_cheese2609.html',
  cocosCheese:'https://www.cocos-jpn.co.jp/menu/grand/pizza/fried_cheese2203.html',
  saizeriyaLamb:'https://www.saizeriya.co.jp/menu-popular/1402/',
  saizeriyaMussel:'https://www.saizeriya.co.jp/menu-popular/1410/',
  saizeriyaEscargot:'https://www.saizeriya.co.jp/menu-popular/1405/',
};
const general='家庭で作る一例と、外食を記録する際の一般的な一皿の目安です。材料表の量から栄養を概算し、ソースと付け合わせも含めます。加熱で落ちる脂や蒸発量は未補正です。店舗の盛付量・配合・商品表示に合わせて量や食材を調整してください。ご飯やパンは別に追加します。';
const fryNote='材料表の植物油は食品に残る吸収量の仮定で、揚げ鍋に張る全量ではありません。衣の厚さや揚げ方で変わります。';
const recipe=(id,name,role,category,method,items,steps,reference,extra={})=>{
  const parts=new Map();for(const [key,value]of items)parts.set(key,(parts.get(key)??0)+value);
  return {id:`bistro-${id}`,name,role,family:role==='side'?'small-dish':category==='fish'?'fish-main':'meat-main',genre:'洋食',minutes:30,servings:2,
    ingredients:[...parts].map(([id,amount])=>({id,amount})),steps,staple:false,mealBase:false,nature:'home-cooked',
    portion:{amount:1,unit:'皿'},ingredientsKnown:true,allergensKnown:true,shoppingKnown:true,tags:(extra.minutes??30)<=20?['時短']:[],
    displayCategory:category,displayMethod:method,displaySecondaryCategories:[],
    sourceNote:`${general} 料理構成の参考（確認日2026-11-13）：${reference}`,...extra};
};

export const BISTRO_RECIPES=freeze([
  recipe('cheese-in-hamburg','チーズインハンバーグ','main','meat','grill',[
    ['beef_minced',170],['pork_minced',170],['onion',100],['egg',1],['breadcrumbs',20],['milk',40],['mozzarella',50],['palette_cheddar',20],
    ['oil',8],['butter',8],['canned_tomato',150],['worcestershire_sauce',16],['sugar',4],['salt',1.2],['black_pepper',.3],['water',60],
  ],[
    '玉ねぎを細かく刻む。油の半量でしんなりするまで中火で炒め、バットに広げて十分に冷ます。パン粉は牛乳に浸し、チーズは中心に包みやすい大きさにまとめて冷やす。',
    '選んだひき肉は冷たい状態で塩の半量を加え、粘りが出るまで練る。冷めた玉ねぎ、卵、牛乳を吸わせたパン粉、こしょうを混ぜ、人数分に分ける。',
    '肉だねを広げてチーズを中心に包み、継ぎ目をしっかり閉じる。厚みをそろえ、残りの油を熱したフライパンで両面に焼き色を付ける。',
    '水の半量を加えてふたをし、弱火で蒸し焼きにする。厚い肉の部分の中心75℃で1分以上を確認し、いったん器へ移す。チーズが漏れないよう強く押さえない。',
    '同じフライパンにトマト缶、ウスターソース、砂糖、残りの水と塩を入れ、弱めの中火で5分ほど混ぜながら煮詰める。バターを溶かし、ハンバーグにかける。',
  ],urls.gusto,{minutes:40,variantLabel:'チーズイン'}),
  recipe('chicken-onion-garlic','若鶏のグリル・玉ねぎにんにく醤油ソース','main','meat','grill',[
    ['chicken',360],['onion',120],['garlic',10],['soy_sauce',24],['mirin',20],['sake',20],['sugar',4],['oil',8],['water',40],['salt',.6],['black_pepper',.2],['broccoli',160],
  ],[
    '鶏もも肉は皮つきのまま余分な筋を除き、厚いところを開いて厚みをそろえる。塩とこしょうを振る。玉ねぎとにんにくはすりおろし、ブロッコリーは小房にする。',
    '焦げ付きにくいフライパンに油の半量を入れ、鶏肉を皮側から中火で焼く。軽く押さえて皮を密着させ、焼き色が付いたら返して弱火にする。',
    '水の半量を加えてふたをし、鶏肉の中心75℃で1分以上を確認する。ブロッコリーは別鍋で好みの硬さにゆで、水気を切る。',
    '小鍋に残りの油と玉ねぎ、にんにくを入れて弱火で炒める。しょうゆ、みりん、清酒、砂糖、残りの水を加え、中火で煮立ててから3〜4分煮る。',
    '鶏肉を切り分け、ブロッコリーと一緒に盛る。玉ねぎの生臭さが消えたソースをかけ、人数分へ分ける。',
  ],urls.gustoChicken,{minutes:30}),
  recipe('chicken-mushroom-cream','チキンステーキのきのこクリームソース','main','meat','grill',[
    ['chicken',360],['mushroom',100],['shimeji',100],['onion',80],['broccoli',160],['butter',16],['oil',4],['flour',14],['milk',220],['water',40],['salt',1.4],['black_pepper',.3],
  ],[
    '鶏もも肉の厚みをそろえ、塩の半量とこしょうを振る。玉ねぎとマッシュルームを薄切りにし、しめじをほぐす。ブロッコリーは小房に分ける。',
    'フライパンに油を入れ、鶏肉を皮側から中火で焼く。返したら水の半量を加えてふたをし、弱火で中心75℃で1分以上まで加熱する。別皿に移して保温する。',
    '別の小鍋でバターを溶かし、玉ねぎときのこを中火で炒める。しんなりしたら薄力粉を振り入れ、粉っぽさが消えるまで弱火で炒める。',
    '牛乳と残りの水を少しずつ加え、その都度よく混ぜる。弱火で3〜5分煮てとろみを付け、残りの塩で味を調える。ブロッコリーは別鍋でゆでて湯を切る。',
    '鶏肉とブロッコリーを盛り、きのこソースをかける。ソースも人数分へ均等に分ける。',
  ],urls.cocosChicken,{minutes:35}),
  recipe('cod-shrimp-butter','たらとえびの醤油バターグリル','main','fish','grill',[
    ['cod',240],['shrimp',140],['broccoli',140],['potato',120],['butter',18],['olive_oil',8],['soy_sauce',16],['sake',20],['lemon',16],['salt',.4],['black_pepper',.2],
  ],[
    'たらは骨を確認して水気を拭き、塩とこしょうを振る。えびは背わたを取り、水気を拭く。じゃがいもを薄めの一口大、ブロッコリーを小房にする。',
    'じゃがいもは水からゆでて竹串が通るまで火を通す。ブロッコリーを加えてさっとゆで、湯を切る。',
    'フライパンでオリーブ油とバター半量を熱し、たらを中火で焼く。焼き色が付いたら静かに返し、空いたところにえびを並べる。',
    '清酒を加えてふたをし、弱めの中火で魚介の中心まで十分に火を通す。しょうゆと残りのバターを加え、溶けたソースを回しかける。',
    '魚介と温野菜を器に分け、フライパンのソースもかける。レモンを添え、食べる際に搾る。',
  ],urls.royalSeafood,{sourceNote:`${general} 真鯛・海老・牡蠣と温野菜の組み合わせを参考に、家庭で扱いやすいたらとえびで構成した配合です。参考：${urls.royalSeafood}`}),
  recipe('garlic-shrimp','ガーリックシュリンプ','main','fish','stir-fry',[
    ['shrimp',280],['garlic',14],['butter',12],['olive_oil',20],['lemon',20],['parsley',3],['chilli',.3],['salt',1.2],['black_pepper',.2],
  ],[
    'えびは殻と背わたを取り、可食部を量って水気を拭く。にんにくとパセリを細かく刻む。',
    '冷たいフライパンにオリーブ油、にんにく、とうがらしを入れ、弱火で香りを出す。にんにくを焦がさないようにする。',
    'えびを重ならないように加え、中火で両面を焼く。赤くなって身が不透明になり、中心まで十分に加熱されたことを確認する。',
    '塩、こしょう、バター、レモン汁を加えて手早くからめ、パセリを散らす。えびとソースを人数分へ均等に分ける。',
  ],urls.royalSide,{minutes:20,sourceNote:`${general} えびに絡めるオリーブ油とバターは全量を食べる配合として計上します。参考：${urls.royalSide}`}),
  recipe('lamb-spice-skewers','ラムのスパイス串焼き','main','meat','grill',[
    ['bistro_lamb_loin',260],['onion',100],['pepper',80],['olive_oil',8],['garlic',6],['salt',1.4],['paprika_powder',2],['cumin',1],['black_pepper',.3],['lemon',16],
  ],[
    'ラムのロースは脂身つきの可食部を量り、筋を除いて大きさのそろった角切りにする。玉ねぎとピーマンも肉と同じくらいの大きさに切る。',
    'ラムにオリーブ油、すりおろしたにんにく、塩、パプリカ粉、クミン、こしょうをからめる。冷蔵庫で15〜20分置いて香りをなじませる。',
    '肉と野菜を串にゆるく刺す。フライパンを中火で温め、時々返しながら全ての面へ焼き色を付ける。竹串を使う場合は先端が熱源へ直接触れないようにする。',
    '火を弱めてふたをし、厚い肉の中心75℃で1分以上を確認する。レモンを添えて人数分に盛る。',
  ],urls.saizeriyaLamb,{minutes:35,sourceNote:`${general} アロスティチーニを参考に、野菜を添えたスパイス味のラム串焼きに構成しました。成羊マトンではなく脂身つきラムロースの値を使います。参考：${urls.saizeriyaLamb}`}),
  recipe('beef-cut-steak','牛肩ロースのカットステーキ','main','meat','grill',[
    ['beef_stew_cut',300],['onion',100],['garlic',8],['broccoli',160],['butter',10],['oil',6],['soy_sauce',16],['mirin',16],['water',30],['salt',.4],['black_pepper',.4],
  ],[
    '牛肩ロースは厚みをそろえたステーキ用のかたまりを使い、筋を数か所切る。塩とこしょうを振る。玉ねぎは薄切り、にんにくは細かく刻む。',
    'ブロッコリーを別鍋でゆでて湯を切る。フライパンに油を熱し、牛肉の両面へ中火で焼き色を付ける。',
    '火を弱めてふたをし、厚い部分の中心まで十分に火を通す。肉を清潔な皿へ移して数分休ませ、食べやすい大きさに切る。',
    '同じフライパンで玉ねぎとにんにくを弱めの中火で炒める。しょうゆ、みりん、水を加えて2〜3分煮立て、バターを溶かす。',
    '牛肉、ブロッコリー、玉ねぎを盛り、ソースも分けてかける。肉から出た汁をソースへ加える場合は、必ず再度十分に煮立てる。',
  ],urls.cocosSteak,{minutes:30,sourceNote:`${general} カットステーキを参考に、成分が登録されている牛肩ロース脂身つきを指定した家庭用配合です。部位や脂身の量で特に脂質が変わります。参考：${urls.cocosSteak}`}),
  recipe('seafood-broccoli-ajillo','魚介とブロッコリーのアヒージョ','main','fish','simmer',[
    ['shrimp',140],['scallop',140],['broccoli',180],['mushroom',120],['garlic',12],['olive_oil',60],['salt',1.6],['chilli',.3],
  ],[
    'えびは背わたを除き、ほたて貝柱とともに水気をよく拭く。にんにくを薄切り、マッシュルームを半分に切る。ブロッコリーは小房に分ける。',
    'ブロッコリーは別鍋の湯で1〜2分下ゆでし、ざるへ上げて十分に水気を切る。余分な水分を残さない。',
    '小鍋にオリーブ油、にんにく、とうがらしを入れ、弱火で香りを出す。きのこを加え、魚介とブロッコリーを重ねる。',
    '塩を加え、弱火で小さく泡が出る状態を保つ。油をはねさせないよう具の水気をしっかり切り、ふたを少しずらして魚介の中心まで十分に火を通す。',
    '具と調味した油を人数分へ分ける。油は全量を食べるモデルで計算し、残した油の栄養は差し引かない。パンは別メニューとして記録する。',
  ],urls.cocosAjillo,{minutes:25,sourceNote:`${general} えび・ほたて貝柱の家庭用配合。材料表のオリーブ油は全量を口にする想定で栄養へ含めます。鍋に残した油も計算に含まれ、食べ残した分は自動では差し引きません。参考：${urls.cocosAjillo}`}),
  recipe('mussel-garlic-bake','ムール貝のガーリックパン粉焼き','side','fish','grill',[
    ['bistro_mussel_raw',180],['onion',60],['garlic',8],['breadcrumbs',18],['butter',14],['olive_oil',10],['parsley',3],['sake',30],['water',30],['salt',.3],['black_pepper',.2],
  ],[
    '加熱用として販売されたムール貝を使い、殻の汚れと足糸を除く。殻なし品を使う場合も身の可食重量を材料表に合わせる。玉ねぎ、にんにく、パセリを細かく刻む。',
    '鍋に貝、清酒、水を入れてふたをし、加熱する。殻が開いても十分に火を通し、開かない貝は使わない。むき身なら中心まで十分に火を通す。',
    'フライパンにバターとオリーブ油を入れ、にんにくと玉ねぎを弱火で炒める。パン粉、塩、こしょう、パセリを混ぜ、火を止める。',
    '貝の上殻を外すか耐熱皿に身を並べ、香味パン粉をのせる。200℃に予熱したオーブンで5〜8分を目安に、表面へ焼き色を付ける。',
    '焼き上がりの貝と香味パン粉を人数分へ盛る。材料の貝は殻を除いた身の重量で、殻付き購入重量とは分ける。',
  ],urls.saizeriyaMussel,{minutes:30,sourceNote:`${general} 店舗のパーナ貝料理を参考に、一般的なムール貝と香味パン粉の配合へ構成。貝は成分表いがい生の代表値で、殻を除いた可食部を計算します。参考：${urls.saizeriyaMussel}`}),
  recipe('escargot-herb-butter','エスカルゴの香草バター焼き','side','fish','grill',[
    ['bistro_escargot_canned',120],['mushroom',80],['onion',40],['garlic',10],['parsley',6],['butter',30],['olive_oil',10],['sake',20],['water',20],['salt',.4],['black_pepper',.2],
  ],[
    '食用エスカルゴの水煮缶詰を開け、液を切って身を量る。マッシュルームを小さく切り、玉ねぎ、にんにく、パセリを細かく刻む。',
    'フライパンでオリーブ油を温め、玉ねぎときのこを弱めの中火で炒める。エスカルゴ、清酒、水を加え、ふたをして3〜4分温める。',
    '室温でやわらかくしたバターににんにく、パセリ、塩、こしょうを混ぜる。加熱した具を小さな耐熱皿へ並べ、香草バターを分けてのせる。',
    '200℃に予熱したオーブンで5〜8分を目安に、中心まで熱くなるまで焼く。溶けたバターも一緒に人数分へ分け、パンを添えるなら別に記録する。',
  ],urls.saizeriyaEscargot,{minutes:30,sourceNote:`${general} 水煮缶詰と家庭用の香草バターで構成。バターとオリーブ油はソースを含め全量を食べる想定です。参考：${urls.saizeriyaEscargot}`}),
  recipe('pumpkin-meat-gratin','かぼちゃのミートソースグラタン','side','vegetable','grill',[
    ['pumpkin',200],['beef_minced',60],['onion',40],['canned_tomato',80],['garlic',3],['olive_oil',3],['milk',120],['flour',9],['butter',7],['cheese',30],['salt',.7],['black_pepper',.2],
  ],[
    'かぼちゃは種とわたを除いて薄めの一口大に切る。玉ねぎとにんにくをみじん切りにする。かぼちゃを耐熱容器へ入れ、ふんわりふたをして電子レンジでやわらかくする。',
    'フライパンにオリーブ油を熱し、玉ねぎ、にんにく、牛ひき肉をほぐして炒める。トマト缶と塩の半量を加え、肉の中心75℃で1分以上を確認して水分を軽く飛ばす。',
    '小鍋でバターを溶かし、薄力粉を弱火で炒める。牛乳を少しずつ加えて混ぜ、残りの塩とこしょうで味を付け、なめらかなホワイトソースにする。',
    '耐熱皿にかぼちゃ、ミートソース、ホワイトソースを重ね、チーズをのせる。200℃に予熱したオーブンで10〜15分、表面に焼き色が付くまで焼いて人数分へ分ける。',
  ],urls.royalPumpkin,{minutes:40,displaySecondaryCategories:['meat','dairy']}),
  recipe('red-cabbage-two-cheeses','紫キャベツと2種チーズのマリネ','side','vegetable','dressed',[
    ['red_cabbage',200],['palette_cheddar',25],['parmesan_cheese',10],['vinegar',20],['olive_oil',10],['sugar',5],['salt',.8],['black_pepper',.2],
  ],[
    '紫キャベツは芯を除いて細く刻む。塩の半量をまぶして10分ほど置き、出た水分を軽く絞る。チェダーチーズは小さく切る。',
    '米酢、砂糖、残りの塩、こしょうをよく混ぜ、オリーブ油を少しずつ加えて混ぜる。砂糖が溶けたらキャベツを和える。',
    '冷蔵庫で20〜30分なじませ、食べる直前にチェダーと粉チーズを混ぜて盛る。たれを含めて人数分へ分け、食べるまで冷蔵する。',
  ],urls.royalCabbage,{minutes:40,displaySecondaryCategories:['dairy'],sourceNote:`${general} 紫キャベツとチーズの組み合わせを参考に、家庭で入手しやすいチェダーとパルメザンへ置き換えています。参考：${urls.royalCabbage}`}),
  recipe('onion-rings','オニオンリング','side','vegetable','fried',[
    ['onion',260],['flour',50],['starch',15],['palette_baking_powder',2],['water',70],['oil',24],['salt',1],['paprika_powder',.6],['tomato_paste',15],['vinegar',6],['sugar',4],
  ],[
    '玉ねぎは厚めの輪切りにし、輪を外して水気を拭く。トマトペースト、酢、砂糖、塩の半量、水の一部を小鍋で煮立ててソースにする。',
    '薄力粉の一部を玉ねぎへ薄くまぶす。残りの粉、片栗粉、ベーキングパウダー、残りの塩と水を混ぜ、ややとろみのある衣を作る。',
    '揚げ鍋の油を170℃に熱し、衣を付けた玉ねぎを少量ずつ入れる。時々返し、衣がきつね色で玉ねぎもやわらかくなるまで揚げる。',
    '網へ上げて油を切り、パプリカ粉を振ってソースとともに人数分へ分ける。材料表の油は食べる部分に残る吸収量の目安として扱う。',
  ],urls.royalSide,{minutes:25,sourceNote:`${general} ${fryNote} トマトソースも含めて計上します。参考：${urls.royalSide}`}),
  recipe('camembert-fry','カマンベールチーズフライ','side','dairy','fried',[
    ['palette_camembert',120],['flour',16],['egg',.5],['breadcrumbs',25],['oil',16],['canned_tomato',100],['garlic',3],['olive_oil',4],['salt',.3],['black_pepper',.1],
  ],[
    'カマンベールをひと口大に切る。薄力粉、溶き卵、パン粉の順に衣を付け、切り口を隙間なく覆って冷蔵庫で10分ほど落ち着かせる。',
    '小鍋にオリーブ油と刻んだにんにくを入れて弱火で温め、トマト缶を加える。5〜7分煮詰め、塩とこしょうで味を調える。',
    '揚げ鍋の油を170〜175℃に熱し、衣を付けたチーズを少量ずつ静かに入れる。短時間で衣を色よく揚げ、チーズが流れ出る前に取り出す。',
    '網で油を切り、トマトソースとともに人数分へ盛る。中が熱いため、少し落ち着かせてからいただく。',
  ],urls.cocosCheese,{minutes:25,sourceNote:`${general} 店舗のクリーミーフライを参考に、カマンベールそのものへ衣を付ける家庭用配合です。植物油は吸収量、オリーブ油はトマトソース用として別に計上します。${fryNote} 参考：${urls.cocosCheese}`}),
  recipe('mentaiko-cheese-baked-potato','明太チーズのベイクドポテト','side','vegetable','grill',[
    ['potato',340],['acmp_mentaiko',30],['cheese',40],['butter',8],['milk',20],['parsley',2],['black_pepper',.2],
  ],[
    'じゃがいもはよく洗い、皮付きのまま使う。芽や緑色の部分を十分に取り除き、竹串で数か所穴を開ける。',
    '湿らせたキッチンペーパーと耐熱の覆いを使い、電子レンジで竹串がすっと通るまで加熱する。加熱むらを避けるため途中で向きを変え、少し蒸らす。',
    'じゃがいもへ切り込みを入れて開き、内側を軽くほぐす。薄皮から出した明太子、牛乳、バターを混ぜて詰め、チーズをのせる。',
    '200℃に予熱したオーブンで10分前後、明太子の中心まで十分に火を通してチーズへ焼き色を付ける。刻んだパセリとこしょうを振り、人数分へ分ける。',
  ],urls.cocosPotato,{minutes:30,displaySecondaryCategories:['dairy','fish'],sourceNote:`${general} 辛子明太子とチーズの製品由来の塩分も合算し、追加の食塩は使わない配合です。参考：${urls.cocosPotato}`}),
  recipe('chilli-bean-cheese-bake','彩り野菜とチリコンカンのチーズ焼き','side','vegetable','grill',[
    ['beef_minced',100],['kidney_bean_cooked',120],['onion',80],['pepper',60],['zucchini',80],['canned_tomato',180],['garlic',5],['olive_oil',8],['cheese',40],['cumin',1],['paprika_powder',1],['chilli',.3],['salt',1.2],
  ],[
    '玉ねぎとにんにくを細かく刻み、ピーマンとズッキーニを小さめの角切りにする。赤いんげん豆の水煮は無調味のものを使い、表示量に合わせる。',
    'フライパンにオリーブ油を熱し、玉ねぎとにんにくを弱めの中火で炒める。牛ひき肉を加えてほぐし、ピーマンとズッキーニを加える。',
    'トマト缶、水煮豆、クミン、パプリカ粉、とうがらし、塩を加える。弱めの中火で10〜15分、混ぜながら煮詰め、肉の中心75℃で1分以上の加熱を確認する。',
    '耐熱皿へ入れ、チーズを全体へ散らす。200℃に予熱したオーブンで5〜8分、チーズが溶けて焼き色が付くまで焼いて人数分へ分ける。',
  ],urls.cocosChilli,{minutes:35,displaySecondaryCategories:['bean','meat','dairy']}),
]);
