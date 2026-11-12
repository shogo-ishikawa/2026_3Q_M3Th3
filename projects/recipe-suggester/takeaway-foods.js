/** 即席スープ、惣菜、店内・持ち帰り料理の記録例。確認日: 2026-11-13。
 * 材料は2人分、portionとmanualNutritionは1人分です。
 * レシピは付けず、調製・再加熱は商品の表示に従います。
 */
const KEYS=Object.freeze(['kcal','protein','fat','carbs','fiber','salt']);
const CHECKED='2026-11-13';
const productNotice='商品名・規格・地域や時期によって原材料と栄養は変わります。実物の表示を優先してください。';
const PRODUCTS=[
  {
    "slug": "harusame-wonton",
    "name": "エースコック スープはるさめ ワンタン（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      78,
      1.3,
      1.1,
      16,
      0.4,
      2.1
    ],
    "source": "https://www.acecook.co.jp/products/001931/",
    "allergens": [
      "wheat",
      "egg",
      "milk",
      "sesame",
      "soy",
      "chicken",
      "pork"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝乾燥製品22gと湯220mlの全量",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "スープも含む1食分の表示値です。残したスープの割合は自動補正しません。",
    "water": 220
  },
  {
    "slug": "harusame-egg",
    "name": "エースコック スープはるさめ かきたま（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      70,
      1.4,
      0.5,
      15.1,
      0.2,
      1.7
    ],
    "source": "https://www.acecook.co.jp/products/001932/",
    "allergens": [
      "crab",
      "wheat",
      "egg",
      "milk",
      "soy"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝乾燥製品20gと湯220mlの全量",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "スープも含む1食分の表示値です。残したスープの割合は自動補正しません。",
    "water": 220
  },
  {
    "slug": "harusame-tantan",
    "name": "エースコック スープはるさめ 担担味（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      99,
      2.4,
      3.5,
      15,
      1,
      2.7
    ],
    "source": "https://www.acecook.co.jp/products/001933/",
    "allergens": [
      "wheat",
      "egg",
      "milk",
      "sesame",
      "soy",
      "chicken",
      "pork",
      "gelatin"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝乾燥製品31gと湯220mlの全量",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "スープも含む1食分の表示値です。残したスープの割合は自動補正しません。",
    "water": 220
  },
  {
    "slug": "harusame-wakame-vegetable",
    "name": "エースコック スープはるさめ わかめと野菜（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      72,
      1.3,
      0.5,
      15.9,
      0.9,
      1.8
    ],
    "source": "https://www.acecook.co.jp/products/002854/",
    "allergens": [
      "wheat",
      "milk",
      "sesame",
      "soy",
      "chicken",
      "pork"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝乾燥製品21gと湯220mlの全量",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "スープも含む1食分の表示値です。残したスープの割合は自動補正しません。",
    "water": 220
  },
  {
    "slug": "harusame-wakame-gomtang",
    "name": "エースコック スープはるさめ すごい！どっさりわかめ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      74,
      1.1,
      0.9,
      17.2,
      3.9,
      1.8
    ],
    "source": "https://www.acecook.co.jp/products/001889/",
    "allergens": [
      "wheat",
      "egg",
      "milk",
      "beef",
      "sesame",
      "soy",
      "chicken",
      "pork",
      "gelatin"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝乾燥製品23gと湯220mlの全量",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "スープも含む1食分の表示値です。残したスープの割合は自動補正しません。",
    "water": 220
  },
  {
    "slug": "knorr-corn",
    "name": "クノール カップスープ コーンクリーム（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      80,
      1.2,
      2.7,
      13,
      null,
      1
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_1",
    "allergens": [
      "wheat",
      "milk",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末18.6gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "knorr-potage",
    "name": "クノール カップスープ ポタージュ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      69,
      0.99,
      2.4,
      11,
      null,
      1.2
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_2",
    "allergens": [
      "wheat",
      "milk",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末16.5gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "knorr-mushroom",
    "name": "クノール カップスープ ミルク仕立てのきのこのポタージュ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      60,
      0.92,
      2.5,
      8.7,
      null,
      1.2
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_4",
    "allergens": [
      "wheat",
      "milk",
      "soy"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末14.2gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "knorr-spinach",
    "name": "クノール カップスープ チーズ仕立てのほうれん草のポタージュ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      61,
      1.3,
      3.2,
      6.9,
      null,
      1.2
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_5",
    "allergens": [
      "wheat",
      "milk",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末13.4gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "knorr-pumpkin",
    "name": "クノール カップスープ 栗かぼちゃのポタージュ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      82,
      0.9,
      2.9,
      13,
      null,
      1
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_6",
    "allergens": [
      "wheat",
      "milk",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末18.8gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "knorr-tomato",
    "name": "クノール カップスープ 完熟トマトまるごと1個分使ったポタージュ（即席）",
    "role": "soup",
    "family": "soup",
    "nutrients": [
      65,
      1.7,
      1.1,
      12,
      null,
      1
    ],
    "source": "https://www.ajinomoto.co.jp/products/detail/?ProductName=knorr_cup_7",
    "allergens": [
      "wheat",
      "milk",
      "soy"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "杯",
    "portionLabel": "1杯＝粉末17gの小袋1袋を表示どおり調製",
    "nature": "instant",
    "genre": "洋食",
    "purchasePerPortion": 1,
    "note": "粉末の小袋1袋当たりの表示値です。調製に使う湯の量は実物の包材で確認します。食物繊維は未表示です。"
  },
  {
    "slug": "tomato-unsalted",
    "name": "カゴメトマトジュース 食塩無添加",
    "role": "drink",
    "family": "juice",
    "nutrients": [
      39,
      1.8,
      0,
      8.7,
      null,
      null
    ],
    "source": "https://www.kagome.co.jp/products/drink/A2404/",
    "allergens": [],
    "purchaseUnit": "ml",
    "basisAmount": 200,
    "portionUnit": "ml",
    "portionLabel": "表示200ml当たり",
    "nature": "ready-to-eat",
    "genre": "その他",
    "purchasePerPortion": 200,
    "note": "食物繊維0.8〜2.3g、食塩相当量0〜0.18gは範囲表示のため不明にしています。"
  },
  {
    "slug": "tomato-low-salt",
    "name": "カゴメトマトジュース 低塩",
    "role": "drink",
    "family": "juice",
    "nutrients": [
      39,
      1.8,
      0,
      8.7,
      null,
      null
    ],
    "source": "https://www.kagome.co.jp/products/drink/A2402/",
    "allergens": [],
    "purchaseUnit": "ml",
    "basisAmount": 200,
    "portionUnit": "ml",
    "portionLabel": "表示200ml当たり",
    "nature": "ready-to-eat",
    "genre": "その他",
    "purchasePerPortion": 200,
    "note": "食物繊維0.8〜2.3g、食塩相当量0.31〜0.60gは範囲表示のため不明にしています。"
  },
  {
    "slug": "yakitori-momo-tare",
    "name": "焼鳥日本一 もも串（たれ）",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      94,
      6.9,
      5.7,
      2.8,
      null,
      0.6
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "wheat",
      "mackerel",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "yakitori-momo-salt",
    "name": "焼鳥日本一 塩もも串",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      84,
      6.7,
      5.7,
      0.6,
      null,
      0.3
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "chicken"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "yakitori-negima-tare",
    "name": "焼鳥日本一 ももねぎ串（たれ）",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      80,
      5.7,
      4.6,
      3.4,
      null,
      0.6
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "wheat",
      "mackerel",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "yakitori-tsukune-tare",
    "name": "焼鳥日本一 つくね串（たれ）",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      116,
      5.7,
      7.4,
      5.9,
      null,
      0.9
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "egg",
      "milk",
      "wheat",
      "mackerel",
      "soy",
      "chicken",
      "pork"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "yakitori-kawa-tare",
    "name": "焼鳥日本一 かわ串（たれ）",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      209,
      4,
      19.2,
      2.8,
      null,
      0.5
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "wheat",
      "mackerel",
      "soy",
      "chicken"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "yakitori-sunagimo-salt",
    "name": "焼鳥日本一 塩砂肝串",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      40,
      7.3,
      0.7,
      0.6,
      null,
      0.3
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "chicken"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "1本",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "焼鳥日本一の1本当たりの公表値です。小袋の追加たれは含めません。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  },
  {
    "slug": "eel-kabayaki",
    "name": "うなぎ日本一 うなぎ蒲焼（中串）",
    "role": "main",
    "family": "fish-main",
    "nutrients": [
      273,
      17.5,
      19.3,
      4.2,
      null,
      0.9
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "wheat",
      "soy"
    ],
    "purchaseUnit": "本",
    "basisAmount": 1,
    "portionUnit": "本",
    "portionLabel": "中串1串を1本として記録",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "「うなぎ日本一」欄の中串1串当たりの表示値です。ご飯は含みません。追加の小袋調味料は別です。",
    "foodCategory": "fish",
    "cookingMethod": "grill"
  },
  {
    "slug": "unaju",
    "name": "うなぎ日本一 うな重（中）",
    "role": "staple",
    "family": "donburi",
    "nutrients": [
      694,
      23.8,
      20.1,
      97.3,
      null,
      1.1
    ],
    "source": "https://www.nihonichi.jp/products/component",
    "allergens": [
      "wheat",
      "soy",
      "apple"
    ],
    "purchaseUnit": "食",
    "basisAmount": 1,
    "portionUnit": "食",
    "portionLabel": "うなぎ日本一の中サイズ1折（ご飯込み）",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "「焼鳥日本一」欄とは別の「うなぎ日本一」欄の中サイズを使用しています。ご飯込みで、別にご飯を足す必要はありません。"
  },
  {
    "slug": "shumai",
    "name": "崎陽軒 おいしさ長もち 昔ながらのシウマイ",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      32,
      1.7,
      1.6,
      2.8,
      null,
      0.2
    ],
    "source": "https://kiyoken.com/products/shiumai/nagamukashi.html",
    "allergens": [
      "wheat",
      "pork"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "1個",
    "nature": "ready-to-eat",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "公式の1個当たりの推定値です。添付調味料は別に確認してください。食物繊維は未表示です。",
    "foodCategory": "meat",
    "cookingMethod": "steam"
  },
  {
    "slug": "frozen-suigyoza",
    "name": "セブンプレミアム 水餃子（冷凍・12個入）",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "source": "https://7premium.jp/index.php/product/search/detail?id=12370",
    "allergens": [
      "pork",
      "soy"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "1個（12個入り1袋の12分の1）",
    "nature": "instant",
    "genre": "中華",
    "purchasePerPortion": 0.08333333333333333,
    "note": "公式ページで12個入りと主な原料は確認できますが、栄養表示は掲載されていないため全成分を未登録にしています。実物の表示を手入力で補えます。",
    "foodCategory": "meat",
    "cookingMethod": "boil"
  },
  {
    "slug": "spring-roll",
    "name": "セブン‐イレブン 五目春巻",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      131,
      2.1,
      8.5,
      11.9,
      0.6,
      0.6
    ],
    "source": "https://www.sej.co.jp/products/a/item/150631",
    "allergens": [
      "egg",
      "milk",
      "wheat",
      "sesame",
      "soy",
      "chicken",
      "pork"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "1個",
    "nature": "ready-to-eat",
    "genre": "中華",
    "purchasePerPortion": 1,
    "note": "掲載商品の1個分の参考値です。地域・規格の異なる商品へは流用しません。販売継続を保証するものではありません。",
    "foodCategory": "meat",
    "cookingMethod": "fried"
  },
  {
    "slug": "tempura-shrimp",
    "name": "てんや 海老の天ぷら（単品）",
    "role": "main",
    "family": "fish-main",
    "nutrients": [
      54,
      3.5,
      2,
      5.5,
      null,
      0.1
    ],
    "source": "https://www.tenya.co.jp/pdf/allergen-shop.pdf",
    "allergens": [
      "shrimp",
      "wheat"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "店内の単品1個（天つゆを除く）",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "2026年11月12日更新の公式表「店内メニュー・天ぷら（単品）」の値です。天つゆ・ご飯は含まず、お持ち帰り専用商品とは区別します。食物繊維は未表示です。",
    "foodCategory": "fish",
    "cookingMethod": "fried"
  },
  {
    "slug": "tempura-squid",
    "name": "てんや いかの天ぷら（単品）",
    "role": "main",
    "family": "fish-main",
    "nutrients": [
      58,
      3.3,
      3.2,
      4.1,
      null,
      0.1
    ],
    "source": "https://www.tenya.co.jp/pdf/allergen-shop.pdf",
    "allergens": [
      "squid",
      "wheat"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "店内の単品1個（天つゆを除く）",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "2026年11月12日更新の公式表「店内メニュー・天ぷら（単品）」の値です。天つゆ・ご飯は含まず、お持ち帰り専用商品とは区別します。食物繊維は未表示です。",
    "foodCategory": "fish",
    "cookingMethod": "fried"
  },
  {
    "slug": "tempura-maitake",
    "name": "てんや まいたけの天ぷら（単品）",
    "role": "side",
    "family": "small-dish",
    "nutrients": [
      68,
      0.9,
      4.4,
      6.6,
      null,
      0
    ],
    "source": "https://www.tenya.co.jp/pdf/allergen-shop.pdf",
    "allergens": [
      "wheat"
    ],
    "purchaseUnit": "個",
    "basisAmount": 1,
    "portionUnit": "個",
    "portionLabel": "店内の単品1個（天つゆを除く）",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "2026年11月12日更新の公式表「店内メニュー・天ぷら（単品）」の値です。天つゆ・ご飯は含まず、お持ち帰り専用商品とは区別します。食物繊維は未表示です。",
    "foodCategory": "mushroom",
    "cookingMethod": "fried"
  },
  {
    "slug": "beef-karubi",
    "name": "セブンプレミアム 牛カルビ焼き",
    "role": "main",
    "family": "meat-main",
    "nutrients": [
      226,
      8.6,
      19.8,
      3.9,
      1,
      0.8
    ],
    "source": "https://www.sej.co.jp/products/a/item/101220",
    "allergens": [
      "egg",
      "milk",
      "wheat",
      "beef"
    ],
    "purchaseUnit": "袋",
    "basisAmount": 1,
    "portionUnit": "袋",
    "portionLabel": "1袋",
    "nature": "ready-to-eat",
    "genre": "和食",
    "purchasePerPortion": 1,
    "note": "セブン‐イレブンの当該掲載商品の1包装分の参考値です。内容量・規格が異なる品へ流用せず、実物の表示を確認します。販売継続を保証するものではありません。",
    "foodCategory": "meat",
    "cookingMethod": "grill"
  }
];

// 一覧の料理名は店舗に依存しない表記にし、参照商品は出典だけに残します。
const RECORD_LABELS=Object.freeze({
  "yakitori-momo-tare": "焼き鳥・もも（たれ・テイクアウト）",
  "yakitori-momo-salt": "焼き鳥・もも（塩・テイクアウト）",
  "yakitori-negima-tare": "焼き鳥・ねぎま（たれ・テイクアウト）",
  "yakitori-tsukune-tare": "つくね串（たれ・テイクアウト）",
  "yakitori-kawa-tare": "焼き鳥・皮（たれ・テイクアウト）",
  "yakitori-sunagimo-salt": "焼き鳥・砂肝（塩・テイクアウト）",
  "eel-kabayaki": "うなぎの蒲焼き（テイクアウト・中串）",
  "unaju": "うな重（テイクアウト）",
  "shumai": "シュウマイ（惣菜）",
  "frozen-suigyoza": "水餃子（冷凍・12個入り）",
  "spring-roll": "五目春巻き（惣菜）",
  "tempura-shrimp": "えびの天ぷら（外食・単品）",
  "tempura-squid": "いかの天ぷら（外食・単品）",
  "tempura-maitake": "まいたけの天ぷら（外食・単品）",
  "beef-karubi": "牛カルビ焼き（惣菜）"
});
const recordName=product=>RECORD_LABELS[product.slug]??product.name;
const referenceNote=product=>RECORD_LABELS[product.slug]?`栄養値の参照商品：${product.name}。出典の商品を参考にした記録例で、同じ料理でも量や栄養は異なります。`:'';

export const TAKEAWAY_INGREDIENTS=Object.fromEntries(PRODUCTS.map(product=>[
  `takeaway_${product.slug.replaceAll('-','_')}`,
  {name:`${recordName(product)}（購入品）`,unit:product.purchaseUnit,allergens:product.allergens,
   groups:[],proteinSources:[],
   note:`購入する完成品の数量です。${referenceNote(product)}${productNotice}確認日${CHECKED}。${product.source}`},
]));

export const TAKEAWAY_RECIPES=PRODUCTS.map(product=>{
  const mainDish=product.role==='main'||product.role==='side';
  return {id:`takeaway-${product.slug}`,name:recordName(product),role:product.role,genre:product.genre,
    family:product.family,variantLabel:recordName(product),nature:product.nature,
    servings:2,minutes:product.nature==='instant'?5:2,
    ingredients:[{id:`takeaway_${product.slug.replaceAll('-','_')}`,amount:product.purchasePerPortion*2},
      ...(product.water?[{id:'water',amount:product.water*2}]:[])],
    portion:{amount:product.basisAmount,unit:product.portionUnit,label:product.slug==='unaju'?'中サイズ1折（ご飯込み）。出典の商品を基準にした記録例です。':product.portionLabel},
    staple:product.role==='staple',mealBase:product.role==='staple',processed:true,
    allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,
    tags:product.role==='staple'?[]:['時短'],steps:[],
    manualNutrition:Object.fromEntries(KEYS.map((key,index)=>[key,product.nutrients[index]])),
    ...(mainDish?{displayCategory:product.foodCategory,displayMethod:product.cookingMethod}:{}),
    sourceNote:`${referenceNote(product)}${product.note} ${productNotice}全原材料を登録したDBではないため、アレルギー確認済みや自動提案の候補とは扱いません。確認日${CHECKED}。出典: ${product.source}`,
  };
});
