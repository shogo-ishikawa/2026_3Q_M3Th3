import {occasionDish} from './occasion-recipe.js';

const lunchDinner = ['昼食', '夕食'];
const withBreakfast = ['朝食', '昼食', '夕食'];
const withDrinks = ['昼食', '夕食', '晩酌'];

function regionalDish({id, region, reference, tags, aliases = [], ...dish}) {
  const recipe = occasionDish(tags, {
    ...dish, id: 'regional-' + id,
    aliases: ['郷土料理', region, ...aliases], staple: dish.role === 'staple',
  });
  return {...recipe, sourceNote: recipe.sourceNote + ' 料理の地域・背景は農林水産省「うちの郷土料理」を参照。' +
    'https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/' + reference + '.html'};
}

export const REGIONAL_OCCASION_RECIPES = [
  regionalDish({
    id: 'hokkaido-imomochi', name: '北海道のいももち・甘辛しょうゆ', region: '北海道', reference: 'imomochi_hokkaido',
    tags: ['autumn'], aliases: ['いもだんご', 'おやつ'], role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'grill', mealOccasions: ['昼食', '間食'], minutes: 25, portion: {amount: 2, unit: '個'},
    ingredients: [['potato', 220], ['starch', 22], ['oil', 5], ['soy_sauce', 8], ['sugar', 6], ['water', 12]],
    steps: [
      'じゃがいもを一口大に切り、やわらかくゆでる。湯を切って鍋をゆすり、表面の水分を飛ばす。',
      '熱いうちにつぶし、粗熱が取れたら片栗粉を練り込む。食べる人数に合わせ、ひとりにつき二つの小判形にする。厚みは1cm程度にそろえる。',
      '油を引いたフライパンに並べ、弱めの中火で両面をこんがり焼く。しょうゆ、砂糖、水を合わせて加え、すぐに両面にからめる。',
    ],
  }),
  regionalDish({
    id: 'aomori-kaiyaki', name: 'ほたての貝焼き味噌', region: '青森', reference: 'kaiyaki_miso_aomori',
    tags: [], aliases: ['貝焼きみそ', '津軽', '青森県', 'ご飯のお供'], role: 'main', family: 'fish-main',
    category: 'fish', method: 'simmer', mealOccasions: withBreakfast.concat('晩酌'), minutes: 15,
    ingredients: [['scallop', 120], ['egg', 2], ['negi', 30], ['soup311_awase_dashi', 130], ['miso', 15], ['sake', 10]],
    steps: [
      'ほたて貝柱は厚みを半分に切る。長ねぎは小口切りにして卵は軽く溶く。',
      '貝殻の代わりに小さなフライパンを使う。だしと酒、ほたてを入れて煮立て、貝の中心まで火を通す。',
      '煮汁でみそを溶き、ねぎを加える。卵を回し入れてふたをし、卵が固まったら火を止める。',
    ],
  }),
  regionalDish({
    id: 'akita-damako', name: 'だまこ鍋', region: '秋田', reference: '29_4_akita', tags: ['autumn', 'winter'],
    aliases: ['秋田県', '鍋を囲む日'], role: 'staple', family: 'rice', mealBase: true, mealOccasions: lunchDinner, minutes: 35,
    ingredients: [['rice', 280], ['chicken', 170], ['burdock', 65], ['simmered_maitake', 80], ['negi', 80],
      ['water', 550], ['soy_sauce', 18], ['sake', 18], ['salt', 1]],
    steps: [
      '温かいご飯をすりこぎで半分ほどつぶす。塩を溶いた少量の水で手をぬらし、直径3cmの団子に丸める。',
      'ごぼうはささがき、鶏もも肉は一口大にする。鍋に分量の水、酒、鶏、ごぼうを入れて煮立て、あくを取りながら煮る。',
      '肉の中心まで火が通ったらしょうゆ、ほぐしたまいたけ、斜めに切った長ねぎを加える。最後にだまこを入れ、崩れないよう煮汁が染みるまで静かに煮る。',
    ],
  }),
  regionalDish({
    id: 'yamagata-imoni', name: '牛肉と里いもの芋煮', region: '山形', reference: 'imoni_yamagata',
    tags: ['autumn'], aliases: ['山形県', '内陸', '芋煮会'], role: 'main', family: 'meat-main',
    category: 'meat', method: 'hotpot', mealOccasions: withDrinks, minutes: 35,
    ingredients: [['beef', 160], ['taro', 250], ['konjac', 100], ['negi', 75], ['water', 500],
      ['sake', 20], ['soy_sauce', 20], ['sugar', 7]],
    steps: [
      '里いもは皮をむき、大きいものは半分に切る。こんにゃくはちぎって下ゆでし、長ねぎは斜めに切る。',
      '鍋に水、里いも、こんにゃく、酒を入れる。ふたをずらして中火で煮て、里いもに竹串が通るまで火を通す。',
      '牛薄切り肉を広げ入れてあくを取る。砂糖としょうゆを加え、長ねぎがやわらかくなり肉に火が通ったら煮汁ごと盛る。',
    ],
  }),
  regionalDish({
    id: 'ibaraki-soboro-natto', name: '切り干し大根の即席そぼろ納豆', region: '茨城', reference: 'soboronatto_ibaraki',
    tags: [], aliases: ['茨城県', '水戸', 'しょぼろ納豆', 'ご飯のお供'], role: 'side', family: 'small-dish',
    category: 'bean', method: 'dressed', mealOccasions: withBreakfast.concat('晩酌'), minutes: 20,
    ingredients: [['natto', 90], ['kiriboshi_daikon', 12], ['soy_sauce', 7], ['mirin', 6], ['water', 35]],
    steps: [
      '切り干し大根は洗って水で戻し、水気をしっかり絞る。食感が残るよう7mm幅に刻む。',
      '小鍋にしょうゆ、みりん、分量の水と大根を入れる。中火で混ぜながら煮て汁気を飛ばし、皿に広げて冷ます。',
      'たれを入れていない納豆をほぐし、大根を混ぜる。小鉢に盛ってご飯に添える。',
    ],
  }),
  regionalDish({
    id: 'saitama-tsumikko', name: '本庄のつみっこ', region: '埼玉', reference: '33_14_saitama',
    tags: ['winter'], aliases: ['埼玉県', 'すいとん', 'とっちゃなげ'], role: 'staple', family: 'other-staple',
    mealBase: true, mealOccasions: lunchDinner, minutes: 35, portion: {amount: 1, unit: '杯'},
    ingredients: [['flour', 120], ['chicken', 90], ['daikon', 80], ['carrot', 40], ['burdock', 40], ['negi', 35],
      ['water', 65], ['soup311_awase_dashi', 550], ['soy_sauce', 16], ['mirin', 10]],
    steps: [
      '薄力粉に分量の水を少しずつ加えてこねる。まとまったら覆い、具を用意する間休ませる。',
      'だしでささがきのごぼう、薄いいちょう切りの大根とにんじん、一口大の鶏肉を煮る。あくを取り、しょうゆとみりんを加える。',
      'ぬらした指で生地を薄く引きのばしながら一口分ずつちぎって鍋に落とす。斜め切りのねぎを加え、団子の中心に粉っぽさがなくなり鶏に火が通るまで煮る。',
    ],
  }),
  regionalDish({
    id: 'tokyo-fukagawa', name: 'あさりの深川めし（ぶっかけ）', region: '東京', reference: '34_1_tokyo',
    tags: ['spring'], aliases: ['東京都', '深川丼', '漁師めし'], role: 'staple', family: 'donburi', mealBase: true,
    mealOccasions: lunchDinner, minutes: 20, portion: {amount: 1, unit: '杯'},
    ingredients: [['rice', 320], ['clam', 290], ['negi', 65], ['ginger', 6], ['miso', 18], ['sake', 15], ['water', 280]],
    steps: [
      '砂抜き済みのあさりは殻をこすり洗いする。鍋に水と酒、あさりを入れ、ふたをして強めの火で蒸し煮にする。',
      '口が開いた貝の身を外し、開かなかった貝は除く。煮汁は細かいざるでこし、薄く切った長ねぎ、千切りのしょうがと鍋に戻す。',
      '長ねぎがやわらかくなったら身を戻して中心まで十分に加熱し、みそを溶く。熱いご飯に汁ごとかける。',
    ],
  }),
  regionalDish({
    id: 'chiba-flower-sushi', name: '房総の花の太巻ずし（鮭ご飯）', region: '千葉', reference: 'futomaki_zushi_chiba',
    tags: ['hinamatsuri', 'school-entry', 'birthday'], aliases: ['千葉県', '太巻き祭りずし', '飾り巻きずし', 'お祝い'],
    role: 'staple', family: 'sushi', mealBase: true, mealOccasions: lunchDinner, minutes: 45,
    ingredients: [['rice', 280], ['salmon', 60], ['egg', 1], ['spinach', 30], ['nori', 6], ['vinegar', 18], ['sugar', 7], ['salt', 1.5], ['oil', 2]],
    steps: [
      '酢、砂糖、塩を合わせて温かいご飯に切り混ぜる。鮭を中心まで焼いて骨と皮を取り、細かくほぐしてご飯の半量に混ぜる。',
      'ほうれん草をゆでて水気を絞る。油を薄く引いて卵を焼き、中心にする長さ約10cmの棒状に切る。残りは細く切って葉と一緒に使う。',
      '鮭ご飯を細長く切ったのりで巻いて、卵と同じ長さの細巻きを作る。太巻き一本につき細巻き五本を卵のまわりに並べ、花びらの間にほうれん草を挟む。',
      '巻きすに外巻き用ののりを敷き、向こう端を少しあけて白い酢飯を広げる。花の束をのせ、巻きすを持ち上げて一巻きにする。ぬらした包丁で切る。',
    ],
  }),
  regionalDish({
    id: 'niigata-noppe', name: '里いもとほたてののっぺ', region: '新潟', reference: 'noppe_niigata',
    tags: ['new-year', 'anniversary'], aliases: ['新潟県', 'のっぺい', '祝い膳'], role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'simmer', mealOccasions: withDrinks, minutes: 35,
    ingredients: [['taro', 170], ['scallop', 55], ['bamboo_shoot_cooked', 50], ['carrot', 45], ['shiitake', 40],
      ['konjac', 40], ['soup311_awase_dashi', 260], ['kyoto_usukuchi', 10], ['mirin', 9]],
    steps: [
      '里いも、たけのこ、にんじん、しいたけを食べやすい短冊にそろえる。こんにゃくも同じ大きさに切って下ゆでする。',
      '鍋にだしと野菜、こんにゃくを入れ、沸いたら火を弱める。里いもの形を残して竹串が通るまで煮る。',
      '薄切りのほたて、薄口しょうゆ、みりんを加え、ほたての中心まで火を通す。里いもの自然なとろみを生かし、煮汁を少し添える。',
    ],
  }),
  regionalDish({
    id: 'ishikawa-nasu-somen', name: '加賀のなすそうめん', region: '石川', reference: 'nasusoumen_ishikawa',
    tags: ['summer'], aliases: ['石川県', '金沢', 'なすのそうめんかぶし'], role: 'staple', family: 'somen',
    mealBase: false, mealOccasions: lunchDinner, minutes: 25, portion: {amount: 1, unit: '杯'},
    ingredients: [['somen', 135], ['aubergine', 200], ['noodle_niboshi_stock', 380], ['kyoto_usukuchi', 12], ['mirin', 12], ['sake', 10]],
    steps: [
      'なすは縦半分にし、皮側に浅い切り込みを入れて長さを半分に切る。',
      '煮干しだしに薄口しょうゆ、みりん、酒を合わせてなすを入れる。落としぶたをし、箸がすっと入るまで煮る。',
      '別鍋でそうめんを表示より少し短めにゆで、水でもみ洗いしてよく水を切る。なすの煮汁に加えてひと煮立ちさせ、味を吸わせる。',
    ],
  }),
  regionalDish({
    id: 'gifu-gohei', name: '東濃のくるみ五平餅', region: '岐阜', reference: '38_8_gifu',
    tags: ['autumn'], aliases: ['岐阜県', '収穫祝い', '五平もち'], role: 'staple', family: 'onigiri',
    mealBase: false, mealOccasions: ['昼食', '間食'], minutes: 25, portion: {amount: 2, unit: '本'},
    ingredients: [['rice', 260], ['walnut', 16], ['sesame', 5], ['soy_sauce', 10], ['sugar', 8], ['mirin', 12]],
    steps: [
      '温かいご飯を粒が半分残るくらいにつぶす。ぬらした手でひと口大の俵形にし、ひと串に二つずつ平たい竹串に刺して押さえる。ひとり二串を目安にする。',
      'くるみとごまを乾煎りしてすりつぶす。しょうゆ、砂糖、みりんを小鍋で煮立て、くるみとごまを混ぜてたれにする。',
      'フライパンに五平餅を並べ、両面が乾いて焼き色がつくまで焼く。たれを両面に塗り、弱火で焦がさないように返しながら焼く。',
    ],
  }),
  regionalDish({
    id: 'mie-tekone', name: '志摩のかつおのてこねずし', region: '三重', reference: 'tekone_zushi_mie',
    tags: ['anniversary', 'summer'], aliases: ['三重県', '伊勢志摩', '手こね寿司', 'おもてなし'], role: 'staple', family: 'sushi',
    mealBase: true, mealOccasions: lunchDinner, minutes: 25,
    ingredients: [['rice', 320], ['bonito_sashimi', 160], ['vinegar', 20], ['sugar', 7], ['salt', 1],
      ['soy_sauce', 14], ['mirin', 12], ['ginger', 5], ['shiso', 3], ['nori', 1]],
    steps: [
      'みりんを一度煮立て、しょうゆを加えて冷ます。刺身用のかつおをそぎ切りにし、たれにからめて冷蔵庫で10分ほどおく。',
      '酢、砂糖、塩を合わせて温かいご飯に切り混ぜ、広げて人肌まで冷ます。しょうがと青じそは細い千切りにする。',
      '酢飯にかつおの半量をさっくり混ぜ、残りを上に並べる。しょうが、青じそ、ちぎったのりを散らし、できたてを食べる。',
    ],
  }),
  regionalDish({
    id: 'nara-chagayu', name: '大和のさつまいも茶粥', region: '奈良', reference: 'chagayu_nara',
    tags: ['autumn'], aliases: ['奈良県', '茶がゆ', 'おかいさん'], role: 'staple', family: 'rice', mealBase: false,
    mealOccasions: ['朝食', '昼食'], minutes: 20, portion: {amount: 1, unit: '杯'},
    ingredients: [['rice', 210], ['roasted_tea', 450], ['sweet_potato', 100], ['salt', 0.7]],
    steps: [
      'さつまいもは1cm角に切って水にさらし、水気を切る。鍋に無糖のほうじ茶とさつまいもを入れる。',
      '沸いたら火を弱め、いもに竹串が通るまで煮る。炊いたご飯を加え、箸でほぐす。',
      'ご飯がほどけてふっくらするまで数分煮る。塩を少し加え、とろみがつきすぎる前に器によそう。',
    ],
  }),
  regionalDish({
    id: 'shiga-saba-somen', name: '長浜の焼きさばそうめん', region: '滋賀', reference: 'saba_soumen_shiga',
    tags: ['spring'], aliases: ['滋賀県', '湖北', '鯖そうめん', '農繁期'], role: 'staple', family: 'somen',
    mealBase: true, mealOccasions: lunchDinner, minutes: 35,
    ingredients: [['somen', 130], ['mackerel', 180], ['ginger', 8], ['soy_sauce', 18], ['sake', 20], ['mirin', 15], ['sugar', 5], ['water', 230]],
    steps: [
      'さばは小骨を取り、切り身をグリルで両面焼いて皮に焼き色をつける。しょうがを薄切りにする。',
      '鍋に水、しょうが、しょうゆ、酒、みりん、砂糖を煮立てる。焼いたさばを入れて落としぶたをし、身に味が染みるまで弱めの火で煮る。',
      'そうめんを別鍋でゆでて水でもみ洗いし、水気を切る。さばを器に取り出し、残った煮汁にそうめんをからめて軽く煮詰め、さばと一緒に盛る。',
    ],
  }),
  regionalDish({
    id: 'hyogo-takomeshi', name: '明石のたこめし', region: '兵庫', reference: '40_27_hyogo',
    tags: ['summer'], aliases: ['兵庫県', 'たこ飯', '半夏生'], role: 'staple', family: 'rice', mealBase: false,
    mealOccasions: lunchDinner, minutes: 75, portion: {amount: 1, unit: '杯'},
    ingredients: [['uncooked_rice', 150], ['octopus', 125], ['ginger', 6], ['soy_sauce', 10], ['sake', 10], ['soup311_awase_dashi', 170]],
    steps: [
      '米は洗って水気を切り、炊飯器の内釜に入れる。酒、しょうゆ、だしを炊く米の量に合う目盛りまで入れ、20分ほど吸水させる。',
      'ゆでだこは炊いて縮むので少し大きめのそぎ切りにする。しょうがは皮をむいて千切りにする。',
      '米の上にしょうがとたこをのせ、混ぜずに炊飯する。炊き上がったら底から返し、たこを均等にして盛る。',
    ],
  }),
  regionalDish({
    id: 'hiroshima-kaki-dote', name: '広島かきの土手鍋', region: '広島', reference: '42_4_hiroshima',
    tags: ['winter', 'anniversary'], aliases: ['広島県', '牡蠣の土手鍋', '鍋を囲む日'], role: 'main', family: 'fish-main',
    category: 'fish', method: 'hotpot', mealOccasions: withDrinks, minutes: 30,
    ingredients: [['simmered_oyster', 170], ['tofu', 150], ['chinese_cabbage', 180], ['negi', 60], ['shiitake', 45],
      ['miso', 32], ['mirin', 15], ['sugar', 5], ['kyoto_kombu_dashi', 380]],
    steps: [
      '白菜はざく切り、長ねぎは斜め切り、しいたけと豆腐は食べやすく切る。かきはざるでやさしく洗って水を切る。',
      'みそ、みりん、砂糖を合わせ、小鍋の内側に厚く塗る。中央に白菜、長ねぎ、しいたけ、豆腐を並べ、昆布だしを静かに注いで煮る。',
      '野菜がやわらかくなったらかきを加え、かきの中心を85～90℃で90秒以上加熱する。鍋肌のみそを好みの濃さまで溶かしながら取り分ける。',
    ],
  }),
  regionalDish({
    id: 'kagawa-shippoku', name: '讃岐のしっぽくうどん', region: '香川', reference: 'sippoku_udon_kagawa',
    tags: ['autumn', 'winter'], aliases: ['香川県', 'さぬき', '卓袱うどん'], role: 'staple', family: 'udon',
    mealBase: true, mealOccasions: lunchDinner, minutes: 30, portion: {amount: 1, unit: '杯'},
    ingredients: [['udon', 380], ['taro', 120], ['daikon', 95], ['carrot', 50], ['aburaage', 35],
      ['negi', 20], ['noodle_niboshi_stock', 550], ['kyoto_usukuchi', 16], ['mirin', 10]],
    steps: [
      '皮をむいた里いもは小さな輪切り、大根とにんじんはいちょう切りにする。油揚げは短冊切り、ねぎは小口切りにする。',
      '鍋に煮干しだし、里いも、大根、にんじんを入れる。煮立ったら火を弱め、野菜に串が通ったら油揚げ、薄口しょうゆ、みりんを加える。',
      '別鍋でうどんを温め、湯を切って丼へ。煮含めた根菜とつゆをたっぷりかけ、ねぎをのせる。',
    ],
  }),
  regionalDish({
    id: 'ehime-imotaki', name: '大洲のいもたき', region: '愛媛', reference: 'imotaki_ehime', tags: ['autumn', 'harvest-moon'],
    aliases: ['愛媛県', '芋炊き', 'お月見'], role: 'main', family: 'meat-main', category: 'meat', method: 'hotpot',
    mealOccasions: withDrinks, minutes: 35,
    ingredients: [['chicken', 165], ['taro', 230], ['shiitake', 50], ['konjac', 70], ['aburaage', 25],
      ['soup311_awase_dashi', 430], ['kyoto_usukuchi', 12], ['sugar', 5], ['mirin', 12], ['sake', 12]],
    steps: [
      '里いもを皮をむいて大きめに切り、さっと下ゆでする。鶏もも肉は一口大、しいたけは半分、油揚げは短冊に切る。',
      'こんにゃくをちぎり、下ゆでして水を切る。鍋にだし、鶏、里いも、こんにゃく、酒を入れて煮立て、あくを取る。',
      'しいたけ、油揚げ、薄口しょうゆ、砂糖、みりんを加える。里いもがやわらかくなり肉の中心まで火が通るまで煮て、鍋のまま取り分ける。',
    ],
  }),
  regionalDish({
    id: 'oita-ryukyu', name: 'ぶりのりゅうきゅう', region: '大分', reference: 'ryukyu_oita', tags: ['winter'],
    aliases: ['大分県', '琉球', 'ご飯のお供'], role: 'main', family: 'sashimi', category: 'fish', method: 'sashimi',
    mealOccasions: withDrinks, minutes: 20,
    ingredients: [['yellowtail_sashimi', 160], ['soy_sauce', 12], ['sake', 9], ['mirin', 9], ['ginger', 5],
      ['ground_sesame', 7], ['scallion_garnish', 6]],
    steps: [
      '酒とみりんを小鍋で煮立てて火から下ろす。しょうゆを合わせ、器に移して冷ます。',
      '刺身用のぶりをそぎ切りにする。冷ましたたれにすりごま、おろししょうがを混ぜ、ぶりと合わせる。',
      '覆いをして冷蔵庫で10分ほど味をなじませる。小鉢に盛り、小口切りのねぎを散らしてすぐ食べる。',
    ],
  }),
  regionalDish({
    id: 'miyazaki-hiyajiru', name: 'あじの冷や汁かけ麦ご飯', region: '宮崎', reference: 'hiyajiru_miyazaki', tags: ['summer'],
    aliases: ['宮崎県', '冷汁', '暑い日'], role: 'staple', family: 'rice', mealBase: true,
    mealOccasions: withBreakfast, minutes: 30, portion: {amount: 1, unit: '杯'},
    ingredients: [['rice', 240], ['cooked_barley', 80], ['horse_mackerel', 100], ['cucumber', 75], ['tofu', 90],
      ['miso', 24], ['ground_sesame', 10], ['shiso', 3], ['soup311_awase_dashi', 320]],
    steps: [
      'あじをグリルで両面から中心まで焼く。皮と骨を取り除き、身をほぐしてすり鉢ですりごま、みそとすり合わせる。',
      '魚みそをアルミ箔に薄く広げ、グリルで表面に焼き色をつける。ボウルに戻し、冷やしただしを少しずつ混ぜて溶く。',
      '薄い輪切りのきゅうり、くずした豆腐、千切りの青じそを汁に加える。ご飯とゆで押し麦を合わせて椀に盛り、食べる直前に汁をかける。',
    ],
  }),
  regionalDish({
    id: 'kagoshima-keihan', name: '奄美の鶏飯', region: '鹿児島', reference: 'keihan_kagoshima', tags: ['anniversary'],
    aliases: ['鹿児島県', 'けいはん', '奄美大島', 'おもてなし'], role: 'staple', family: 'rice', mealBase: true,
    mealOccasions: lunchDinner, minutes: 45, portion: {amount: 1, unit: '杯'},
    ingredients: [['rice', 300], ['chicken_breast', 160], ['shiitake', 65], ['egg', 1], ['palette_takuan', 20],
      ['scallion_garnish', 5], ['nori', 1], ['water', 550], ['sake', 15], ['soy_sauce', 8], ['mirin', 8], ['salt', 1], ['oil', 2]],
    steps: [
      '鶏むね肉を厚み2cmほどに開く。水と酒を沸かして鶏を加え、あくを取りながら中心まで十分に火を通す。取り出してほぐし、ゆで汁は塩で調える。',
      'ゆで汁の約1割を小鍋に取り、薄切りのしいたけ、しょうゆ、みりんを加えて煮含める。薄く油を引いたフライパンで卵を薄く焼き、細く切る。',
      'たくあんはみじん切り、小ねぎは小口切りにする。ご飯に鶏、しいたけ、錦糸卵、漬物、ねぎとちぎったのりを並べ、熱い鶏のゆで汁をかける。',
    ],
  }),
  regionalDish({
    id: 'kagoshima-gane', name: 'さつまいものがね', region: '鹿児島', reference: 'gane_kagoshima', tags: ['autumn', 'obon'],
    aliases: ['鹿児島県', '精進揚げ', 'おやつ'], role: 'side', family: 'small-dish', category: 'vegetable', method: 'fried',
    mealOccasions: ['昼食', '夕食', '間食'], minutes: 25,
    ingredients: [['sweet_potato', 150], ['carrot', 35], ['chive', 18], ['flour', 40], ['rice_flour', 12],
      ['sugar', 6], ['salt', 0.7], ['water', 50], ['oil', 25]],
    steps: [
      'さつまいもはよく洗い、皮つきのまま長さ5cmほどの太めの細切りにする。にんじんとにらも同じ長さにそろえる。',
      '薄力粉、米粉、砂糖、塩を具にまぶす。分量の水を少しずつ加え、粉が野菜にからんでまとまる硬さにする。',
      '油を引いた小さめのフライパンに、ひと口分ずつ具を落として箸で薄く広げる。中弱火で片面ずつ揚げ焼きにし、いもに竹串が通り衣が色づいたら油を切る。',
    ],
  }),
  regionalDish({
    id: 'okinawa-kubu', name: 'クーブイリチー（昆布の炒め煮）', region: '沖縄', reference: '47_2_okinawa',
    tags: ['new-year', 'anniversary'], aliases: ['沖縄県', 'クーブイリチイ', '祝い膳'], role: 'side', family: 'small-dish',
    category: 'seaweed', method: 'stir-fry', mealOccasions: withDrinks, minutes: 45,
    ingredients: [['kombu', 12], ['dish_pork_belly_sliced', 65], ['konjac', 65], ['palette_atsuage', 55],
      ['water', 290], ['soy_sauce', 10], ['mirin', 8], ['sugar', 3], ['oil', 3]],
    steps: [
      '昆布を分量の水で戻し、重ねて端からごく細く刻む。戻し汁は取っておく。こんにゃくを下ゆでし、厚揚げ、豚ばら肉と一緒に細切りにする。',
      '鍋に油を熱し、豚肉を炒めてからこんにゃく、昆布、厚揚げを加えて軽く炒め合わせる。',
      '昆布の戻し汁、しょうゆ、みりん、砂糖を加える。ふたをして昆布がやわらかくなるまで煮て、最後にふたを外し、汁気が少し残るまで炒りつける。',
    ],
  }),
];
