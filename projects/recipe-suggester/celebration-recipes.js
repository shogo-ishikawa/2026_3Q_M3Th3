// 食材の数量は2人分。単位、栄養、アレルゲンには共通の食材台帳を使う。
const eventNames = {
  birthday: ['誕生日', 'バースデー'],
  christmas: ['クリスマス', 'クリスマスイブ'],
  'new-year': ['お正月', '正月', '新年', 'おせち'],
};

function dish(event, {id, name, role, family, category, method, minutes, ingredients, steps, aliases = []}) {
  return {
    id: `celebration-${id}`, name, role, family, genre: event === 'new-year' ? '和食' : '洋食',
    nature: 'home-cooked', servings: 2, minutes, staple: false, mealBase: false,
    portion: {amount: 1, unit: role === 'soup' ? '杯' : '皿'},
    mealOccasions: ['昼食', '夕食'], tags: minutes <= 20 ? ['時短'] : [],
    searchAliases: [...eventNames[event], ...aliases],
    ...(category ? {displayCategory: category, displayMethod: method, displaySecondaryCategories: []} : {}),
    ingredients: ingredients.map(([id, amount]) => ({id, amount})), steps,
    ingredientsKnown: true, allergensKnown: true, shoppingKnown: true,
    sourceNote: '行事に合わせた家庭用の配合です。材料は2人分、栄養は台帳の可食部と調味料から求めた1人分の概算です。',
  };
}

const birthday = [
  dish('birthday', {
    id: 'birthday-beef-rolls', name: '牛肉の彩り野菜ロール', role: 'main', family: 'meat-main', category: 'meat', method: 'grill', minutes: 30,
    ingredients: [['beef', 220], ['asparagus', 90], ['paprika', 80], ['flour', 6], ['oil', 6], ['soy_sauce', 12], ['mirin', 16], ['water', 25]],
    steps: [
      'アスパラガスは根元の硬い部分を取り、縦半分に切る。赤パプリカは同じ長さの細切りにする。',
      '野菜を歯ごたえが残る程度に下ゆでし、水気を拭く。牛薄切り肉を広げ、赤と緑の野菜を芯にしてきつめに巻く。',
      '薄力粉を薄くまぶす。油をひいたフライパンに巻き終わりを下にして置き、動かさずに焼き付けてから転がし、全体に焼き色を付ける。',
      '水を加えてふたをし、弱めの火で蒸し焼きにする。肉が重なった部分まで火を通し、中心75℃で1分以上を確認する。',
      'しょうゆとみりんを加え、煮詰めながら絡める。清潔な包丁で斜めに切り、野菜の断面を上にして盛る。',
    ],
  }),
  dish('birthday', {
    id: 'birthday-scallop-coquille', name: 'ほたてとマッシュルームのコキール', role: 'main', family: 'fish-main', category: 'fish', method: 'grill', minutes: 35,
    aliases: ['帆立', 'コキーユ', 'グラタン'],
    ingredients: [['scallop', 180], ['mushroom', 90], ['onion', 50], ['butter', 16], ['flour', 14], ['milk', 220], ['parmesan_cheese', 10], ['salt', 0.8], ['parsley', 2]],
    steps: [
      'オーブンを200℃に予熱する。玉ねぎとマッシュルームは薄切りにし、加熱用のほたて貝柱は厚みを半分に切って水気を拭く。',
      '鍋にバターの半量を溶かし、玉ねぎとマッシュルームを炒める。ほたてを加えて両面を焼き、具をいったん取り出す。',
      '残りのバターを溶かして薄力粉を弱火で炒める。牛乳を少しずつ加えてそのつど混ぜ、なめらかにとろみが付いたら塩を加える。',
      '具と出た汁を戻し、弱く煮立てて薄切りのほたてに十分火を通す。浅い耐熱皿に分け、粉チーズを振る。',
      'オーブンで10分ほど焼き、ソースが縁までふつふつと煮立ち表面に焼き色が付いたら、刻みパセリを散らす。',
    ],
  }),
  dish('birthday', {
    id: 'birthday-pear-walnut-salad', name: '洋梨と紫キャベツのくるみサラダ', role: 'side', family: 'side', category: 'vegetable', method: 'salad', minutes: 15,
    ingredients: [['fruit_european_pear', 120], ['red_cabbage', 100], ['lettuce', 40], ['walnut', 14], ['lemon', 10], ['olive_oil', 8], ['salt', 0.6]],
    steps: [
      '紫キャベツを細いせん切りにし、分量の塩をまぶして軽くもむ。しんなりしたら水気を軽く絞る。レタスは洗ってちぎる。',
      'くるみは乾いたフライパンで弱火でいり、香りが立ったら取り出して粗く刻む。',
      '洋梨の皮と芯を除き、くし形の薄切りにする。レモン汁とオリーブ油を混ぜ、洋梨と紫キャベツを軽く和える。',
      'レタスを敷いて洋梨を扇形に重ね、中央に紫キャベツをのせる。食べる直前にくるみを散らす。',
    ],
  }),
  dish('birthday', {
    id: 'birthday-carrot-orange-potage', name: 'にんじんとオレンジのポタージュ', role: 'soup', family: 'potage', minutes: 30,
    ingredients: [['carrot', 180], ['onion', 50], ['potato', 50], ['orange', 100], ['olive_oil', 6], ['water', 280], ['salt', 1.1]],
    steps: [
      'にんじんとじゃがいもは皮をむいて薄い半月切りにし、玉ねぎは薄切りにする。オレンジは皮と薄皮を除き、果肉を粗く刻む。',
      'オリーブ油で玉ねぎをしんなりするまで炒め、にんじんとじゃがいもを加える。油が回ったら水を注ぐ。',
      'ふたをして弱火で15分ほど煮る。野菜がスプーンでつぶせる柔らかさになったら火を止め、オレンジの果肉とその汁を加える。',
      '粗熱を取り、ブレンダーでなめらかにつぶす。鍋で静かに温め直して塩を加え、器に注ぐ。',
    ],
  }),
];

const christmas = [
  dish('christmas', {
    id: 'christmas-lemon-chicken', name: '鶏もも肉とじゃがいものレモンロースト', role: 'main', family: 'meat-main', category: 'meat', method: 'grill', minutes: 45,
    aliases: ['ローストチキン'],
    ingredients: [['chicken', 280], ['potato', 180], ['onion', 80], ['garlic', 6], ['lemon', 18], ['olive_oil', 10], ['salt', 1.4], ['dried_basil', 0.5]],
    steps: [
      'オーブンを210℃に予熱する。よく洗ったじゃがいもと玉ねぎはくし形に切る。じゃがいもは中心が少し硬いくらいまで下ゆでして湯を切る。',
      '鶏もも肉の厚い部分を開いて厚みをそろえる。すりおろしたにんにく、レモン汁、塩、乾燥バジル、オリーブ油の半量をもみ込む。',
      '天板に鶏肉を皮を上にしてのせる。周囲に野菜を並べ、残りのオリーブ油を野菜に絡める。',
      '25〜30分を目安に焼く。鶏肉の厚い部分が中心75℃で1分以上になり、じゃがいもに竹串が通るまで加熱する。',
      '清潔なまな板で鶏肉を切り分け、皮が上になるように焼いた野菜と盛り合わせる。',
    ],
  }),
  dish('christmas', {
    id: 'christmas-herb-cod', name: 'たらの緑のパン粉焼き', role: 'main', family: 'grilled-fish', category: 'fish', method: 'grill', minutes: 25,
    aliases: ['香草パン粉焼き'],
    ingredients: [['cod', 240], ['breadcrumbs', 24], ['parsley', 10], ['garlic', 3], ['olive_oil', 12], ['salt', 1], ['lemon', 8]],
    steps: [
      'オーブンを200℃に予熱する。たらの小骨を外し、塩を振って少し置き、出た水分を紙で拭き取る。',
      '洗って水気を拭いたパセリとにんにくを細かく刻み、パン粉とオリーブ油を合わせてしっとりした緑色の衣を作る。',
      '耐熱皿にたらを並べ、上面に衣を均等に広げて軽く押さえる。15分ほど焼き、衣の色付きが早い場合は途中でホイルをかぶせる。',
      'たらは中心まで火を通し、厚いところも身がほぐれることを確かめる。仕上げにレモン汁を添える。',
    ],
  }),
  dish('christmas', {
    id: 'christmas-wreath-salad', name: 'ブロッコリーと赤パプリカのリースサラダ', role: 'side', family: 'side', category: 'vegetable', method: 'salad', minutes: 20,
    ingredients: [['broccoli', 180], ['paprika', 70], ['corn', 30], ['yogurt', 45], ['lemon', 6], ['olive_oil', 5], ['salt', 0.5]],
    steps: [
      'ブロッコリーは小房に分け、茎は皮を厚めにむいて薄切りにする。茎から順にゆで、ざるに広げて水気を飛ばす。',
      '赤パプリカは薄い輪切りと小さな角切りに分ける。コーンは火を通して冷まし、水気を切る。',
      '大皿の中央を空け、茎の上に小房を円く並べる。花の飾りのようにパプリカをのせ、コーンを散らす。',
      'ヨーグルト、レモン汁、オリーブ油、塩を混ぜて別添えにし、取り分けてからかける。',
    ],
  }),
  dish('christmas', {
    id: 'christmas-beet-bean-soup', name: 'ビーツと白いんげんの赤いスープ', role: 'soup', family: 'vegetable-soup', minutes: 35,
    ingredients: [['beet', 120], ['white_bean_cooked', 100], ['canned_tomato', 160], ['onion', 50], ['water', 240], ['olive_oil', 6], ['salt', 1.2], ['parsley', 2]],
    steps: [
      'ビーツは洗って皮をむき、薄いいちょう切りにする。玉ねぎは細かく刻む。水煮の白いんげんは水気を切る。',
      '鍋にオリーブ油を熱し、玉ねぎをじっくり炒める。ビーツと水を加え、ふたをして弱火で15〜20分ほど煮る。',
      'ビーツが柔らかくなったらトマト缶をつぶして加え、白いんげんを入れる。豆が崩れないよう静かに混ぜてさらに煮る。',
      '塩で味を調え、豆と具を均等に器に分け、仕上げに刻んだパセリを散らす。',
    ],
  }),
];

const newYear = [
  dish('new-year', {
    id: 'new-year-matsukaze', name: '鶏の松風焼き', role: 'main', family: 'meat-main', category: 'meat', method: 'grill', minutes: 35,
    ingredients: [['chicken_minced', 230], ['egg', 1], ['miso', 16], ['sugar', 6], ['starch', 8], ['ginger', 5], ['sesame', 5], ['canteen_aonori', 0.4]],
    steps: [
      'オーブンを180℃に予熱する。しょうがをすりおろし、卵を溶く。小さな耐熱の角型にオーブンシートを敷く。',
      '鶏ひき肉、みそ、砂糖、しょうが、片栗粉を粘りが出るまで練る。溶き卵を少しずつ加え、均一な肉だねにする。',
      '肉だねを厚さ2cmほどに平らに広げる。表面の半分に白ごまを振り、残りの半分に青のりを振る。',
      '20〜25分を目安に焼き、中心が75℃で1分以上になるまで加熱する。少し落ち着かせてから型を外す。',
      '清潔な包丁で扇に見立てた台形に切り、白ごまと青のりの面が交互になるよう盛る。',
    ],
  }),
  dish('new-year', {
    id: 'new-year-shrimp-lotus', name: 'えびとれんこんの祝い煮', role: 'main', family: 'fish-main', category: 'fish', method: 'simmer', minutes: 25,
    ingredients: [['shrimp', 200], ['lotus_root', 150], ['soup311_awase_dashi', 200], ['ginger', 6], ['soy_sauce', 16], ['mirin', 18], ['sake', 12]],
    steps: [
      'れんこんは皮をむいて輪切りにし、穴の間の縁を浅く切り取って花形にする。しょうがは薄切りにする。',
      '鍋に合わせだし、しょうゆ、みりん、清酒、しょうがを入れる。れんこんを並べ、落としぶたをして弱めの火で煮る。',
      'れんこんに竹串が通ったら、背わたを除いたむきえびを加える。えびを時々返し、中心まで火を通す。',
      '花れんこんを器に並べ、えびを重ねる。分量の煮汁を具にかけ、しょうがを添える。',
    ],
  }),
  dish('new-year', {
    id: 'new-year-apple-kinton', name: 'りんごとさつまいもの茶巾きんとん', role: 'side', family: 'small-dish', category: 'vegetable', method: 'simmer', minutes: 30,
    ingredients: [['sweet_potato', 200], ['apple', 95], ['sugar', 8], ['lemon', 5], ['water', 35]],
    steps: [
      'さつまいもは皮を厚めにむいて輪切りにし、串がすっと通るまで蒸す。熱いうちにつぶして繊維を取り除く。',
      'りんごは皮と芯を除いて小さな角切りにする。小鍋に分量の水、砂糖、レモン汁を入れ、りんごを弱火で透き通るまで煮る。',
      'つぶしたさつまいもにりんごを混ぜ、りんごの煮汁を加減しながら加える。柔らかすぎたら弱火で水分を飛ばす。',
      '触れられる温度になったら取り分け、ラップで包んで上をねじり茶巾形にする。ラップを外して小皿に並べる。',
    ],
  }),
  dish('new-year', {
    id: 'new-year-seabream-soup', name: '焼き鯛と青菜のすまし椀', role: 'soup', family: 'clear-soup', minutes: 25,
    aliases: ['お吸い物', '祝い椀'],
    ingredients: [['seabream_sashimi', 100], ['komatsuna', 60], ['carrot', 35], ['soup311_awase_dashi', 340], ['kyoto_usukuchi', 6], ['sake', 10], ['salt', 0.5]],
    steps: [
      '鯛は骨のない切り身を薄めのそぎ切りにし、塩を振って出た水気を拭く。にんじんは薄切りにして花形に抜き、抜いた残りも細かく切る。',
      '小松菜をゆでて水気を絞り、椀に収まる長さに切る。鯛は熱した魚焼きグリルで両面を焼き、中心まで火を通す。',
      '小鍋に合わせだし、にんじんと清酒を入れ、にんじんが柔らかくなるまで煮る。薄口しょうゆを加え、静かにひと煮立ちさせる。',
      '椀に焼いた鯛と小松菜を置き、花形のにんじんを添える。熱いだしを静かに張る。',
    ],
  }),
];

export const CELEBRATION_RECIPES = [...birthday, ...christmas, ...newYear];

const occasionsByRecipe = new Map();
for (const [id, recipes] of Object.entries({birthday, christmas, 'new-year': newYear})) {
  const occasions = Object.freeze([id]);
  for (const recipe of recipes) occasionsByRecipe.set(recipe.id, occasions);
}
const noOccasions = Object.freeze([]);

export function recipeOccasionIds(recipe) {
  return occasionsByRecipe.get(recipe?.id) ?? noOccasions;
}
