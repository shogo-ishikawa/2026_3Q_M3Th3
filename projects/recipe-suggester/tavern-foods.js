/** v3.11：中華店・焼鳥店の料理構成を参考にした家庭用のおかず。全量は2人分。 */
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const food=(name,allergens,groups,proteinSources,extra={})=>({name,unit:'g',allergens,groups,proteinSources,...extra});
export const TAVERN_INGREDIENTS=freeze({
  tavern_pork_liver:food('豚レバー（肝臓・生）',['pork'],['protein'],['meat'],{derivedFrom:['pork'],note:'血の塊や食べない筋を除いた生の可食重量。牛・鶏のレバーと分けます。下処理・加熱による流出は未補正です。'}),
  tavern_wood_ear_dried:food('きくらげ（乾燥・戻す前）',[],['vegetable'],[],{note:'乾燥きくらげの重量。戻した後の重量を同じ値へ掛けません。水で戻して洗い、必ず加熱して使います。'}),
  tavern_chicken_gizzard:food('鶏砂肝（すなぎも・生）',['chicken'],['protein'],['meat'],{derivedFrom:['chicken'],note:'食べない硬い部分を除いた生の可食重量。焼き鳥や味付け済みの値ではありません。'}),
  tavern_chicken_heart:food('鶏ハツ（心臓・生）',['chicken'],['protein'],['meat'],{derivedFrom:['chicken'],note:'血の塊や食べない血管を除いた生の可食重量。砂肝とは別の部位で、脂質も異なります。'}),
  tavern_onsen_egg:food('温泉卵（たれなし・標準47g）',['egg'],['protein'],['egg'],{unit:'個',derivedFrom:['egg'],note:'バローのたれなし温泉たまごを代表に使用。1個の可食部標準47gで、添付たれは含めません。卵のみの製品を想定し、実物の原材料・保存方法を確認してください。'}),
});
const rows={
  tavern_pork_liver:{code:'11166',group:11,raw:[114,20.4,3.4,2.5,0,.1]},
  tavern_wood_ear_dried:{code:'08006',group:8,raw:[216,7.9,2.1,71.1,57.4,.1]},
  tavern_chicken_gizzard:{code:'11233',group:11,raw:[86,18.3,1.8,null,0,.1],estimates:{carbs:.03}},
  tavern_chicken_heart:{code:'11231',group:11,raw:[186,14.5,15.5,null,0,.2],estimates:{carbs:.03}},
  tavern_onsen_egg:{basis:1,gramsPerUnit:47,raw:[66,6,4.5,.3,null,.2],estimates:{fiber:0},
    source:'バロー開発商品ValorSelect「温泉たまご（たれなし）」1個（可食部標準47g）当たりの公式表示。確認日2026-11-13。https://valor.jp/product/1571/',
    estimateNote:'食物繊維は未掲載のため原値はnull、卵のみの食品として計算用に0g/個を仮定。'},
};
const perUnit=(values,basis)=>Object.fromEntries(KEYS.map((key,index)=>[key,values[index]===null?null:values[index]/basis]));
export const TAVERN_NUTRITION=freeze(Object.fromEntries(Object.entries(rows).map(([id,row])=>{
  const basis=row.basis??100,rawNutritionPerUnit=perUnit(row.raw,basis),nutritionPerUnit={...rawNutritionPerUnit};
  for(const [key,value]of Object.entries(row.estimates??{}))nutritionPerUnit[key]=value/basis;
  const rawNutritionSource=row.source??`日本食品標準成分表（八訂）増補2023年 食品番号${row.code}。可食部100g値を1gに換算。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${row.group}_${row.code}_7`;
  return [id,{gramsPerUnit:row.gramsPerUnit??1,rawNutritionPerUnit,nutritionPerUnit,rawNutritionSource,estimatedNutrients:Object.keys(row.estimates??{}),
    nutritionSource:`${rawNutritionSource} ${TAVERN_INGREDIENTS[id].note} ${row.estimateNote??(row.estimates?'炭水化物Trは原値をnullで保持し、計算用には0.01以上0.05g未満/100gの中央0.03g/100gを仮定。':'')}`}];
})));

const HIDAKA='https://hidakaya.hiday.co.jp/hits/ja/menu/1/list/5.html';
const OHSHO='https://www.ohsho.co.jp/menu/east/';
const TORI='https://torikizoku.co.jp/menu/ippin/';
const SPEED='https://torikizoku.co.jp/menu/speed/';
const YAKI='https://torikizoku.co.jp/menu/yakitori/';
const recipe=(slug,name,role,genre,category,method,items,steps,source,extra={})=>({
  id:`tavern-${slug}`,name,role,genre,minutes:25,servings:2,staple:false,mealBase:false,
  family:role==='side'?'small-dish':category==='bean'?'bean-main':category==='egg'?'egg-main':'meat-main',
  nature:'home-cooked',portion:{amount:1,unit:'皿'},allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
  displayCategory:category,displayMethod:method,displaySecondaryCategories:[],tags:(extra.minutes??25)<=20?['時短']:[],
  ingredients:items.map(([id,amount])=>({id,amount})),steps,
  sourceNote:`公式メニューの料理構成を参考に、家庭の材料と火力で作る配合を設計しました。店舗の製法や栄養表示を示すものではありません。材料表は2人分で、ご飯は含みません。確認日2026-11-13。参考：${source} 出典・配合の考え方は docs/tavern-sources.md。`,...extra,
});

export const TAVERN_RECIPES=freeze([
  recipe('liver-chive','豚レバーとにらのオイスター炒め','main','中華','meat','stir-fry',[
    ['tavern_pork_liver',220],['chive',100],['bean_sprout',200],['onion',80],['ginger',8],['garlic',5],['starch',12],['soy_sauce',12],['oyster_sauce',12],['sake',20],['sugar',4],['oil',12],['water',30],
  ],[
    '豚レバーは薄くそぎ切りにし、清潔な冷水で血の塊を落として水気を十分に拭く。しょうがをすりおろし、にんにくを刻む。生肉を扱った器具を洗ってから野菜の準備へ進む。',
    'レバーにしょうがと清酒の半量、しょうゆの三分の一を絡め、冷蔵庫で約10分置く。にらは食べやすい長さ、玉ねぎは薄切りにし、もやしを洗ってよく水を切る。',
    '残りの清酒・しょうゆにオイスターソース・砂糖・水を混ぜる。レバーへ片栗粉を薄くまぶし、油の三分の二を熱したフライパンへ重ならないよう並べる。',
    '中火で両面を焼き、弱火でふたをしてレバーの中心75℃で1分以上を確認して清潔な皿へ取り出す。表面の焼き色だけで加熱を判断しない。',
    '残りの油とにんにくで玉ねぎ・もやしを強めの中火で炒める。レバーと合わせ調味料を戻して煮立て、最後ににらを加え、葉がしんなりしたら火を止める。たれも一緒に盛る。',
  ],'https://hidakaya.hiday.co.jp/hits/ja/menu/2/detail/29.html',{minutes:30,displaySecondaryCategories:['vegetable']}),
  recipe('spicy-pork-kimchi-vegetables','豚肉とキムチ野菜の辛みそ炒め','main','中華','meat','stir-fry',[
    ['pork',220],['cabbage',200],['bean_sprout',150],['chive',60],['kimchi',100],['onion',80],['miso',16],['soy_sauce',6],['sake',18],['sugar',5],['mapo_doubanjiang',5],['garlic',5],['oil',10],['water',25],
  ],[
    'キャベツは芯を薄く切って葉をざく切りにし、玉ねぎは薄切り、にらは食べやすい長さに切る。もやしは洗って水を切り、キムチは汁ごと使う。',
    'みそ・しょうゆ・清酒・砂糖・豆板醤・水を混ぜ、みその塊を溶かす。豚肉は重なりを広げ、食べやすく切る。',
    'フライパンで油と刻んだにんにくを温め、豚肉を広げて中火で焼く。肉の中心75℃で1分以上を確認する。',
    '玉ねぎ・キャベツの芯を加えて炒め、続けて葉ともやしを加える。フライパンを混ぜすぎず、野菜から出る水分を飛ばす。',
    'キムチと合わせ調味料を加え、全体が熱くなるまで手早く炒める。最後ににらを加えてひと混ぜし、野菜に辛みそが絡んだら盛る。',
  ],'https://hidakaya.hiday.co.jp/hits/ja/menu/1/detail/26.html',{displaySecondaryCategories:['vegetable']}),
  recipe('pork-chive','豚肉とにらの香味しょうゆ炒め','main','中華','meat','stir-fry',[
    ['pork',240],['chive',120],['bean_sprout',180],['carrot',50],['garlic',5],['ginger',5],['soy_sauce',16],['oyster_sauce',8],['sake',15],['sugar',3],['starch',6],['oil',12],['water',30],
  ],[
    'にらは食べやすい長さ、にんじんは細切りにし、もやしを洗って水を切る。にんにくとしょうがは刻む。豚肉は重なりを広げて切る。',
    '清酒の半量と片栗粉の半量を豚肉に揉み込む。残りの清酒・片栗粉にしょうゆ・オイスターソース・砂糖・水を混ぜる。',
    '油と香味野菜をフライパンで温め、豚肉を広げて炒める。塊をほぐしながら中心75℃で1分以上を確認する。',
    'にんじん・もやしを加えて強めの中火で炒め、にんじんが食べられる硬さになったらにらを加える。',
    '合わせ調味料を底から混ぜ直して回し入れ、煮立たせて薄くとろみを付ける。にらの香りと歯ごたえが残るうちに火を止める。',
  ],'https://www.ohsho.co.jp/menu/east/post_349.html',{displaySecondaryCategories:['vegetable']}),
  recipe('pork-wood-ear-egg','豚肉ときくらげの卵炒め','main','中華','meat','stir-fry',[
    ['pork',180],['tavern_wood_ear_dried',6],['egg',3],['bamboo_shoot_cooked',100],['negi',60],['komatsuna',100],['soy_sauce',14],['oyster_sauce',8],['sake',15],['sugar',3],['oil',16],['water',30],['starch',5],
  ],[
    '乾燥きくらげは表示に従い冷蔵庫内で水に戻す。長時間室温に置かず、洗って硬い石づきを除き食べやすく切る。戻し水は捨て、材料表の水はたれに使う。',
    'たけのこの水煮は水気を切って薄切り、長ねぎは斜め薄切り、小松菜は茎と葉に分けて切る。豚肉は食べやすく切る。卵を溶き、たれの調味料・水・片栗粉を別容器で混ぜる。',
    '油の半量を中火で熱し、卵を流して大きく混ぜ、全体が固まったら清潔な皿へ取り出す。',
    '残りの油で豚肉を炒め、中心75℃で1分以上を確認する。きくらげ・たけのこ・小松菜の茎・長ねぎを加えて約3分炒め、きくらげにも十分に火を通す。',
    '小松菜の葉と卵を戻し、混ぜ直したたれを加えて煮立てる。卵を大きめにほぐし、薄くとろみが付いたら盛る。',
  ],'https://www.ohsho.co.jp/menu/east/post_352.html',{minutes:40,displaySecondaryCategories:['egg','mushroom','vegetable']}),
  recipe('motsu-miso-stir-fry','豚もつとキャベツのみそ炒め','main','中華','meat','stir-fry',[
    ['pork_small_intestine_boiled',260],['cabbage',220],['onion',100],['pepper',80],['chive',50],['garlic',6],['ginger',8],['miso',26],['soy_sauce',6],['sake',20],['sugar',7],['mapo_doubanjiang',4],['oil',8],['water',35],
  ],[
    'もつは下ゆで済み・無調味の豚小腸を使い、水気をよく拭いて食べやすく切る。生のもつへ同じ下処理や時間を適用しない。',
    'キャベツは芯を薄く切って葉をちぎり、玉ねぎとピーマンを切る。にらは短く切り、にんにくとしょうがは刻む。',
    'みそ・しょうゆ・清酒・砂糖・豆板醤・水を混ぜる。フライパンで油と香味野菜を温め、もつの表面を中火で焼いて香ばしさを付ける。',
    '玉ねぎとキャベツの芯、続けて葉とピーマンを炒める。たれを加え、底から混ぜながらもつと野菜を均一に温める。',
    'もつの中心75℃で1分以上を確認し、にらを加えて汁気を軽く飛ばす。たれを残しすぎず、焦げ付かせない程度に絡めて盛る。',
  ],'https://www.ohsho.co.jp/menu/east/post_60.html',{displaySecondaryCategories:['vegetable']}),
  recipe('chive-omelette','にらの厚焼き玉子','side','中華','egg','grill',[
    ['egg',3],['chive',70],['soy_sauce',8],['sugar',3],['water',20],['oil',8],
  ],[
    'にらを洗って水気を拭き、短く刻む。卵を溶き、しょうゆ・砂糖・水をよく混ぜる。',
    '小さめのフライパンへ油の半量を熱し、にらをさっと炒める。にらの香りが立ったら卵液へ戻して混ぜる。',
    '残りの油を引いて弱めの中火にし、卵液を流す。縁から大きく混ぜて厚みを均一にし、ふたをして弱火で約3分焼く。',
    '表面がほぼ固まったら皿を使って裏返し、さらに弱火で焼く。中心に液状の卵が残らず全体が固まったことを確認し、食べやすく切る。',
  ],'https://hidakaya.hiday.co.jp/hits/ja/menu/2/detail/303_2.html',{minutes:15}),
  recipe('negi-chashu','ねぎチャーシューの香味和え','side','中華','meat','dressed',[
    ['noodle_chashu',100],['negi',80],['cucumber',80],['soy_sauce',6],['vinegar',8],['sesame_oil',5],['sugar',2],['mapo_chilli_oil',1],
  ],[
    '長ねぎを細い斜め切りにし、冷水にさっとさらして水気をしっかり切る。きゅうりは細切りにする。',
    '加熱済みチャーシューを細切りにする。商品の保存方法と期限に従い、温めが必要な場合は表示に従って温めてから冷ます。',
    'しょうゆ・酢・ごま油・砂糖・ラー油を混ぜ、チャーシューと長ねぎを和える。きゅうりを加えて全体へたれを薄く行き渡らせる。',
    '冷たいうちに盛り、長く置かずに食べる。チャーシュー自体の味付けと、追加の香味だれを両方計上した配合です。',
  ],'https://hidakaya.hiday.co.jp/hits/ja/menu/1/detail/199.html',{minutes:15,displaySecondaryCategories:['vegetable']}),
  recipe('chive-kimchi-tofu','にらキムチ冷奴','side','中華','bean','cold',[
    ['silken_tofu',300],['chive',50],['kimchi',80],['soy_sauce',4],['sesame_oil',4],['sesame',3],
  ],[
    '豆腐は清潔なざるで軽く水を切り、食べやすく切って冷蔵庫へ入れる。にらは洗って食べやすい長さに切る。',
    'にらを熱湯でさっとゆでて冷水に取り、水気を十分に絞る。キムチは大きい部分を切り、汁ごと和え衣に使う。',
    'にら・キムチ・しょうゆ・ごま油・ごまを混ぜる。冷やした豆腐へ等分してのせ、食べる直前に盛り付ける。',
    '家庭用として白菜キムチと加熱したにらを組み合わせる。室温に置き続けず、作ったら早めに食べる。',
  ],'https://hidakaya.hiday.co.jp/hits/ja/menu/1/detail/377.html',{minutes:15,displaySecondaryCategories:['vegetable']}),
  recipe('fluffy-yam-pan','だし香る長いものふんわり鉄板焼き','side','和食','vegetable','grill',[
    ['yam',260],['egg',2],['flour',10],['water',60],['bonito',2],['soy_sauce',8],['mirin',8],['oil',6],['mayonnaise',8],['nori',1],['scallion_garnish',8],
  ],[
    '長いもの皮をむいてすりおろす。小ねぎを刻み、かつお節は細かくほぐす。卵は黄身と白身を分けず全体を使う。',
    '耐熱容器に水・みりん・かつお節を入れ、ふんわり覆って電子レンジで一度煮立つまで温める。粗熱を取り、しょうゆを混ぜる。かつお節はこさずに食べる。',
    'すりおろした長いもへ卵・薄力粉・冷ましただしを混ぜる。油を引いた小さめのフライパンへ流し、弱火でふたをして約8分焼く。',
    '表面が固まり切らなければ弱火で加熱を続け、中心まで卵が固まったことを確かめる。生の黄身を仕上げに加えない。',
    'マヨネーズを細くかけ、ちぎった海苔と小ねぎを散らす。やわらかい生地をすくい、人数分に取り分ける。',
  ],TORI,{minutes:25}),
  recipe('grilled-chicken-mayo-salad','鶏の香ばし焼きと玉ねぎのマヨサラダ','side','和食','meat','salad',[
    ['chicken',160],['onion',100],['lettuce',100],['mayonnaise',22],['soy_sauce',8],['vinegar',10],['apple',30],['oil',3],['black_pepper',.2],
  ],[
    '玉ねぎを薄く切って冷水に短くさらし、よく水を切る。レタスは洗ってちぎり、水気を拭く。りんごは皮と芯を除いてすりおろす。',
    '鶏肉は厚みを開いてそろえる。フライパンへ油を薄く引き、皮側から中火で焼いて香ばしい焼き色を付ける。',
    '裏返して弱火でふたをし、肉の中心75℃で1分以上を確認する。清潔な皿へ取り出し、粗熱が取れたら薄く切る。',
    'マヨネーズ・しょうゆ・酢・りんご・こしょうを混ぜ、玉ねぎと鶏肉を和える。レタスへ盛り、出来上がったら早めに食べる。',
  ],SPEED,{minutes:25,displaySecondaryCategories:['vegetable']}),
  recipe('chicken-mentaiko-mayo','鶏むね肉の明太マヨ焼き','main','和食','meat','grill',[
    ['chicken_breast',300],['acmp_mentaiko',40],['mayonnaise',24],['sake',15],['starch',8],['oil',6],['nori',1],['scallion_garnish',10],['cabbage',120],
  ],[
    'キャベツを細切りにして洗い、水気を切る。明太子は薄皮を除いてほぐし、マヨネーズと混ぜる。小ねぎを刻み、海苔をちぎる。',
    '鶏むね肉は厚さをそろえてそぎ切りにし、清酒を揉み込む。片栗粉を全体へ薄くまぶす。',
    'フライパンへ油を熱し、肉を重ならないよう並べて中火で両面を焼く。弱火にしてふたをし、中心75℃で1分以上を確認する。',
    'ふたを外し、明太マヨを肉の上へ薄く塗る。再びふたをして弱火で約2分、明太子を含め均一に温める。焦げそうなら火を止めて余熱でなじませる。',
    'キャベツと肉を盛り、肉に海苔と小ねぎを散らす。フライパンに残った明太マヨも食べる量として取り分ける。',
  ],YAKI,{minutes:25,displaySecondaryCategories:['vegetable']}),
  recipe('tare-chicken-katsu-egg','鶏たれかつの温泉卵添え','main','和食','meat','fried',[
    ['chicken_breast',300],['flour',15],['egg',.5],['breadcrumbs',35],['oil',22],['soy_sauce',18],['mirin',20],['sake',15],['sugar',9],['water',25],['cabbage',140],['tavern_onsen_egg',2],
  ],[
    'キャベツを細切りにし、洗って水を切る。鶏肉は厚みをそろえて開き、食べやすい大きさへ切る。衣に使う卵を溶く。',
    'しょうゆ・みりん・清酒・砂糖・水を小鍋で煮立て、弱火で約3分煮てたれにする。鶏肉へ薄力粉、溶き卵、パン粉を順に薄く付ける。',
    '調理用の揚げ油を170℃に温め、肉を詰め込まずに揚げる。材料表の油は衣と肉に残る吸収量の目安で、揚げ鍋に張る全量ではありません。',
    '両面が色付いたら中心75℃で1分以上を確認し、網で油を切る。熱いかつをたれへ短く浸し、残りのたれは上からかけて食べる。',
    'キャベツとかつを盛り、たれなしの市販温泉卵を割って添える。卵は商品の期限・保存方法に従う。半熟卵を避ける場合は、卵を固めに加熱して添える。',
  ],TORI,{minutes:30,displaySecondaryCategories:['egg','vegetable'],sourceNote:`鳥貴族の「鳥たれかつ丼の頭」を参考にした、ご飯を含まない家庭用配合です。店舗の製法・栄養表示の再現ではありません。鶏肉はむね肉、卵は市販のたれなし温泉卵、油は吸収量22ml/全量を仮定。たれは全量を食べる概算です。確認日2026-11-13。${TORI} docs/tavern-sources.md。`}),
  recipe('gizzard-heart-ponzu','鶏砂肝とハツのねぎポン酢','main','和食','meat','dressed',[
    ['tavern_chicken_gizzard',140],['tavern_chicken_heart',140],['negi',80],['daikon',100],['soy_sauce',14],['lemon',16],['vinegar',8],['sake',15],['ginger',8],['oil',5],['water',35],
  ],[
    '砂肝の食べない硬い部分を除き、厚い部分へ切れ目を入れて薄く開く。ハツは縦に開いて血の塊や硬い血管を除き、清潔な冷水で洗って水気を拭く。材料表は下処理後の可食重量です。',
    '長ねぎを薄く切ってさっと水にさらし、水気を切る。大根はすりおろして軽く水気を切り、しょうがは千切りにする。しょうゆ・レモン汁・酢を混ぜて簡単なポン酢を作る。',
    'フライパンへ油としょうがを入れて温め、砂肝とハツを中火で焼く。清酒・水を加えてふたをし、弱火で約5分蒸し焼きにする。',
    '厚い部分の中心75℃で1分以上を確認し、ふたを外して水分を軽く飛ばす。赤い色や弾力だけで加熱を判断しない。',
    '粗熱を取った砂肝とハツへポン酢を絡め、長ねぎと大根おろしをのせる。たれも食べる配合です。作ったら早めに食べ、保存する場合は速やかに冷やして冷蔵する。',
  ],SPEED,{minutes:30,displaySecondaryCategories:['vegetable']}),
  recipe('negi-kombu','白ねぎの昆布しょうゆ和え','side','和食','vegetable','dressed',[
    ['negi',160],['kombu',3],['soy_sauce',6],['mirin',6],['water',35],['sesame_oil',5],['sesame',3],
  ],[
    '昆布を材料表の水で戻し、やわらかくなったら細い短冊に切る。戻し水は捨てず小鍋へ入れ、昆布・しょうゆ・みりんを加える。',
    '小鍋を弱火にかけ、昆布が食べられるやわらかさになるまで約10分煮る。水分が足りなければ少量の水を足し、最後は煮汁が少し残る程度へ煮詰めて冷ます。',
    '長ねぎは細い斜め切りにして熱湯でさっとゆで、ざるで水を切る。粗熱が取れたら余分な水気を絞る。',
    '長ねぎへ昆布と残った煮汁・ごま油・ごまを和えて盛る。市販の塩昆布は使わず、材料表の昆布を全量食べる家庭用の小鉢です。',
  ],SPEED,{minutes:25,displaySecondaryCategories:['seaweed']}),
]);
