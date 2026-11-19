import {occasionDish} from './occasion-recipe.js';

// ムール貝は身の重量、あさりは殻付き重量。単位はいずれも食材台帳に従う。
// 貝の加熱: https://www.maff.go.jp/j/syouan/seisaku/foodpoisoning/f_encyclopedia/norovirus.html
// ミディエ・ドルマの配合はトルコ文化ポータルの米・玉ねぎ・松の実を参考にした家庭向け。
// https://kulturportali.gov.tr/turkiye/canakkale/neyenir/midye-dolma
function worldDish(country, tags, recipe) {
  return occasionDish(tags, {
    genre: '洋食', ...recipe,
    aliases: ['世界の料理', country, `${country}料理`, ...recipe.aliases],
  });
}

export const WORLD_OCCASION_RECIPES = [
  worldDish('フランス', ['anniversary', 'christmas', 'marine-day'], {
    id: 'provencal-bouillabaisse', name: 'たらとあさりの家庭風ブイヤベース',
    role: 'main', family: 'fish-main', category: 'fish', method: 'stew', minutes: 35,
    mealOccasions: ['昼食', '夕食'], aliases: ['マルセイユ', '南仏', '魚介のスープ', 'おもてなし'],
    ingredients: [['cod', 200], ['clam', 200], ['shrimp', 70], ['onion', 70], ['celery', 40], ['garlic', 5], ['canned_tomato', 150], ['perf_wine_white', 50], ['water', 280], ['olive_oil', 10], ['parsley', 2], ['salt', 0.7]],
    steps: [
      '砂抜き済みのあさりは殻をこすり洗いする。たらは骨を除いて大きめに切り、えびは背わたを除く。',
      'オリーブ油でみじん切りの玉ねぎ、セロリ、にんにくをしんなりするまで炒める。トマトをつぶしながら加え、水気が半分になるまで煮詰める。',
      '白ワインと水を注いで煮立てる。たらとあさりを並べ、ふたをして弱めの中火で加熱する。殻が開いたらえびも加える。',
      'あさりの身の中心を85～90℃で90秒以上加熱し、開かない貝は除く。たらに火が通り、えび全体が白くなったら塩で味を調え、刻みパセリを散らす。',
    ],
  }),
  worldDish('トルコ', ['summer', 'marine-day', 'anniversary'], {
    id: 'midye-dolma', name: 'ミディエ・ドルマ（ムール貝のピラフ詰め）',
    role: 'side', family: 'small-dish', genre: 'エスニック', category: 'fish', method: 'steam', minutes: 35,
    mealOccasions: ['昼食', '夕食', '晩酌'], aliases: ['ミディエドルマ', 'ミディエ・ドルマス', 'イスタンブール', 'ムール貝の米詰め', 'おもてなし'],
    ingredients: [['bistro_mussel_raw', 120], ['rice', 70], ['onion', 35], ['pine_nuts', 5], ['raisin', 6], ['black_pepper', 0.3], ['olive_oil', 5], ['lemon_slice', 20], ['water', 90]],
    steps: [
      '大粒の殻付きムール貝を用意する（殻付きの目安は材料欄の身の重量の約2.5倍）。殻をこすり洗いして足糸を抜き、殻が割れたものや触れても口を閉じないものは除く。',
      'フライパンにオリーブ油を熱し、みじん切りの玉ねぎと松の実を炒める。温かいご飯、刻んだレーズン、黒こしょうを混ぜて火を止める。',
      '別の鍋に貝と分量の水の半分を入れ、ふたをして蒸す。殻が開いたものを取り出す。開かない貝は使わない。殻をつないだまま、身の横にご飯を少しずつ詰める。',
      '貝を鍋に戻し、入りきらなかったご飯は小さな耐熱皿に入れて並べる。残りの水を足し、ふたをして蒸す。身と詰め物の中心を85～90℃で90秒以上加熱してレモンをしぼる。',
    ],
  }),
  worldDish('フランス', ['anniversary', 'valentine', 'birthday'], {
    id: 'salmon-tartare-avocado', name: 'サーモンのタルタル アボカドとレモン',
    role: 'side', family: 'small-dish', category: 'fish', method: 'cold', minutes: 15,
    mealOccasions: ['昼食', '夕食', '晩酌'], aliases: ['タルタル・ド・ソーモン', 'サーモンタルタル', '前菜', 'おもてなし'],
    ingredients: [['salmon_sashimi', 140], ['avocado', 85], ['onion', 15], ['lemon', 10], ['olive_oil', 5], ['salt', 0.6], ['black_pepper', 0.1]],
    steps: [
      '玉ねぎはみじん切りにし、冷水にさらして水気をよく絞る。皿とボウルは冷やしておく。',
      'アボカドを8mm角に切り、レモン汁の半量であえる。フォークで半分だけつぶし、冷やした皿に丸く広げる。',
      '冷蔵庫から生食用サーモンを出し、清潔な包丁で8mm角に切る。玉ねぎ、残りのレモン汁、オリーブ油、塩、黒こしょうと軽くあえる。',
      'アボカドの上にサーモンを重ね、スプーンの背で形を整える。食べる直前まで冷やし、作ったらすぐにいただく。',
    ],
  }),
  worldDish('フランス', ['anniversary', 'christmas', 'autumn'], {
    id: 'salmon-tartare-apple', name: 'サーモンのタルタル りんごときゅうり',
    role: 'side', family: 'small-dish', category: 'fish', method: 'cold', minutes: 15,
    mealOccasions: ['昼食', '夕食', '晩酌'], aliases: ['サーモンタルタル', '前菜', 'おもてなし'],
    ingredients: [['salmon_sashimi', 140], ['apple', 45], ['cucumber', 40], ['lemon', 8], ['olive_oil', 5], ['parsley', 2], ['salt', 0.6]],
    steps: [
      'きゅうりは縦に割って種をスプーンで取り、5mm角に切る。りんごは芯を除いて同じ大きさに切り、レモン汁をからめる。',
      'パセリの葉は水気をよく拭いて細かく刻み、きゅうりと一緒に冷やしておく。',
      '冷蔵庫から生食用サーモンを取り出し、清潔な包丁で1cm角に切る。冷たいボウルに入れ、塩とオリーブ油をからめる。',
      '水気を切ったきゅうりと、りんご、パセリをさっと合わせる。冷やした小鉢に盛り、すぐにいただく。',
    ],
  }),
  worldDish('ブラジル', ['summer', 'marine-day'], {
    id: 'moqueca', name: '白身魚のモケカ（ココナッツ煮）',
    role: 'main', family: 'fish-main', genre: 'エスニック', category: 'fish', method: 'stew', minutes: 30,
    mealOccasions: ['昼食', '夕食'], aliases: ['ムケッカ', 'ムケカ', 'バイーア', '魚のココナッツミルク煮'],
    ingredients: [['cod', 230], ['paprika', 90], ['onion', 80], ['tomato', 180], ['coconut_milk', 160], ['garlic', 4], ['world_lime_juice', 10], ['paprika_powder', 1], ['olive_oil', 6], ['salt', 1.4]],
    steps: [
      'たらは骨を除いて大きめに切り、塩の半量とライム果汁の半量を振る。玉ねぎとトマトは薄い輪切り、パプリカは細切りにする。',
      '鍋にオリーブ油と刻んだにんにくを入れて弱火で温める。玉ねぎを底に敷いてトマト、たら、パプリカの順に重ねる。',
      'ココナッツミルクにパプリカ粉と残りの塩を混ぜて回しかける。ふたをして中弱火で12分ほど煮る。',
      'たらの厚い部分まで火が通ったら、鍋を揺すって煮汁をなじませる。器に取り分け、残りのライム果汁をかける。',
    ],
  }),
  worldDish('フランス', ['winter', 'anniversary', 'white-day'], {
    id: 'mushroom-fricassee', name: '鶏肉ときのこのフリカッセ',
    role: 'main', family: 'meat-main', category: 'meat', method: 'stew', minutes: 35,
    mealOccasions: ['昼食', '夕食'], aliases: ['鶏の白い煮込み', 'おもてなし'],
    ingredients: [['chicken', 240], ['mushroom', 100], ['onion', 70], ['butter', 12], ['flour', 12], ['milk', 180], ['perf_wine_white', 35], ['water', 65], ['salt', 1.5], ['parsley', 2]],
    steps: [
      '鶏肉を一口大に切り、塩を振る。マッシュルームは四つ割り、玉ねぎは繊維に沿って薄切りにする。',
      '鍋にバターを溶かし、鶏肉の表面が白くなるまで焼く。玉ねぎとマッシュルームを加え、焼き色をつけずに炒める。',
      '薄力粉を振って炒め、粉がなじんだら白ワインを加えてひと煮立ちさせる。水と牛乳を少しずつ混ぜながら注ぐ。',
      '弱火で底を混ぜながらとろみが出るまで煮る。鶏肉の中心を75℃で1分以上加熱し、仕上げに刻んだパセリを振る。',
    ],
  }),
  worldDish('ハンガリー', ['winter', 'autumn'], {
    id: 'chicken-paprikas', name: 'チキン・パプリカシュ（鶏のパプリカ煮）',
    role: 'main', family: 'meat-main', category: 'meat', method: 'stew', minutes: 35,
    mealOccasions: ['昼食', '夕食'], aliases: ['パプリカーシュ', 'パプリカチキン'],
    ingredients: [['chicken', 230], ['onion', 100], ['paprika', 80], ['tomato', 90], ['paprika_powder', 5], ['yogurt', 65], ['flour', 5], ['water', 120], ['oil', 7], ['salt', 1.5]],
    steps: [
      '玉ねぎをみじん切りにし、油でじっくり炒める。トマトとパプリカは角切り、鶏肉は一口大にする。',
      '鍋を火から外してパプリカ粉を混ぜ、水を注いで火に戻す。鶏肉、トマト、パプリカ、塩を加える。',
      'ふたをして20分を目安に煮る。鶏肉の中心を75℃で1分以上加熱し、ふたを取って煮汁を少し詰める。',
      'ヨーグルトに薄力粉をよく混ぜ、熱い煮汁を少しずつ足してのばす。鍋に戻し、混ぜながら弱火でとろみが出るまで2～3分煮る。',
    ],
  }),
  worldDish('トルコ', ['summer'], {
    id: 'menemen', name: 'メネメン（トマトとピーマンの卵とじ）',
    role: 'main', family: 'egg-main', genre: 'エスニック', category: 'egg', method: 'stir-fry', minutes: 15,
    mealOccasions: ['朝食', '昼食'], aliases: ['トルコの朝ごはん', 'ブランチ'],
    ingredients: [['egg', 3], ['tomato', 220], ['pepper', 55], ['olive_oil', 8], ['paprika_powder', 0.8], ['salt', 1.2]],
    steps: [
      'ピーマンは種を除いて細切りにし、トマトはへたを落として小さな角切りにする。卵はボウルに割り入れ、軽く溶く。',
      'フライパンにオリーブ油を熱してピーマンを炒め、しんなりしたらトマトと塩を加える。',
      '木べらでトマトをつぶし、汁が煮詰まって底に筋が残るまで中火で煮る。パプリカ粉を振る。',
      '溶き卵を回し入れ、弱火で底からゆっくり返す。卵が全体に固まったらすぐ器に盛る。',
    ],
  }),
  worldDish('スペイン', ['winter', 'autumn'], {
    id: 'sopa-de-ajo', name: 'ソパ・デ・アホ（にんにくとパンのスープ）',
    role: 'soup', family: 'soup', minutes: 20,
    mealOccasions: ['朝食', '昼食', '夕食'], aliases: ['カスティーリャ', 'ブランチ'],
    ingredients: [['garlic', 8], ['wholegrain_bread', 60], ['egg', 2], ['paprika_powder', 2], ['olive_oil', 8], ['water', 420], ['salt', 1.5]],
    steps: [
      'パンは2cm角に切って軽くトーストする。にんにくは芯を除き、薄切りにする。',
      '鍋にオリーブ油とにんにくを入れ、弱火できつね色にする。火を止め、パプリカ粉を混ぜてすぐに水を注ぐ。',
      '鍋を火に戻し、塩とパンを加えて5分煮る。パンが汁を含んだら、スプーンで人数分のくぼみを作る。',
      'くぼみごとに卵を割り入れ、ふたをして弱火で卵黄と卵白が固まるまで煮る。卵を崩さず汁ごとすくう。',
    ],
  }),
  worldDish('ポルトガル', ['winter', 'autumn'], {
    id: 'caldo-verde', name: 'キャベツのカルド・ヴェルデ風スープ',
    role: 'soup', family: 'vegetable-soup', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'], aliases: ['じゃがいものスープ', 'カルドベルデ'],
    ingredients: [['potato', 190], ['cabbage', 75], ['onion', 50], ['garlic', 3], ['palette_wiener', 45], ['olive_oil', 6], ['water', 420], ['salt', 0.8]],
    steps: [
      'じゃがいもと玉ねぎを薄切りにする。キャベツは硬い芯を薄くそぎ、葉を重ねてごく細く切る。',
      '鍋にオリーブ油の半量と刻んだにんにくを入れて温める。玉ねぎ、じゃがいもを炒め、水を注いでふたをする。',
      'じゃがいもが崩れるまで約15分煮る。鍋の中でマッシャーでつぶし、輪切りにしたウインナーを加える。',
      'キャベツを入れて3～4分、しんなりするまで煮る。塩で味を整え、残りのオリーブ油を回しかける。',
    ],
  }),
  worldDish('モロッコ', ['spring', 'summer'], {
    id: 'moroccan-carrot-orange', name: 'にんじんとオレンジのモロッコ風サラダ',
    role: 'side', family: 'side', genre: 'エスニック', category: 'vegetable', method: 'salad', minutes: 15,
    mealOccasions: ['昼食', '夕食'], aliases: ['キャロットラペ', 'クミン風味', '持ち寄り'],
    ingredients: [['carrot', 150], ['orange', 110], ['lemon', 8], ['olive_oil', 6], ['cumin', 0.5], ['parsley', 2], ['salt', 0.7]],
    steps: [
      'にんじんを粗くすりおろすか短い細切りにする。塩をまぶして5分置き、水気を軽く絞る。',
      'オレンジは皮と薄皮を除き、果肉を一口大に切る。切るときに出た果汁はボウルに取っておく。',
      'ボウルにレモン汁、クミン、オリーブ油を加えてよく混ぜ、にんじんをあえる。',
      'オレンジの果肉と刻んだパセリを最後に合わせる。果肉が崩れないようにざっと混ぜて盛る。',
    ],
  }),
  worldDish('フランス', ['summer', 'anniversary'], {
    id: 'provencal-tian', name: '夏野菜のティアン（南仏の重ね焼き）',
    role: 'side', family: 'side', category: 'vegetable', method: 'grill', minutes: 45,
    mealOccasions: ['昼食', '夕食'], aliases: ['プロヴァンス', 'おもてなし', 'ティヤン'],
    ingredients: [['zucchini', 120], ['aubergine', 100], ['tomato', 180], ['onion', 60], ['garlic', 4], ['dried_basil', 0.5], ['olive_oil', 14], ['salt', 1.1]],
    steps: [
      'オーブンを200℃に予熱する。玉ねぎは薄切りにし、オリーブ油の3分の1でしんなりするまで炒めて浅い耐熱皿に敷く。',
      'ズッキーニ、なす、トマトは厚さ4mmの輪切りにする。大きなトマトは半月にし、野菜の高さをそろえる。',
      '野菜を色違いに並べて少しずつ重ねる。刻んだにんにく、塩、バジル、残りのオリーブ油を上から振る。',
      'アルミホイルをかけて20分焼き、外してさらに10～15分焼く。なすの中心にすっと串が入り、縁が色づいたら取り出す。',
    ],
  }),
  worldDish('イタリア', ['anniversary', 'autumn', 'christmas'], {
    id: 'risotto-funghi', name: 'きのこのリゾット・アイ・フンギ',
    role: 'staple', family: 'rice', staple: true, minutes: 35,
    mealOccasions: ['昼食', '夕食'], aliases: ['リゾット・アイ・フンギ', 'パルメザン', 'おもてなし'],
    ingredients: [['uncooked_rice', 140], ['mushroom', 100], ['shiitake', 60], ['onion', 45], ['perf_wine_white', 30], ['water', 530], ['parmesan_cheese', 18], ['butter', 12], ['olive_oil', 5], ['salt', 1.2]],
    steps: [
      'マッシュルームとしいたけを薄切りにし、オリーブ油できつね色になるまで炒めて取り出す。別の鍋で分量の水を沸かし、塩を溶かす。',
      '空いた鍋にバターの半量を入れ、刻んだ玉ねぎを炒める。生米を加えて油をなじませ、白ワインを注いで水分を飛ばす。',
      '熱い塩湯をお玉1杯ずつ足し、軽く煮立つ火加減で18～20分煮る。米が汁を吸ったら次のひとすくいを加え、途中できのこを戻す。',
      '米の芯にわずかに歯ごたえが残るところで火を止める。残りのバターと粉チーズを手早く混ぜ、ゆるく流れる状態で盛り付ける。',
    ],
  }),
  worldDish('スイス', ['spring', 'summer'], {
    id: 'bircher-muesli', name: 'りんごのビルヒャー・ミューズリー',
    role: 'staple', family: 'oatmeal', staple: true, minutes: 40,
    mealOccasions: ['朝食', '間食'], aliases: ['ミューズリ', 'オーバーナイトオーツ', 'ブランチ'],
    ingredients: [['oatmeal', 65], ['milk', 100], ['yogurt', 100], ['apple', 130], ['raisin', 12], ['lemon', 6], ['almond', 8]],
    steps: [
      'そのまま食べられる表示のオートミールを使う。ボウルに牛乳、ヨーグルト、レーズンを合わせ、オートミールを混ぜる。',
      'ラップをかけて冷蔵庫で30分以上置く。前夜に仕込めば朝は混ぜるだけでよい。',
      '食べる直前にりんごをよく洗って芯を除き、皮ごと粗くすりおろす。レモン汁を合わせ、オートミールに混ぜる。',
      'アーモンドを粗く刻む。ミューズリーを器に入れ、食感が残るようにアーモンドを最後に散らす。',
    ],
  }),
  worldDish('スイス', ['winter', 'autumn'], {
    id: 'swiss-roesti', name: 'じゃがいものロスティ',
    role: 'side', family: 'side', category: 'vegetable', method: 'grill', minutes: 30,
    mealOccasions: ['朝食', '昼食', '夕食'], aliases: ['レシュティ', 'ロシュティ', 'ブランチ', '付け合わせ'],
    ingredients: [['potato', 290], ['butter', 12], ['olive_oil', 5], ['salt', 1.1], ['black_pepper', 0.2]],
    steps: [
      'じゃがいもは皮をむいて粗いせん切りにする。水にはさらさず、布巾で水分をしっかり絞る。',
      '焼く直前に塩と黒こしょうを混ぜる。直径20cmほどのフライパンにオリーブ油とバターの半量を温め、じゃがいもを薄く広げる。',
      'へらで軽く押さえ、ふたをして弱めの中火で8分ほど焼く。底がきつね色になり全体がまとまったら皿を使って裏返す。',
      '縁から残りのバターを入れ、ふたをせずに裏面も7～8分焼く。中心まで柔らかく両面が香ばしくなったら切り分ける。',
    ],
  }),
  worldDish('トルコ', ['summer', 'autumn'], {
    id: 'biber-dolma', name: 'ビベル・ドルマ（パプリカのピラフ詰め）',
    role: 'side', family: 'side', genre: 'エスニック', category: 'vegetable', method: 'steam', minutes: 35,
    mealOccasions: ['昼食', '夕食'], aliases: ['ビベルドルマス', 'ビベル・ドルマス', '詰め物', '持ち寄り'],
    ingredients: [['paprika', 260], ['rice', 130], ['onion', 50], ['tomato', 90], ['raisin', 10], ['pine_nuts', 6], ['olive_oil', 8], ['lemon', 6], ['parsley', 2], ['salt', 0.8], ['water', 90]],
    steps: [
      '小さめのパプリカを人数分用意し、上部を切ってふた用に取り分ける。種と白い筋を取り、底を破らないようにする。',
      'みじん切りの玉ねぎと松の実をオリーブ油で炒める。角切りのトマト、温かいご飯、レーズン、塩を混ぜて火を止める。',
      'ご飯をパプリカに詰めてふたをのせ、小鍋に立てる。残ったご飯があれば小さな耐熱皿に入れて一緒に置く。',
      '鍋の底に水を注いでふたをし、弱火で15～20分蒸す。果肉が柔らかくなったら刻んだパセリを振り、レモン汁をかける。',
    ],
  }),
  worldDish('ギリシャ', ['summer', 'spring'], {
    id: 'tzatziki', name: 'ザジキ（きゅうりのヨーグルトディップ）',
    role: 'side', family: 'small-dish', category: 'vegetable', method: 'dressed', minutes: 35,
    mealOccasions: ['昼食', '夕食', '晩酌'], aliases: ['ツァツィキ', 'ザジーキ', '前菜', '持ち寄り'],
    ingredients: [['yogurt', 160], ['cucumber', 100], ['garlic', 1.5], ['olive_oil', 6], ['lemon', 4], ['salt', 0.7], ['black_pepper', 0.1]],
    steps: [
      'ざるにキッチンペーパーを敷き、ヨーグルトをのせて冷蔵庫で30分水切りする。受け皿はざるの底が水分につかない深さにする。',
      'きゅうりは粗くすりおろし、塩の半量を振って5分置く。清潔な布巾に包み、出た水分をしっかり絞る。',
      'にんにくをすりおろす。水切りヨーグルトにきゅうり、にんにく、残りの塩、レモン汁を加え、スプーンであえる。',
      '冷たい器に盛り、表面にくぼみを作る。オリーブ油と黒こしょうをかけて前菜として添える。',
    ],
  }),
  worldDish('ポルトガル', ['winter', 'christmas'], {
    id: 'arroz-doce', name: 'レモン香るアロス・ドース（ライスプディング）',
    role: 'snack', family: 'sweets', minutes: 35, portion: {amount: 1, unit: '杯'},
    mealOccasions: ['間食'], aliases: ['アロース・ドセ', 'ミルクライス', 'デザート'],
    ingredients: [['uncooked_rice', 45], ['milk', 250], ['water', 100], ['sugar', 22], ['lemon_slice', 2], ['salt', 0.2]],
    steps: [
      'よく洗ったレモンの皮をごく薄くそぎ、細いせん切りにする。小鍋に米と水、塩を入れ、沸いたら弱火で10分煮る。',
      '牛乳とレモンの皮を加え、ふつふつとした火加減で15分ほど煮る。焦げつかないよう、底をへらでときどき混ぜる。',
      '米が柔らかくなったら砂糖を混ぜる。へらですくうとゆっくり落ちる濃さで火を止め、温かいうちに小さな器に分ける。',
    ],
  }),
  worldDish('フランス', ['anniversary', 'valentine', 'white-day'], {
    id: 'pear-belle-helene', name: '洋梨のベル・エレーヌ（温かいチョコソース）',
    role: 'snack', family: 'ice-dessert', minutes: 45, portion: {amount: 1, unit: '皿'},
    mealOccasions: ['間食'], aliases: ['ポワール・ベル・エレーヌ', 'デザート', 'おもてなし'],
    ingredients: [['fruit_european_pear', 220], ['water', 220], ['sugar', 18], ['lemon', 5], ['cocoa_powder', 7], ['milk', 35], ['vanilla_ice_cream', 70]],
    steps: [
      '洋梨を縦半分にし、皮をむいて芯を丸くくり抜く。小鍋に水、レモン汁、砂糖の半量を合わせる。',
      '洋梨を加え、落としぶたをして弱火で12～15分煮る。串が通ったら煮汁から上げ、冷えた皿に並べて粗熱を取る。',
      '別の小鍋にココアと残りの砂糖を混ぜ、牛乳を少しずつ加えてなめらかにのばす。弱火でつやが出るまで1～2分煮る。',
      '洋梨のくぼみにバニラアイスをのせる。食卓に出す直前に温かいチョコソースをかける。',
    ],
  }),
];
