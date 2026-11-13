/** v3.11: お吸い物・あら汁・洋風スープと肉ワンタン。表示量は2人分です。 */
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const food=(name,unit,allergens=[],extra={})=>({name,unit,allergens,groups:[],proteinSources:[],...extra});
export const SOUP311_INGREDIENTS=freeze({
  soup311_awase_dashi:food('かつお・昆布の合わせだし（抽出液）','ml',[],{
    derivedFrom:['bonito','kombu'],
    note:'かつお節と昆布を取り除いた液体のだしです。顆粒だしや濃縮白だしとは別物で、食材本体の全重量を食べる計算にはしません。1ml≒1gで換算します。',
  }),
  soup311_consomme:food('コンソメスープの素（固形の代表値）','g',['wheat','milk','beef','soy','chicken'],{
    derivedFrom:['flour','milk','beef','soybeans','chicken'],
    note:'味の素KKコンソメ固形の表示を代表に使用。溶かす前の重量で、1個5.3gが目安です。無塩のだしや塩分ひかえめ品とは区別します。加工品の原材料は実物の表示を確認してください。',
  }),
  soup311_wonton_wrappers:food('ワンタンの皮（生）','g',['wheat','soy'],{
    derivedFrom:['flour','soybeans'],
    note:'トップバリュ雲呑・焼売の皮の表示を代表に使用。加熱前の重量です。30枚約110gから1枚約3.67gとする目安で、皮の厚さや商品で変わります。乾燥粉やゆで上がり重量とは区別します。',
  }),
});
const profile=(raw,denominator,source,estimates={},estimateNote='')=>{
  const rawNutritionPerUnit=Object.fromEntries(KEYS.map((key,index)=>[key,raw[index]===null?null:raw[index]/denominator]));
  return {gramsPerUnit:1,rawNutritionPerUnit,rawNutritionSource:source,
    nutritionPerUnit:{...rawNutritionPerUnit,...Object.fromEntries(Object.entries(estimates).map(([key,value])=>[key,value/denominator]))},
    estimatedNutrients:Object.keys(estimates),nutritionSource:`${source}${estimateNote?` 計算用の概算補完：${estimateNote}`:''}`};
};
export const SOUP311_NUTRITION=freeze({
  soup311_awase_dashi:profile([2,.3,null,.3,null,.1],100,
    '日本食品標準成分表（八訂）増補2023年 食品番号17021「荒節・昆布だし」の可食部100g。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=17_17021_7',
    {fat:.03,fiber:0},'脂質Trは0.01以上0.05g未満/100gの中央0.03g/100gを仮定。未掲載の食物繊維は、固形物をこしただしとして計算上0g/100gと仮定。液体は1ml≒1g。'),
  soup311_consomme:profile([12,.36,.26,2,null,2.4],5.3,
    '味の素KKコンソメ固形、公式の1個5.3g当たり表示。確認日2026-11-13。https://www.ajinomoto.co.jp/products/detail/?ProductName=consomme_1',
    {fiber:0},'食物繊維は未表示のため原値はnull。食塩・糖・エキスを主体とするスープの素で固形の野菜を含まない代表品として、計算用に0g/5.3gと仮定。'),
  soup311_wonton_wrappers:profile([297,9,1.2,63.6,1.9,.7],110,
    'イオン トップバリュ「雲呑・焼売の皮」の公式1袋30枚約110g当たり表示。全6項目が表示された規格を代表に使用。確認日2026-11-13。https://www.topvalu.net/items/detail/4902121716661/'),
});
const parts=entries=>entries.map(([id,amount])=>({id,amount}));
const recipe=(slug,name,genre,items,steps,extra={})=>({
  id:`soup311-${slug}`,name,role:'soup',family:'soup',genre,minutes:20,servings:2,
  ingredients:parts(items),steps,tags:(extra.minutes??20)<=20?['時短']:[],staple:false,mealBase:false,nature:'home-cooked',
  portion:{amount:1,unit:'杯',label:'鍋の具と汁を均等に分けた1人分の1杯'},
  ingredientsKnown:true,allergensKnown:true,shoppingKnown:true,
  sourceNote:'材料表の可食量から計算した家庭用の代表配合です。具と汁を全量食べる想定で、特定店舗の配合・表示値ではありません。',...extra,
});
const araNote='魚の量は骨などを除いた身の可食部に相当する調理前重量で、骨付きあらの購入重量ではありません。骨付きの量を身の重量へ自動換算しません。鮭・ぶりの通常の身を代理値として計算し、かま・頭の脂の差や霜降りで流出する脂は未補正です。骨そのものの重量は栄養に加えません。';
export const SOUP311_RECIPES=freeze([
  recipe('osuimono-tofu-wakame','豆腐とわかめのお吸い物','和食',[
    ['silken_tofu',120],['wakame',1],['soup311_awase_dashi',400],['soy_sauce',6],['salt',.6],['scallion_garnish',5],
  ],[
    '豆腐は小さめの角切りにする。乾燥わかめは水で戻して水気を切り、食べやすい長さに切る。小ねぎは小口切りにする。',
    '鍋に材料表の合わせだしを入れて中火で温め、豆腐を加える。弱く煮立つ状態で2〜3分、豆腐の中まで温める。',
    'わかめ、しょうゆ、塩を加え、再び温まったら火を止める。具と汁を均等に椀へ盛り、小ねぎを散らす。',
  ],{minutes:10,variantLabel:'豆腐とわかめ',sourceNote:'わかめと豆腐のお吸い物の調理法を参考に、顆粒だしを抽出済みの合わせだしへ置き換えた家庭用配合。豆腐・わかめ・汁を全量計上します。https://park.ajinomoto.co.jp/recipe/card/010726/ https://park.ajinomoto.co.jp/recipe/card/705969/'}),
  recipe('osuimono-asari','あさりのお吸い物','和食',[
    ['clam',200],['water',400],['sake',15],['soy_sauce',3],['salt',.3],['scallion_garnish',5],
  ],[
    '砂抜き済みの殻付きあさりをこすり洗いし、殻が割れたものや傷んだものを取り除く。小ねぎは小口切りにする。',
    '鍋にあさり、材料表の水、清酒を入れる。ふたをして中火にかけ、煮立ったら弱めの火にしてあくをすくう。',
    '殻が開いてからも身の中心まで十分に加熱する。開かない貝は取り除き、しょうゆと塩を加える。器へ具と汁を分け、小ねぎを散らす。',
  ],{minutes:15,variantLabel:'あさり',sourceNote:'あさりのお吸い物の調理法を参考にした代表配合。材料のあさりは殻付き重量で、既存食材の可食率30%を一度だけ適用します。蒸し汁は全量使い、殻は食べた栄養に加えません。https://park.ajinomoto.co.jp/recipe/card/702662/'}),
  recipe('arajiru-salmon','鮭のあら汁（しょうゆ仕立て）','和食',[
    ['salmon',160],['taro',80],['daikon',100],['carrot',50],['burdock',30],['tofu',100],['negi',40],
    ['soup311_awase_dashi',500],['sake',20],['soy_sauce',12],['ginger',6],
  ],[
    '鮭のあらは食べる身の可食部を材料表の量だけ確保できる分を用意し、流水で血やうろこを落とす。熱湯を回しかけ、表面の汚れをやさしく洗う。骨を外した身だけを使ってもよい。',
    '里いもは皮をむいて下ゆでし、ぬめりを流す。大根とにんじんはいちょう切り、ごぼうは薄いささがきにする。豆腐は角切り、長ねぎは斜め切り、しょうがは薄切りにする。',
    '鍋に合わせだし、大根、にんじん、ごぼう、里いも、しょうがを入れる。煮立ったら弱めの中火にし、根菜がほぼやわらかくなるまで8〜10分煮る。',
    '鮭と清酒を加えてあくを取り、身の中心まで十分火が通るまで7〜8分煮る。しょうゆ、豆腐、長ねぎを加えてひと煮立ちさせる。',
    '器へ盛り、骨付きのあらを使った場合は食べるときに小骨も除く。残った骨は食べた量に含めず、身と汁を均等に分ける。',
  ],{minutes:30,variantLabel:'鮭・しょうゆ仕立て',sourceNote:`あら汁の下処理と根菜を先に煮る順序を参考にした家庭用配合。${araNote} https://park.ajinomoto.co.jp/recipe/card/709853/`}),
  recipe('arajiru-buri','ぶりのあら汁（みそ仕立て）','和食',[
    ['yellowtail',160],['daikon',160],['carrot',60],['tofu',100],['negi',40],['ginger',6],
    ['soup311_awase_dashi',500],['sake',20],['miso',24],
  ],[
    'ぶりのあらは食べる身の可食部を材料表の量だけ確保できる分を用意し、血とうろこを洗う。熱湯を回しかけて霜降りにし、浮いた汚れを洗い流す。骨を除いた身で代用してもよい。',
    '大根とにんじんは薄いいちょう切りにする。長ねぎは白い部分を斜め切り、青い部分を小口切りにする。豆腐は角切り、しょうがは薄切りにする。',
    '鍋に合わせだし、大根、にんじん、しょうがを入れて煮る。根菜がほぼやわらかくなったら、ぶりと清酒を加えてあくをすくう。',
    '弱く煮立つ火加減で7〜8分を目安に、魚の中心まで十分火を通す。豆腐と長ねぎの白い部分を加えて温め、火を弱めてみそを溶く。',
    '煮立て続けずに火を止め、長ねぎの青い部分を添えて人数分へ盛る。骨付きのあらを使った場合は食べるときに小骨まで除き、骨は食べた量に含めない。',
  ],{minutes:30,variantLabel:'ぶり・みそ仕立て',sourceNote:`ニッスイのぶりのあら汁の調理順序を参考に、野菜と調味料を定量化した家庭用配合。${araNote} https://www.nissui.co.jp/recipe/01116.html`}),
  recipe('clam-chowder-tomato','トマトのクラムチャウダー','洋食',[
    ['clam',250],['bacon',30],['potato',120],['onion',80],['carrot',40],['celery',30],['canned_tomato',200],
    ['water',250],['olive_oil',6],['soup311_consomme',2.65],['black_pepper',.1],['parsley',2],
  ],[
    '砂抜き済みのあさりをこすり洗いする。鍋にあさりと材料表の水の一部を入れ、ふたをして加熱する。殻が開いてからも十分に火を通し、開かない貝は使わない。',
    'あさりの身を外し、蒸し汁を細かいざるでこして残す。じゃがいもの芽と緑色の部分を十分に除き、玉ねぎ、にんじん、セロリとともに小さめの角切りにする。ベーコンは細く切る。',
    '鍋にオリーブ油を入れて中火で温め、ベーコンと野菜を炒める。玉ねぎが透き通ったらトマト缶を加え、木べらで崩しながら2〜3分炒める。',
    '蒸し汁、残りの水、コンソメを加える。煮立ったら弱めの火で10〜15分、じゃがいもがやわらかくなるまで煮る。',
    'あさりの身を戻して十分に温め、黒こしょうで調える。具と汁を人数分に分けて盛り、刻んだパセリを散らす。',
  ],{minutes:30,variantLabel:'トマト仕立て',sourceNote:'クラムチャウダーの貝・野菜をトマトで煮る家庭用モデル。カゴメのトマトチャウダーの着想を参考に、あさり・根菜を使い、牛乳や生クリームを加えない配合へ組み直しました。コンソメ自体は乳を含みます。殻付きあさりの可食率は30%。蒸し汁を含む全量を計上し、既存のクリーム仕立てとは別項目です。https://www.kagome.co.jp/products/recipe/Z6352/'}),
  recipe('pumpkin-milk-potage','かぼちゃのミルクポタージュ','洋食',[
    ['pumpkin',240],['onion',80],['butter',10],['milk',250],['water',200],['soup311_consomme',2.65],['black_pepper',.1],
  ],[
    'かぼちゃは種とわたを除き、皮を薄くそいで小さめに切る。材料表のかぼちゃは食べる部分の重量。玉ねぎは薄切りにする。',
    '鍋でバターを溶かし、玉ねぎを弱めの中火で焦がさずに炒める。透き通って甘い香りが出たらかぼちゃ、水、コンソメを加える。',
    'ふたをして弱火で10〜15分、かぼちゃがスプーンでつぶせるまで煮る。火を止めて粗熱を取り、ミキサーでなめらかにする。熱い液体を密閉してかくはんしない。',
    '鍋に戻して牛乳を混ぜ、鍋底から混ぜながら弱火で全体を温める。沸騰させ続けず、黒こしょうを加えて器へ分ける。',
  ],{minutes:30,variantLabel:'かぼちゃ・ミルク',sourceNote:'明治のかぼちゃポタージュの加熱・かくはん方法を参考に、カレー粉や生クリームを使わない普段向けの配合にしました。既存の豆乳仕立てと区別し、牛乳・バター・コンソメも材料から合算します。https://www.meiji.co.jp/meiji-shokuiku/shokuikurecipe/recipe/0845.html'}),
  recipe('consomme-plain','コンソメスープ','洋食',[
    ['water',300],['soup311_consomme',5.3],['parsley',1],
  ],[
    '材料表の水を鍋で沸かす。固形のコンソメを使う場合は溶けやすい大きさに割り、材料表の重量を用意する。',
    'コンソメを加えて弱火で混ぜ、固形分が残らないように溶かす。塩分を含むため、この配合では食塩を追加しない。',
    '刻んだパセリを加えて火を止め、温かいうちに人数分の器へ分ける。汁全量を飲む想定で記録する。',
  ],{minutes:5,variantLabel:'具なし',sourceNote:'味の素KKコンソメ固形の公式使用目安に合わせ、水300mlと固形5.3gを2人分とした一例。製品を溶かす前のgと水を別に計上し、1杯は出来上がりの半量。食塩相当量はスープの素由来も含みます。https://www.ajinomoto.co.jp/products/detail/?ProductName=consomme_1'}),
  recipe('consomme-vegetable','野菜のコンソメスープ','洋食',[
    ['cabbage',100],['onion',80],['carrot',40],['mushroom',60],['water',400],['soup311_consomme',5.3],['black_pepper',.1],
  ],[
    'キャベツは短い細切り、玉ねぎは薄切り、にんじんは薄いいちょう切りにする。マッシュルームは汚れを拭いて薄切りにする。',
    '鍋に材料表の水、コンソメ、にんじん、玉ねぎを入れて中火にかける。煮立ったら弱めの火にし、5分ほど煮る。',
    'キャベツとマッシュルームを加え、さらに5〜7分、具がやわらかくなるまで煮る。追加の食塩は使わず、黒こしょうで香りを調える。',
    '野菜と汁を均等に器へ盛る。煮汁も全量を食べる想定で、固形の野菜とコンソメの栄養をそれぞれ加算する。',
  ],{minutes:20,variantLabel:'野菜',sourceNote:'コンソメを野菜と同時に入れて煮る公式の使い方を参考にした、油を加えない家庭用配合。使用する固形スープの素と水の量を別々に計上します。https://www.ajinomoto.co.jp/products/detail/?ProductName=consomme_1'}),
  recipe('wonton-pork','豚肉と長ねぎのワンタンスープ','中華',[
    ['soup311_wonton_wrappers',44],['pork_minced',80],['negi',40],['ginger',4],['soy_sauce',8],['sake',10],
    ['sesame_oil',4],['salt',.5],['noodle_chinese_stock',400],['komatsuna',80],['black_pepper',.1],
  ],[
    '長ねぎは半量をみじん切り、残りを斜め薄切りにする。しょうがはすりおろす。小松菜はよく洗って食べやすく切り、茎と葉を分ける。',
    '豚ひき肉に刻んだ長ねぎ、しょうが、しょうゆとごま油の各半量、塩と黒こしょうを加える。粘りが出るまで混ぜ、皮に無理なく包める小さな肉だねに分ける。',
    'ワンタンの皮は材料表の加熱前重量を使う。中央に肉だねを薄くのせ、縁を水で軽く湿らせて空気を抜きながら折り、開かないよう押さえる。包む枚数に合わせて肉だねを均等に使う。',
    '鍋に中華だし、清酒、残りのしょうゆと長ねぎ、小松菜の茎を入れて煮立てる。ワンタンをくっつかないように入れ、強くかき混ぜず弱く煮立つ状態でゆでる。',
    '皮が半透明になってからも肉だねの中心75℃で1分以上を確認する。小松菜の葉を加えて火を通し、残りのごま油を混ぜる。具と汁を人数分へ分けて盛る。',
  ],{minutes:25,variantLabel:'豚肉と長ねぎ',sourceNote:'味の素のワンタンスープの包み方と加熱順序を参考に、えびを使わず豚肉・長ねぎ・小松菜で作る家庭用配合です。皮は公式表示30枚約110gの規格から12枚分を44gの目安とし、実重量を優先します。既存の鶏肉・手作り皮のワンタンスープとは別項目。中華だしは抽出済み液体で、顆粒のgと取り違えません。https://park.ajinomoto.co.jp/recipe/card/010732/'}),
]);
