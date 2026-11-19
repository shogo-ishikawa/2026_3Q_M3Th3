import {occasionDish} from './occasion-recipe.js';

// 数量は2人分。単位・アレルゲン・栄養成分は共通の食材台帳に従う。
export const AUTUMN_WINTER_RECIPES = [
  occasionDish(['harvest-moon', 'autumn'], {
    id: 'moon-taro-chicken', name: '鶏と里いもの月見照り煮', role: 'main', family: 'meat-main',
    category: 'meat', method: 'simmer', genre: '和食', minutes: 35,
    ingredients: [['chicken', 220], ['taro', 220], ['ginger', 6], ['soup311_awase_dashi', 180], ['soy_sauce', 15], ['mirin', 18], ['sugar', 5]],
    steps: [
      '里いもは皮をむき、大きいものは半分に切って下ゆでする。ぬめりをさっと洗う。',
      '鶏もも肉をひと口大に切り、皮目を下にして鍋で焼く。脂が出たら薄切りしょうがと里いもを加える。',
      'だし、しょうゆ、みりん、砂糖を注ぐ。落としぶたをして15分ほど、里いもに串がすっと入るまで煮る。',
      '鶏の中心まで火が通ったらふたを外し、鍋を揺すりながら煮汁を絡める。丸い里いもを手前に盛る。',
    ],
  }),
  occasionDish(['harvest-moon', 'autumn'], {
    id: 'moon-sardine-lotus', name: 'いわしのすり身とれんこんの月形焼き', role: 'main', family: 'fish-main',
    category: 'fish', method: 'grill', genre: '和食', minutes: 30,
    ingredients: [['sardine', 200], ['lotus_root', 100], ['ginger', 5], ['miso', 9], ['starch', 8], ['oil', 8], ['sake', 12], ['water', 20]],
    steps: [
      'れんこんは皮をむいてすり身を上下からはさめるように薄い輪切りを対にして取り、残りを細かく刻む。いわしは皮と小骨を取り、包丁で粘りが出るまでたたく。',
      'すり身に刻んだれんこん、おろししょうが、みそ、片栗粉の半量を練り込み、輪切りの組数に合わせて小判形に分ける。',
      '輪切りの片面に残りの片栗粉を薄く振る。粉の面を内側にしてすり身を輪切りではさみ、平らに整える。',
      '油で両面を焼き付け、酒と水を加えてふたをし、中まで火を通す。ふたを外しれんこんの面を香ばしく焼く。',
    ],
  }),
  occasionDish(['harvest-moon', 'autumn', 'child-friendly'], {
    id: 'moon-sweet-potato-ankake', name: 'さつまいもの満月焼き きのこあん', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'grill', genre: '和食', minutes: 25,
    ingredients: [['sweet_potato', 200], ['milk', 25], ['oil', 5], ['shimeji', 65], ['soup311_awase_dashi', 100], ['soy_sauce', 7], ['mirin', 7], ['starch', 3], ['water', 8]],
    steps: [
      'さつまいもは皮をむいて薄く切り、蒸して熱いうちにつぶす。牛乳を混ぜる。',
      '生地を小さく取り分け、満月をかたどって薄い円形に整える。油を温めたフライパンで両面をこんがり焼く。',
      'しめじは石づきを落とし短く切る。だし、しょうゆ、みりんで煮て火を通す。',
      '分量の水で溶いた片栗粉を混ぜてひと煮立ちさせる。焼いたさつまいもの黄色を少し残してあんをかける。',
    ],
  }),
  occasionDish(['harvest-moon', 'senior-friendly'], {
    id: 'moon-carrot-tofu-soup', name: 'にんじんの満月と豆腐の薄くず椀', role: 'soup', family: 'clear-soup',
    genre: '和食', minutes: 20,
    ingredients: [['carrot', 70], ['silken_tofu', 120], ['spinach', 35], ['soup311_awase_dashi', 330], ['kyoto_usukuchi', 5], ['salt', 0.4], ['starch', 4], ['water', 10]],
    steps: [
      'にんじんの太いところを薄い輪切りにして満月形を人数に合わせて取り、端は小さく刻む。ほうれん草はゆでて短く刻む。',
      'だしでにんじんを煮る。箸で切れる柔らかさになったら、さいの目の絹ごし豆腐をそっと加える。',
      '薄口しょうゆと塩で味を調え、分量の水で溶いた片栗粉を加え、ひと煮立ちさせる。',
      '椀に刻んだ青菜を置き、豆腐と汁をよそう。丸いにんじんを汁に浮かべる。',
    ],
  }),
  occasionDish(['harvest-moon', 'autumn'], {
    id: 'moon-taro-aonori', name: '絹かつぎの青のりごま塩添え', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'steam', genre: '和食', minutes: 25,
    ingredients: [['taro', 200], ['sesame', 5], ['canteen_aonori', 0.6], ['salt', 0.8]],
    steps: [
      '小さな里いもを選び、皮を傷めないように泥を洗う。分量は皮を除いた可食部の重さで用意する。',
      '皮の中央にぐるりと浅い切れ目を入れ、蒸気の上がった蒸し器に並べる。15〜20分を目安に串が中心まで通るまで蒸す。',
      '白ごまを乾いた小鍋で香りが立つまでいり、軽くすって青のりと塩を混ぜる。',
      '里いもは手で触れられる温度に冷まし、皮をむく。半分に切って青のりごま塩を添える。',
    ],
  }),

  occasionDish(['respect-for-aged', 'senior-friendly'], {
    id: 'elders-flounder-turnip', name: 'かれいのかぶら蒸し 銀あん', role: 'main', family: 'fish-main',
    category: 'fish', method: 'steam', genre: '和食', minutes: 30,
    ingredients: [['flounder', 200], ['turnip', 170], ['egg', 1], ['salt', 0.5], ['soup311_awase_dashi', 100], ['kyoto_usukuchi', 4], ['starch', 4], ['water', 10]],
    steps: [
      'かれいは小骨を確認して食べやすい大きさに切る。卵は卵白と卵黄に分ける。かぶはすりおろして軽く水気を切る。',
      '卵白を軽く泡立ててかぶと塩を混ぜ、耐熱の浅い器に置いたかれいを覆う。',
      '蒸気の上がった蒸し器で12〜15分ほど蒸す。魚の中心まで火が通り、かぶがふんわり固まったら取り出す。',
      'だしと薄口しょうゆを温め、水溶き片栗粉でとろみを付ける。卵黄を溶いて細く流し、十分火を通したあんをかける。',
    ],
  }),
  occasionDish(['respect-for-aged', 'senior-friendly'], {
    id: 'elders-stuffed-koya', name: '高野豆腐のしっとり鶏射込み煮', role: 'main', family: 'bean-main',
    category: 'bean', method: 'simmer', genre: '和食', minutes: 35,
    ingredients: [['tofu_dried', 35], ['chicken_minced', 100], ['carrot', 25], ['ginger', 3], ['soup311_awase_dashi', 300], ['soy_sauce', 12], ['mirin', 15], ['sugar', 4], ['starch', 3]],
    steps: [
      '高野豆腐を表示に従って戻す。両手で水気を押して半分に切り、厚みの中央に切り込みを入れて袋にする。',
      'ひき肉に細かく刻んだにんじん、おろししょうが、片栗粉を加えて練り、高野豆腐の袋に薄く詰める。',
      'だし、しょうゆ、みりん、砂糖を浅い鍋で煮立て、重ならないように高野豆腐を並べる。',
      '落としぶたをして弱火で15分ほど煮て肉の中心まで火を通す。煮汁ごと少し置き、食べやすく切って盛る。',
    ],
  }),
  occasionDish(['respect-for-aged', 'senior-friendly', 'autumn'], {
    id: 'elders-aubergine-dengaku', name: '皮むき焼きなすの豆腐田楽', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'grill', genre: '和食', minutes: 25,
    ingredients: [['aubergine', 220], ['silken_tofu', 80], ['miso', 12], ['mirin', 12], ['sugar', 4], ['ginger', 2]],
    steps: [
      'なすはへたの周りに切れ目を入れ、皮に数か所穴を開ける。魚焼きグリルで返しながら皮が黒くなるまで焼く。',
      '粗熱が取れたら皮をむき、へたを落とす。繊維を断つように短く切り、水気を切って器に並べる。',
      '小鍋に豆腐、みそ、みりん、砂糖を入れ、豆腐をつぶしながら弱火で練る。',
      '木べらで跡が残る柔らかさになったら豆腐みそを焼きなすにかけ、しょうがをすりおろして添える。',
    ],
  }),
  occasionDish(['respect-for-aged', 'senior-friendly'], {
    id: 'elders-scallop-yam', name: 'ほたてと長いものすり流し', role: 'soup', family: 'soup',
    genre: '和食', minutes: 20,
    ingredients: [['scallop', 100], ['yam', 100], ['soup311_awase_dashi', 270], ['kyoto_usukuchi', 5], ['salt', 0.4], ['scallion_garnish', 3]],
    steps: [
      'ほたては筋を外して薄くそぎ切りにする。長いもは皮をむいてすりおろす。',
      'だしを煮立ててほたてに火を通す。数切れを取り分け、残りは木べらで細かくほぐす。',
      '長いもを少しずつ加え、底から混ぜながら弱火で煮る。生の粘りが落ち着いたら薄口しょうゆと塩を加える。',
      '器に注ぎ、取り分けたほたても細かくほぐしてのせる。小口切りの小ねぎを散らす。',
    ],
  }),

  occasionDish(['autumn-equinox', 'autumn'], {
    id: 'equinox-ganmodoki', name: 'にんじんと枝豆の手作りがんもどき', role: 'main', family: 'bean-main',
    category: 'bean', method: 'fried', genre: '和食', minutes: 35,
    ingredients: [['tofu', 300], ['yam', 45], ['carrot', 30], ['edamame', 35], ['starch', 15], ['oil', 18], ['ginger', 4], ['soy_sauce', 6]],
    steps: [
      '木綿豆腐を布で包み、重しをしてよく水気を切る。にんじんは細かく刻み、枝豆はゆでて粗く刻む。',
      '滑らかにつぶした豆腐に、すりおろした長いも、にんじん、枝豆、片栗粉を混ぜる。',
      '食べやすい小判形にして、油をひいた小さなフライパンに並べる。弱めの中火で両面と側面をじっくり揚げ焼きにする。',
      '外がきつね色で中まで熱くなったら油を切る。おろししょうがとしょうゆを添える。',
    ],
  }),
  occasionDish(['autumn-equinox', 'senior-friendly'], {
    id: 'equinox-tofu-shiitake', name: '高野豆腐と干ししいたけの二色含め煮', role: 'main', family: 'bean-main',
    category: 'bean', method: 'simmer', genre: '和食', minutes: 55,
    ingredients: [['tofu_dried', 55], ['dried_shiitake', 8], ['carrot', 80], ['kyoto_kombu_dashi', 280], ['soy_sauce', 12], ['mirin', 16], ['sugar', 6]],
    steps: [
      '干ししいたけはぬるま湯に浸して芯まで戻し、軸をのぞいて薄切りにする。高野豆腐も表示に従って戻し、ひと口大に切る。',
      'にんじんは薄い半月切りにする。鍋に昆布だし、しょうゆ、みりん、砂糖を入れて煮立てる。',
      'にんじん、しいたけ、高野豆腐の順に入れ、落としぶたをして弱火で15分ほど静かに煮含める。',
      'にんじんが箸で切れる柔らかさになったら火を止め、煮汁の中でしばらく味をなじませる。三色を分けて盛る。',
    ],
  }),
  occasionDish(['autumn-equinox', 'autumn'], {
    id: 'equinox-persimmon-shiraae', name: '柿とほうれん草のごま白和え', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'dressed', genre: '和食', minutes: 20,
    ingredients: [['tofu', 110], ['fruit_persimmon', 100], ['spinach', 95], ['ground_sesame', 8], ['miso', 7], ['sugar', 3]],
    steps: [
      '木綿豆腐を熱湯で2分ゆで、ざるで水を切りながら冷ます。ほうれん草は別にゆでて水気を絞る。',
      '柿の皮と種を除き、短い拍子木切りにする。ほうれん草は柿と同じ長さに切る。',
      '豆腐をつぶし、すりごま、みそ、砂糖を合わせて粒の細かい和え衣にする。',
      '食べる直前に柿とほうれん草を衣に加え、柿をつぶさず底から返すように和える。',
    ],
  }),
  occasionDish(['autumn-equinox', 'autumn'], {
    id: 'equinox-kenchin', name: '秋彼岸の里いもとまいたけの精進けんちん汁', role: 'soup', family: 'vegetable-soup',
    genre: '和食', minutes: 30,
    ingredients: [['taro', 90], ['simmered_maitake', 65], ['tofu', 80], ['daikon', 70], ['burdock', 25], ['sesame_oil', 5], ['kyoto_kombu_dashi', 370], ['soy_sauce', 10], ['salt', 0.3]],
    steps: [
      '里いもは皮をむいて薄い半月切りに、大根はいちょう切りにする。ごぼうはささがきにし、まいたけをほぐす。',
      '鍋でごま油を熱し、水気を切った豆腐をくずしながら炒める。ごぼう、里いも、大根を入れて油をなじませる。',
      '昆布だしを注いで煮立て、あくを取り、まいたけを加える。根菜が柔らかくなるまで弱火で煮る。',
      'しょうゆと塩で味を調える。里いもを崩さないよう、汁と具を椀に取り分ける。',
    ],
  }),

  occasionDish(['halloween', 'child-friendly'], {
    id: 'halloween-pepper-lantern', name: 'パプリカのジャック・オー・ランタン肉詰め', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '洋食', minutes: 45,
    ingredients: [['paprika', 260], ['beef_pork_mince_raw', 160], ['onion', 45], ['breadcrumbs', 12], ['milk', 20], ['tomato_paste', 12], ['cheese', 15], ['salt', 0.8]],
    steps: [
      '小ぶりのパプリカの上部をふた用に切り、種を取る。側面に小さな三角の目や口を浅く切り抜き、抜いた果肉を刻む。',
      '玉ねぎをみじん切りにし、刻んだ果肉、合いびき肉、牛乳を吸わせたパン粉、塩、トマトペーストと練り合わせる。',
      'パプリカに軽く詰めて表面を平らにし、耐熱皿に立てる。ふたを脇に置き、190℃のオーブンで25〜30分焼く。',
      '肉の中心まで十分火を通してチーズをのせ、溶けるまで焼く。ふたを添え、食べるときに切り分ける。',
    ],
  }),
  occasionDish(['halloween', 'child-friendly'], {
    id: 'halloween-ghost-pie', name: 'おばけマッシュのコテージパイ', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '洋食', minutes: 40,
    ingredients: [['beef_minced', 180], ['potato', 230], ['onion', 65], ['carrot', 45], ['canned_tomato', 100], ['milk', 35], ['butter', 8], ['nori', 0.4], ['salt', 1]],
    steps: [
      'じゃがいもを小さく切ってゆで、湯を切り、熱いうちに牛乳とバターを混ぜてつぶす。',
      'ひき肉を炒めてほぐし、刻んだ玉ねぎとにんじんを加える。トマト缶と塩を入れ、肉と野菜に火が通り汁気が減るまで煮る。',
      '耐熱皿に具を敷き、袋の角を切ってマッシュポテトを山形に絞る。先端を少し傾けておばけの形にする。',
      '200℃のオーブンで10分ほど、山の先に薄い焼き色が付くまで焼く。海苔を小さく切って目を付ける。',
    ],
  }),
  occasionDish(['halloween', 'child-friendly'], {
    id: 'halloween-pumpkin-packets', name: 'かぼちゃの三角包み焼き', role: 'side', family: 'side',
    category: 'vegetable', method: 'grill', genre: '洋食', minutes: 25,
    ingredients: [['pumpkin', 130], ['dumpling_wrappers', 65], ['palette_cream_cheese', 25], ['curry_powder', 0.3], ['olive_oil', 5], ['salt', 0.3]],
    steps: [
      'かぼちゃの種と皮を除き、小さく切って柔らかく蒸す。水気を飛ばしながらつぶす。',
      'クリームチーズ、少量のカレー粉、塩を混ぜる。餃子の皮に包めるように、あんを冷ましておく。',
      '皮の中央にあんを少量ずつのせ、縁を水でぬらして三方から寄せ、三角帽子の形にしっかり閉じる。',
      '表面にオリーブ油を薄く塗り、200℃のオーブンで10分ほど焼く。閉じ目がきつね色になったら取り出す。',
    ],
  }),
  occasionDish(['halloween'], {
    id: 'halloween-purple-soup', name: '紫キャベツとりんごの魔女のスープ', role: 'soup', family: 'potage',
    genre: '洋食', minutes: 30,
    ingredients: [['red_cabbage', 180], ['apple', 85], ['onion', 40], ['potato', 50], ['water', 300], ['olive_oil', 5], ['salt', 1.1], ['lemon', 5]],
    steps: [
      '紫キャベツと玉ねぎは細切りにし、じゃがいもと皮をむいたりんごは薄切りにする。',
      'オリーブ油で玉ねぎとキャベツを炒める。しんなりしたらりんご、じゃがいも、水を加えてふたをする。',
      '15分ほど煮てじゃがいもが崩れる柔らかさになったら、粗熱を取ってからかくはんする。鍋に戻して温め、塩を加える。',
      '紫色のスープを器に注ぐ。レモン汁を数滴ずつたらし、スプーンの先を通して赤紫色の模様を描く。',
    ],
  }),
  occasionDish(['halloween'], {
    id: 'halloween-egg-eyes', name: '目玉たまごのアボカドボート', role: 'side', family: 'small-dish',
    category: 'egg', method: 'cold', genre: '洋食', minutes: 20,
    ingredients: [['egg', 2], ['avocado', 85], ['yogurt', 20], ['lemon', 5], ['nori', 0.6], ['paprika', 25], ['salt', 0.3]],
    steps: [
      '卵を固ゆでにし、冷水に取って殻をむく。縦半分に切り、黄身を取り出す。',
      '黄身をアボカド、ヨーグルト、レモン汁、塩と一緒につぶし、緑色のクリームを作る。',
      'パプリカを細いせん切りにし、白身のくぼみに沿わせる。緑色のクリームをその上に丸く詰める。',
      '海苔を小さな丸に切ってクリームの中央に置き、瞳に見立てる。冷やしてから皿に並べる。',
    ],
  }),

  occasionDish(['christmas', 'winter'], {
    id: 'christmas-pork-apple', name: '豚ロースのソテー 焼きりんごソース', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '洋食', minutes: 30,
    ingredients: [['pork_loin', 240], ['apple', 140], ['onion', 50], ['butter', 12], ['apple_juice', 70], ['vinegar', 5], ['salt', 1.1], ['black_pepper', 0.2]],
    steps: [
      '豚ロースの筋に切り込みを入れ、厚みをそろえて塩とこしょうを振る。りんごは芯を除き、半分をくし形、残りを細かく切る。',
      '鍋にバターの半量を溶かし、くし形のりんごに焼き色を付けて取り出す。同じ鍋で肉の両面を焼き、弱火で中心まで火を通して取り出す。',
      '残りのバターで刻んだ玉ねぎとりんごを炒める。りんごジュースと酢を加え、鍋底のうま味を溶かしながら煮詰める。',
      '肉を皿に移して温かいソースをかけ、焼きりんごを扇形に添える。',
    ],
  }),
  occasionDish(['christmas'], {
    id: 'christmas-salmon-parcel', name: '鮭とほうれん草の包み焼き ディップ添え', role: 'main', family: 'fish-main',
    category: 'fish', method: 'grill', genre: '洋食', minutes: 30,
    ingredients: [['salmon', 240], ['spinach', 100], ['mushroom', 60], ['butter', 10], ['yogurt', 45], ['lemon', 8], ['parsley', 3], ['salt', 1.1]],
    steps: [
      'オーブンを200℃に温める。鮭の骨を確かめ、分量の塩の半分を振って水気を拭く。ほうれん草は下ゆでして水気を絞る。',
      '人数分のオーブンシートにほうれん草、薄切りマッシュルーム、鮭を分けてのせる。鮭にバターをのせ、蒸気が逃げにくいよう紙を折り閉じる。',
      '天板に並べて15〜20分、魚の厚いところがほぐれるまで焼く。包みの端を開き、熱い蒸気を逃がす。',
      'ヨーグルトにレモン汁、刻みパセリ、残りの塩を混ぜて添える。包みに残った汁も一緒に盛る。',
    ],
  }),
  occasionDish(['christmas', 'child-friendly'], {
    id: 'christmas-cauliflower-tree', name: 'カリフラワーの雪とブロッコリーの小さなツリー', role: 'side', family: 'side',
    category: 'vegetable', method: 'salad', genre: '洋食', minutes: 25,
    ingredients: [['broccoli', 130], ['cauliflower', 100], ['potato', 100], ['carrot', 25], ['milk', 25], ['parmesan_cheese', 8], ['salt', 0.4]],
    steps: [
      'じゃがいもをゆで、湯を切って牛乳、粉チーズ、塩と一緒につぶす。温かいうちに皿に円すい形に盛る。',
      'ブロッコリーを小房に、カリフラワーを細かい粒に分ける。にんじんは薄く切り、星形に抜いて端を刻む。',
      'にんじんとブロッコリーを順にゆで、最後にカリフラワーをさっとゆでる。水気をよく切る。',
      '円すいの下からブロッコリーを軽く押し付ける。刻みにんじんを飾り、カリフラワーを雪のように散らして星をのせる。',
    ],
  }),
  occasionDish(['christmas', 'winter'], {
    id: 'christmas-carrot-lentils', name: 'レンズ豆とトマトの赤いスープ', role: 'soup', family: 'vegetable-soup',
    genre: '洋食', minutes: 30,
    ingredients: [['lentil_cooked', 130], ['canned_tomato', 200], ['carrot', 60], ['onion', 55], ['olive_oil', 7], ['water', 230], ['salt', 1.4], ['yogurt', 20], ['parsley', 2]],
    steps: [
      'にんじんと玉ねぎを薄く切る。厚手の鍋でオリーブ油を温め、野菜を焦がさずにじっくり炒める。',
      'トマトをつぶして加え、水、ゆでレンズ豆、塩を入れる。にんじんが柔らかくなるまでふたをして弱火で煮る。',
      '粗熱を取ってから滑らかにかくはんし、再び鍋で温める。レンズ豆で自然なとろみが出たら器へ注ぐ。',
      'ヨーグルトを軽く溶いて円を描き、刻んだパセリを中央に散らす。',
    ],
  }),

  occasionDish(['new-year', 'winter'], {
    id: 'new-year-yellowtail-yuan', name: 'ぶりの柑橘幽庵焼き', role: 'main', family: 'grilled-fish',
    category: 'fish', method: 'grill', genre: '和食', minutes: 40,
    ingredients: [['yellowtail', 230], ['fruit_satsuma', 50], ['soy_sauce', 14], ['mirin', 14], ['sake', 12], ['oil', 3]],
    steps: [
      'みかんの果肉をしぼる。果汁にしょうゆ、みりん、酒を合わせて浅い容器に入れる。',
      'ぶりは骨を確認し水気を拭き、漬け汁に浸して冷蔵庫に20分置く。途中で一度返す。',
      '漬け汁をぬぐって薄く油をひいた魚焼きグリルに並べる。中火で両面を焼き、中心まで火を通す。',
      '残った漬け汁を別の小鍋でしっかり沸かし、少しとろみが出るまで煮詰める。焼けたぶりに薄く塗る。',
    ],
  }),
  occasionDish(['new-year'], {
    id: 'new-year-chicken-yawata', name: '鶏もも肉の八幡巻き', role: 'main', family: 'meat-main',
    category: 'meat', method: 'simmer', genre: '和食', minutes: 50,
    ingredients: [['chicken', 280], ['burdock', 65], ['carrot', 55], ['soup311_awase_dashi', 200], ['soy_sauce', 16], ['mirin', 16], ['sake', 12], ['sugar', 5]],
    steps: [
      'ごぼうとにんじんを肉の幅に合わせて細い棒状に切る。だしで下煮し、竹串が通るまで柔らかくする。煮汁を取っておく。',
      '鶏肉は厚い所を開いて平らにし、皮を下に置く。野菜の水気を切って肉で巻き、調理用のたこ糸で縛る。',
      '巻き終わりを下にして鍋で焼き付ける。下煮のだし、しょうゆ、みりん、酒、砂糖を加え、転がしながらふたをして煮る。',
      '巻いた肉の中心まで十分火を通す。煮汁を絡めて少し落ち着かせ、清潔な包丁で輪切りにして糸を外す。',
    ],
  }),
  occasionDish(['new-year', 'winter'], {
    id: 'new-year-persimmon-namasu', name: '柿入り紅白なます', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'pickled', genre: '和食', minutes: 20,
    ingredients: [['daikon', 180], ['carrot', 40], ['fruit_persimmon', 65], ['vinegar', 18], ['sugar', 7], ['salt', 1.2]],
    steps: [
      '大根とにんじんは皮をむいて細いせん切りにする。にんじんは大根よりも少し細く切る。',
      '塩を振って軽くもみ、しんなりしたら水気をしっかり絞る。柿は皮と種を除いて細切りにする。',
      'ボウルで米酢と砂糖をよく混ぜ、砂糖が溶けたら大根とにんじんを加える。',
      '柿を最後に加えて形を残すように和え、10分ほど置く。汁気を軽く切って小鉢に盛る。',
    ],
  }),
  occasionDish(['new-year'], {
    id: 'new-year-shrimp-shinjo', name: 'えびしんじょと花にんじんの祝い椀', role: 'soup', family: 'clear-soup',
    genre: '和食', minutes: 30,
    ingredients: [['shrimp', 120], ['yam', 30], ['starch', 6], ['carrot', 35], ['spinach', 35], ['soup311_awase_dashi', 350], ['kyoto_usukuchi', 5], ['salt', 0.6]],
    steps: [
      'むきえびの背わたを取り、よく拭いて包丁で細かくたたく。すりおろした長いも、片栗粉、塩の半量を混ぜ、粘りが出るまで練る。',
      'にんじんを薄く花形に抜き、端は細かく刻む。ほうれん草はゆでて水気を絞り、短く切る。',
      'だしで花にんじんと端を煮る。えびの生地をぬらしたスプーンで小さくすくい、沸騰を抑えただしで中心まで火を通す。',
      '薄口しょうゆと残りの塩を加える。椀に青菜、しんじょ、花にんじんを入れ、静かに汁を張る。',
    ],
  }),

  occasionDish(['birthday', 'child-friendly'], {
    id: 'birthday-meatloaf-eggs', name: 'まんなか卵のバースデーミートローフ', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '洋食', minutes: 55,
    ingredients: [['beef_pork_mince_raw', 260], ['egg', 2], ['onion', 60], ['carrot', 35], ['breadcrumbs', 18], ['milk', 35], ['salt', 1.2], ['bread_ketchup', 30], ['worcestershire_sauce', 8]],
    steps: [
      '卵は固ゆでにして殻をむく。玉ねぎ、にんじんをみじん切りにし、耐熱容器でふたをして電子レンジで柔らかく加熱し、冷ましておく。',
      'ひき肉、塩、牛乳を吸わせたパン粉、野菜を練る。オーブンシートに半量を敷き、中央に卵を横一列に並べる。',
      '残りの肉だねで卵を包み、継ぎ目を閉じる。180℃のオーブンで約30分、肉の厚い部分の中心まで十分に焼く。',
      'ケチャップとウスターソースを小鍋で温める。肉を少し休ませて切り分け、卵の断面を上にしてソースを添える。',
    ],
  }),
  occasionDish(['birthday', 'child-friendly'], {
    id: 'birthday-shrimp-piccata', name: 'えびとじゃがいものチーズピカタ', role: 'main', family: 'fish-main',
    category: 'fish', method: 'grill', genre: '洋食', minutes: 30,
    ingredients: [['shrimp', 180], ['potato', 140], ['egg', 1], ['flour', 12], ['parmesan_cheese', 12], ['olive_oil', 7], ['parsley', 3], ['salt', 0.7]],
    steps: [
      'じゃがいもは薄く切って固めにゆで、湯を切る。えびは背わたを除き、腹側から厚みを開いて水気を拭く。',
      '卵を溶き、粉チーズ、刻んだパセリ、塩を混ぜる。えびとじゃがいもの表面に薄力粉を薄くはたく。',
      'フライパンにオリーブ油を熱する。じゃがいも、えびの順に卵液をくぐらせ、一重に並べて両面を焼く。',
      'えびの中心が不透明になり卵の衣に火が通るまで焼く。じゃがいもとえびを交互に重ねて盛る。',
    ],
  }),
  occasionDish(['birthday', 'anniversary'], {
    id: 'birthday-beet-ribbon', name: 'ビーツとにんじんのリボンマリネ', role: 'side', family: 'side',
    category: 'vegetable', method: 'salad', genre: '洋食', minutes: 25,
    ingredients: [['beet', 100], ['carrot', 90], ['fruit_european_pear', 75], ['vinegar', 12], ['olive_oil', 8], ['sugar', 3], ['salt', 0.6]],
    steps: [
      'ビーツとにんじんの皮をむき、ピーラーで長いリボン状に削る。最後の端は包丁で薄く切る。',
      'にんじんを先にさっとゆでて引き上げ、同じ湯でビーツを柔らかくゆでる。それぞれ水気をよく切る。',
      '酢、油、砂糖、塩を合わせて半分ずつ別の器に入れる。色が移り過ぎないようににんじんとビーツを別々に和える。',
      '洋梨を薄切りにして皿に敷く。野菜を一枚ずつ緩く巻き、赤とオレンジのリボンを重ねる。',
    ],
  }),
  occasionDish(['birthday', 'child-friendly'], {
    id: 'birthday-corn-star', name: '星形にんじんのコーンロワイヤル', role: 'soup', family: 'soup',
    genre: '洋食', minutes: 30,
    ingredients: [['corn', 100], ['egg', 1], ['milk', 90], ['water', 70], ['soup311_consomme', 1.8], ['carrot', 30]],
    steps: [
      'にんじんは薄い星形に抜き、端とともにゆでる。コーンは芯を除いた粒を水、刻んだ端のにんじんと一緒に柔らかく煮る。',
      'コンソメを溶かし、粗熱を取って牛乳を加え、滑らかにかくはんする。裏ごしして皮をのぞく。',
      '卵を泡立てずに溶き、コーン液を合わせてこし、小さな耐熱のスープカップに分ける。',
      'ふたをして弱い蒸気で12〜15分蒸す。中心まで固まったら星にんじんを飾り、スプーンでいただく。',
    ],
  }),

  occasionDish(['anniversary'], {
    id: 'anniversary-seabream-meuniere', name: '鯛のムニエル 焦がしバターとレモンのソース', role: 'main', family: 'fish-main',
    category: 'fish', method: 'meuniere', genre: '洋食', minutes: 25,
    ingredients: [['seabream_sashimi', 230], ['asparagus', 100], ['flour', 10], ['butter', 16], ['olive_oil', 5], ['lemon', 10], ['parsley', 3], ['salt', 1.1]],
    steps: [
      '鯛は厚みのあるそぎ切りにして塩を振り、水気を拭く。アスパラは根元の皮をむき、短く切って下ゆでする。',
      '鯛に薄力粉をはたく。オリーブ油とバターの半量を温めたフライパンで片面に焼き色を付け、返して中まで火を通す。',
      '魚とアスパラを皿に盛る。鍋の余分な粉を拭き、残りのバターを入れ、泡が細かくなって茶色く香るまで熱する。',
      '火から外してレモン汁と刻みパセリを加え、鍋を揺すってソースをまとめて鯛にかける。',
    ],
  }),
  occasionDish(['anniversary', 'winter'], {
    id: 'anniversary-beef-ragout', name: '牛肉とまいたけの赤ワイン煮込み', role: 'main', family: 'meat-main',
    category: 'meat', method: 'stew', genre: '洋食', minutes: 90,
    ingredients: [['beef_stew_cut', 240], ['simmered_maitake', 100], ['onion', 90], ['carrot', 60], ['perf_wine_red', 90], ['canned_tomato', 140], ['water', 160], ['flour', 7], ['olive_oil', 8], ['salt', 1.3]],
    steps: [
      '牛肉は3cm角に切り、分量の塩の半分を振って薄力粉をまぶす。油で各面を焼き付け、皿に取り出す。',
      '同じ鍋で薄切り玉ねぎ、ひと口大のにんじん、ほぐしたまいたけを炒める。赤ワインを注ぎ、鍋底を木べらでこそげる。',
      'ワインを半量まで煮詰め、牛肉、トマト缶、水、残りの塩を加える。ふたを少しずらし、弱火で1時間ほど煮込む。',
      '肉にフォークが楽に入るまで煮る。必要に応じて湯を足し、最後にふたを外し、肉に絡む濃さまでソースを煮詰める。',
    ],
  }),
  occasionDish(['anniversary'], {
    id: 'anniversary-salmon-terrine', name: '鮭とブロッコリーの二色卵テリーヌ', role: 'side', family: 'small-dish',
    category: 'egg', method: 'steam', genre: '洋食', minutes: 40,
    ingredients: [['salmon', 80], ['broccoli', 70], ['egg', 2], ['milk', 70], ['butter', 4], ['salt', 0.6]],
    steps: [
      '鮭は骨と皮を除いて小さく切る。ブロッコリーは柔らかくゆで、湯を切って細かく刻む。',
      '卵と牛乳、塩を混ぜてこす。バターを塗った一人用の小さな耐熱型に鮭とブロッコリーを上下に重ねて詰める。',
      '卵液を静かに注ぎ、ホイルをかぶせる。蒸気の上がった蒸し器で弱火にし、厚みに合わせて20分ほど蒸す。',
      '中央の卵が固まり、鮭の中心まで火が通ったら、少し休ませて型から出す。彩りが見えるように厚めに切る。',
    ],
  }),
  occasionDish(['anniversary'], {
    id: 'anniversary-shrimp-bisque', name: 'えびとパプリカのビスク風スープ', role: 'soup', family: 'potage',
    genre: '洋食', minutes: 30,
    ingredients: [['shrimp', 130], ['paprika', 100], ['onion', 55], ['tomato_paste', 16], ['milk', 150], ['water', 180], ['butter', 10], ['flour', 7], ['salt', 0.9]],
    steps: [
      'むきえびの背わたを除き、飾り用に人数に合わせて取り分ける。残りを刻み、パプリカと玉ねぎは薄切りにする。',
      'バターで飾りのえびを中まで焼いて取り出す。同じ鍋で野菜と刻んだえびを炒め、トマトペーストと薄力粉を混ぜる。',
      '水を少しずつ加え、野菜が柔らかくなるまで10分ほど煮る。粗熱を取って滑らかにかくはんし、ざるでこす。',
      '牛乳を加えて沸かし過ぎず温め、塩を加える。皿の中央に焼いたえびを置き、周りにスープを注ぐ。',
    ],
  }),

  occasionDish(['autumn'], {
    id: 'autumn-saury-plum-roll', name: 'さんまの梅しそ巻き焼き', role: 'main', family: 'grilled-fish',
    category: 'fish', method: 'grill', genre: '和食', minutes: 25,
    ingredients: [['saury', 220], ['ume', 12], ['shiso', 6], ['mirin', 8], ['soy_sauce', 5], ['oil', 4]],
    steps: [
      '三枚おろしのさんまの小骨を除き、長さを半分に切る。梅干しは種を除いて包丁で細かくたたく。',
      '身を上にして梅肉を塗り、青じそを重ねる。端から巻いて短いつまようじで留める。',
      '薄く油をひいたフライパンに並べ、転がしながら焼く。ふたをして弱火にし、重なった身の中心まで火を通す。',
      '余分な脂を拭いてみりんとしょうゆを絡める。すべてのつまようじを取り除いて断面を見せて盛る。',
    ],
  }),
  occasionDish(['autumn'], {
    id: 'autumn-salmon-mushroom', name: '秋鮭のきのこみそホイル蒸し', role: 'main', family: 'fish-main',
    category: 'fish', method: 'steam', genre: '和食', minutes: 25,
    ingredients: [['salmon', 230], ['simmered_maitake', 75], ['enoki', 55], ['onion', 60], ['miso', 16], ['mirin', 12], ['butter', 7], ['water', 12]],
    steps: [
      '鮭の骨を除いて水気を拭く。まいたけとえのきは根元を落としてほぐし、玉ねぎは薄切りにする。',
      'みそをみりんと分量の水でゆるめる。一人分ずつに切った大きなアルミホイルに玉ねぎ、鮭、きのこの順で分けて置く。',
      '合わせみそをかけてバターをのせ、ホイルの縁をしっかり折って閉じる。フライパンに置き、包みの外に湯を浅く張る。',
      'ふたをして弱めの中火で12〜15分蒸す。鮭の中心もほぐれ、きのこに火が通ったら包みの汁ごと盛る。',
    ],
  }),
  occasionDish(['autumn'], {
    id: 'autumn-lotus-persimmon', name: 'れんこんと柿の甘酢ごま和え', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'dressed', genre: '和食', minutes: 20,
    ingredients: [['lotus_root', 130], ['fruit_persimmon', 85], ['vinegar', 15], ['sugar', 5], ['ground_sesame', 8], ['salt', 0.5]],
    steps: [
      'れんこんは皮をむいて薄いいちょう切りにし、水を替えながら洗う。柿は皮と種を除き、れんこんと同じ大きさに切る。',
      'れんこんを湯で2〜3分ゆで、歯ざわりが残るところでざるに上げて水気を切る。',
      '米酢、砂糖、塩を合わせ、温かいれんこんに絡める。ときどき返しながら冷ます。',
      '冷めたら柿とすりごまを加える。柿を崩さないように大きく混ぜて小鉢に盛る。',
    ],
  }),
  occasionDish(['autumn'], {
    id: 'autumn-sweetpotato-miso', name: 'さつまいもと焼きまいたけの豆乳みそ汁', role: 'soup', family: 'miso-soup',
    genre: '和食', minutes: 25,
    ingredients: [['sweet_potato', 130], ['simmered_maitake', 80], ['onion', 40], ['kyoto_kombu_dashi', 240], ['soy_milk', 120], ['miso', 16], ['oil', 3]],
    steps: [
      'さつまいもはよく洗って薄い半月切り、玉ねぎは薄切りにする。まいたけは大きめにほぐす。',
      'だしにさつまいもと玉ねぎを入れ、串がすっと通るまで弱火で煮る。',
      'フライパンに油をひき、まいたけをしばらく動かさずに焼いて片面に香ばしい色を付ける。裏返して火を通す。',
      '鍋にまいたけと豆乳を加え、煮立つ前に火を弱めてみそを溶く。さつまいもをくずさないようによそう。',
    ],
  }),

  occasionDish(['winter'], {
    id: 'winter-yellowtail-leek', name: 'ぶりと焼きねぎのみぞれ鍋仕立て', role: 'main', family: 'fish-main',
    category: 'fish', method: 'hotpot', genre: '和食', minutes: 30,
    ingredients: [['yellowtail', 230], ['negi', 120], ['daikon', 200], ['kyoto_kombu_dashi', 250], ['soy_sauce', 13], ['mirin', 14], ['ginger', 6]],
    steps: [
      'ぶりは骨を確認してひと口大に切り、熱湯を回しかけて水気を拭く。大根はすりおろし、汁も取っておく。',
      '長ねぎを長さ3cmに切り、油をひかずにフライパンで焼き、所々に焦げ目を付ける。',
      '鍋に昆布だし、しょうゆ、みりん、薄切りしょうがを入れて煮立てる。ぶりと焼きねぎを加えて煮る。',
      'ぶりの中心まで火が通ったら大根おろしを汁ごと加え、もう一度静かに煮立てる。ねぎとぶりを煮汁とともに盛る。',
    ],
  }),
  occasionDish(['winter'], {
    id: 'winter-pork-chinese-cabbage', name: '白菜と豚肉の重ね蒸し 黒酢だれ', role: 'main', family: 'meat-main',
    category: 'meat', method: 'steam', genre: '和食', minutes: 30,
    ingredients: [['pork', 200], ['chinese_cabbage', 350], ['ginger', 7], ['sake', 15], ['water', 40], ['canteen_black_vinegar', 14], ['soy_sauce', 10], ['sesame_oil', 3], ['scallion_garnish', 4]],
    steps: [
      '白菜は葉と芯を付けたまま洗う。白菜と豚薄切り肉を交互に重ね、鍋の深さに合わせて4〜5cm幅に切る。',
      '切り口を上にして小鍋にきっちり詰め、すき間に薄切りしょうがを入れる。酒と分量の水を注ぎ、ふたをする。',
      '沸いたら弱火で15分ほど蒸し、白菜の芯が柔らかく、重なった豚肉の中心まで火が通ったことを確かめる。',
      '黒酢、しょうゆ、ごま油、刻んだ小ねぎを混ぜる。鍋の蒸し汁でたれを好みの濃さにゆるめて添える。',
    ],
  }),
  occasionDish(['winter', 'senior-friendly'], {
    id: 'winter-turnip-orange', name: 'かぶのやわらかみかん煮', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'simmer', genre: '和食', minutes: 25,
    ingredients: [['turnip', 240], ['fruit_satsuma', 100], ['kyoto_kombu_dashi', 140], ['mirin', 10], ['salt', 0.6]],
    steps: [
      'かぶは厚めに皮をむいて厚さ1cmの半月切りにする。みかんは皮と薄皮を除き、飾り用の果肉を少し残す。',
      '鍋に昆布だし、みりん、塩、かぶを入れ、落としぶたをして弱火で柔らかく煮る。',
      'みかんの果肉を鍋の上で軽くつぶし、果汁ごと加える。かぶが箸で切れるまで静かに煮る。',
      '仕上げに残した果肉を入れて温め、かぶの上に果肉を少しずつのせて煮汁を張る。',
    ],
  }),
  occasionDish(['winter', 'senior-friendly'], {
    id: 'winter-cauliflower-negi', name: '焼き長ねぎとカリフラワーの白いポタージュ', role: 'soup', family: 'potage',
    genre: '洋食', minutes: 30,
    ingredients: [['cauliflower', 185], ['negi', 90], ['potato', 60], ['milk', 150], ['water', 230], ['olive_oil', 6], ['salt', 1]],
    steps: [
      '長ねぎは白い部分を厚さ1cmに切り、油をひいた鍋で切り口に焼き色を付ける。',
      '小房に分けたカリフラワー、薄切りじゃがいも、水を加える。ふたをして、すべての具がスプーンでつぶれるまで煮る。',
      '粗熱を取り、牛乳を加えて滑らかにかくはんする。長ねぎの繊維が残るときは細かいざるでこす。',
      '鍋に戻して底を混ぜながら温め、塩で調える。沸く直前に火を止めて器に注ぐ。',
    ],
  }),

  occasionDish(['child-friendly'], {
    id: 'kids-corn-nuggets', name: 'コーンと豆腐のふんわりチキンナゲット', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '洋食', minutes: 25,
    ingredients: [['chicken_minced', 200], ['silken_tofu', 75], ['corn', 45], ['starch', 13], ['oil', 10], ['bread_ketchup', 18], ['salt', 0.7]],
    steps: [
      'コーンは加熱して粗く刻み、大きな粒を残さないようにする。絹ごし豆腐はペーパーで余分な水分を取る。',
      '鶏ひき肉、塩、豆腐、片栗粉を練り、コーンを混ぜる。ぬらしたスプーンで厚さ1cmほどの小判形にする。',
      '油を温めたフライパンに並べて両面を焼き、弱火にしてふたをし、中心まで十分火を通す。',
      'ふたを外し、表面を軽く焼き直してケチャップを添える。大きいものは食べやすく切り分ける。',
    ],
  }),
  occasionDish(['child-friendly'], {
    id: 'kids-fish-carrot-sauce', name: '白身魚のカラフルにんじんソース', role: 'main', family: 'fish-main',
    category: 'fish', method: 'meuniere', genre: '洋食', minutes: 25,
    ingredients: [['cod', 220], ['carrot', 80], ['onion', 45], ['apple_juice', 55], ['water', 45], ['butter', 8], ['flour', 9], ['salt', 0.8]],
    steps: [
      'にんじんと玉ねぎを薄切りにし、分量の水とりんごジュースを加えてふたをし、柔らかく煮る。',
      '野菜は粗熱を取って煮汁と一緒に滑らかにかくはんする。小鍋に戻して分量の半分の塩を加え、温めておく。',
      'たらの皮と骨を除き、ひと口大にして残りの塩を振り、薄力粉をまぶす。バターを熱したフライパンに並べる。',
      '返しながら中まで火を通し、にんじんソースにのせる。食べるときに魚をほぐしてソースを絡める。',
    ],
  }),
  occasionDish(['child-friendly'], {
    id: 'kids-vegetable-pinwheel', name: 'にんじんと青菜のくるくる卵焼き', role: 'side', family: 'small-dish',
    category: 'egg', method: 'grill', genre: '和食', minutes: 20,
    ingredients: [['egg', 2], ['carrot', 35], ['spinach', 35], ['soup311_awase_dashi', 18], ['sugar', 3], ['salt', 0.4], ['oil', 4]],
    steps: [
      'にんじんはすりおろして耐熱容器で柔らかくなるまで加熱する。ほうれん草はゆでて水気を絞り、細かく刻む。',
      '卵を溶き、だし、砂糖、塩を混ぜて半分ずつに分ける。片方ににんじん、もう片方にほうれん草を加える。',
      '油を引いた小さな卵焼き器ににんじん入りの卵を流し、固まってきたら端から巻く。残りの油を薄く引く。',
      '青菜入りの卵を流し、巻いた卵の下にも行き渡らせる。ぐるりと巻き、弱火で中まで火を通して輪切りにする。',
    ],
  }),
  occasionDish(['child-friendly'], {
    id: 'kids-alphabet-soup', name: '小さなマカロニとミートボールのトマトスープ', role: 'soup', family: 'vegetable-soup',
    genre: '洋食', minutes: 30,
    ingredients: [['pork_minced', 100], ['macaroni', 25], ['canned_tomato', 160], ['carrot', 45], ['onion', 55], ['starch', 4], ['water', 360], ['salt', 1.2], ['olive_oil', 4]],
    steps: [
      '玉ねぎを細かく刻み、半分をひき肉、片栗粉、ひとつまみの塩と練る。ぬらした手で小さく平たい肉団子にする。',
      '油をひいた鍋で残りの玉ねぎと細かく切ったにんじんを炒め、トマト缶、水を加えて煮立てる。',
      '小さめのマカロニと肉団子を入れ、時々混ぜながらマカロニが柔らかくなり肉団子の中心まで火が通るまで煮る。',
      '残りの塩で味を調える。器の中で大きな肉団子をスプーンで分け、食べる人に合わせて少し冷ます。',
    ],
  }),
  occasionDish(['child-friendly'], {
    id: 'kids-potato-waffle', name: 'じゃがいもと枝豆のお花ガレット', role: 'side', family: 'side',
    category: 'vegetable', method: 'grill', genre: '洋食', minutes: 25,
    ingredients: [['potato', 210], ['edamame', 45], ['parmesan_cheese', 12], ['starch', 6], ['oil', 7], ['carrot', 25]],
    steps: [
      'にんじんは薄い輪切りにしてゆでる。枝豆も柔らかくゆで、薄皮を取って細かく刻む。',
      'じゃがいもを細いせん切りにする。水にさらさず、刻んだ枝豆、粉チーズ、片栗粉と混ぜる。',
      'フライパンに油を薄く広げ、にんじんの輪を間隔をあけて置く。じゃがいもをその周りに小さな円形に盛って押さえる。',
      '弱めの中火で両面を焼き、中まで火を通す。にんじんを花の中心に見立て、焼き色の付いた面を表にして並べる。',
    ],
  }),

  occasionDish(['senior-friendly'], {
    id: 'soft-hanpen-cod', name: 'たらとはんぺんのふんわり酒蒸し', role: 'main', family: 'fish-main',
    category: 'fish', method: 'steam', genre: '和食', minutes: 25,
    ingredients: [['cod', 150], ['palette_hanpen', 95], ['egg', 1], ['ginger', 3], ['sake', 10], ['soup311_awase_dashi', 80], ['kyoto_usukuchi', 4], ['starch', 3], ['water', 8]],
    steps: [
      '皮と骨を除いたたらを小さく切る。フードプロセッサーにたら、ちぎったはんぺん、卵、おろししょうが、酒を入れて滑らかにする。',
      '人数分の浅い耐熱の器に生地を薄く広げる。蒸気の上がった蒸し器で12〜15分ほど、中心までしっかり固まるまで蒸す。',
      '小鍋でだしと薄口しょうゆを温め、水溶き片栗粉を加えて再び煮立て、さらりとしたあんを作る。',
      '蒸し上がった生地にあんをかける。スプーンですくってあんと一緒に取り分ける。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-pork-tofu-simmer', name: '豆腐と豚そぼろのやわらか白菜煮', role: 'main', family: 'bean-main',
    category: 'bean', method: 'simmer', genre: '和食', minutes: 20,
    ingredients: [['silken_tofu', 210], ['pork_minced', 100], ['chinese_cabbage', 160], ['ginger', 3], ['soup311_awase_dashi', 160], ['soy_sauce', 10], ['mirin', 10], ['starch', 5], ['water', 12]],
    steps: [
      '白菜は芯を薄いそぎ切り、葉を短い細切りにする。小鍋に冷たいだし、ひき肉、おろししょうがを入れ、菜箸でほぐす。',
      '中火にかけ、ひき肉が固まり始めるまで混ぜる。白菜の芯、葉の順に加え、ふたをして柔らかく煮る。',
      '豚肉に十分火を通し、白菜が箸で切れるのを確かめる。しょうゆ、みりん、スプーンで分けた絹ごし豆腐を加えて温める。',
      '分量の水で溶いた片栗粉を鍋肌から加え、とろみが出るまで煮る。豆腐をくずし過ぎないように盛る。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-turnip-tofu', name: 'かぶのすりおろしとろみそぼろ', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'simmer', genre: '和食', minutes: 15,
    ingredients: [['turnip', 200], ['chicken_minced', 55], ['soup311_awase_dashi', 80], ['mirin', 7], ['kyoto_usukuchi', 5], ['starch', 3], ['water', 8]],
    steps: [
      'かぶの皮をむいて半量を薄い小さないちょう切り、残りをすりおろす。おろし汁も取っておく。',
      '小鍋でひき肉を冷たいだしとほぐしてから加熱する。煮立ったら、薄切りのかぶ、みりん、薄口しょうゆを加える。',
      'ひき肉に十分火が通り、かぶが箸でつぶせたら、おろしたかぶを汁ごと加えて煮る。',
      '水溶き片栗粉を加えて混ぜ、再び煮立てる。器に少しずつよそい、温かいあんをかける。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-pumpkin-miso', name: 'かぼちゃのなめらか白ごまみそ和え', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'dressed', genre: '和食', minutes: 15,
    ingredients: [['pumpkin', 220], ['ground_sesame', 7], ['miso', 8], ['kyoto_kombu_dashi', 45], ['mirin', 6]],
    steps: [
      'かぼちゃは種、わた、硬い皮を除き、火が通りやすい厚さに薄く切る。',
      '耐熱皿にかぼちゃとだしの半分を入れ、ふんわり覆って電子レンジで加熱する。途中で混ぜ、スプーンで無理なくつぶせるまで火を通す。',
      '小鍋に残りのだし、みりん、みそを混ぜてひと煮立ちさせ、すりごまを混ぜる。',
      'かぼちゃを粗くつぶして和え衣を少しずつ混ぜる。だしが残っていれば加えてしっとりと仕上げる。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-broccoli-egg', name: 'ブロッコリーの穂先と炒り卵のミルク煮', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'simmer', genre: '洋食', minutes: 15,
    ingredients: [['broccoli', 110], ['egg', 1], ['milk', 105], ['butter', 5], ['salt', 0.4]],
    steps: [
      'ブロッコリーの穂先を小さく刻む。茎を使うときは硬い皮を厚めにむき、芯を細かく切る。',
      '小鍋にバターを溶かしてブロッコリーを炒め、牛乳を注いでふたをし、ごく弱火で柔らかく煮る。',
      '穂先がスプーンでつぶれたら塩を加える。溶き卵を回し入れ、菜箸で混ぜながら細かな炒り卵状にする。',
      '卵に火が通ったら煮汁を少し残して火を止める。卵が乾く前に、ブロッコリーと煮汁を一緒にすくう。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-daikon-shirasu', name: '大根としらすのやさしいおかか煮', role: 'side', family: 'small-dish',
    category: 'vegetable', method: 'simmer', genre: '和食', minutes: 20,
    ingredients: [['daikon', 210], ['shirasu_dried', 18], ['bonito', 3], ['kyoto_kombu_dashi', 160], ['mirin', 8], ['soy_sauce', 4]],
    steps: [
      '大根の皮を厚めにむき、小さな薄いいちょう切りにする。しらすは大きいものがあれば刻む。',
      '小鍋に大根、昆布だし、みりんを入れ、落としぶたをして弱火で煮る。箸が楽に通るまで火を通す。',
      'しらす、しょうゆ、手でもみほぐしたかつお節を加える。しらすが柔らかくなるまで数分煮含める。',
      '火を止めて少し置き、大根に味を含ませる。煮汁としらすも一緒に小鉢に移す。',
    ],
  }),
  occasionDish(['senior-friendly'], {
    id: 'soft-carrot-soymilk', name: 'にんじんと絹ごし豆腐の豆乳すり流し', role: 'soup', family: 'potage',
    genre: '和食', minutes: 20,
    ingredients: [['carrot', 120], ['silken_tofu', 100], ['kyoto_kombu_dashi', 170], ['soy_milk', 130], ['miso', 10]],
    steps: [
      'にんじんは皮をむいて薄いいちょう切りにし、昆布だしを入れた小鍋で煮る。',
      'にんじんがつぶれるまで柔らかくなったら火を止め、粗熱を取る。水気を切った絹ごし豆腐を加える。',
      '具と煮汁を滑らかになるまでかくはんする。鍋に戻して豆乳を少しずつ加え、ごく弱火で温める。',
      '煮立つ前にみそを溶き、底からひと混ぜする。温かいうちに小さな汁椀に分ける。',
    ],
  }),

  occasionDish(['tanabata', 'summer'], {
    id: 'tanabata-okra-chicken', name: '星オクラの鶏照り巻き', role: 'main', family: 'meat-main',
    category: 'meat', method: 'grill', genre: '和食', minutes: 30,
    ingredients: [['chicken_breast', 260], ['okra', 80], ['starch', 8], ['oil', 5], ['soy_sauce', 12], ['mirin', 16], ['sake', 10], ['water', 30]],
    steps: [
      'オクラはがくの硬い部分を削り、さっとゆでて水気を拭く。鶏むね肉は厚みを開いて薄い長方形に整える。',
      '肉をオクラが巻ける幅に分け、片栗粉の半量を振ってオクラを並べる。手前から巻き、外側に残りの粉を薄く付ける。',
      '油をひいたフライパンに巻き終わりを下にして置き、動かさず焼いてから転がす。水と酒を注ぎ、ふたをして中心まで十分蒸し焼きにする。',
      'しょうゆとみりんを絡め、少し休ませて清潔な包丁で輪切りにする。オクラの星形の断面を見せて盛る。',
    ],
  }),
  occasionDish(['tanabata', 'summer'], {
    id: 'tanabata-seabream-galaxy', name: '鯛の天の川蒸し 夏野菜の帯仕立て', role: 'main', family: 'fish-main',
    category: 'fish', method: 'steam', genre: '和食', minutes: 25,
    ingredients: [['seabream_sashimi', 210], ['zucchini', 100], ['carrot', 45], ['ginger', 4], ['sake', 14], ['soup311_awase_dashi', 110], ['kyoto_usukuchi', 5], ['starch', 3], ['water', 8]],
    steps: [
      '鯛は厚めにそぎ切りにする。ズッキーニとにんじんをピーラーで細長い帯状に削り、しょうがは細いせん切りにする。',
      '耐熱皿に鯛と野菜の帯を交互に置き、川が流れるように少しずつ向きを変える。しょうがをのせて酒を振る。',
      '蒸し器で8〜12分、野菜がしなやかになり鯛が中心までほぐれるまで蒸す。',
      'だしと薄口しょうゆを温め、水溶き片栗粉を加えてひと煮立ちさせる。蒸し皿の汁を合わせ、鯛と野菜にかける。',
    ],
  }),
  occasionDish(['tanabata', 'summer', 'child-friendly'], {
    id: 'tanabata-rainbow-salad', name: '七夕の五色短冊サラダ', role: 'side', family: 'side',
    category: 'vegetable', method: 'salad', genre: '和食', minutes: 20,
    ingredients: [['cucumber', 70], ['carrot', 45], ['daikon', 60], ['paprika', 55], ['egg', 1], ['oil', 3], ['vinegar', 13], ['sugar', 4], ['sesame_oil', 4], ['salt', 0.6]],
    steps: [
      'きゅうり、にんじん、大根、赤パプリカを短い短冊切りにする。にんじんをさっとゆでて水気を切る。',
      '卵を溶き、油をひいたフライパンに薄く流す。両面を焼いて中まで固め、粗熱が取れたら同じ短冊形に切る。',
      '米酢、砂糖、ごま油、塩を混ぜ、野菜をそれぞれ少量ずつ和える。',
      '緑、橙、白、赤、黄を混ぜ込まずに列をずらして盛る。残りのたれを卵と野菜に少しずつかける。',
    ],
  }),
  occasionDish(['tanabata', 'summer'], {
    id: 'tanabata-somen-star', name: '星オクラとそうめんの天の川すまし汁', role: 'soup', family: 'clear-soup',
    genre: '和食', minutes: 15,
    ingredients: [['somen', 35], ['okra', 55], ['carrot', 35], ['soup311_awase_dashi', 380], ['kyoto_usukuchi', 6], ['salt', 0.4], ['ginger', 2]],
    steps: [
      'にんじんを薄く切って星形に抜き、端は細く刻む。オクラはがくを整え、ゆでて星形の小口切りにする。',
      'そうめんは別の湯で表示時間どおりにゆで、水で洗ってざるに上げる。椀に分けやすい長さに切る。',
      'だしでにんじんと端を柔らかく煮て、薄口しょうゆと塩を加える。そうめんをさっと温める。',
      '椀にそうめんを細い帯のように流して置き、オクラとにんじんの星を散らす。熱い汁を注ぎ、おろししょうがを添える。',
    ],
  }),
];
