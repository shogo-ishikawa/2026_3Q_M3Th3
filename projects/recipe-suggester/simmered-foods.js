/** v3.11: 鍋料理12種と、おでん・柚子胡椒に使う食材。材料は2人分。 */
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const food=(name,allergens=[],groups=[],proteinSources=[],extra={})=>({name,unit:'g',allergens,groups,proteinSources,...extra});
export const SIMMERED_INGREDIENTS=freeze({
  simmered_yuzu_kosho:food('柚子こしょう（青・ペースト）',[],[],[],{
    note:'エスビー食品のビン入り柚子こしょうを代表に、ゆずと青唐辛子・食塩からなるペーストを想定します。粉末や赤柚子こしょうではありません。塩分・辛さは商品で異なるため実物の表示を優先してください。',
  }),
  simmered_satsumaage:food('さつま揚げ（プレーン・調理済み）',['wheat','egg','soy'],['protein'],['fish'],{
    ingredientsKnown:false,allergensKnown:false,shoppingKnown:true,
    note:'成分表の一般的な揚げかまぼこ。卵白・でんぷん・大豆を含む配合を保守的に想定しています。魚種・副原料・原材料は銘柄によるため未確認とし、商品の表示で確認してください。衣や揚げ油を別に加えません。',
  }),
  simmered_chikuwabu:food('ちくわぶ（小麦の生地・加熱済み）',['wheat'],['staple'],[],{
    derivedFrom:['flour'],note:'成分表のちくわぶ。魚肉の焼きちくわとは別の食品です。煮込む前の製品重量を量り、吸水後の重量と混同しません。',
  }),
  simmered_tsumire:food('魚のつみれ（加熱済み・代表品）',['egg','wheat','soy'],['protein'],['fish'],{
    note:'紀文つみれ90g・5粒の公式表示を代表に使用します。1粒18g。魚肉・植物性たん白・でん粉・卵白等を含む加熱済み品で、生のすり身や家庭の魚団子とは異なります。実物の商品表示を確認してください。',
  }),
  simmered_gobomaki:food('ごぼう巻（揚げかまぼこ・調理済み）',['egg','wheat','soy'],['protein','vegetable'],['fish'],{
    note:'伏見蒲鉾ごぼう巻（真空）108g・4本の公式表示を代表に使用します。1本27g。ごぼうと魚肉の揚げ製品を一緒に量り、揚げ油を別に加えません。',
  }),
  simmered_quail_egg_boiled:food('うずら卵（水煮・殻と液を除く）',['egg'],['protein'],['egg'],{
    note:'うずら卵の水煮缶詰の可食部。殻や漬け液を除いた製品重量です。1個約9gは入力用の目安で、鶏卵1個と同じ重量ではありません。',
  }),
  simmered_duck:food('合鴨肉（皮つき・生）',[],['protein'],['meat'],{
    note:'成分表のあいがも・肉・皮つき・生の可食部重量です。皮なし鴨肉や鶏肉、あひるの値と混同しません。煮汁へ出た脂も食べる概算で、脂を捨てた量は差し引いていません。',
  }),
  simmered_oyster:food('かき（養殖・加熱用・むき身）',[],['protein'],['fish'],{
    note:'養殖かき・生のむき身の可食部重量。殻付き重量に廃棄率を再適用せず、缶詰やカキフライとは分けます。加熱用を使い、中心まで十分に加熱します。かきは登録アレルゲン29品目の項目にはありませんが、本人の除外食材として指定できます。',
  }),
  simmered_mizuna:food('水菜（葉・生）',[],['vegetable'],[],{note:'根元と傷んだ部分を除いた生の可食部重量。下ゆで後の重量ではありません。'}),
  simmered_maitake:food('まいたけ（生）',[],['vegetable'],[],{note:'硬い根元など食べない部分を除いた生の可食部重量。乾燥品ではありません。'}),
});
const mext=(group,code)=>`日本食品標準成分表（八訂）増補2023年 食品番号${code}、可食部100g値。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${code}_7`;
const rows={
  simmered_yuzu_kosho:{raw:[50,1,1,8,null,13],estimates:{fiber:1.03},
    source:'エスビー食品「ビン入り柚子こしょう」80gの公式10g表示（5kcal、P0.1g、F0.1g、C0.8g、食塩1.3g）を100g換算。確認日2026-11-13。https://www.sbfoods.co.jp/products/detail/18147.html',
    estimateNote:'食物繊維は未表示のため原値はnull。製品100g中に生青唐辛子相当10gを含むと仮定し、既存の生とうがらし代表値（食品番号06171）の繊維10.3g/100gを使って1.03g/100gを計算用に補完。実際の配合・分析値ではありません。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=6_06171_7'},
  simmered_satsumaage:{raw:[116,11.3,2.4,12.6,0,2],source:mext(10,'10386')},
  simmered_chikuwabu:{raw:[160,7.1,1.2,31.1,1.5,0],source:mext(1,'01069')},
  simmered_tsumire:{raw:[98/90*100,10.4/90*100,2.8/90*100,7.7/90*100,null,1.2/90*100],estimates:{fiber:0},
    source:'紀文食品「紀文つみれ」1包装90g（5粒）の公式表示から100gへ換算。確認日2026-11-13。https://www.kibun.co.jp/products/all_168750a/index.html',
    estimateNote:'食物繊維は未表示のため原値はnull。魚肉・植物性たん白・でん粉主体の配合で、目に見える野菜のないつみれを想定して計算上0g/100gと仮定しています。'},
  simmered_gobomaki:{raw:[144/108*100,8.5/108*100,3.9/108*100,18.7/108*100,null,1.3/108*100],estimates:{fiber:1.14},
    source:'伏見蒲鉾「ごぼう巻（真空）」標準108g（4本）の公式表示から100gへ換算。掲載値はメーカーのサンプル分析による推定値。確認日2026-11-13。https://fushimikamaboko.co.jp/lineup/369/',
    estimateNote:'食物繊維は未表示のため原値はnull。ごぼうが重量の20%と仮定し、既存ごぼう代表値（食品番号06084）の繊維5.7g/100gから1.14g/100gを計算用に補完。実際の配合・分析値ではありません。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=6_06084_7'},
  simmered_quail_egg_boiled:{raw:[162,11,14.1,.6,0,.5],source:mext(12,'12003')},
  simmered_duck:{raw:[304,14.2,29,.1,0,.2],source:mext(11,'11205')},
  simmered_oyster:{raw:[58,6.9,2.2,4.9,0,1.2],source:mext(10,'10292')},
  simmered_mizuna:{raw:[23,2.2,.1,4.8,3,.1],source:mext(6,'06072')},
  simmered_maitake:{raw:[22,2,.5,4.4,3.5,0],source:mext(8,'08028')},
};
const perGram=values=>Object.fromEntries(KEYS.map((key,index)=>[key,values[index]===null?null:values[index]/100]));
export const SIMMERED_NUTRITION=freeze(Object.fromEntries(Object.entries(rows).map(([id,row])=>{
  const rawNutritionPerUnit=perGram(row.raw),nutritionPerUnit={...rawNutritionPerUnit};
  for(const [key,value] of Object.entries(row.estimates??{}))nutritionPerUnit[key]=value/100;
  return [id,{gramsPerUnit:1,rawNutritionPerUnit,nutritionPerUnit,estimatedNutrients:Object.keys(row.estimates??{}),
    rawNutritionSource:row.source,nutritionSource:[row.source,row.estimateNote,SIMMERED_INGREDIENTS[id].note].filter(Boolean).join(' ')}];
})));
const recipe=(slug,name,category,ingredients,steps,source,extra={})=>({
  id:`simmered-${slug}`,name,role:'main',family:category==='fish'?'fish-main':'meat-main',genre:'和食',
  minutes:30,servings:2,staple:false,mealBase:false,nature:'home-cooked',portion:{amount:1,unit:'皿'},
  ingredients:ingredients.map(([id,amount])=>({id,amount})),steps,allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
  displayCategory:category,displayMethod:'hotpot',displaySecondaryCategories:['vegetable','mushroom'],tags:['定番'],
  variantLabel:name,sourceNote:`家庭で用意できる材料へ組み直した本アプリの配合です。参照元の専用鍋つゆ・分量・公式栄養をそのまま再現するものではありません。肉・野菜は材料に表示した状態の可食部重量。具と鍋つゆを全量食べる概算で、残すつゆや下ゆでによる脂・栄養の流出は未補正です。ご飯や麺の締めは含めず、食べる場合は別に登録します。構成・調理の参考：${source}`, ...extra,
});
export const SIMMERED_RECIPES=freeze([
  recipe('pork-millefeuille-nabe','豚ばらと白菜のミルフィーユ鍋','meat',[
    ['dish_pork_belly_sliced',240],['chinese_cabbage',500],['shimeji',100],['ginger',10],['water',550],['soy_sauce',20],['mirin',20],['sake',30],
  ],[
    '白菜は洗って水気を切り、葉の間に豚ばら薄切り肉を広げて重ねる。重ねた束を鍋の深さより少し低く切り、切り口を上にして隙間なく並べる。しめじはほぐし、しょうがは薄切りにする。',
    '水・しょうゆ・みりん・清酒を混ぜて鍋へ静かに注ぐ。しめじとしょうがを隙間へ入れ、中火で沸かしたらふたをして弱めの中火で12〜15分煮る。',
    'ときどき底の汁を確認し、焦げそうなら水を少しずつ補う。白菜の芯が透き通り、肉の重なった中心が75℃で1分以上になるまで加熱する。',
    '白菜と肉の重なりを崩しすぎないよう器へ移し、汁と一緒に取り分ける。白菜の甘みと豚肉のうま味がなじんだところをいただく。',
  ],'ミツカン 白菜の一口ミルフィーユ鍋 https://www.mizkan.co.jp/ouchirecipe/recipe/?menu_id=14007',{displaySecondaryCategories:['vegetable','mushroom']}),
  recipe('pork-mizore-nabe','豚肉と大根おろしのみぞれ鍋','meat',[
    ['pork',260],['daikon',400],['negi',100],['shimeji',100],['simmered_mizuna',100],['noodle_chinese_stock',600],['soy_sauce',15],['sake',20],['ginger',8],
  ],[
    '大根は皮をむいてすりおろし、汁を別の器へ取り分ける。豚肉は食べやすく切る。長ねぎを斜めに切り、しめじをほぐし、水菜は根元を洗って切る。しょうがは細切りにする。',
    '鍋に中華だし・しょうゆ・清酒・しょうがと大根の汁を入れて沸かす。豚肉を重ならないよう加え、アクを取り、長ねぎとしめじを入れて弱めの中火で煮る。',
    '豚肉の中心75℃で1分以上を確認したら、大根おろしを広げてひと煮立ちさせる。水菜を加えてしんなりするまで温める。',
    '煮込みすぎて大根の食感を失わないうちに取り分ける。大根の汁も使う配合なので、捨てずに加える。',
  ],'味の素 豚みぞれ鍋 https://park.ajinomoto.co.jp/recipe/card/707849/'),
  recipe('chicken-yuzu-kosho-nabe','鶏肉と水菜の柚子胡椒鍋','meat',[
    ['chicken',300],['chinese_cabbage',300],['tofu',200],['simmered_mizuna',100],['shiitake',80],['water',600],['sake',30],['soy_sauce',12],['simmered_yuzu_kosho',6],['ginger',8],
  ],[
    '鶏もも肉は厚い部分を開いて一口大に切る。白菜の芯と葉を分けて切り、しいたけを食べやすくする。豆腐は水を切って角切りにし、水菜は根元を洗って切る。しょうがは薄切りにする。',
    '鍋に水・清酒・しょうゆ・しょうがを入れ、鶏肉と白菜の芯を加えて中火にかける。煮立ったらアクを取り、ふたを少しずらして弱めの中火で10〜12分煮る。',
    'しいたけ・豆腐・白菜の葉を加え、鶏肉の中心75℃で1分以上の加熱を確認する。水菜を加えてさっと火を通す。',
    '柚子胡椒は鍋の汁を少し取って溶かし、火を弱めて戻す。香りを飛ばさないよう長く煮立てず、具と汁を取り分ける。辛味と香りを確かめながら、温かいうちにいただく。',
  ],'キッコーマン ゆずこしょう香る鶏だんご鍋 https://www.kikkoman.co.jp/homecook/search/recipe/00055362/',{displaySecondaryCategories:['vegetable','mushroom','bean']}),
  recipe('chicken-salt-lemon-nabe','鶏むね肉の塩レモン鍋','meat',[
    ['chicken_breast',300],['starch',12],['chinese_cabbage',350],['negi',100],['enoki',100],['simmered_mizuna',80],['lemon_slice',40],['lemon',15],['garlic',6],['ginger',8],['salt',2.5],['mirin',20],['water',600],
  ],[
    '鶏むね肉は繊維を断つように薄いそぎ切りにし、片栗粉を薄くまぶす。白菜の芯と葉を分けて切り、長ねぎを斜め切りにする。えのきは根元を除いてほぐし、水菜は洗って切る。',
    '鍋に水・塩・みりん・すりおろしたにんにくとしょうがを入れ、白菜の芯と長ねぎを加えて沸かす。鶏肉をほぐしながら入れ、ふたをして弱めの中火で煮る。',
    'えのきと白菜の葉を加え、鶏肉の中心75℃で1分以上を確認する。水菜を加えて火を通し、レモン汁を混ぜる。',
    '皮をよく洗った薄切りレモンを最後にのせ、短く温めて取り分ける。皮の苦みが出るので輪切りを長く煮込まない。麺などの締めを食べる場合は別に登録する。',
  ],'象印 鶏塩レモン鍋 https://www.zojirushi.co.jp/recipe/list/1050.html',{displaySecondaryCategories:['vegetable','mushroom','fruit']}),
  recipe('ishikari-nabe','鮭とじゃがいもの石狩鍋','fish',[
    ['salmon',280],['potato',200],['cabbage',300],['onion',150],['carrot',100],['tofu',200],['shiitake',80],['water',600],['miso',36],['mirin',20],['sake',20],['butter',12],
  ],[
    '鮭は無塩の生切り身を使い、骨を確認して一口大に切る。じゃがいもを大きめに切り、にんじんは薄め、キャベツと玉ねぎは食べやすく切る。しいたけを切り、豆腐は水を切る。',
    '鍋に水・清酒・じゃがいも・にんじん・玉ねぎを入れ、沸いたら弱めの中火で8〜10分煮る。みそを鍋の汁で溶き、みりんと一緒に加える。',
    '鮭・キャベツ・しいたけ・豆腐を加え、ふたを少しずらして煮る。じゃがいもに竹串が通り、鮭の中心まで白く十分に火が通るまで加熱する。',
    '最後にバターを溶かし、強く煮立てずに取り分ける。塩鮭ではなく生鮭の配合なので、使う魚を混同しない。',
  ],'農林水産省北海道農政事務所 石狩鍋 https://www.maff.go.jp/hokkaido/suishin/shokuiku/dentoshoku_ishikarinabe.html',{minutes:40,displaySecondaryCategories:['vegetable','mushroom','bean','dairy']}),
  recipe('beef-motsu-nabe','牛もつのにんにく醤油鍋','meat',[
    ['meat_beef_small_intestine_raw',260],['cabbage',400],['chive',80],['burdock',80],['negi',80],['garlic',15],['ginger',10],['chilli',.5],['noodle_chinese_stock',650],['soy_sauce',22],['mirin',20],['miso',12],
  ],[
    '牛もつは加熱用の小腸を使い、表示に従って下処理する。分量外のたっぷりの湯で7〜8分下ゆでし、ざるへ上げて水気を切る。下ゆで前の生の可食部重量を材料欄で量る。',
    'キャベツを大きめに切り、ごぼうはささがきにしてさっと水にさらす。長ねぎは斜め切り、にらは短く切り、にんにくとしょうがは薄切りにする。',
    '鍋に中華だし・しょうゆ・みりん・みそ・にんにく・しょうが・唐辛子を入れ、もつとごぼうを加えて弱めの中火で15〜20分煮る。もつの中心75℃で1分以上を確認する。',
    'キャベツと長ねぎを加えて柔らかく煮て、最後ににらを加える。締めの麺は含まない。下ゆでで落ちた脂は計算から差し引かないため、栄養は材料全量による概算になる。',
  ],'エバラ もつ鍋 https://gyoumuyou.ebarafoods.com/recipe/detail/recipe000142.html',{minutes:45,displaySecondaryCategories:['vegetable']}),
  recipe('oyster-miso-nabe','かきと豆腐の味噌鍋','fish',[
    ['simmered_oyster',240],['chinese_cabbage',350],['tofu',200],['negi',100],['shimeji',100],['miso',30],['mirin',20],['sake',20],['ginger',8],['noodle_niboshi_stock',600],
  ],[
    '加熱用のかきのむき身は表示に従ってやさしく洗い、水気を切る。白菜の芯と葉を分けて切り、長ねぎは斜め切り、しめじは小房にする。豆腐を切り、しょうがを薄切りにする。',
    '鍋に煮干しだし・清酒・みりん・しょうが・白菜の芯・長ねぎを入れ、弱めの中火で5〜7分煮る。みそを鍋の汁で溶いて加える。',
    'かき・しめじ・豆腐・白菜の葉を入れ、かきの中心を85〜90℃で90秒以上加熱する。表面が白くなっただけで止めず、十分な加熱を確認する。',
    'かきに火が通ったら強く煮込み続けず、具と汁を取り分ける。骨や殻を含む重量ではなく、材料欄はむき身の重さとして記録する。',
  ],'山内鮮魚店 牡蠣鍋（味噌味） https://www.yamauchi-f.com/recipe/?p=1307',{displaySecondaryCategories:['vegetable','mushroom','bean']}),
  recipe('duck-negi-nabe','合鴨と焼きねぎの鍋','meat',[
    ['simmered_duck',240],['negi',240],['simmered_mizuna',120],['simmered_maitake',100],['tofu',200],['water',600],['soy_sauce',24],['mirin',30],['sake',25],['ginger',8],
  ],[
    '皮付きの合鴨肉は薄く切り、長ねぎは一部を太めのぶつ切り、残りを斜め切りにする。水菜を洗って切り、まいたけをほぐす。豆腐を水切りして切り、しょうがを薄切りにする。',
    'フライパンを中火にかけ、鴨の皮側とぶつ切りのねぎへ軽く焼き目を付ける。出た脂も捨てずに鍋へ移す。この段階で鴨の中心まで火を通したとはみなさない。',
    '鍋へ水・しょうゆ・みりん・清酒・しょうがを加えて沸かす。鴨肉・残りのねぎ・豆腐・まいたけを入れ、鴨の中心75℃で1分以上になるまで弱めの中火で煮る。',
    '最後に水菜を加えてしんなりするまで加熱する。鴨とねぎを一緒に盛り、脂を含む煮汁も取り分ける。そばなどの締めは別の主食として記録する。',
  ],'ミツカン 鴨鍋 https://www.mizkan.co.jp/prouse/recipe/resipe_detail/?MenuID=817',{minutes:35,displaySecondaryCategories:['vegetable','mushroom','bean']}),
  recipe('chicken-tomato-cheese-nabe','鶏肉と野菜のチーズトマト鍋','meat',[
    ['chicken',260],['cabbage',300],['onion',150],['broccoli',120],['shimeji',100],['canned_tomato',400],['cheese',60],['garlic',8],['olive_oil',10],['water',350],['salt',2],['black_pepper',.2],
  ],[
    '鶏肉は一口大に切り、キャベツと玉ねぎを食べやすく切る。ブロッコリーは小房に分け、しめじをほぐし、にんにくをみじん切りにする。',
    '厚手の鍋にオリーブ油とにんにくを入れて弱火で香りを出し、鶏肉の表面を焼く。玉ねぎを加えて透き通るまで炒め、トマト缶・水・塩・こしょうを加える。',
    'キャベツとしめじを入れ、ふたを少しずらして弱めの中火で10〜12分煮る。鶏肉の中心75℃で1分以上を確認し、ブロッコリーを加えて柔らかくする。',
    'チーズを全体へ散らしてふたをし、溶けたら底から静かに混ぜて取り分ける。ご飯を入れるリゾット風の締めは、この材料と栄養には含めない。',
  ],'カゴメ トマト鍋の家庭向け展開（トマトカレー鍋の構成を参考） https://www.kagome.co.jp/products/recipe/15085/',{genre:'洋食',displaySecondaryCategories:['vegetable','mushroom','dairy']}),
  recipe('chicken-curry-nabe','鶏肉と白菜の和風カレー鍋','meat',[
    ['chicken',260],['chinese_cabbage',300],['negi',100],['shimeji',100],['aburaage',40],['carrot',80],['noodle_niboshi_stock',600],['soy_sauce',24],['mirin',20],['curry_powder',8],['oil',8],['garlic',8],['ginger',8],
  ],[
    '鶏肉は一口大に切り、白菜の芯と葉を分け、長ねぎは斜め切りにする。にんじんは薄切り、しめじは小房にし、油揚げは短冊切りにする。にんにくとしょうがは刻む。',
    '鍋に油・にんにく・しょうがを入れて弱火で温め、鶏肉の表面を焼く。カレー粉を振り入れて焦がさないよう短く炒め、すぐに煮干しだしを少しずつ加えて溶きのばす。',
    'しょうゆ・みりん・白菜の芯・にんじん・長ねぎを加えて煮る。鶏肉の中心75℃で1分以上を確認し、しめじ・油揚げ・白菜の葉を加えてさらに煮る。',
    '野菜が好みの柔らかさになったら取り分ける。とろみの強いカレールウではなく、香辛料だけのカレー粉を使う。ご飯やうどんの締めは別に登録する。',
  ],'エスビー食品 和風カレー鍋 https://www.sbfoods.co.jp/akakan/recipe/09.html',{genre:'和食',displaySecondaryCategories:['vegetable','mushroom','bean']}),
  recipe('soy-milk-tantan-nabe','豚そぼろと野菜の豆乳担々鍋','meat',[
    ['pork_minced',240],['tofu',200],['chinese_cabbage',250],['bean_sprout',150],['komatsuna',100],['soy_milk',400],['water',300],['ground_sesame',30],['miso',20],['soy_sauce',15],['mapo_doubanjiang',8],['mapo_tianmianjiang',10],['mapo_chilli_oil',6],['oil',6],['garlic',8],['ginger',8],
  ],[
    '白菜は芯と葉を分けて切り、小松菜は茎と葉を分ける。もやしを洗って水気を切り、豆腐を切る。にんにくとしょうがはみじん切りにする。',
    '鍋に植物油・にんにく・しょうがを入れて弱火で香りを出す。ひき肉を加えてほぐし、豆板醤と甜麺醤を加えて炒める。肉の中心75℃で1分以上を確認する。',
    '水・しょうゆ・みそを加えて溶かし、白菜の芯ともやし・小松菜の茎・豆腐を入れて弱めの中火で煮る。野菜が柔らかくなったら無調整豆乳とすりごまを加える。',
    '白菜と小松菜の葉を加え、沸騰させ続けない火加減で全体を十分に温める。ラー油を混ぜて取り分ける。豆乳の分離を抑えるため、煮立ったら火を弱める。',
  ],'桃屋 豆乳担々鍋の具材構成を参考に、食べるラー油を通常の調味料へ分解 https://www.momoya.co.jp/recipe/detail/4209/index.html',{genre:'中華',displaySecondaryCategories:['vegetable','bean']}),
  recipe('pork-spinach-joya-nabe','豚肉とほうれん草の常夜鍋','meat',[
    ['pork',260],['spinach',300],['negi',100],['simmered_maitake',100],['water',600],['sake',40],['soy_sauce',20],['mirin',15],['lemon',20],
  ],[
    'ほうれん草は根元の土を洗い、分量外の湯でさっと下ゆでして水に取り、水気を絞って切る。長ねぎは斜め切り、まいたけは小房、豚肉は食べやすい長さにする。',
    '鍋に水・清酒・しょうゆ・みりんを入れて沸かす。長ねぎとまいたけを加えて煮て、豚肉を広げながら少量ずつ加える。',
    '肉が重なっている部分をほぐし、豚肉の中心75℃で1分以上を確認する。下ゆでしたほうれん草を加え、全体が熱くなるまで温める。',
    'レモン汁を混ぜて取り分ける。ほうれん草の材料量は下ゆで前の可食部重量で、ゆで汁へ流れた栄養や絞った水分は補正していない。',
  ],'キッコーマン 常夜鍋 https://www.kikkoman.co.jp/homecook/search/recipe/00057592/',{minutes:25,displaySecondaryCategories:['vegetable','mushroom']}),
]);
