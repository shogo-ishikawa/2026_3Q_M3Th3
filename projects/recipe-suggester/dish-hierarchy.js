import {matchesJapaneseQuery,japaneseQueryRank} from './japanese-search.js';
import {CATALOG_CATEGORIES, FOOD_NATURES, recipeFamily, recipeNature} from './catalog.js';

/** 献立での役割とは別の、料理を探すための主な食材です。 */
export const FOOD_CATEGORIES = Object.freeze([
  ['meat', '肉'], ['fish', '魚介'], ['vegetable', '野菜・いも'],
  ['egg', '卵'], ['bean', '豆・豆腐'], ['mushroom', 'きのこ'],
  ['seaweed', '海藻'], ['dairy', '乳製品'], ['grain', '穀類・めん'],
  ['fruit', '果物'], ['other', 'その他'],
].map(([id, label]) => Object.freeze({id, label})));

/** 料理の形を表します。手作り・即席などの nature とは区別します。 */
export const COOKING_METHODS = Object.freeze([
  ['fried', '揚げ物'],
  ['sashimi', '刺身'], ['grill', '焼き物'], ['simmer', '煮物'],
  ['hotpot', '鍋料理'], ['stew', '煮込み'],
  ['meuniere', 'ムニエル'], ['stir-fry', '炒め物'], ['steam', '蒸し物'],
  ['boil', 'ゆで物'], ['dressed', '和え物'], ['salad', 'サラダ'],
  ['pickled', '酢の物・漬物'], ['cold', '冷菜'],
  ['other', 'その他'],
].map(([id, label]) => Object.freeze({id, label})));

const familyById = new Map(CATALOG_CATEGORIES.map(item => [item.id, item]));
const categoryById = new Map(FOOD_CATEGORIES.map(item => [item.id, item]));
const methodById = new Map(COOKING_METHODS.map(item => [item.id, item]));
// 料理名・旧ソースにある細分類は保ちながら、選択肢は一つにまとめます。
const friedDetails = new Map([
  ['karaage', '唐揚げ'], ['cutlet', 'フライ・カツ'],
  ['croquette', 'コロッケ'], ['fry', 'その他の揚げ物'],
]);
const normaliseMethod = method => friedDetails.has(method) ? 'fried' : method;
const natureById = new Map(FOOD_NATURES.map(item => [item.id, item]));
const sections = new Set(['main', 'side', 'staple', 'soup', 'drink', 'snack']);
const normalise = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
const isDish = section => section === 'main' || section === 'side';

// 主菜・副菜を料理ごとに確認した対応表です。材料やしょうゆ等の原料から
// 主材料を推測せず、既存の family・role・ID や保存データも変更しません。
// 旧 role=main の麺・丼も監査に含みますが、表示先は dishSection が優先です。
const auditedRows = [
  ["chicken-teriyaki", "meat", "grill"], // 鶏の照り焼き
  ["chicken-tomato", "meat", "stew", "vegetable"], // 鶏肉と野菜のトマト煮
  ["chicken-steam", "meat", "steam", "vegetable"], // 鶏むね肉と白菜の蒸し煮
  ["chicken-salt-lemon", "meat", "grill"], // 鶏肉の塩レモン焼き
  ["chicken-cashew", "meat", "stir-fry", "vegetable"], // 鶏肉とカシューナッツ炒め
  ["chicken-miso", "meat", "grill"], // 鶏肉のみそ焼き
  ["chicken-curry-yogurt", "meat", "grill"], // 鶏肉のヨーグルトカレー焼き
  ["chicken-meatball", "meat", "grill"], // 鶏つくね
  ["chicken-oyako", "meat", "simmer", "egg"], // しっかり火を通す親子煮
  ["chicken-rice-flour", "meat", "grill"], // 鶏むね肉の米粉焼き
  ["chicken-broccoli", "meat", "stir-fry", "vegetable"], // 鶏肉とブロッコリーの炒め物
  ["chicken-lotus", "meat", "grill", "vegetable"], // 鶏ひき肉とれんこんの重ね焼き
  ["pork-ginger", "meat", "grill", "vegetable"], // 豚のしょうが焼き
  ["pork-cabbage", "meat", "stir-fry", "vegetable"], // 豚肉とキャベツのみそ炒め
  ["pork-vinegar", "meat", "stir-fry", "vegetable"], // 揚げない酢豚
  ["pork-daikon", "meat", "simmer", "vegetable"], // 豚肉と大根の煮物
  ["pork-beansprout", "meat", "steam", "vegetable"], // 豚肉ともやしの蒸し焼き
  ["pork-meatball", "meat", "simmer"], // 肉団子の甘酢あん
  ["pork-roll", "meat", "grill", "vegetable"], // 豚肉のいんげん巻き
  ["pork-salt-cabbage", "meat", "stir-fry", "vegetable"], // 豚肉と白菜のしょうが塩炒め
  ["pork-aubergine", "meat", "stir-fry", "vegetable"], // なすと豚肉のしょうゆ炒め
  ["pork-tofu", "bean", "stir-fry", "vegetable", "meat"], // 豚肉入り炒り豆腐
  ["beef-onion", "meat", "simmer", "vegetable"], // 牛肉と玉ねぎの甘辛煮
  ["beef-pepper", "meat", "stir-fry", "vegetable"], // 牛肉とピーマンの細切り炒め
  ["beef-potato", "meat", "simmer", "vegetable"], // 牛肉の肉じゃが
  ["beef-tomato", "meat", "stew", "vegetable", "mushroom"], // 牛肉とトマトの煮込み
  ["beef-hamburg", "meat", "grill"], // 卵を使わない牛肉ハンバーグ
  ["beef-burdock", "meat", "simmer", "vegetable"], // 牛肉とごぼうのしぐれ煮
  ["beef-broccoli", "meat", "stir-fry", "vegetable"], // 牛肉とブロッコリーのにんにく炒め
  ["salmon-foil", "fish", "steam", "vegetable", "mushroom"], // さけときのこの包み蒸し
  ["salmon-miso", "fish", "steam", "vegetable"], // さけとキャベツのみそ蒸し
  ["salmon-milk", "fish", "simmer", "vegetable", "dairy"], // さけと小松菜のミルク煮
  ["salmon-lemon", "fish", "grill"], // さけのレモンソテー
  ["mackerel-miso", "fish", "simmer"], // さばのみそ煮
  ["mackerel-tomato", "fish", "simmer", "vegetable"], // さばのトマト煮
  ["cod-salt-steam", "fish", "steam", "vegetable"], // たらと白菜の塩蒸し
  ["cod-sweet-vinegar", "fish", "grill", "vegetable"], // たらの野菜甘酢あん
  ["cod-potato", "fish", "stew", "vegetable"], // たらとじゃがいもの煮込み
  ["horse-mackerel-pan", "fish", "grill"], // あじの米粉焼き
  ["sardine-ginger", "fish", "simmer"], // いわしのしょうが煮
  ["tuna-cube", "fish", "grill"], // まぐろのしょうゆ焼き
  ["shrimp-chilli", "fish", "stir-fry", "vegetable"], // えびのトマトチリ炒め
  ["shrimp-egg", "fish", "stir-fry", "egg"], // えびと卵の炒め物
  ["squid-pepper", "fish", "stir-fry", "vegetable"], // いかとパプリカの炒め物
  ["scallop-broccoli", "fish", "stir-fry", "vegetable"], // ほたてとブロッコリーの塩炒め
  ["tofu-steak", "bean", "grill", "mushroom"], // 豆腐ステーキのきのこあん
  ["tofu-mapo", "bean", "simmer", "meat"], // 豆腐と豚肉の辛くない麻婆豆腐
  ["tofu-vegetable", "bean", "stir-fry", "vegetable"], // 豆腐と野菜の塩炒め
  ["tofu-burger", "bean", "grill", "meat"], // 豆腐と鶏肉のハンバーグ
  ["soybeans-tomato", "bean", "stew", "vegetable"], // 大豆と野菜のトマト煮
  ["tofu-egg", "bean", "simmer", "egg"], // 豆腐と卵のそぼろ煮
  ["omelette-vegetable", "egg", "grill", "vegetable"], // 野菜入り厚焼き卵
  ["egg-potato", "egg", "grill", "vegetable"], // じゃがいものスペイン風オムレツ
  ["egg-tomato", "egg", "stir-fry", "vegetable"], // トマトと卵の炒め物
  ["crab-omelette", "egg", "grill", "fish"], // かに入り卵焼き
  ["chicken-rice-bowl", "grain", "simmer", "egg", "meat"], // 鶏そぼろ丼
  ["beef-rice-bowl", "grain", "simmer", "meat"], // 牛丼
  ["pork-rice-bowl", "grain", "simmer", "meat"], // 豚肉と小松菜の丼
  ["egg-fried-rice", "grain", "stir-fry", "vegetable", "bean", "egg"], // 卵と野菜のチャーハン
  ["salmon-fried-rice", "grain", "other", "vegetable", "fish"], // さけと小松菜の混ぜご飯
  ["tomato-chicken-curry", "grain", "simmer", "meat"], // ルウを使わないチキンカレー
  ["minced-dry-curry", "grain", "simmer", "vegetable", "meat"], // 野菜たっぷりドライカレー
  ["tofu-rice-bowl", "grain", "simmer", "mushroom", "bean"], // 豆腐ときのこのあんかけ丼
  ["tofu-natto-rice", "grain", "simmer", "bean"], // 納豆豆腐の温かい丼
  ["pasta-meat", "grain", "boil", "meat"], // 野菜入りミートソーススパゲティ
  ["pasta-shrimp", "grain", "boil", "fish"], // えびとトマトのスパゲティ
  ["pasta-mushroom", "grain", "boil", "mushroom", "bean"], // きのこの和風スパゲティ
  ["pasta-milk-salmon", "grain", "boil", "fish", "dairy"], // さけとほうれん草のミルクパスタ
  ["udon-pork", "grain", "stir-fry", "vegetable", "meat"], // 豚肉と野菜の焼きうどん
  ["udon-egg", "grain", "boil", "vegetable", "egg"], // 卵と小松菜の温うどん
  ["soba-chicken", "grain", "boil", "meat"], // 鶏肉とねぎの温そば
  ["rice-egg-omelette", "grain", "grill", "egg", "meat"], // しっかり焼くオムライス
  ["rice-baked-cheese", "grain", "grill", "bean", "dairy"], // 野菜と豆腐の焼きカレーご飯
  ["chicken-sandwich", "grain", "grill", "vegetable", "meat"], // 鶏肉とキャベツの温サンド
  ["pork-cabbage-roll", "meat", "simmer", "vegetable"], // 白菜の肉巻き煮
  ["pork-chive-egg", "meat", "simmer", "vegetable", "egg"], // 豚肉とにらの卵とじ
  ["chicken-root-simmer", "meat", "simmer", "vegetable"], // 鶏肉と根菜の筑前煮風
  ["chicken-nanban-pickle", "meat", "grill", "vegetable"], // 鶏肉と彩り野菜の南蛮漬け
  ["chicken-tofu-pot", "meat", "hotpot", "vegetable", "bean"], // 鶏肉と豆腐の塩鍋
  ["tofu-dried-simmer", "bean", "simmer", "vegetable", "mushroom"], // 高野豆腐と野菜の煮物
  ["okara-vegetable-patty", "bean", "grill", "vegetable"], // おからと野菜のもち焼き
  ["soy-hijiki-patty", "bean", "grill", "seaweed"], // 大豆とひじきのつくね焼き
  ["clam-sake-steam", "fish", "steam"], // あさりの酒蒸し
  ["squid-daikon-simmer", "fish", "simmer", "vegetable"], // いかと大根の煮物
  ["cod-fishball", "fish", "simmer", "vegetable", "bean"], // たらのつみれと野菜の煮物
  ["mackerel-curry-roast", "fish", "grill", "vegetable"], // さばと根菜のカレー焼き
  ["cod-cheese-bake", "fish", "grill", "vegetable", "dairy"], // たらとトマトのチーズ焼き
  ["seafood-okonomiyaki", "grain", "grill", "vegetable", "egg", "fish"], // 海鮮とキャベツのお好み焼き
  ["soy-taco-rice", "grain", "stir-fry", "vegetable", "bean"], // 大豆そぼろのタコライス風
  ["chicken-pilaf", "grain", "stir-fry", "meat"], // 鶏肉と野菜のフライパンピラフ風
  ["soy-milk-risotto", "grain", "simmer", "mushroom", "bean"], // きのこと豆乳のリゾット風
  ["egg-tofu-porridge", "grain", "simmer", "bean", "egg"], // 卵と豆腐の雑炊
  ["savoury-french-toast", "grain", "grill", "vegetable", "egg", "dairy"], // 野菜とチーズの甘くないフレンチトースト
  ["rice-flour-chijimi", "grain", "grill", "vegetable"], // 米粉の野菜チヂミ
  ["pork-stuffed-pepper", "meat", "grill", "vegetable"], // ピーマンの肉詰め
  ["tofu-sesame-crust", "bean", "grill"], // 豆腐のごま衣焼き
  ["breakfast-tomato-scramble", "egg", "stir-fry", "vegetable", "dairy"], // トマトとチーズのスクランブルエッグ
  ["breakfast-spinach-omelette", "egg", "grill", "vegetable", "mushroom"], // ほうれん草ときのこの朝オムレツ
  ["breakfast-tofu-scramble", "bean", "stir-fry", "vegetable"], // 豆腐とコーンのカレースクランブル
  ["breakfast-lentil-potato", "bean", "stew", "vegetable"], // レンズ豆とじゃがいもの朝煮込み
  ["breakfast-cheese-mushroom-egg", "egg", "grill", "mushroom", "dairy"], // きのことチーズの包まない卵焼き
  ["breakfast-salmon-spinach", "fish", "steam", "vegetable"], // さけとほうれん草の朝蒸し
  ["breakfast-chicken-cabbage", "meat", "simmer", "vegetable", "bean"], // 鶏むね肉とキャベツの豆乳煮
  ["breakfast-chickpea-toast", "grain", "grill", "vegetable", "bean"], // ひよこ豆とトマトのオープントースト
  ["breakfast-egg-sandwich", "grain", "grill", "egg"], // 火を通した卵のホットサンド
  ["breakfast-oat-egg", "grain", "simmer", "egg"], // 卵と青菜のオートミール雑炊
  ["breakfast-banana-pancake", "grain", "grill", "fruit"], // バナナとオートミールのパンケーキ
  ["breakfast-sardine-tomato", "fish", "stew", "bean"], // いわしと白いんげん豆のトマト煮
  ["breakfast-pork-pumpkin", "meat", "steam", "vegetable"], // 豚肉とかぼちゃのしょうが蒸し
  ["breakfast-tofu-broccoli", "bean", "grill", "vegetable", "dairy"], // 豆腐とブロッコリーのミルクグラタン
  ["breakfast-shrimp-pea", "fish", "stir-fry", "vegetable", "egg"], // えびとグリーンピースの卵炒め
  ["daily-snack-oven-karaage", "meat", "karaage"], // 唐揚げ（オーブン調理）
  ["classic-karaage-thigh", "meat", "karaage"], // 鶏もも肉の唐揚げ
  ["classic-karaage-breast", "meat", "karaage"], // 鶏むね肉の唐揚げ
  ["classic-karaage-salt", "meat", "karaage"], // 鶏むね肉の塩唐揚げ
  ["classic-grilled-salmon", "fish", "grill"], // 鮭の塩焼き
  ["classic-grilled-mackerel", "fish", "grill"], // さばの塩焼き
  ["classic-grilled-hokke", "fish", "grill"], // ほっけの開き焼き
  ["classic-grilled-aji", "fish", "grill"], // あじの塩焼き
  ["classic-grilled-saury", "fish", "grill"], // さんまの塩焼き
  ["classic-grilled-shishamo", "fish", "grill"], // ししゃもの焼き物
  ["classic-sashimi-tuna", "fish", "sashimi"], // まぐろ赤身の刺身
  ["classic-sashimi-tuna-mediumfat", "fish", "sashimi"], // まぐろ中トロの刺身
  ["classic-sashimi-salmon", "fish", "sashimi"], // サーモンの刺身
  ["classic-sashimi-yellowtail", "fish", "sashimi"], // ぶりの刺身
  ["classic-sashimi-seabream", "fish", "sashimi"], // たいの刺身
  ["classic-sashimi-bonito", "fish", "sashimi"], // かつおの刺身
  ["classic-sashimi-aji", "fish", "sashimi"], // あじの刺身
  ["classic-sashimi-squid", "fish", "sashimi"], // いかの刺身
  ["classic-sashimi-octopus", "fish", "sashimi"], // ゆでだこの刺身
  ["classic-sashimi-scallop", "fish", "sashimi"], // ほたての刺身
  ["classic-sashimi-assorted", "fish", "sashimi"], // 刺身の盛り合わせ
  ["classic-omelette-plain", "egg", "grill"], // プレーンオムレツ
  ["classic-omelette-cheese", "egg", "grill", "dairy"], // チーズオムレツ
  ["classic-omelette-spinach", "egg", "grill", "vegetable"], // ほうれん草のオムレツ
  ["classic-omelette-bacon", "egg", "grill", "meat"], // ベーコンオムレツ
  ["classic-tamagoyaki", "egg", "grill"], // 卵焼き
  ["classic-dashimaki", "egg", "grill"], // だし巻き卵
  ["classic-boiled-egg", "egg", "boil"], // ゆで卵
  ["classic-fried-egg", "egg", "grill"], // 目玉焼き
  ["classic-scrambled-egg", "egg", "stir-fry"], // スクランブルエッグ
  ["classic-natto-plain", "bean", "cold"], // 納豆
  ["classic-natto-grated-daikon", "bean", "cold", "vegetable"], // おろし納豆
  ["classic-croquette-potato", "vegetable", "croquette", "meat"], // じゃがいものコロッケ
  ["classic-croquette-pumpkin", "vegetable", "croquette"], // かぼちゃのコロッケ
  ["classic-croquette-cream", "dairy", "croquette", "vegetable"], // コーンクリームコロッケ
  ["classic-menchi", "meat", "cutlet"], // メンチカツ
  ["classic-tonkatsu", "meat", "cutlet"], // とんかつ
  ["classic-chicken-katsu", "meat", "cutlet"], // チキンカツ
  ["classic-aji-fry", "fish", "cutlet"], // アジフライ
  ["classic-hamburg", "meat", "grill"], // 合いびきハンバーグ
  ["classic-chicken-nanban", "meat", "fry", "egg"], // チキン南蛮
  ["classic-meatballs-teriyaki", "meat", "simmer"], // 肉団子の照り煮
  ["classic-gyoza", "meat", "grill"], // 焼き餃子
  ["classic-shumai", "meat", "steam"], // 蒸しシュウマイ
  ["classic-chicken-plum-shiso", "meat", "grill"], // 鶏むね肉の梅しそ焼き
  ["classic-chicken-negi-salt", "meat", "stir-fry", "vegetable"], // 鶏肉と長ねぎの塩炒め
  ["classic-pork-mushroom-steam", "meat", "steam", "vegetable", "mushroom"], // 豚肉ときのこのしょうが蒸し
  ["classic-beef-tofu-sukini", "meat", "simmer", "bean"], // 牛肉と豆腐のすき煮
  ["classic-pork-potato-curry", "meat", "stir-fry", "vegetable"], // 豚肉とじゃがいものカレー炒め
  ["classic-chicken-lotus-sweet-sour", "meat", "stir-fry", "vegetable"], // 鶏肉とれんこんの甘酢炒め
  ["classic-pork-cabbage-millefeuille", "meat", "steam", "vegetable"], // 豚肉と白菜の重ね蒸し
  ["classic-koya-egg-simmer", "bean", "simmer", "vegetable", "mushroom", "egg"], // 高野豆腐の卵とじ
  ["classic-tofu-negi-miso", "bean", "grill"], // 豆腐のねぎみそ田楽
  ["classic-salmon-potato-miso-butter", "fish", "steam", "vegetable"], // 鮭とじゃがいものみそバター焼き
  ["classic-cod-komatsuna-ginger", "fish", "simmer", "vegetable"], // たらと小松菜のしょうが煮
  ["classic-mackerel-daikon-vinegar", "fish", "simmer", "vegetable"], // さばと大根の甘酢煮
  ["classic-shrimp-tofu-dumpling", "fish", "steam", "bean"], // えびと豆腐の蒸し団子
  ["classic-squid-cabbage-ginger", "fish", "stir-fry", "vegetable"], // いかとキャベツのしょうが炒め
  ["classic-pork-vermicelli", "meat", "simmer", "grain"], // 豚ひき肉と春雨の炒め煮
  ["classic-beef-pepper-tomato", "meat", "stir-fry", "vegetable"], // 牛肉とピーマンのトマト炒め
  ["classic-chicken-pumpkin-sesame", "meat", "grill", "vegetable"], // 鶏肉とかぼちゃのごま照り焼き
  ["classic-chicken-okara-lotus", "meat", "grill", "vegetable", "bean"], // おからとれんこんの鶏つくね
  ["classic-pork-nira-chijimi", "meat", "grill", "vegetable", "grain"], // 豚肉とにらの米粉チヂミ
  ["classic-natto-yam-pan-fry", "bean", "grill", "vegetable", "egg"], // 納豆と長いものふんわり焼き
  ["potato-pepper-strips", "vegetable", "stir-fry"], // じゃがいもとピーマンの細切り炒め
  ["kiriboshi-cucumber", "vegetable", "pickled"], // 切り干し大根ときゅうりのマリネ
  ["daikon-leaf-tofu", "vegetable", "simmer", "bean"], // 大根の葉と油揚げの炒め煮
  ["chickpea-carrot-lemon", "bean", "salad", "vegetable"], // ひよこ豆とにんじんのレモンサラダ
  ["sweet-potato-apple", "vegetable", "simmer", "fruit"], // さつまいもとりんごの重ね煮
  ["yam-shimeji-butter", "vegetable", "grill", "mushroom"], // 長いもとしめじのバター焼き
  ["carrot-pumpkin-mash", "vegetable", "boil"], // にんじんとかぼちゃのマッシュ
  ["aubergine-tomato-cold", "vegetable", "cold"], // 焼きなすとトマトの冷たい小鉢
  ["side-001", "vegetable", "dressed"], // ほうれん草のごま和え
  ["side-002", "vegetable", "simmer", "bean"], // 小松菜と豆腐のさっと煮
  ["side-003", "vegetable", "salad", "fruit"], // にんじんとオレンジのサラダ
  ["side-004", "vegetable", "pickled", "seaweed"], // きゅうりとわかめの酢の物
  ["side-005", "vegetable", "grill"], // 大根のしょうが焼き
  ["side-006", "vegetable", "dressed"], // キャベツの梅おかか和え
  ["side-007", "vegetable", "steam", "mushroom"], // ブロッコリーときのこの蒸し焼き
  ["side-008", "vegetable", "simmer"], // かぼちゃの含め煮
  ["side-009", "vegetable", "simmer"], // さつまいものレモン煮
  ["side-010", "vegetable", "stir-fry"], // いんげんのアーモンドソテー
  ["side-011", "vegetable", "grill"], // れんこんのごま照り焼き
  ["side-012", "vegetable", "stir-fry"], // ごぼうとにんじんのきんぴら
  ["side-013", "vegetable", "grill"], // なすの田楽みそ
  ["side-014", "vegetable", "dressed"], // オクラとトマトのおかか和え
  ["side-015", "vegetable", "pickled"], // かぶの甘酢漬け
  ["side-016", "vegetable", "grill", "dairy"], // ズッキーニのチーズ焼き
  ["side-017", "vegetable", "salad", "dairy"], // トマトとモッツァレラのサラダ
  ["side-018", "vegetable", "grill"], // じゃがいものガーリックロースト
  ["side-019", "vegetable", "stir-fry"], // カリフラワーのターメリック炒め
  ["side-020", "vegetable", "salad"], // ビーツのヨーグルトサラダ
  ["side-021", "bean", "salad", "vegetable"], // レンズ豆とセロリの温サラダ
  ["side-022", "mushroom", "pickled"], // きのこのレモンマリネ
  ["side-023", "vegetable", "simmer"], // キャベツとコーンのミルク煮
  ["side-024", "egg", "stir-fry", "vegetable"], // アスパラガスの炒り卵
  ["side-025", "bean", "simmer", "vegetable"], // グリーンピースとにんじんの蒸し煮
  ["side-026", "vegetable", "grill"], // パプリカのクミン焼き
  ["side-027", "bean", "dressed"], // 枝豆と豆腐のつぶし和え
  ["side-028", "vegetable", "dressed", "bean"], // ほうれん草とにんじんの白和え
  ["side-029", "seaweed", "simmer", "bean", "vegetable"], // ひじきと大豆の煮物
  ["side-030", "vegetable", "simmer", "mushroom"], // 切り干し大根の含め煮
  ["side-031", "vegetable", "grill"], // 里いものみそバター焼き
  ["side-032", "vegetable", "grill"], // 長いもの青ねぎ焼き
  ["side-033", "vegetable", "salad", "fruit"], // 大根とりんごのシャキシャキサラダ
  ["side-034", "vegetable", "dressed"], // 紫キャベツとレーズンの甘酢和え
  ["side-035", "bean", "stew", "vegetable"], // 赤いんげん豆のトマト煮
  ["side-036", "vegetable", "dressed"], // カリフラワーのヨーグルト和え
  ["side-037", "egg", "steam", "mushroom"], // きのこの茶わん蒸し
  ["side-038", "vegetable", "grill", "dairy"], // じゃがいものチーズおやき
  ["side-039", "vegetable", "grill", "egg"], // コーンの卵入りフリッター
  ["side-040", "vegetable", "stir-fry"], // もやしとにらの香味炒め
  ["side-041", "vegetable", "steam"], // 蒸しなすのしょうが酢だれ
  ["side-042", "bean", "simmer", "mushroom"], // 豆腐のきのこあん
  ["side-043", "bean", "stir-fry", "vegetable", "egg"], // ピーマンと豆腐の卵炒め
  ["side-044", "vegetable", "salad"], // にんじんとキャベツのコールスロー
  ["side-045", "bean", "dressed"], // ひよこ豆のごまペースト和え
  ["side-046", "vegetable", "dressed"], // ブロッコリーのごまレモン和え
  ["side-047", "vegetable", "stir-fry"], // 青菜とカシューナッツの炒め物
  ["side-048", "vegetable", "salad", "fruit"], // アボカドとトマトのつぶしサラダ
  ["side-049", "vegetable", "salad"], // じゃがいもときゅうりのヨーグルトサラダ
  ["side-050", "vegetable", "stew"], // 野菜のラタトゥイユ
  ["side-051", "vegetable", "simmer", "meat"], // 冬瓜の鶏そぼろあん
  ["side-052", "vegetable", "pickled"], // 焼きトマトのハーブマリネ
  ["side-053", "vegetable", "grill", "bean"], // じゃがいもとほうれん草の豆乳グラタン
  ["side-054", "fish", "dressed", "vegetable"], // きゅうりといかの酢みそ和え
  ["side-055", "vegetable", "fry"], // ごぼうのカリカリ揚げ
  ["side-056", "vegetable", "stir-fry"], // ゴーヤのおかか炒め
  ["side-057", "vegetable", "grill", "bean"], // かぼちゃとひよこ豆のコロッケ風
  ["side-058", "vegetable", "grill"], // カリフラワーのくるみ衣焼き
  ["side-059", "vegetable", "simmer", "fruit"], // 紫キャベツとりんごの蒸し煮
  ["side-060", "vegetable", "simmer"], // オクラのしょうが煮
  ["snack-edamame", "bean", "boil"], // ゆで枝豆（薄塩）
  ["snack-pumpkin", "vegetable", "steam"], // かぼちゃの甘み蒸し
  ["snack-cheese-tomato", "dairy", "cold", "vegetable"], // チーズと一口トマト
  ["snack-soybean", "bean", "dressed"], // ゆで大豆のごま和え
  ["snack-sesame-potato", "vegetable", "grill"], // さつまいものごま焼き
  ["breakfast-natto-okra", "bean", "cold", "vegetable"], // 納豆とオクラの冷ややっこ
  ["calendar-side-carrot-raisin", "vegetable", "dressed"], // にんじんとレーズンのレモン和え
  ["calendar-side-broccoli-corn", "vegetable", "dressed"], // ブロッコリーとコーンのヨーグルト和え
  ["calendar-side-komatsuna-walnut", "vegetable", "dressed"], // 小松菜のくるみ和え
  ["calendar-side-cucumber-chickpea", "vegetable", "dressed", "bean"], // きゅうりとひよこ豆のさっぱり和え
  ["calendar-side-aubergine-sesame", "vegetable", "simmer", "bean"], // なすのごま豆乳煮
  ["calendar-side-lotus-edamame", "vegetable", "stir-fry", "bean"], // れんこんと枝豆の塩炒め
  ["calendar-side-tomato-bean", "vegetable", "dressed", "bean"], // トマトと白いんげん豆のバジル和え
  ["calendar-side-pumpkin-almond", "vegetable", "salad"], // かぼちゃとアーモンドの温サラダ
  ["calendar-side-cabbage-apple", "vegetable", "salad", "fruit"], // キャベツとりんごのレモンサラダ
  ["calendar-side-okra-corn", "vegetable", "dressed"], // オクラとコーンの梅和え
  ["calendar-side-mushroom-beans", "mushroom", "stir-fry", "bean", "vegetable"], // きのこと大豆のトマトソテー
  ["calendar-side-turnip-leaf", "vegetable", "steam"], // かぶと小松菜の蒸し和え
  ["daily-snack-bacon-cheese-roll", "meat", "grill", "dairy"], // ベーコンチーズ巻き
  ["classic-side-hiyayakko", "bean", "cold"], // 冷奴（薬味）
  ["classic-side-shirasu-tofu", "bean", "cold", "fish"], // しらすの冷奴
  ["classic-side-okra-tofu", "bean", "cold", "vegetable"], // オクラの冷奴
  ["classic-side-ume-tofu", "bean", "cold"], // 梅しそ冷奴
  ["classic-side-unohana", "bean", "simmer", "vegetable", "mushroom"], // 卯の花（おから煮）
  ["classic-side-hijiki-aburaage", "seaweed", "simmer", "bean", "vegetable"], // ひじきと油揚げの煮物
  ["classic-side-potato-salad", "vegetable", "salad", "egg"], // ポテトサラダ（家庭用）
  ["classic-side-egg-salad", "egg", "salad"], // 卵サラダ
  ["classic-side-macaroni-salad", "grain", "salad", "vegetable"], // マカロニサラダ
  ["classic-side-vermicelli-salad", "grain", "salad", "vegetable", "egg"], // 春雨サラダ
  ["classic-side-cucumber-sunomono", "vegetable", "pickled"], // きゅうりの酢の物
  ["classic-side-mozuku-vinegar", "seaweed", "pickled", "vegetable"], // もずく酢
  ["classic-side-mekabu", "seaweed", "cold"], // めかぶの小鉢
  ["classic-side-taro-simmered", "vegetable", "simmer"], // 里芋の含め煮
  ["classic-side-bamboo-tosa", "vegetable", "simmer"], // たけのこの土佐煮
  ["classic-side-daikon-konjac", "vegetable", "simmer", "other"], // 大根とこんにゃくの煮物
  ["classic-side-gomoku-beans", "bean", "simmer", "vegetable", "mushroom", "other"], // 五目煮豆
  ["classic-side-komatsuna-ohitashi", "vegetable", "dressed"], // 小松菜のお浸し
  ["classic-side-spinach-ohitashi", "vegetable", "dressed"], // ほうれん草のお浸し
  ["classic-side-carrot-shirishiri", "vegetable", "stir-fry", "egg"], // にんじんしりしり
  ["classic-side-aubergine-nibitashi", "vegetable", "simmer"], // なすの煮浸し
  ["classic-side-cabbage-pickle", "vegetable", "pickled"], // キャベツの浅漬け
  ["classic-side-hakusai-pickle", "vegetable", "pickled"], // 白菜の浅漬け
  ["classic-side-cucumber-pickle", "vegetable", "pickled"], // きゅうりの浅漬け
  ["classic-side-smashed-cucumber", "vegetable", "dressed"], // たたききゅうり（ごま油）
  ["classic-side-chilled-tomato", "vegetable", "cold"], // 冷やしトマト（和風）
  ["classic-side-octopus-cucumber", "fish", "pickled", "vegetable", "seaweed"], // たこときゅうりの酢の物
  ["classic-side-potato-soboro", "vegetable", "simmer", "meat"], // じゃがいものそぼろ煮
  ["classic-side-koya-tofu", "bean", "simmer", "vegetable", "mushroom"], // 高野豆腐の含め煮
  ["classic-side-burdock-konjac", "vegetable", "stir-fry", "other"], // ごぼうとこんにゃくの炒り煮
  ["classic-side-bean-sprout-namul", "vegetable", "dressed"], // もやしのナムル
  ["classic-side-carrot-namul", "vegetable", "dressed"], // にんじんのナムル
  ["classic-side-spinach-namul", "vegetable", "dressed"], // ほうれん草のナムル
  ["classic-side-namasu", "vegetable", "pickled"], // 大根とにんじんのなます
  ["classic-side-broccoli-bonito", "vegetable", "dressed"], // ブロッコリーのおかか和え
  ["classic-side-nameko-oroshi", "mushroom", "dressed", "vegetable"], // なめこのおろし和え
  ["classic-side-spinach-egg", "vegetable", "simmer", "egg"], // ほうれん草の卵とじ
  ["classic-side-edamame-ginger", "bean", "dressed"], // 枝豆のしょうが浸し
  ["classic-side-pumpkin-soboro", "vegetable", "simmer", "meat"], // かぼちゃのそぼろ煮
  ["classic-side-tofu-dengaku", "bean", "boil", "other"], // 豆腐とこんにゃくの田楽
  ["classic-side-asparagus-enoki", "vegetable", "steam", "mushroom"], // アスパラガスとえのきのレモン蒸し
  ["classic-side-lotus-soy-curry", "vegetable", "salad", "bean"], // れんこんと大豆のカレーサラダ
  ["classic-side-paprika-bean-marinade", "vegetable", "pickled", "bean"], // パプリカと白いんげん豆のマリネ
  ["classic-side-carrot-cumin-yogurt", "vegetable", "dressed"], // 蒸しにんじんのクミンヨーグルト和え
  ["classic-side-zucchini-chickpea", "vegetable", "stew", "bean"], // ズッキーニとひよこ豆のトマト煮
  ["classic-side-komatsuna-peanut-egg", "vegetable", "stir-fry", "egg"], // 小松菜と卵のピーナッツ炒め
  ["classic-side-taro-mushroom-miso", "vegetable", "dressed", "mushroom"], // 里芋ときのこのごまみそ和え
  ["classic-side-cabbage-lentil", "vegetable", "salad", "bean"], // キャベツとレンズ豆の温サラダ
  ["classic-side-daikon-tuna", "vegetable", "salad", "fish"], // 大根とツナのしそサラダ
  ["classic-side-mushroom-konjac", "mushroom", "stir-fry", "other"], // きのことこんにゃくのしょうが炒め
];

const audited = new Map();
for (const [id, category, method, ...secondaryCategories] of auditedRows) {
  if (audited.has(id) || !categoryById.has(category) || !methodById.has(normaliseMethod(method)) ||
      secondaryCategories.some(value => !categoryById.has(value) || value === category) ||
      new Set(secondaryCategories).size !== secondaryCategories.length) {
    throw new Error(`料理の階層分類を確認してください: ${id}`);
  }
  audited.set(id, Object.freeze({category, method, secondaryCategories:Object.freeze(secondaryCategories)}));
}

/** family の正規の役割を使い、旧主菜扱いの麺や丼を主食のまま表示します。 */
export function dishSection(recipe) {
  return familyById.get(recipeFamily(recipe)).role;
}

function sourceClassification(recipe) {
  const keys = ['displayCategory', 'displayMethod', 'displaySecondaryCategories'];
  if (!keys.some(key => Object.hasOwn(recipe, key))) return undefined;
  const category = recipe.displayCategory, method = recipe.displayMethod;
  const secondaryCategories = recipe.displaySecondaryCategories === undefined ? [] : recipe.displaySecondaryCategories;
  if (!Object.hasOwn(recipe, 'displayCategory') || !Object.hasOwn(recipe, 'displayMethod') ||
      !categoryById.has(category) || !methodById.has(normaliseMethod(method)) || !Array.isArray(secondaryCategories) ||
      secondaryCategories.some(id => !categoryById.has(id) || id === category) ||
      new Set(secondaryCategories).size !== secondaryCategories.length) {
    throw new Error(`料理の表示用分類を確認してください: ${recipe.id ?? recipe.name ?? ''}`);
  }
  return {category, method, secondaryCategories};
}

/** 主材料は一つ、別の食材から探す入口は secondaryCategories に持ちます。 */
export function dishClassification(recipe) {
  const section = dishSection(recipe);
  // source 専用の表示情報です。保存形式や手入力の項目を増やしません。
  const entry = isDish(section) && recipe.custom !== true ? sourceClassification(recipe) ?? audited.get(recipe.id) : undefined;
  return {section, category:entry?.category ?? 'other',
    secondaryCategories:[...(entry?.secondaryCategories ?? [])], method:normaliseMethod(entry?.method ?? 'other'),
    ...(friedDetails.has(entry?.method) ? {methodDetail:entry.method} : {})};
}

function checkedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('料理を探す条件を確認してください。');
  const {section = 'all', category = 'all', method = 'all', query = '', nature = 'all'} = options ?? {};
  if ((section !== 'all' && !sections.has(section)) ||
      (category !== 'all' && !categoryById.has(category)) ||
      (method !== 'all' && !methodById.has(normaliseMethod(method))) ||
      (nature !== 'all' && !natureById.has(nature)) || typeof query !== 'string') {
    throw new Error('料理を探す条件を確認してください。');
  }
  return {section, category, method:normaliseMethod(method), query:normalise(query), nature};
}

function matchesQuery(recipe, classification, query) {
  if (!query) return true;
  const family = familyById.get(recipeFamily(recipe));
  const words = [recipe.name, recipe.variantLabel, family.label, natureById.get(recipeNature(recipe)).label,
    ...(recipe.tags ?? []), ...(recipe.searchAliases ?? []), ...(recipe.ingredients ?? []).map(part => part.name ?? part.id)];
  if (isDish(classification.section)) words.push(categoryById.get(classification.category).label,
    methodById.get(classification.method).label,
    friedDetails.get(classification.methodDetail) ?? '',
    ...classification.secondaryCategories.map(id => categoryById.get(id).label));
  return matchesJapaneseQuery(words, query);
}

/**
 * 条件をすべて満たす元レシピを一度ずつ返します。検索時は料理名との一致を優先し、
 * 同順位と検索語がない場合は元の順番を保ちます。
 * 主材料・調理法の指定時は主菜と副菜のみを対象にします。
 * secondaryCategories も食材カテゴリからの入口として扱います。
 */
export function browseDishes(recipes, options = {}) {
  if (!Array.isArray(recipes)) throw new Error('メニューの一覧を確認してください。');
  const selected = checkedOptions(options);
  const matched = recipes.filter(recipe => {
    const classification = dishClassification(recipe);
    if ((selected.category !== 'all' || selected.method !== 'all') && !isDish(classification.section)) return false;
    return (selected.section === 'all' || selected.section === classification.section) &&
      (selected.category === 'all' || classification.category === selected.category || classification.secondaryCategories.includes(selected.category)) &&
      (selected.method === 'all' || classification.method === selected.method) &&
      (selected.nature === 'all' || recipeNature(recipe) === selected.nature) &&
      matchesQuery(recipe, classification, selected.query);
  });
  if (!selected.query) return matched;
  return matched.map((recipe,index) => ({recipe,index,rank:japaneseQueryRank([recipe.name,recipe.variantLabel],selected.query)}))
    .sort((a,b) => a.rank - b.rank || a.index - b.index).map(({recipe}) => recipe);
}

/** 絞り込まれた主菜・副菜について、食材から入れる料理数を返します。 */
export function availableDishCategories(recipes, options = {}) {
  const counts = new Map();
  for (const recipe of browseDishes(recipes, options)) {
    const classification = dishClassification(recipe);
    if (!isDish(classification.section)) continue;
    for (const id of [classification.category, ...classification.secondaryCategories]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return FOOD_CATEGORIES.filter(item => counts.has(item.id)).map(item => ({...item, count:counts.get(item.id)}));
}

/** 食材や調理・提供形態などの条件に合う、調理法ごとの料理数を返します。 */
export function availableCookingMethods(recipes, options = {}) {
  const counts = new Map();
  for (const recipe of browseDishes(recipes, options)) {
    const classification = dishClassification(recipe);
    if (!isDish(classification.section)) continue;
    counts.set(classification.method, (counts.get(classification.method) ?? 0) + 1);
  }
  return COOKING_METHODS.filter(item => counts.has(item.id)).map(item => ({...item, count:counts.get(item.id)}));
}
