import {occasionDish} from './occasion-recipe.js';

export const SPRING_SUMMER_RECIPES = [
  occasionDish('coming-of-age', {
    id: 'tai-yuzu-salt', name: '鯛の昆布包み酒蒸し', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'steam', minutes: 25,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['seabream_sashimi', 200], ['kombu', 4], ['negi', 60], ['carrot', 30], ['sake', 20], ['kyoto_usukuchi', 5], ['water', 35]],
    steps: [
      '昆布を分量の水で湿らせ、長ねぎを斜めに薄く、にんじんを短い細切りにする。',
      '耐熱皿に昆布を敷き、鯛と野菜をのせて酒を振る。皿ごと蒸し器に入れ、鯛の中心まで蒸す。',
      '昆布を取り出して細く刻み、鯛と野菜に添える。蒸し汁に薄口しょうゆを合わせてかける。',
    ],
  }),
  occasionDish('coming-of-age', {
    id: 'beef-burdock-miso', name: '牛肉とごぼうのみそ風味焼き', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'grill', minutes: 25,
    ingredients: [['beef', 200], ['burdock', 100], ['negi', 45], ['miso', 15], ['mirin', 15], ['ginger', 5], ['oil', 5], ['water', 40]],
    steps: [
      'ごぼうを斜め薄切り、長ねぎを斜め切りにし、しょうがをすりおろす。',
      '油を熱して牛薄切り肉を広げ、両面を焼く。ごぼうと長ねぎ、水を入れ、ふたをしてごぼうが柔らかくなるまで蒸す。',
      'みそをみりんとしょうがで溶いて加え、肉にしっかり火を通しながら水分を飛ばす。',
    ],
  }),
  occasionDish('coming-of-age', {
    id: 'lotus-plum-fans', name: 'れんこんの梅酢あえ', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'pickled', minutes: 20,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['lotus_root', 150], ['ume', 12], ['vinegar', 12], ['sugar', 4], ['sesame', 3]],
    steps: [
      'れんこんを薄い半月切りにし、透き通って歯ごたえが残るまでゆで、水気を切る。',
      '梅干しの種を除き、果肉を包丁で細かくたたいて酢と砂糖を混ぜる。',
      '温かいれんこんを梅酢にくぐらせ、少し置いて味を含ませる。ごまを振って盛る。',
    ],
  }),
  occasionDish('coming-of-age', {
    id: 'scallop-turnip-broth', name: 'ほたてとかぶの祝い椀', role: 'soup', family: 'soup', genre: '和食', minutes: 20,
    ingredients: [['scallop', 90], ['turnip', 110], ['carrot', 25], ['soup311_awase_dashi', 350], ['kyoto_usukuchi', 7], ['shiso', 2]],
    steps: [
      'かぶはくし形、にんじんは薄い輪切りにし、ほたては厚みを半分にする。',
      '合わせだしでかぶとにんじんを煮る。かぶに串が通ったらほたてを加え、身の中心まで火を通す。',
      '薄口しょうゆで味を整え、汁と具を椀によそう。細く切った青じそを浮かべる。',
    ],
  }),
  occasionDish('setsubun', {
    id: 'sardine-plum-roll', name: 'いわしの梅しそ渦巻き焼き', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'grill', minutes: 30,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['sardine', 220], ['ume', 12], ['shiso', 5], ['starch', 8], ['oil', 6], ['sake', 12]],
    steps: [
      '開いたいわしの小骨を除いて水分を拭き、種を除いてたたいた梅肉を薄く塗る。',
      '青じそを重ねて尾の方へ巻き、巻き終わりをようじで留め、片栗粉を薄くまぶす。',
      '油を引いたフライパンで向きを変えながら焼く。酒を加えてふたをし、中心まで蒸し焼きにしてようじを外す。',
    ],
  }),
  occasionDish('setsubun', {
    id: 'chicken-soybean-patties', name: '鶏肉とつぶし大豆の磯辺つくね', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'grill', minutes: 30,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['chicken_minced', 180], ['soybeans', 80], ['negi', 30], ['starch', 8], ['ginger', 5], ['nori', 2], ['soy_sauce', 10], ['mirin', 14], ['oil', 5], ['water', 30]],
    steps: [
      'ゆで大豆を粒の形がなくなるまでつぶし、鶏ひき肉、刻んだ長ねぎ、片栗粉、おろししょうがと練る。',
      '平たい小判形にし、細く切ったのりを巻く。フライパンに油を熱し、巻き終わりを下にして両面を焼く。',
      '水を加えてふたをし、中心まで十分に火を通す。しょうゆとみりんを加え、転がしながら照りを出す。',
    ],
  }),
  occasionDish('setsubun', {
    id: 'squash-soy-dressed', name: 'かぼちゃとゆで大豆のごまあえ', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'dressed', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['pumpkin', 170], ['soybeans', 60], ['ground_sesame', 7], ['miso', 8], ['mirin', 7], ['water', 20]],
    steps: [
      'かぼちゃの種を除き、皮をところどころ落として小さめの角切りにする。',
      '水とみりんを入れた鍋でかぼちゃとゆで大豆を、ふたをして蒸し煮にする。',
      '柔らかくなったらみそとすりごまを少量の煮汁で溶き、かぼちゃを少し崩しながら全体にからめる。',
    ],
  }),
  occasionDish('setsubun', {
    id: 'soybean-root-soup', name: '大豆と根菜の鬼よけ汁', role: 'soup', family: 'soup', genre: '和食', minutes: 30,
    ingredients: [['soybeans', 80], ['daikon', 85], ['carrot', 45], ['burdock', 35], ['aburaage', 18], ['soup311_awase_dashi', 350], ['miso', 18]],
    steps: [
      '大根とにんじんをいちょう切り、ごぼうを薄い小口切りにする。油揚げは湯をかけて短冊に切る。',
      '鍋の合わせだしに根菜を入れ、アクを取りながら煮る。根菜が柔らかくなったらゆで大豆と油揚げを加える。',
      '大豆が温まったら火を弱め、みそを溶く。沸く直前で火を止めて椀に分ける。',
    ],
  }),
  occasionDish('valentine', {
    id: 'cocoa-beef-stew', name: '牛肉とビーツのカカオトマト煮', role: 'main', family: 'meat-main', genre: '洋食', category: 'meat', method: 'stew', minutes: 55,
    ingredients: [['beef_stew_cut', 230], ['beet', 75], ['onion', 90], ['canned_tomato', 200], ['cocoa_powder', 3], ['oil', 7], ['water', 240], ['salt', 2]],
    steps: [
      '牛肉は小さめの角切り、ビーツと玉ねぎは薄切りにする。鍋に油を熱して牛肉の表面を焼く。',
      '玉ねぎとビーツを入れてしんなりさせ、トマト缶をつぶして加える。水を注ぎ、ふたをして肉が柔らかくなるまで煮る。',
      '少量の煮汁で純ココアを溶いて戻す。混ぜながら少し煮詰め、塩で味を整える。',
    ],
  }),
  occasionDish('valentine', {
    id: 'salmon-pink-crumb', name: '鮭のパプリカチーズ衣焼き', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'grill', minutes: 25,
    ingredients: [['salmon', 220], ['paprika', 70], ['breadcrumbs', 20], ['parmesan_cheese', 10], ['olive_oil', 8], ['lemon', 8], ['salt', 1]],
    steps: [
      'パプリカを細かく刻んで温め、水分を飛ばしながら炒める。パン粉、粉チーズ、オリーブ油の半量と混ぜる。',
      '鮭の水分を拭いて塩を振り、残りの油を塗った耐熱皿に置く。パプリカの衣を上面に軽く押し付ける。',
      '200℃のオーブンで鮭の中心まで火が通り、衣に焼き色が付くまで焼く。食べる直前にレモン汁をかける。',
    ],
  }),
  occasionDish('valentine', {
    id: 'berry-beet-salad', name: 'いちごとビーツのルビーマリネ', role: 'side', family: 'small-dish', genre: '洋食', category: 'fruit', method: 'salad', minutes: 30,
    ingredients: [['strawberry', 100], ['beet', 100], ['orange', 70], ['vinegar', 9], ['olive_oil', 5], ['salt', 0.5]],
    steps: [
      'ビーツは皮をむき、小さな角切りにして柔らかくゆでる。ざるに上げて冷ます。',
      'いちごはへたを取って四つ割り、オレンジは薄皮を除いて一口大にする。',
      'ボウルに酢、塩、オリーブ油を混ぜ、先にビーツをあえる。果物を加え、形を保ちながら混ぜて冷やす。',
    ],
  }),
  occasionDish('valentine', {
    id: 'red-pepper-potage', name: '赤パプリカと白いんげんのポタージュ', role: 'soup', family: 'potage', genre: '洋食', minutes: 30,
    ingredients: [['paprika', 150], ['white_bean_cooked', 100], ['onion', 65], ['milk', 150], ['water', 170], ['olive_oil', 6], ['salt', 1.6]],
    steps: [
      '赤パプリカの種を除いて薄切りにし、玉ねぎも薄切りにする。鍋でオリーブ油と一緒にしんなりするまで炒める。',
      'ゆでた白いんげんと水を加え、パプリカが柔らかくなるまでふたをして煮る。',
      '火を止めて粗熱を取り、滑らかになるまでつぶす。牛乳を加えて再び温め、塩を加える。',
    ],
  }),
  occasionDish('hinamatsuri', {
    id: 'snap-shrimp-steam', name: 'えびとかぶの桃色しんじょ', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'steam', minutes: 30,
    ingredients: [['shrimp', 180], ['turnip', 80], ['egg', 1], ['starch', 12], ['sake', 8], ['kyoto_usukuchi', 6], ['water', 35]],
    steps: [
      'えびは殻と背わたを取って水分を拭き、包丁で粘りが出るまでたたく。かぶは皮をむいて粗くおろし水気を絞る。',
      'えび、かぶ、溶き卵、片栗粉を混ぜ、耐熱の小鉢に分ける。蒸し器で中心まで火を通す。',
      '薄口しょうゆ、酒、水をひと煮立ちさせ、蒸し上がったしんじょに少しずつかける。',
    ],
  }),
  occasionDish('hinamatsuri', {
    id: 'trio-egg-stack', name: 'ひし形の三色重ね卵焼き', role: 'main', family: 'egg-main', genre: '和食', category: 'egg', method: 'grill', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['egg', 4], ['spinach', 55], ['salmon', 55], ['milk', 25], ['starch', 4], ['oil', 5], ['salt', 1]],
    steps: [
      'ほうれん草をゆでて絞り、細かく刻む。鮭は中心まで火を通し、骨を除いて細かくほぐす。',
      '卵に牛乳、片栗粉、塩を混ぜて三つに分け、一つに鮭、一つにほうれん草を混ぜる。',
      '油を塗った小さな卵焼き器で、緑、黄色、鮭の順に流す。ふたをして層の中心まで固め、落ち着いてからひし形に切る。',
    ],
  }),
  occasionDish('hinamatsuri', {
    id: 'petal-radish-salad', name: '大根とにんじんの花びら甘酢', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'pickled', minutes: 20,
    ingredients: [['daikon', 130], ['carrot', 55], ['kyoto_kombu_dashi', 45], ['vinegar', 16], ['sugar', 6], ['salt', 1.2]],
    steps: [
      '大根を薄いいちょう切り、にんじんを小さな花びら形の薄切りにする。塩を振り、水分が出たら軽く絞る。',
      '昆布だしに砂糖と酢を混ぜ、砂糖を溶かす。細かい薄切りは形を崩さずに漬ける。',
      '少し置いて味がなじんだら漬け汁を切り、赤と白が重なるように小皿に盛る。',
    ],
  }),
  occasionDish('hinamatsuri', {
    id: 'clam-egg-ribbon', name: 'あさりと卵の春色すまし汁', role: 'soup', family: 'soup', genre: '和食', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['clam', 70], ['egg', 1], ['komatsuna', 45], ['kyoto_kombu_dashi', 350], ['kyoto_usukuchi', 6], ['sake', 8]],
    steps: [
      '小松菜を短く切り、卵は小鉢で溶く。あさりはむき身の分量を使い、さっと洗って水を切る。',
      '昆布だしと酒を温め、あさりと小松菜の茎を加えて煮る。あさりに十分に火が通ったら葉と薄口しょうゆを入れる。',
      '汁が再び煮立ったら溶き卵を細く回し入れ、ふんわりと固まってから椀に分ける。',
    ],
  }),
  occasionDish('white-day', {
    id: 'cod-white-pouch', name: 'たらと長ねぎの白い包み焼き', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'steam', minutes: 30,
    ingredients: [['cod', 220], ['negi', 90], ['mushroom', 65], ['milk', 45], ['butter', 10], ['flour', 5], ['salt', 1.4]],
    steps: [
      '長ねぎは斜めに薄く、マッシュルームは縦に薄く切る。柔らかくしたバターに小麦粉を練り合わせる。',
      'クッキングシートに野菜とたらを重ね、塩を振る。合わせたバターを分けてのせ、牛乳を注いで包む。',
      '耐熱皿に置き、200℃のオーブンで蒸気が回り、たらの中心まで火が通るまで焼く。汁をこぼさず皿に移す。',
    ],
  }),
  occasionDish('white-day', {
    id: 'chicken-cauli-gratin', name: '鶏肉とカリフラワーの白みそグラタン', role: 'main', family: 'meat-main', genre: '洋食', category: 'meat', method: 'grill', minutes: 35,
    ingredients: [['chicken_breast', 200], ['cauliflower', 170], ['onion', 65], ['miso', 13], ['milk', 180], ['flour', 10], ['butter', 10], ['cheese', 20]],
    steps: [
      'カリフラワーを小房にして下ゆでする。鶏むね肉を一口大、玉ねぎを薄切りにする。',
      'バターで玉ねぎ、鶏肉を炒め、小麦粉を振る。牛乳を少しずつ混ぜ、みそを溶き、鶏肉の中心まで火を通す。',
      '耐熱皿にカリフラワーを並べてソースをかけ、チーズを散らす。オーブントースターで表面に焼き色を付ける。',
    ],
  }),
  occasionDish('white-day', {
    id: 'apple-yogurt-slaw', name: 'りんごとかぶの白いヨーグルトあえ', role: 'side', family: 'small-dish', genre: '洋食', category: 'fruit', method: 'salad', minutes: 15,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['apple', 90], ['turnip', 110], ['yogurt', 45], ['lemon', 7], ['salt', 0.8]],
    steps: [
      'かぶは厚めのせん切りにし、塩をまぶして軽くもみ、水気を絞る。',
      'りんごは皮付きで細切りにし、変色しないようにすぐレモン汁をまぶす。',
      'ヨーグルトをなめらかに混ぜ、かぶとりんごの水分を切ってあえる。汁ごと小鉢に分ける。',
    ],
  }),
  occasionDish('white-day', {
    id: 'potato-onion-cream', name: 'じゃがいもと長ねぎの豆乳ポタージュ', role: 'soup', family: 'potage', genre: '洋食', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['potato', 180], ['negi', 85], ['soy_milk', 180], ['water', 180], ['butter', 7], ['salt', 1.5]],
    steps: [
      'じゃがいもは薄い半月切り、長ねぎの白い部分は薄い小口切りにする。',
      'バターで長ねぎを焦がさず炒め、じゃがいもと水を加える。じゃがいもが簡単に崩れるまで煮る。',
      '粗熱を取り、滑らかにつぶす。豆乳を混ぜてゆっくり温め、塩で仕上げる。',
    ],
  }),
  occasionDish('spring-equinox', {
    id: 'tofu-sesame-cutlet', name: '厚切り豆腐の二色ごま焼き', role: 'main', family: 'bean-main', genre: '和食', category: 'bean', method: 'grill', minutes: 25,
    ingredients: [['tofu', 320], ['sesame', 12], ['ground_sesame', 8], ['starch', 10], ['soy_sauce', 12], ['mirin', 10], ['oil', 8]],
    steps: [
      '木綿豆腐を重しで水切りし、厚めの長方形に切る。しょうゆとみりんを薄くからめる。',
      'ごま、すりごま、片栗粉を混ぜ、豆腐の両面に押し付ける。残った調味液は取っておく。',
      'フライパンに油を広げ、豆腐を両面こんがり焼く。残した調味液を煮立て、表面にからめる。',
    ],
  }),
  occasionDish('spring-equinox', {
    id: 'bamboo-cabbage-tofu', name: 'たけのこと春キャベツの生揚げ風炒め', role: 'main', family: 'bean-main', genre: '和食', category: 'bean', method: 'stir-fry', minutes: 25,
    ingredients: [['tofu', 260], ['bamboo_shoot_cooked', 100], ['cabbage', 120], ['starch', 10], ['sesame_oil', 7], ['ginger', 5], ['soy_sauce', 12], ['mirin', 9]],
    steps: [
      '水切りした木綿豆腐を平たく切り、片栗粉をまぶす。ゆでたけのこを薄切り、キャベツをざく切りにする。',
      'ごま油で豆腐を両面香ばしく焼いて取り出す。空いたフライパンに刻んだしょうが、たけのこ、キャベツを順に入れ炒める。',
      '豆腐を戻し、しょうゆとみりんを鍋肌から加える。木べらで大きく返して味を回す。',
    ],
  }),
  occasionDish('spring-equinox', {
    id: 'burdock-peanut-free', name: 'ごぼうとにんじんのくるみみそ', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'dressed', minutes: 20,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['burdock', 100], ['carrot', 65], ['walnut', 18], ['miso', 11], ['sugar', 4], ['water', 25]],
    steps: [
      'ごぼうとにんじんを細い拍子木に切り、先にごぼうを入れて順にゆで、湯を切る。',
      'くるみを軽く乾いりし、すり鉢でよくする。みそ、砂糖、水を混ぜて練りみそにする。',
      '鍋に練りみそを移し、焦げないよう弱火で混ぜる。野菜を加えて汁気が少なくなるまでからめる。',
    ],
  }),
  occasionDish('spring-equinox', {
    id: 'fried-tofu-mizuna', name: '水菜と焼き油揚げの昆布だし汁', role: 'soup', family: 'soup', genre: '和食', minutes: 15,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['simmered_mizuna', 65], ['aburaage', 35], ['shimeji', 55], ['kyoto_kombu_dashi', 350], ['kyoto_usukuchi', 7], ['mirin', 5]],
    steps: [
      '油揚げをフライパンで乾いりし、表面を香ばしくして短冊に切る。水菜を短く、しめじを小房に分ける。',
      '昆布だしにしめじとみりんを入れて煮る。しめじに火が通ったら油揚げを加える。',
      '薄口しょうゆと水菜を加えて短時間で火を止め、水菜の歯ざわりを残して盛る。',
    ],
  }),
  occasionDish('graduation', {
    id: 'shrimp-potato-cake', name: 'えびとじゃがいもの卒業メダル焼き', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'grill', minutes: 30,
    ingredients: [['shrimp', 150], ['potato', 210], ['egg', 1], ['starch', 8], ['parsley', 2], ['oil', 8], ['salt', 1]],
    steps: [
      'じゃがいもはゆでて熱いうちにつぶし、塩を混ぜて冷ます。えびは殻と背わたを除き、粗くたたく。',
      'じゃがいもにえび、溶き卵、片栗粉、刻んだパセリを混ぜ、薄く丸い形に整える。',
      '油を熱したフライパンで両面を焼く。ふたをして中まで蒸し焼きにし、えびと卵の中心まで火を通す。',
    ],
  }),
  occasionDish('graduation', {
    id: 'chicken-tomato-ribbons', name: '鶏肉とリボンにんじんのトマト煮', role: 'main', family: 'meat-main', genre: '洋食', category: 'meat', method: 'simmer', minutes: 35,
    ingredients: [['chicken', 220], ['carrot', 100], ['onion', 80], ['canned_tomato', 180], ['garlic', 4], ['olive_oil', 7], ['water', 65], ['salt', 1.6]],
    steps: [
      'にんじんをピーラーでリボン状に削り、玉ねぎは薄切り、鶏肉は一口大にする。',
      'オリーブ油に刻みにんにくを入れ、鶏肉の表面を焼く。玉ねぎ、トマト缶、水を加え、ふたをして煮る。',
      '鶏肉に中まで火が通ったらにんじんを加える。リボンがしんなりしたら塩を加え、汁にからませる。',
    ],
  }),
  occasionDish('graduation', {
    id: 'broccoli-eggy-buds', name: 'ブロッコリーのミモザおひたし', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'dressed', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['broccoli', 160], ['egg', 1], ['soup311_awase_dashi', 60], ['kyoto_usukuchi', 7], ['mirin', 5]],
    steps: [
      'ブロッコリーを小さい房に分け、茎も皮を厚めにむいて短冊にし、順にゆでる。',
      '合わせだし、薄口しょうゆ、みりんをひと煮立ちさせ、温かいブロッコリーを浸す。',
      '卵を固ゆでにして白身を刻み、黄身をざるでこす。汁を切ったブロッコリーに白身と黄身を散らす。',
    ],
  }),
  occasionDish('graduation', {
    id: 'asparagus-corn-soup', name: 'アスパラガスとコーンの卵スープ', role: 'soup', family: 'soup', genre: '洋食', minutes: 15,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['asparagus', 80], ['corn', 70], ['egg', 1], ['soup311_consomme', 3.5], ['water', 360], ['starch', 3]],
    steps: [
      'アスパラガスの根元の硬い部分を取り、穂先を残して斜め薄切りにする。卵はよく溶いておく。',
      '水の一部で片栗粉を溶く。残りの水とコンソメを温め、アスパラガスとコーンを煮る。',
      '水溶き片栗粉を混ぜて軽くとろみを付け、卵を筋状に流す。卵がふんわり固まったら火を止める。',
    ],
  }),
  occasionDish('school-entry', {
    id: 'spring-tofu-burg', name: '枝豆とコーンのお祝い鶏バーグ', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'grill', minutes: 30,
    ingredients: [['chicken_minced', 200], ['tofu', 80], ['edamame', 40], ['corn', 40], ['breadcrumbs', 12], ['soy_sauce', 9], ['mirin', 12], ['oil', 5], ['water', 35]],
    steps: [
      '枝豆はゆでて薄皮を除いて刻む。豆腐は水気を拭き、鶏ひき肉、パン粉と一緒に混ぜる。',
      'コーンと枝豆を加え、平たい丸形にする。油を熱したフライパンで両面を焼き、水を加えてふたをする。',
      '中心まで十分に火を通したらふたを取り、しょうゆとみりんを加える。煮汁を回しかけながら照りを出す。',
    ],
  }),
  occasionDish('school-entry', {
    id: 'salmon-spinach-bake', name: '鮭とほうれん草のチーズ卵焼き', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'grill', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['salmon', 160], ['spinach', 85], ['egg', 3], ['cheese', 25], ['milk', 25], ['oil', 5], ['salt', 1]],
    steps: [
      '鮭の骨を除き、小さめに切る。ほうれん草をゆでて絞り、短く刻む。',
      '油を熱して鮭を焼き、火が通ったらほぐす。ほうれん草を加えて炒め、平らに広げる。',
      '塩と牛乳を混ぜた溶き卵を回し入れ、チーズを散らす。ふたをして弱火で中心まで固め、取り分ける。',
    ],
  }),
  occasionDish('school-entry', {
    id: 'carrot-orange-ribbons', name: 'にんじんとオレンジの花束サラダ', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'salad', minutes: 15,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['carrot', 130], ['orange', 95], ['raisin', 12], ['lemon', 8], ['olive_oil', 6], ['salt', 0.6]],
    steps: [
      'にんじんをピーラーで薄く長く削る。塩を振ってしんなりしたら軽く絞る。',
      'オレンジの実を一口大に切り、切るときに出た果汁をレモン汁、オリーブ油と混ぜる。',
      'にんじんとレーズンをソースであえ、最後にオレンジを加える。にんじんを巻きながら盛る。',
    ],
  }),
  occasionDish('school-entry', {
    id: 'spring-cabbage-milk-soup', name: '春キャベツと新玉ねぎのミルクスープ', role: 'soup', family: 'soup', genre: '洋食', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['cabbage', 140], ['onion', 90], ['milk', 180], ['water', 170], ['butter', 6], ['soup311_consomme', 3]],
    steps: [
      'キャベツをひと口大、新玉ねぎを薄いくし形に切る。鍋にバターを入れ、玉ねぎを透き通るまで炒める。',
      'キャベツを加えてさっと炒め、水とコンソメを加える。野菜が好みの柔らかさになるまで煮る。',
      '牛乳を注ぎ、弱火で鍋底から混ぜる。沸騰する前に火を止め、野菜と一緒によそう。',
    ],
  }),
  occasionDish('childrens-day', {
    id: 'fish-koinobori', name: 'あじのこいのぼりパン粉焼き', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'grill', minutes: 25,
    ingredients: [['horse_mackerel', 220], ['cucumber', 35], ['carrot', 35], ['breadcrumbs', 17], ['cheese', 12], ['olive_oil', 7], ['nori', 1], ['salt', 1]],
    steps: [
      'あじは三枚におろした身から小骨を除く。にんじんときゅうりを薄い半月切りにし、にんじんはさっと下ゆでする。',
      'あじを耐熱皿に並べ、塩、パン粉、細かいチーズ、オリーブ油を順にのせる。200℃のオーブンで中まで焼く。',
      '頭側に小さく切ったのりの目を置き、野菜をうろこのように並べる。骨が残っていないか盛り付け時にも確認する。',
    ],
  }),
  occasionDish('childrens-day', {
    id: 'carrot-pork-spears', name: '豚肉とアスパラガスのかぶと春巻き', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'fried', minutes: 35,
    ingredients: [['pork_minced', 160], ['asparagus', 85], ['carrot', 50], ['spring_roll_wrappers', 100], ['soy_sauce', 9], ['ginger', 4], ['starch', 4], ['water', 20], ['oil', 14]],
    steps: [
      'アスパラガスとにんじんを短い細切りにする。油の一部でしょうがと豚ひき肉を炒め、野菜、しょうゆを加えて肉に十分に火を通す。',
      '分量の水で溶いた片栗粉の一部を入れて具をまとめ、冷ます。春巻きの皮に少量ずつのせ、三角に折って端を残りの水溶き片栗粉で留める。',
      'フライパンに残りの油を広げ、三角の両面とかどを返しながらこんがり焼く。',
    ],
  }),
  occasionDish('childrens-day', {
    id: 'potato-scale-salad', name: 'こいのぼりのポテトサラダ', role: 'side', family: 'small-dish', genre: '洋食', category: 'vegetable', method: 'salad', minutes: 25,
    ingredients: [['potato', 210], ['cucumber', 45], ['carrot', 45], ['corn', 30], ['yogurt', 30], ['mayonnaise', 14], ['nori', 0.5], ['salt', 0.6]],
    steps: [
      'じゃがいもを柔らかくゆでてつぶす。にんじんを半月の薄切りにしてゆで、きゅうりも同じ形に切る。',
      'じゃがいもが冷めたらコーン、ヨーグルト、マヨネーズ、塩を混ぜる。皿の上で魚の形に整える。',
      'きゅうりとにんじんを交互に並べてうろこを作り、小さくちぎったのりで目を付ける。',
    ],
  }),
  occasionDish('childrens-day', {
    id: 'bamboo-wakame-egg', name: 'たけのことわかめのふわふわ卵椀', role: 'soup', family: 'soup', genre: '和食', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['bamboo_shoot_cooked', 75], ['wakame', 2], ['egg', 1], ['soup311_awase_dashi', 350], ['kyoto_usukuchi', 7], ['starch', 3], ['water', 10]],
    steps: [
      'ゆでたけのこの穂先はくし形、根元は薄切りにする。乾燥わかめは戻して水気を切る。',
      'だしにたけのこを入れて煮て、薄口しょうゆとわかめを加える。水溶き片栗粉を混ぜてひと煮立ちさせる。',
      '溶き卵を細く流し入れ、火が通ったら椀に盛り、たけのこの穂先を上に添える。',
    ],
  }),
  occasionDish('spring', {
    id: 'bamboo-chicken-saute', name: '鶏肉とたけのこの青じそ炒め', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'stir-fry', minutes: 25,
    ingredients: [['chicken', 220], ['bamboo_shoot_cooked', 130], ['shiso', 5], ['soy_sauce', 12], ['mirin', 13], ['oil', 6], ['sake', 10]],
    steps: [
      'ゆでたけのこは穂先を縦に、根元をいちょう切りにする。鶏肉は厚みをそろえて一口大に切る。',
      '油で鶏肉を皮目から焼き、返してたけのこを炒める。酒を加えてふたをし、鶏肉の中心まで火を通す。',
      'しょうゆとみりんを加えて照りを出す。火を止め、手でちぎった青じそを混ぜて香りを残す。',
    ],
  }),
  occasionDish('spring', {
    id: 'asparagus-cod-pan', name: 'たらとアスパラガスのレモンバター蒸し', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'steam', minutes: 20,
    ingredients: [['cod', 220], ['asparagus', 130], ['onion', 50], ['butter', 10], ['lemon', 12], ['water', 35], ['salt', 1.4]],
    steps: [
      'たらに塩を振って水分を拭く。アスパラガスの根元の筋をむいて斜め切り、玉ねぎを薄切りにする。',
      'フライパンに玉ねぎ、たら、アスパラガスの順に重ね、ちぎったバターと水を加えてふたをする。',
      'たらの中心まで蒸し焼きにし、ふたを取って汁を軽く煮詰める。レモン汁を加え、野菜と一緒にかける。',
    ],
  }),
  occasionDish('spring', {
    id: 'peas-potato-warm', name: '新じゃがとグリーンピースの温サラダ', role: 'side', family: 'small-dish', genre: '洋食', category: 'vegetable', method: 'salad', minutes: 25,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['potato', 200], ['green_pea', 65], ['onion', 40], ['vinegar', 9], ['olive_oil', 8], ['parsley', 2], ['salt', 1]],
    steps: [
      '新じゃがはよく洗い、一口大に切ってゆでる。柔らかくなる直前にグリーンピースを入れ、一緒に湯を切る。',
      '刻んだ玉ねぎをさっと湯に通し、酢、塩、オリーブ油と混ぜる。',
      '温かい野菜にソースをからめ、刻んだパセリを散らす。じゃがいもの角を少し崩すと味がなじむ。',
    ],
  }),
  occasionDish('spring', {
    id: 'pea-onion-potage', name: 'グリーンピースと新玉ねぎの豆乳ポタージュ', role: 'soup', family: 'potage', genre: '洋食', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['green_pea', 130], ['onion', 100], ['potato', 50], ['soy_milk', 150], ['water', 210], ['olive_oil', 5], ['salt', 1.5]],
    steps: [
      '新玉ねぎとじゃがいもを薄切りにする。鍋でオリーブ油を温め、玉ねぎを色付けずに炒める。',
      'じゃがいも、水を加えて煮る。柔らかくなり始めたらグリーンピースを入れ、つぶせるまで加熱する。',
      '火を止めて粗熱を取り、滑らかにつぶす。豆乳を注いで温め、塩で味を整える。',
    ],
  }),
  occasionDish('marine-day', {
    id: 'squid-scallop-skewers', name: 'いかとほたての磯の串焼き', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'grill', minutes: 25,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['squid', 110], ['scallop', 110], ['pepper', 75], ['soy_sauce', 10], ['mirin', 14], ['ginger', 5], ['oil', 5]],
    steps: [
      'いかは格子に切り目を入れて一口大、ピーマンは角切りにする。ほたては大きければ厚みを半分にする。',
      'いか、ほたて、ピーマンを交互に串に刺し、薄く油を引いたフライパンで各面を焼く。',
      'しょうがをすりおろしてしょうゆ、みりんと加える。たれを煮立てながらからめ、魚介の中心まで火を通す。',
    ],
  }),
  occasionDish('marine-day', {
    id: 'sardine-tomato-fry', name: 'いわしとトマトのバジル重ね焼き', role: 'main', family: 'fish-main', genre: '洋食', category: 'fish', method: 'grill', minutes: 30,
    ingredients: [['sardine', 220], ['tomato', 160], ['fresh_basil', 6], ['breadcrumbs', 15], ['garlic', 4], ['olive_oil', 9], ['salt', 1.2]],
    steps: [
      'いわしは開いて小骨と水分を取り、半分に切る。トマトは薄い輪切り、にんにくはみじん切りにする。',
      '耐熱皿にいわしとトマトを交互に重ね、間にバジルをちぎって挟む。塩、にんにく、パン粉、油をかける。',
      '200℃のオーブンでいわしの中心まで火を通し、パン粉がきつね色になったら汁ごと取り分ける。',
    ],
  }),
  occasionDish('marine-day', {
    id: 'seaweed-octopus', name: 'たこときゅうりののり酢あえ', role: 'side', family: 'small-dish', genre: '和食', category: 'fish', method: 'dressed', minutes: 15,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['octopus', 100], ['cucumber', 100], ['nori', 2], ['vinegar', 13], ['soy_sauce', 6], ['ginger', 4], ['sugar', 3]],
    steps: [
      'ゆでだこを薄くそぎ切りにし、きゅうりは縦半分にして斜め薄切りにする。しょうがを細いせん切りにする。',
      '酢、しょうゆ、砂糖を混ぜ、ゆでだこときゅうり、しょうがを加えてなじませる。',
      'のりを手で細くちぎり、食べる直前に半分を混ぜる。残りを上に散らして香りを残す。',
    ],
  }),
  occasionDish('marine-day', {
    id: 'clam-tomato-basil', name: 'あさりとトマトのバジルスープ', role: 'soup', family: 'soup', genre: '洋食', minutes: 20,
    ingredients: [['clam', 75], ['tomato', 130], ['onion', 55], ['garlic', 3], ['fresh_basil', 4], ['olive_oil', 5], ['water', 350], ['salt', 1.5]],
    steps: [
      'トマトはざく切り、玉ねぎとにんにくはみじん切りにする。あさりはむき身の分量を用意する。',
      '鍋でにんにくとオリーブ油を温め、玉ねぎ、トマトを炒める。水を注ぎ、トマトの形が少し崩れるまで煮る。',
      'あさりを加えて中心までよく煮る。塩で味を整え、ちぎったバジルを散らす。',
    ],
  }),
  occasionDish('mountain-day', {
    id: 'chicken-woodland-pan', name: '鶏肉とまいたけの山小屋バター焼き', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'grill', minutes: 35,
    ingredients: [['chicken', 210], ['simmered_maitake', 110], ['potato', 140], ['onion', 55], ['butter', 9], ['soy_sauce', 10], ['sake', 12], ['water', 30]],
    steps: [
      'まいたけをほぐし、玉ねぎは薄切りにする。じゃがいもを薄く輪切りにし、串が通るまでゆでる。鶏肉の厚みをそろえ、フライパンに皮目を下にして焼く。',
      '焼き色が付いたら返し、まいたけ、酒、水を加え、ふたをして鶏肉の中心まで火を通す。鶏肉とまいたけを取り出す。',
      '残った汁にバター、玉ねぎ、じゃがいもを加えて焼き、しょうゆを回しかける。鶏肉とまいたけを戻して汁をからめる。',
    ],
  }),
  occasionDish('mountain-day', {
    id: 'yam-mushroom-egg', name: '長いもと三種きのこの山かけ卵焼き', role: 'main', family: 'egg-main', genre: '和食', category: 'egg', method: 'grill', minutes: 25,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['yam', 120], ['egg', 3], ['shimeji', 55], ['enoki', 40], ['shiitake', 35], ['soy_sauce', 9], ['oil', 6]],
    steps: [
      'しめじとえのきをほぐして短く切り、しいたけを薄切りにする。長いもは皮をむいてすりおろす。',
      '油の半量できのこを炒め、水分を十分に飛ばす。溶き卵に長いも、しょうゆを混ぜてきのこを加える。',
      '残りの油を熱し、生地を薄く丸く分けて流す。弱火で両面を焼き、中心の卵までしっかり固める。',
    ],
  }),
  occasionDish('mountain-day', {
    id: 'mountain-roots-roast', name: 'ごぼうとさつまいもの山道ロースト', role: 'side', family: 'small-dish', genre: '洋食', category: 'vegetable', method: 'grill', minutes: 30,
    ingredients: [['burdock', 95], ['sweet_potato', 150], ['olive_oil', 9], ['soy_sauce', 7], ['mirin', 8], ['sesame', 3]],
    steps: [
      'ごぼうを細い拍子木、さつまいもを皮付きのひと口大に切る。水にさっとさらし、水気を拭く。',
      '野菜にオリーブ油をまぶし、重ならないよう天板に広げる。200℃で途中一度返し、火が通るまで焼く。',
      'しょうゆとみりんを小鍋で煮立て、焼いた根菜にからめる。仕上げにごまを振る。',
    ],
  }),
  occasionDish('mountain-day', {
    id: 'mountain-mushroom-soup', name: '三種きのこと里いもの山里みそ汁', role: 'soup', family: 'miso-soup', genre: '和食', minutes: 25,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['taro', 120], ['simmered_maitake', 55], ['nameko', 45], ['shiitake', 35], ['soup311_awase_dashi', 355], ['miso', 18]],
    steps: [
      '里いもの皮をむいて小さめに切る。まいたけをほぐし、しいたけを薄切りにし、なめこをさっと洗う。',
      'だしで里いもを煮て、柔らかくなりかけたらまいたけとしいたけを入れる。',
      'なめこを加えてよく煮る。火を弱めてみそを溶き、里いもときのこを均等によそう。',
    ],
  }),
  occasionDish('obon', {
    id: 'tofu-lotus-steak', name: '豆腐とれんこんの精進つくね', role: 'main', family: 'bean-main', genre: '和食', category: 'bean', method: 'grill', minutes: 30,
    ingredients: [['tofu', 240], ['lotus_root', 130], ['dried_shiitake', 6], ['starch', 14], ['ginger', 4], ['soy_sauce', 12], ['mirin', 12], ['oil', 7], ['water', 70]],
    steps: [
      '干ししいたけを分量の水で戻し、軸を取って細かく刻む。れんこんの半分をおろし、残りは粗く刻む。',
      '水切りした豆腐、れんこん、しいたけ、おろししょうが、片栗粉を練り、平たい丸形にして油で両面を焼く。',
      'しいたけの戻し汁をこして加え、ふたをして中まで蒸す。しょうゆとみりんを加え、たれを煮詰める。',
    ],
  }),
  occasionDish('obon', {
    id: 'aubergine-pepper-miso', name: 'なすと高野豆腐の精進みそ炒め', role: 'main', family: 'bean-main', genre: '和食', category: 'bean', method: 'stir-fry', minutes: 25,
    ingredients: [['aubergine', 170], ['tofu_dried', 38], ['pepper', 70], ['miso', 15], ['mirin', 15], ['ginger', 5], ['oil', 8], ['water', 50]],
    steps: [
      '高野豆腐は表示に従って戻し、軽く絞って拍子木切りにする。なすとピーマンも長さをそろえる。',
      '油でなすを焼き、高野豆腐とピーマンを加えて炒める。水を加え、ふたをして高野豆腐に水分を含ませる。',
      'みそ、みりん、おろししょうがを混ぜて加え、強めの火で炒め合わせる。',
    ],
  }),
  occasionDish('obon', {
    id: 'winter-melon-ginger', name: '冬瓜の冷やししょうがあん', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'simmer', minutes: 35,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['winter_melon', 260], ['kyoto_kombu_dashi', 210], ['kyoto_usukuchi', 9], ['mirin', 8], ['ginger', 6], ['starch', 4], ['water', 12]],
    steps: [
      '冬瓜はわたと種を除き、皮をむいて一口大にする。角を軽く落とし、昆布だしとともに鍋に入れる。',
      '薄口しょうゆとみりんを加え、落としぶたをして冬瓜が透き通るまで煮る。',
      '水溶き片栗粉でとろみを付け、しょうがをすりおろして加える。粗熱を取り、冷蔵庫で冷やして汁ごと盛る。',
    ],
  }),
  occasionDish('obon', {
    id: 'pumpkin-soymilk-miso', name: 'かぼちゃと油揚げの豆乳みそ汁', role: 'soup', family: 'miso-soup', genre: '和食', minutes: 25,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['pumpkin', 130], ['aburaage', 25], ['onion', 45], ['kyoto_kombu_dashi', 240], ['soy_milk', 130], ['miso', 16]],
    steps: [
      'かぼちゃの種とわたを取り、薄いいちょう切りにする。油揚げを短冊、玉ねぎを薄切りにする。',
      '昆布だしで玉ねぎとかぼちゃを柔らかく煮て、油揚げを加えて温める。',
      '豆乳を注いで弱火にし、みそをだしで溶き入れる。煮立てずに汁を温めて椀に分ける。',
    ],
  }),
  occasionDish('summer', {
    id: 'pork-plum-okra', name: '豚肉とオクラの梅おろし蒸し', role: 'main', family: 'meat-main', genre: '和食', category: 'meat', method: 'steam', minutes: 20,
    ingredients: [['pork_loin', 210], ['okra', 100], ['daikon', 150], ['ume', 13], ['sake', 15], ['soy_sauce', 8], ['water', 35]],
    steps: [
      '大根をおろして軽く汁を切り、種を取ってたたいた梅肉としょうゆを混ぜる。オクラはがくを薄く削る。',
      'フライパンに豚薄切り肉とオクラを広げ、酒と水を加えてふたをする。肉が重ならないように返して中心まで火を通す。',
      '豚肉を皿に広げ、斜めに切ったオクラをのせる。梅おろしを中央に盛り、蒸し汁を少し回しかける。',
    ],
  }),
  occasionDish('summer', {
    id: 'mackerel-pickled-tomato', name: 'あじのトマト南蛮漬け', role: 'main', family: 'fish-main', genre: '和食', category: 'fish', method: 'pickled', minutes: 30,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['horse_mackerel', 210], ['tomato', 140], ['onion', 65], ['starch', 12], ['oil', 12], ['vinegar', 20], ['soy_sauce', 11], ['sugar', 5], ['water', 35]],
    steps: [
      'トマトは角切り、玉ねぎは薄切りにする。酢、しょうゆ、砂糖、水をひと煮立ちさせ、野菜を加える。',
      '三枚におろしたあじから小骨を抜き、食べやすく切って片栗粉をまぶす。油を熱し、両面から中心まで焼く。',
      '熱いうちに野菜入りの漬け汁に移し、返しながら味をなじませる。野菜を上に盛り、漬け汁をかける。',
    ],
  }),
  occasionDish('summer', {
    id: 'bittermelon-corn-salad', name: 'ゴーヤーとコーンのツナあえ', role: 'side', family: 'small-dish', genre: '和食', category: 'vegetable', method: 'dressed', minutes: 15,
    mealOccasions: ['昼食', '夕食', '晩酌'],
    ingredients: [['bitter_melon', 100], ['corn', 70], ['tuna_canned', 45], ['vinegar', 10], ['soy_sauce', 6], ['ground_sesame', 4]],
    steps: [
      'ゴーヤーを縦半分に切って種とわたを除き、ごく薄く切る。短くゆでて冷水に取り、水気を絞る。',
      'コーンをゆでて湯を切り、缶のツナをほぐす。ボウルに酢、しょうゆ、すりごまを合わせる。',
      'ゴーヤー、コーン、ツナを加えてあえ、少し置いて味をなじませてから盛る。',
    ],
  }),
  occasionDish('summer', {
    id: 'chilled-zucchini-soup', name: 'ズッキーニと枝豆の冷製スープ', role: 'soup', family: 'potage', genre: '洋食', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'],
    ingredients: [['zucchini', 160], ['edamame', 70], ['onion', 55], ['milk', 140], ['water', 170], ['olive_oil', 5], ['salt', 1.5]],
    steps: [
      '枝豆はゆでてさやと薄皮を除く。ズッキーニと玉ねぎを薄切りにし、油で焦がさないよう炒める。',
      '枝豆と水を加え、ズッキーニが柔らかくなるまで煮る。火を止めて粗熱を取り、滑らかにつぶす。',
      '牛乳と塩を混ぜて一度温め、鍋底を冷水に当てて粗熱を取る。冷蔵庫で冷やし、器に注ぐ。',
    ],
  }),
];
