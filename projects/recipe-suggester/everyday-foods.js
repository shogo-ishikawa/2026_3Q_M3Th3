/**
 * 日常の食事を種類から選ぶための代表的な家庭料理と一般食品。
 * 材料は2人分。portionは1人分の出来上がり量の目安で、生材料の重量とは異なります。
 * 市販品は特定ブランドの保証値ではありません。原材料と栄養表示を実物で確認してください。
 */
const ingredient = (name, unit, allergens, groups = [], proteinSources = [], extra = {}) =>
  ({name, unit, allergens, groups, proteinSources, ...extra});

export const EVERYDAY_INGREDIENTS = {
  yakisoba_noodles: ingredient('蒸し中華麺（焼きそば用）','g',['wheat'],['staple'],[],{note:'ソースを含まない蒸し麺です。実物の原材料表示も確認してください。'}),
  ramen_noodles: ingredient('中華麺（ゆでたもの）','g',['wheat'],['staple']),
  bacon: ingredient('ベーコン（ばら）','g',['pork'],['protein'],['meat'],{derivedFrom:['pork'],note:'豚ばらベーコンの代表値です。乳・卵などを使う製品は個別に確認してください。'}),
  nori: ingredient('焼き海苔（味付けなし）','g',[]),
  tuna_canned: ingredient('ツナ缶（水煮・液汁を含む）','g',[],['protein'],['fish'],{derivedFrom:['tuna'],note:'まぐろ水煮の代表値です。油漬けの値ではありません。'}),
  carbonated_water: ingredient('炭酸水（無糖・無塩）','ml',[],[],[],{derivedFrom:['water'],note:'水と二酸化炭素だけの炭酸水です。砂糖・果汁入りや塩分入りは含みません。'}),
  worcestershire_sauce: ingredient('ウスターソース（りんご・小麦・大豆を含む想定）','ml',['apple','wheat','soy'],[],[],{derivedFrom:['apple','flour','soybeans'],note:'成分表の代表値です。香辛料や原材料は商品ごとに異なります。'}),
  oyster_sauce: ingredient('オイスターソース（小麦・大豆を含む想定）','ml',['wheat','soy'],[],[],{derivedFrom:['flour','soybeans'],note:'牡蠣の調味料です。貝類に制限がある場合は商品を確認してください。'}),
  pizza_base: ingredient('ピザクラスト（卵・乳・大豆を含む想定）','g',['wheat','egg','milk','soy'],['staple'],[],{derivedFrom:['flour','egg','milk','soybeans'],note:'成分表のピザ生地を使う代表例です。実物の原材料表示を確認してください。'}),
  chocolate: ingredient('ミルクチョコレート（大豆を含む想定）','g',['milk','soy'],[],[],{derivedFrom:['milk','soybeans'],note:'ナッツや小麦を含まない製品を想定しています。実物の原材料表示を確認してください。'}),
  potato_chips: ingredient('ポテトチップス（じゃがいも・油・食塩のみ）','g',[],[],[],{derivedFrom:['potato','oil'],note:'うす塩味の代表値です。乳や小麦などを使った味付け品は含みません。'}),
  rice_cracker: ingredient('しょうゆせんべい（小麦・大豆を含む）','g',['wheat','soy'],[],[],{derivedFrom:['rice','soy_sauce'],note:'成分表のしょうゆせんべいの代表値です。追加の原材料は商品ごとに確認してください。'}),
  biscuit: ingredient('バタークッキー（卵・乳・小麦を含む）','g',['egg','milk','wheat'],[],[],{derivedFrom:['egg','butter','flour'],note:'ナッツやチョコを加えていないクッキーの代表例です。'}),
  vanilla_ice_cream: ingredient('バニラアイスクリーム（卵・乳を含む想定）','g',['egg','milk'],['dairy'],[],{derivedFrom:['egg','milk'],note:'普通脂肪のアイスクリームの代表値です。ラクトアイスや氷菓とは異なります。'}),
  kimchi: ingredient('白菜キムチ（えび・いか・りんご・小麦・大豆を含む想定）','g',['shrimp','squid','apple','wheat','soy'],['vegetable'],[],{derivedFrom:['chinese_cabbage','shrimp','squid','apple','soy_sauce'],note:'魚介由来の調味料などを使う製品を想定しています。実物の原材料表示を確認してください。'}),
  shrimp_tempura: ingredient('えび天ぷら（調理済み）','g',['shrimp','wheat','egg','soy'],['protein'],['fish'],{derivedFrom:['shrimp','flour','egg','soybeans'],note:'衣と吸収油を含む完成品の代表値です。加熱に必要な油を重ねて栄養計算しません。'}),
  pine_nuts: ingredient('松の実（無調味）','g',[],[],[],{note:'表示対象品目とは別に松の実に反応する場合もあります。'}),
  cola: ingredient('コーラ飲料（通常の砂糖入り）','ml',[],[],[],{note:'成分表の代表的なコーラです。ゼロカロリー飲料とは区別してください。'}),
  sports_drink: ingredient('スポーツドリンク（通常の糖分入り）','ml',[],[],[],{note:'成分表の代表値です。商品ごとの糖分と食塩相当量は表示で確認してください。'}),
  fresh_basil: ingredient('バジルの葉（生）','g',[],['vegetable']),
  uncooked_rice: ingredient('精白米うるち米（生米）','g',[],['staple'],[],{note:'炊き込みご飯に使う生米の重量です。炊飯済みのご飯と区別してください。'}),
  octopus: ingredient('ゆでだこ（味付けなし）','g',[],['protein'],['fish']),
  steamed_pork_bun: ingredient('肉まん（調理済み・卵乳ごまを含む想定）','g',['wheat','pork','soy','egg','milk','sesame'],['staple','protein'],['meat'],{derivedFrom:['flour','pork','soy_sauce','egg','milk','sesame'],note:'成分表の肉まんの代表値です。製品の原材料と1個の重量を確認してください。'}),
};

const mergeParts = items => [...items.reduce((map,[id,amount]) => map.set(id,(map.get(id)??0)+amount),new Map())].map(([id,amount])=>({id,amount}));
const dish = (slug,name,family,variantLabel,items,steps,options={}) => {
  const role=options.role??'staple';
  return {id:`daily-${slug}`,name,role,genre:options.genre??'和食',minutes:options.minutes??20,servings:2,
    ingredients:mergeParts(items),steps,staple:role==='staple',tags:[],family,variantLabel,
    portion:options.portion??{amount:1,unit:'皿'},mealBase:options.mealBase??(role==='staple'&&!['rice','onigiri','bread'].includes(family)),
    ...(options.note?{nutritionNote:options.note}:{}),
  };
};
const rice = (slug,name,variant,extras,steps) => dish(slug,name,'rice',variant,[['uncooked_rice',100],...extras],steps,{portion:{amount:150,unit:'g',label:'1人分＝炊き上がり約150g'},minutes:45,mealBase:false});
const RICE = [
  rice('rice-gomoku','五目炊き込みご飯','五目炊き込み',[['carrot',20],['shiitake',20],['burdock',20],['aburaage',10],['chicken',30],['soy_sauce',10],['mirin',8],['water',145]],[
    '生米を洗って吸水させ、ざるに上げて水を切る。野菜と油揚げ、鶏肉を小さく切る。','炊飯器に米、分量の水、しょうゆ、みりんを入れて混ぜ、切った具を上に広げて炊く。','鶏肉の中心まで火が通ったことを確認する。十分に蒸らして全体を混ぜ、人数分に分ける。']),
  rice('rice-chicken-burdock','鶏ごぼうの炊き込みご飯','鶏ごぼう炊き込み',[['chicken',50],['burdock',35],['carrot',15],['ginger',3],['soy_sauce',10],['mirin',8],['water',145]],[
    '洗った生米を吸水させて水を切り、鶏肉、ごぼう、にんじん、しょうがを細かく切る。','炊飯器に米、水、調味料を入れて混ぜ、具を広げて炊く。','鶏肉の中心まで加熱できたことを確かめ、蒸らしてから全体をほぐして盛る。']),
  rice('rice-green-peas','豆ご飯','豆ご飯',[['green_pea',70],['sake',8],['salt',1],['water',150]],[
    '生米を洗って吸水させて水を切り、グリーンピースをさっと洗う。','炊飯器に米、水、清酒、塩を入れて混ぜ、豆をのせて炊く。','蒸らしてから豆をつぶさないように全体を混ぜ、人数分に分けて盛る。']),
  rice('rice-hijiki','ひじきの炊き込みご飯','ひじき炊き込み',[['hijiki',3],['carrot',25],['aburaage',15],['soybeans',40],['soy_sauce',10],['mirin',8],['water',145]],[
    '生米を洗って吸水させる。ひじきは表示に従って戻して洗い、にんじんと油揚げを切る。','炊飯器に米、水、調味料を入れて混ぜ、ひじき、野菜、大豆、油揚げを広げて炊く。','十分に蒸らしてから全体を混ぜ、人数分に分けて盛る。']),
];
const onigiri = (slug,name,variant,extras,steps) => dish(slug,name,'onigiri',variant,[['rice',200],['nori',2],...extras],steps,{portion:{amount:1,unit:'個',label:'1人分＝1個（ご飯100g＋具）'},minutes:10,mealBase:false});
const ONIGIRI = [
  onigiri('onigiri-salt','塩おにぎり','塩',[['salt',0.6]],[ '炊いたご飯を十分に温め、人数分に分けて少し冷ます。','清潔なラップでご飯を包み、塩をなじませながら軽く形を整える。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-salmon','鮭おにぎり','鮭',[['salmon',40],['salt',0.4]],[ '鮭は中心まで十分に加熱し、皮と骨を除いて細かくほぐす。','温めたご飯を人数分に分け、鮭と塩を加えてラップで包んで軽く握る。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-plum','梅おにぎり','梅',[['ume',16]],[ '梅干しの種を取り、果肉を軽くほぐして人数分に分ける。','温めたご飯の中央に梅干しを入れ、清潔なラップで包んで形を整える。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-tuna-mayo','ツナマヨおにぎり','ツナマヨ',[['tuna_canned',40],['mayonnaise',12],['soy_sauce',2]],[ 'ツナ水煮にマヨネーズとしょうゆを加え、全体をよく混ぜる。','温めたご飯を少し冷まし、ツナマヨを包んで清潔なラップで形を整える。','焼き海苔を巻いて早めにいただく。持ち運ぶ場合は十分に冷まして保冷する。' ]),
  onigiri('onigiri-kombu','昆布おにぎり','昆布',[['kombu',3],['soy_sauce',6],['mirin',6],['sugar',3],['water',40]],[ '昆布を水で戻して細く切り、戻した水としょうゆ、みりん、砂糖でやわらかく煮る。','汁気を軽く切った昆布を温めたご飯に包み、清潔なラップで軽く握る。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-okaka','おかかおにぎり','おかか',[['bonito',4],['soy_sauce',5]],[ 'かつお節にしょうゆを加えて、均一になじむように混ぜる。','温めたご飯とおかかを人数分に分け、ラップで包んで軽く握る。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-sesame','ごまおにぎり','ごま',[['sesame',6],['salt',0.4]],[ '炊いたご飯を十分に温め、白ごまと塩を全体に混ぜる。','ご飯を人数分に分け、清潔なラップで包んで軽く形を整える。','食べる直前に焼き海苔を巻き、作ったら早めにいただく。' ]),
  onigiri('onigiri-grilled','焼きおにぎり','焼き',[['soy_sauce',8],['mirin',4],['oil',3]],[ '温めたご飯を清潔なラップで包み、崩れにくい形にややしっかり握る。','薄く油を引いたフライパンで両面を焼き、しょうゆとみりんを混ぜたたれを薄く塗る。','焦がさないように両面を香ばしく焼き、焼き海苔を添えて温かいうちにいただく。' ]),
];

const noodleBowl = (kind,variant,extras,steps,minutes=20) => {
  const noodle=kind==='udon'?'udon':'soba';
  const base=[[noodle,kind==='udon'?400:160],['water',650],['soy_sauce',20],['mirin',16],['bonito',2],['scallion_garnish',4]];
  return dish(`${kind}-${variant[0]}`,`${variant[1]}${kind==='udon'?'うどん':'そば'}`,kind,variant[1],base.concat(extras),steps,{minutes});
};
const NOODLES = ['udon','soba'].flatMap(kind=>{
  const boiled=kind==='udon'?'うどんは表示に従って温める。':'そばは別の鍋で表示に従ってゆで、湯をよく切る。';
  const serve='麺を器に入れて温かいつゆと具を注ぎ、薬味の小ねぎを添える。';
  return [
    noodleBowl(kind,['plain','かけ'],[],[boiled,'分量の水、しょうゆ、みりん、かつお節を煮立て、アルコールを飛ばしてつゆを作る。',serve],12),
    noodleBowl(kind,['kitsune','きつね'],[['aburaage',60],['soy_sauce',8],['sugar',10],['water',60]],[ '油揚げを食べやすく切り、水としょうゆ、砂糖の一部で煮含める。',boiled,'残りの水と調味料、かつお節でつゆを煮立て、麺と油揚げを盛って薬味を添える。' ]),
    noodleBowl(kind,['tanuki','たぬき'],[['flour',16],['oil',12]],[ '薄力粉に分量の水の一部を加えて混ぜ、薄く油を引いたフライパンで細かな衣をカリッと焼く。',boiled,'残りの水と調味料、かつお節でつゆを作り、麺、手作りの揚げ玉、薬味を盛る。' ]),
    noodleBowl(kind,['wakame','わかめ'],[['wakame',3]],[ '乾燥わかめを表示に従って戻し、水気を切る。',boiled,'分量の水と調味料、かつお節でつゆを煮立て、麺とわかめを盛って薬味を添える。' ],15),
    noodleBowl(kind,['meat','肉'],[['pork',160],['onion',80],['ginger',4],['soy_sauce',8],['sugar',5]],[ '豚肉と玉ねぎを食べやすく切り、しょうがを細く切る。',boiled,'分量の水と調味料で肉と玉ねぎを中心まで十分煮て、麺に注ぎ薬味を添える。' ]),
    noodleBowl(kind,['tempura','天ぷら'],[['shrimp_tempura',100]],[ '調理済みのえび天ぷらを表示に従って中まで温める。',boiled,'分量の水と調味料、かつお節でつゆを煮立て、麺とえび天を盛って薬味を添える。' ],15),
    noodleBowl(kind,['curry','カレー'],[['pork',140],['onion',100],['curry_powder',8],['flour',10]],[ '豚肉と玉ねぎを切り、分量の水と調味料の一部で肉の中心まで十分に煮る。',boiled,'カレー粉と薄力粉を少量の水で溶いて鍋に加え、粉っぽさがなくなるまで煮て麺にかける。' ],25),
  ];
});

const YAKISOBA = [
  dish('yakisoba-sauce','ソース焼きそば','yakisoba','ソース',[['yakisoba_noodles',300],['pork',120],['cabbage',160],['carrot',50],['onion',60],['oil',12],['worcestershire_sauce',35],['soy_sauce',6]],[
    '豚肉、キャベツ、にんじん、玉ねぎを食べやすく切り、麺をほぐしておく。','油を熱したフライパンで豚肉の中心まで火を通し、野菜を加えて炒める。','麺を加えて全体をほぐしながら炒め、ウスターソースとしょうゆで味を整える。'],{genre:'中華'}),
  dish('yakisoba-salt','塩焼きそば','yakisoba','塩',[['yakisoba_noodles',300],['pork',120],['cabbage',160],['carrot',50],['bean_sprout',100],['sesame_oil',12],['salt',2],['garlic',4],['black_pepper',0.2],['lemon',8]],[
    '豚肉と野菜を食べやすく切り、にんにくを刻んで麺をほぐす。','ごま油でにんにくと豚肉を炒め、肉の中心まで火が通ってから野菜を加える。','麺を加えて炒め、塩と黒こしょう、レモン汁を全体になじませて盛る。'],{genre:'中華'}),
  dish('yakisoba-seafood','海鮮焼きそば','yakisoba','海鮮',[['yakisoba_noodles',300],['shrimp',100],['squid',100],['chinese_cabbage',160],['carrot',50],['onion',60],['oil',12],['oyster_sauce',20],['soy_sauce',10],['ginger',4]],[
    'えびといかを下処理し、野菜としょうがを食べやすく切る。','油を熱したフライパンで魚介を中心まで加熱し、野菜を加えて炒める。','麺を加えてほぐし、オイスターソースとしょうゆを全体になじませて盛る。'],{genre:'中華'}),
];
const pasta = (slug,name,variant,extras,steps,minutes=25) => dish(`pasta-${slug}`,name,'pasta',variant,[['pasta',160],...extras],steps,{genre:'洋食',minutes});
const PASTA = [
  pasta('peperoncino','ペペロンチーノ','ペペロンチーノ',[['olive_oil',20],['garlic',6],['chilli',0.5],['salt',1.2],['parsley',2]],[
    'スパゲティを表示に従ってゆで、にんにくは薄く切り、唐辛子は種を除く。','フライパンにオリーブ油、にんにく、唐辛子を入れ、弱火で香りを出す。','麺と少量のゆで湯を加えて全体を和え、塩で味を整えてパセリを添える。'],18),
  pasta('carbonara','カルボナーラ','カルボナーラ',[['bacon',60],['egg',2],['cheese',40],['olive_oil',8],['milk',40],['black_pepper',0.4]],[
    '卵、牛乳、細かくしたチーズをよく混ぜ、スパゲティを表示に従ってゆでる。','ベーコンを切ってオリーブ油で炒め、麺と少量のゆで湯を加える。','火を弱めて卵液を加え、絶えず混ぜて卵に火を通し、黒こしょうを振って盛る。']),
  pasta('genovese','ジェノベーゼ','ジェノベーゼ',[['fresh_basil',30],['pine_nuts',20],['garlic',4],['olive_oil',20],['cheese',25],['salt',0.8]],[
    'バジルを洗って水気を拭き、松の実は焦がさないように軽くいって冷ます。','バジル、松の実、にんにく、オリーブ油、チーズ、塩を細かくすりつぶす。','表示に従ってゆでた麺とソースを和え、必要に応じて少量のゆで湯で濃さを整える。']),
  pasta('bolognese','ボロネーゼ','ボロネーゼ',[['beef_minced',100],['pork_minced',100],['canned_tomato',240],['onion',80],['carrot',40],['celery',30],['garlic',4],['olive_oil',10],['salt',1],['black_pepper',0.2]],[
    '玉ねぎ、にんじん、セロリ、にんにくを細かく刻み、オリーブ油で炒める。','ひき肉を加えて中心まで十分に加熱し、トマト缶を加えて全体がなじむまで煮る。','塩と黒こしょうで味を整え、表示に従ってゆでたスパゲティと和える。'],35),
  pasta('arrabbiata','アラビアータ','アラビアータ',[['canned_tomato',240],['garlic',6],['chilli',0.8],['olive_oil',16],['salt',1],['parsley',2]],[
    'にんにくを刻み、唐辛子は種を除き、オリーブ油で弱火にかけて香りを出す。','トマト缶を加えてほどよく煮詰め、塩で味を整える。','表示に従ってゆでたスパゲティを和え、パセリを添えて盛る。']),
  pasta('pescatore','ペスカトーレ','ペスカトーレ',[['shrimp',100],['squid',100],['clam',200],['canned_tomato',200],['garlic',4],['olive_oil',16],['sake',20],['salt',0.6]],[
    '砂抜き済みのあさりを洗い、えびといかを下処理して、にんにくを刻む。','オリーブ油でにんにくを温め、魚介と清酒を加えてふたをする。あさりの殻が開き魚介の中心まで火を通す。','トマト缶を加えて煮て塩で調え、表示に従ってゆでた麺と和える。開かない貝は食べない。'],30),
  pasta('napolitan','ナポリタン','ナポリタン',[['bacon',60],['onion',80],['pepper',60],['mushroom',60],['tomato_paste',40],['sugar',6],['vinegar',8],['worcestershire_sauce',10],['olive_oil',12]],[
    'ベーコン、玉ねぎ、ピーマン、マッシュルームを切り、スパゲティを表示に従ってゆでる。','オリーブ油で具を炒め、トマトペースト、砂糖、米酢、ウスターソースと少量のゆで湯を加える。','麺を加えて全体をよく炒め合わせ、ソースをなじませて盛る。']),
  pasta('japanese-mushroom','きのこの和風パスタ','和風きのこ',[['shimeji',100],['shiitake',50],['onion',60],['soy_sauce',16],['mirin',10],['olive_oil',12],['nori',2]],[
    'きのこの石づきを除いてほぐし、玉ねぎを薄く切り、スパゲティを表示に従ってゆでる。','オリーブ油できのこと玉ねぎを炒め、しょうゆとみりんを加えて煮立てる。','麺を加えて和え、細く切った焼き海苔を添えて盛る。']),
  pasta('tuna-tomato','ツナとトマトのパスタ','ツナトマト',[['tuna_canned',100],['canned_tomato',200],['onion',60],['garlic',4],['olive_oil',10],['salt',0.8]],[
    '玉ねぎとにんにくを刻み、オリーブ油でしんなりするまで炒める。','ツナ水煮とトマト缶を加えて煮込み、塩で味を整える。','表示に従ってゆでたスパゲティを加えて全体を和え、人数分に分けて盛る。']),
  pasta('vongole','ボンゴレ','ボンゴレ',[['clam',400],['garlic',6],['olive_oil',16],['sake',30],['salt',0.6],['parsley',2]],[
    '砂抜き済みのあさりを洗い、にんにくを刻み、スパゲティを表示に従ってゆでる。','オリーブ油でにんにくを温め、あさりと清酒を加えてふたをし、殻が開いて十分に火が通るまで蒸す。','麺と少量のゆで湯を加えて和え、塩で調えてパセリを添える。開かない貝は食べない。']),
];
const curry = (slug,name,variant,protein) => dish(`curry-${slug}`,name,'curry',variant,[['rice',350],['onion',160],['carrot',60],['potato',150],['curry_powder',8],['flour',12],['oil',10],['water',300],['tomato_paste',16],['salt',2],...protein],[
  '肉や野菜を食べやすく切り、厚手の鍋で油を熱して玉ねぎを炒める。','肉を使う場合は加えて中心まで火を通す。にんじんとじゃがいもを加え、カレー粉と薄力粉をなじませる。','水、トマトペースト、塩を加えて具がやわらかくなるまで煮て、温めたご飯と盛る。'],{minutes:35});
const CURRIES = [
  curry('chicken','チキンカレーライス','チキン',[['chicken',200]]),
  curry('pork','ポークカレーライス','ポーク',[['pork',180]]),
  curry('beef','ビーフカレーライス','ビーフ',[['beef',180]]),
  curry('vegetable','野菜カレーライス','野菜',[['pumpkin',100],['aubergine',80],['chickpea_cooked',80]]),
  dish('curry-keema','キーマカレーライス','curry','キーマ',[['rice',350],['pork_minced',180],['onion',160],['carrot',70],['canned_tomato',180],['curry_powder',8],['oil',10],['garlic',4],['ginger',4],['salt',1.6]],[
    '玉ねぎ、にんじん、にんにく、しょうがを細かく刻み、油で炒める。','豚ひき肉を加えて中心まで火を通し、カレー粉とトマト缶を加えて汁気が少なくなるまで煮る。','塩で味を整え、十分に温めたご飯と一緒に人数分に分けて盛る。'],{minutes:30}),
];
const pizza = (slug,name,variant,extras,steps) => dish(`pizza-${slug}`,name,'pizza',variant,[['pizza_base',220],...extras],steps,{genre:'洋食',minutes:25,portion:{amount:0.5,unit:'枚',label:'1人分＝1/2枚（直径約25cmのピザの目安）'}});
const PIZZAS = [
  pizza('margherita','マルゲリータピザ','マルゲリータ',[['canned_tomato',100],['mozzarella',100],['fresh_basil',6],['olive_oil',6],['salt',0.4]],[
    'トマト缶を軽く煮詰めて塩で調え、モッツァレラチーズを食べやすく切る。','ピザクラストにトマトとチーズを広げ、表示に従って十分に焼く。','洗って水気を拭いたバジルとオリーブ油を添え、人数分に切り分ける。']),
  pizza('mixed','ミックスピザ','ミックス',[['bacon',50],['mushroom',60],['pepper',40],['onion',40],['cheese',80],['tomato_paste',30],['water',40],['garlic',2]],[
    'ベーコンと野菜を薄く切り、トマトペースト、水、刻んだにんにくを混ぜる。','ピザクラストにソース、具、チーズを広げ、表示に従って具まで十分に加熱する。','チーズが溶けて生地が香ばしく焼けたら、人数分に切り分ける。']),
  pizza('teriyaki','照り焼きチキンピザ','照り焼きチキン',[['chicken',150],['soy_sauce',16],['mirin',16],['sugar',6],['cheese',60],['onion',50],['mayonnaise',20]],[
    '鶏肉と玉ねぎを切り、しょうゆ、みりん、砂糖を合わせておく。','鶏肉の中心まで十分に焼いてたれをからめ、クラストに玉ねぎ、鶏肉、チーズ、マヨネーズをのせる。','クラストの表示に従って十分に焼き、人数分に切り分ける。']),
  pizza('seafood','シーフードピザ','シーフード',[['shrimp',80],['squid',80],['canned_tomato',100],['cheese',70],['onion',40],['dried_basil',0.4]],[
    'えびといかを下処理し、玉ねぎを薄く切り、トマト缶を軽くつぶす。','クラストにトマト、玉ねぎ、魚介、チーズ、乾燥バジルを広げる。','表示に従って魚介の中心まで十分に加熱し、人数分に切り分ける。']),
];
const friedRice = (slug,name,variant,extras) => dish(`fried-rice-${slug}`,name,'fried-rice',variant,[['rice',350],['oil',12],['scallion_garnish',6],...extras],[
  '具を食べやすく細かく切り、卵を使う場合は溶き、ご飯を十分に温めておく。','油を熱したフライパンで肉や魚介の中心まで火を通し、野菜と卵を使う場合は加えて火を通す。','ご飯を加えてほぐしながら炒め、調味料を全体になじませて盛る。'],{genre:'中華'});
const FRIED_RICE = [
  friedRice('egg','卵チャーハン','卵',[['egg',2],['carrot',30],['soy_sauce',10],['salt',1],['black_pepper',0.2]]),
  friedRice('gomoku','五目チャーハン','五目',[['pork',80],['shrimp',80],['shiitake',40],['carrot',40],['green_pea',40],['egg',2],['soy_sauce',10],['salt',0.8]]),
  friedRice('kimchi','キムチチャーハン','キムチ',[['kimchi',120],['pork',100],['egg',1],['soy_sauce',8]]),
  friedRice('shrimp','えびチャーハン','えび',[['shrimp',140],['egg',2],['green_pea',40],['soy_sauce',10],['salt',0.8]]),
];
const ramen = (slug,name,variant,extras) => dish(`ramen-${slug}`,name,'ramen',variant,[['ramen_noodles',300],['water',700],['ginger',4],['sesame_oil',8],...extras],[
  '肉と野菜を食べやすく切り、しょうがを細かく刻む。','鍋にごま油を熱して具を炒め、水と調味料を加えて肉の中心まで十分に加熱する。','中華麺を表示に従って温めて器に入れ、熱いスープと具を注ぐ。'],{genre:'中華',note:'骨だしや市販のスープを使わない家庭用の代表レシピです。市販ラーメンの保証値ではありません。'});
const RAMEN = [
  ramen('soy','しょうゆラーメン','しょうゆ',[['pork',100],['negi',40],['cabbage',100],['soy_sauce',30],['salt',1.2]]),
  ramen('salt','塩ラーメン','塩',[['chicken_breast',120],['negi',40],['cabbage',100],['garlic',2],['salt',2.4]]),
  ramen('miso','みそラーメン','みそ',[['pork',120],['bean_sprout',160],['corn',40],['miso',40],['soy_sauce',8],['garlic',4]]),
  ramen('tanmen','タンメン','タンメン',[['pork',80],['carrot',60],['onion',80],['cabbage',180],['bean_sprout',100],['salt',2.4],['soy_sauce',6]]),
];
const DONBURI = [
  dish('donburi-oyako','親子丼','donburi','親子',[['rice',350],['chicken',180],['egg',2],['onion',120],['soy_sauce',20],['mirin',20],['sugar',6],['water',120]],[
    '鶏肉と玉ねぎを切り、しょうゆ、みりん、砂糖、水を鍋に入れて煮立てる。','玉ねぎと鶏肉を加え、鶏肉の中心まで十分に加熱してから溶き卵を回し入れる。','ふたをして卵にもしっかり火を通し、温めたご飯にのせて盛る。']),
  dish('donburi-pork','豚丼','donburi','豚',[['rice',350],['pork',200],['onion',120],['soy_sauce',20],['mirin',20],['sugar',6],['oil',6]],[
    '豚肉と玉ねぎを食べやすく切り、しょうゆ、みりん、砂糖を合わせる。','油を熱したフライパンで豚肉と玉ねぎを炒め、肉の中心まで十分に火を通す。','たれを加えて煮からめ、温めたご飯にのせて盛る。']),
  dish('donburi-mapo','麻婆豆腐丼','donburi','麻婆豆腐',[['rice',350],['tofu',250],['pork_minced',100],['negi',40],['garlic',4],['ginger',4],['miso',12],['soy_sauce',14],['sugar',4],['water',150],['starch',8],['sesame_oil',8],['chilli',0.3]],[
    '豆腐は食べやすく切り、長ねぎ、にんにく、しょうがを細かく刻む。','ごま油で香味野菜とひき肉を中心まで炒め、水と調味料、豆腐を加えて煮る。','片栗粉を分量の水の一部で溶いて加え、十分に煮てとろみを付け、温めたご飯にかける。'],{genre:'中華'}),
  dish('donburi-chinese','中華丼','donburi','中華',[['rice',350],['shrimp',80],['squid',80],['pork',80],['chinese_cabbage',200],['carrot',60],['soy_sauce',18],['oyster_sauce',16],['starch',10],['water',200],['oil',10]],[
    '肉と魚介を下処理し、白菜とにんじんを食べやすい大きさに切る。','油で肉と魚介の中心まで加熱し、野菜、水、しょうゆ、オイスターソースを加えて煮る。','片栗粉を分量の水の一部で溶いて加え、十分に煮てとろみを付け、温めたご飯にかける。'],{genre:'中華'}),
  dish('donburi-teriyaki','照り焼きチキン丼','donburi','照り焼きチキン',[['rice',350],['chicken',200],['lettuce',60],['soy_sauce',18],['mirin',18],['sugar',6],['oil',6]],[
    '鶏肉を切り、しょうゆ、みりん、砂糖を合わせ、レタスを洗って水気を切る。','油を熱したフライパンで鶏肉の中心まで十分に焼き、たれを加えて煮からめる。','温めたご飯にレタスと鶏肉をのせ、鍋に残ったたれを添える。']),
];
const misoSoup = (slug,name,variant,extras,minutes=15) => dish(`miso-${slug}`,name,'miso-soup',variant,[['miso',28],['water',360],['bonito',2],...extras],[
  '具を洗い、食べやすい大きさに切って下準備する。','分量の水とかつお節を鍋に入れ、具を加えて中心まで十分に加熱する。','火を弱めてみそを溶き入れ、煮立てすぎないように温めて人数分に分ける。'],{role:'soup',minutes,portion:{amount:1,unit:'杯'},mealBase:false});
const MISO_SOUPS = [
  misoSoup('onion','玉ねぎのみそ汁','玉ねぎ',[['onion',100]]),
  misoSoup('clam','あさりのみそ汁','あさり',[['clam',200]],20),
  misoSoup('tonjiru','豚汁','豚汁',[['pork',80],['daikon',70],['carrot',40],['burdock',30],['tofu',60]],25),
  misoSoup('potato','じゃがいものみそ汁','じゃがいも',[['potato',100],['negi',20]],20),
  misoSoup('aburaage-daikon','油揚げと大根のみそ汁','油揚げ・大根',[['aburaage',20],['daikon',100]]),
];
const drink=(slug,name,family,variant,items)=>dish(`drink-${slug}`,name,family,variant,items,[
  '清潔なグラスを用意し、飲料と追加の材料を確認する。','記載した材料を人数分に分け、飲みやすい温度でグラスに注ぐ。','飲む直前に軽く混ぜ、開封した飲料は表示に従って保存する。'],{role:'drink',minutes:3,portion:{amount:200,unit:'ml'},mealBase:false,genre:'その他'});
const DRINKS = [
  drink('sparkling-water','炭酸水（無糖）','water','炭酸水',[['carbonated_water',400]]),
  drink('lemon-sparkling','レモン炭酸水（無糖）','water','レモン炭酸水',[['carbonated_water',390],['lemon',10]]),
  drink('cola','コーラ','soft-drink','コーラ',[['cola',400]]),
  drink('sports','スポーツドリンク','soft-drink','スポーツドリンク',[['sports_drink',400]]),
  drink('lemonade','レモネード（砂糖入り）','soft-drink','レモネード',[['water',360],['lemon',20],['sugar',20]]),
];
const snack=(slug,name,family,variant,items,steps,portion,minutes=5,note)=>dish(`snack-${slug}`,name,family,variant,items,steps,{role:'snack',minutes,portion,mealBase:false,genre:'その他',note});
const plateSteps = food => [`${food}の原材料表示と栄養表示を確認し、食べる量を量る。`,'清潔な小皿に人数分ずつ分け、袋全体の量と食べる量を区別する。','食べた量を記録し、残った食品は表示に従って保存する。'];
const SNACKS = [
  snack('potato-chips','ポテトチップス（うす塩）','snack','ポテトチップス',[['potato_chips',60]],plateSteps('うす塩味のポテトチップス'),{amount:30,unit:'g'}),
  snack('rice-cracker','しょうゆせんべい','snack','せんべい',[['rice_cracker',40]],plateSteps('しょうゆせんべい'),{amount:2,unit:'枚',label:'1人分＝2枚（計約20g）'}),
  snack('butter-cookie','バタークッキー','sweets','クッキー',[['biscuit',40]],plateSteps('バタークッキー'),{amount:2,unit:'枚',label:'1人分＝2枚（計約20g）'}),
  snack('chocolate','ミルクチョコレート','sweets','チョコレート',[['chocolate',40]],plateSteps('ミルクチョコレート'),{amount:20,unit:'g'}),
  snack('chocolate-cookie','チョコがけクッキー','sweets','チョコクッキー',[['biscuit',30],['chocolate',10]],[
    'チョコレートを刻み、湯せんで焦がさないように溶かす。','クッキーの一部にチョコレートをからめ、清潔な皿に並べる。','チョコレートが固まったら人数分に分け、量を確認していただく。'],{amount:2,unit:'枚',label:'1人分＝2枚（計約20g）'},15),
  snack('vanilla-ice','バニラアイスクリーム','dessert','バニラアイス',[['vanilla_ice_cream',200]],plateSteps('バニラアイスクリーム'),{amount:100,unit:'g'}),
  snack('cocoa-ice','ココアアイスクリーム','dessert','ココアアイス',[['vanilla_ice_cream',184],['cocoa_powder',8],['sugar',8]],[
    'ココアと砂糖を混ぜ、少しやわらかくしたバニラアイスを少量加えてなめらかにする。','残りのアイスも加え、溶かしすぎないように手早く全体を混ぜる。','清潔な器に人数分ずつ盛り、すぐにいただくか冷凍して保存する。'],{amount:100,unit:'g'},10),
  snack('custard-pudding','カスタードプリン（家庭用）','dessert','プリン',[['milk',200],['egg',1],['sugar',20]],[
    '牛乳を温めて砂糖を溶かし、溶いた卵に少しずつ加えて混ぜ、こす。','耐熱容器に人数分ずつ分け、蒸し器か湯を張ったオーブンで中心まで十分に加熱する。','粗熱を取って冷蔵庫でしっかり冷やし、早めにいただく。'],{amount:1,unit:'個',label:'1人分＝小さなカップ1個'},50),
  snack('yoghurt-parfait','ヨーグルトパフェ','dessert','パフェ',[['yogurt',160],['banana',80],['blueberry',40],['oatmeal',20]],[
    'バナナを輪切りにし、ブルーベリーを洗って水気を切る。','オートミールをフライパンで焦がさないように乾いりし、冷ます。','器にヨーグルト、果物、オートミールを重ねて人数分に分ける。'],{amount:1,unit:'杯'},10),
  snack('plain-pancake','プレーンパンケーキ','dessert','パンケーキ',[['flour',80],['egg',1],['milk',80],['sugar',14],['oil',8]],[
    '卵と牛乳、砂糖を混ぜ、薄力粉を加えて粉っぽさがなくなるまで混ぜる。','薄く油を引いたフライパンで小さく丸く流し、弱めの火で焼く。','裏返して中心まで十分に火を通し、人数分に分けて盛る。'],{amount:2,unit:'枚',label:'1人分＝小さめ2枚'},20),
  snack('strawberry-crepe','いちごクレープ（家庭用）','dessert','クレープ',[['flour',50],['egg',1],['milk',100],['butter',8],['sugar',12],['strawberry',80],['yogurt',100]],[
    '薄力粉、卵、牛乳、砂糖、溶かしたバターをなめらかに混ぜ、いちごを洗って切る。','フライパンに生地を薄く流し、両面を中心までしっかり焼いて冷ます。','水気を軽く切ったヨーグルトといちごを包み、人数分に分ける。'],{amount:1,unit:'個'},25),
  snack('banana-cake','バナナケーキ（家庭用）','dessert','バナナケーキ',[['flour',30],['banana',60],['egg',1],['milk',15],['oil',6],['sugar',16]],[
    '卵と砂糖をよく泡立て、つぶしたバナナ、牛乳、油を混ぜる。','薄力粉をふるって加え、粉っぽさがなくなるまで混ぜて小さな耐熱型へ流す。','オーブンで中心まで火を通し、竹串に生地が付かないことを確認して冷まし、人数分に切る。'],{amount:75,unit:'g',label:'1人分＝約75g（小さめ1切れ）'},35),
  snack('chocolate-cake','チョコレートケーキ（家庭用）','dessert','チョコケーキ',[['chocolate',60],['flour',30],['egg',1],['milk',20],['butter',10],['sugar',10]],[
    'チョコレートとバターを湯せんで溶かし、卵、牛乳、砂糖を少しずつ加えて混ぜる。','薄力粉をふるって加え、小さな耐熱型に流してオーブンで中心まで焼く。','竹串に生の生地が付かないことを確認して冷まし、人数分に切り分ける。'],{amount:75,unit:'g',label:'1人分＝約75g（小さめ1切れ）'},35),
  snack('sweet-french-toast','甘いフレンチトースト','dessert','フレンチトースト',[['bread',60],['egg',1],['milk',50],['sugar',10],['butter',6]],[
    '卵、牛乳、砂糖を混ぜ、食パンを浸して卵液をなじませる。','バターを溶かしたフライパンで弱火にかけ、途中で裏返して両面を焼く。','中心まで卵に火が通ったことを確認し、人数分に分けて温かいうちにいただく。'],{amount:1,unit:'枚'},20),
  snack('cheese-crisp','焼きチーズせんべい','cheese','焼きチーズ',[['cheese',40],['rice_flour',20],['milk',20]],[
    '細かくしたチーズに米粉と牛乳を加え、均一になるまで混ぜる。','クッキングシートを敷いた天板に薄く広げ、オーブンで香ばしく焼く。','粗熱を取って食べやすく割り、人数分に分けていただく。'],{amount:30,unit:'g',label:'1人分＝焼き上がり約30g'},20),
  snack('plain-cheese','ナチュラルチーズ','cheese','チーズ',[['cheese',40]],plateSteps('ナチュラルチーズ'),{amount:20,unit:'g'}),
  snack('mozzarella','モッツァレラチーズ','cheese','モッツァレラ',[['mozzarella',60]],plateSteps('モッツァレラチーズ'),{amount:30,unit:'g'}),
  snack('oven-chicken','フライドチキン風（オーブン調理）','hot-snack','チキン',[['chicken',180],['milk',20],['flour',20],['oil',8],['paprika_powder',1],['black_pepper',0.2],['salt',1.4]],[
    '鶏肉を食べやすく切り、牛乳、塩、黒こしょうをなじませる。','薄力粉とパプリカ粉をまぶし、分量の油を薄くからめて天板に並べる。','オーブンで中心まで十分に加熱し、衣が香ばしくなったら人数分に分ける。'],{amount:1,unit:'個',label:'1人分＝大きめ1個'},30,'コンビニ商品の実測値ではなく、分量を限定した油で焼く家庭用の代表例です。'),
  snack('oven-karaage','唐揚げ（オーブン調理）','hot-snack','唐揚げ',[['chicken',180],['ginger',6],['soy_sauce',12],['sake',12],['starch',20],['oil',12]],[
    '鶏肉を小さめに切り、すりおろしたしょうが、しょうゆ、清酒をなじませる。','片栗粉をまぶし、分量の油を薄くからめて天板に重ならないように並べる。','オーブンで途中で裏返しながら中心まで十分に加熱し、人数分に分ける。'],{amount:3,unit:'個',label:'1人分＝小さめ3個'},30,'揚げ鍋の油全量を摂取量にしないため、使用量を限定したオーブン調理の例です。'),
  snack('oven-fries','フライドポテト（オーブン調理）','hot-snack','ポテト',[['potato',240],['oil',12],['salt',1]],[
    'じゃがいもを棒状に切って水にさらし、水気をよく拭き取る。','分量の油をからめて天板に重ならないように広げ、オーブンで焼く。','中までやわらかく表面が香ばしくなるまで加熱し、塩を振って人数分に分ける。'],{amount:100,unit:'g',label:'1人分＝焼き上がり約100g'},30,'市販の深揚げポテトと異なる家庭用のオーブン調理の例です。'),
  snack('takoyaki','たこ焼き（家庭用）','hot-snack','たこ焼き',[['flour',40],['egg',1],['water',100],['octopus',60],['cabbage',30],['scallion_garnish',4],['soy_sauce',4],['worcestershire_sauce',10],['mayonnaise',8],['oil',6]],[
    'ゆでだこを小さく切り、キャベツと小ねぎを刻み、薄力粉、卵、水、しょうゆを混ぜる。','たこ焼き器に薄く油を引いて生地と具を流し、回転させながら丸く焼く。','中心まで生地と具に火を通し、ソースとマヨネーズを添えて人数分に分ける。'],{amount:6,unit:'個',label:'1人分＝小さめ6個'},25),
  snack('pork-bun','肉まん','hot-snack','肉まん',[['steamed_pork_bun',200]],[
    '肉まんの原材料と栄養表示を確認し、食べる個数と重さを確認する。','包装の表示に従い、蒸し器または電子レンジで中心まで十分に温める。','中の具が熱いことに気を付け、人数分に分けて温かいうちにいただく。'],{amount:1,unit:'個',label:'1人分＝1個（約100g）'},8),
  snack('bacon-cheese-roll','ベーコンチーズ巻き','hot-snack','ベーコンチーズ',[['bacon',50],['cheese',40]],[
    'チーズを棒状に切り、薄切りのベーコンで包んで形を整える。','巻き終わりを下にしてフライパンに置き、弱火で焼き始める。','全体を転がしながら中心まで温め、人数分に分けて温かいうちにいただく。'],{amount:2,unit:'個',label:'1人分＝小さめ2個'},12),
  snack('hash-brown','ハッシュドポテト（家庭用）','hot-snack','ハッシュドポテト',[['potato',200],['starch',10],['oil',10],['salt',1]],[
    'じゃがいもを細く刻み、片栗粉と塩を加えて全体をよく混ぜる。','分量の油を熱したフライパンに薄く広げ、ふたをして弱火で中まで火を通す。','裏返して両面を香ばしく焼き、人数分に分けて温かいうちにいただく。'],{amount:1,unit:'枚',label:'1人分＝小さめ1枚'},20),
  snack('apple-cookie-bowl','りんごとクッキーの小皿','sweets','フルーツクッキー',[['apple',100],['biscuit',30]],[
    'りんごを洗って芯を除き、食べやすい大きさに切る。','クッキーの原材料表示を確認し、食べる量を量って人数分に分ける。','りんごとクッキーを小皿に盛り、食べた量を確認していただく。'],{amount:1,unit:'皿'},8),
];

export const EVERYDAY_RECIPES = [
  ...RICE,...ONIGIRI,...NOODLES,...YAKISOBA,...PASTA,...CURRIES,...PIZZAS,...FRIED_RICE,...RAMEN,...DONBURI,...MISO_SOUPS,...DRINKS,...SNACKS,
];
