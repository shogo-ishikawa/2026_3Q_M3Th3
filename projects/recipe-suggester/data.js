/** 献立候補の教材用データ。材料・分量・手順は本教材用に記述しています。 */
import { EXTRA_INGREDIENTS, EXPANDED_RECIPES } from './expanded-foods.js';
import { EVERYDAY_INGREDIENTS, EVERYDAY_RECIPES } from './everyday-foods.js';
import { CLASSIC_MAIN_INGREDIENTS, CLASSIC_MAIN_RECIPES } from './classics-mains.js';
import { CLASSIC_SIDE_INGREDIENTS, CLASSIC_SIDE_RECIPES } from './classics-sides.js';
import { PREPARED_INGREDIENTS, PREPARED_RECIPES } from './prepared-foods.js';
import { FAMILIAR_MAIN_INGREDIENTS, FAMILIAR_MAIN_RECIPES } from './familiar-mains.js';
import { FAMILIAR_SIDE_INGREDIENTS, FAMILIAR_SIDE_RECIPES } from './familiar-sides.js';
import { SUSHI_INGREDIENTS, SUSHI_RECIPES } from './sushi-foods.js';
import { PERFORMANCE_INGREDIENTS, PERFORMANCE_RECIPES } from './performance-foods.js';
import { TAKEAWAY_INGREDIENTS, TAKEAWAY_RECIPES } from './takeaway-foods.js';
import { VARIED_INGREDIENTS, VARIED_RECIPES } from './varied-recipes.js';
import { decorateCookingInstructions } from './cooking-instructions.js';
import { COMFORT_INGREDIENTS, COMFORT_RECIPES } from './comfort-foods.js';
import { CONFECTIONERY_INGREDIENTS, CONFECTIONERY_RECIPES } from './confectionery-foods.js';
import { DESSERT_INGREDIENTS, DESSERT_RECIPES } from './dessert-foods.js';
import { ACCOMPANIMENT_INGREDIENTS, ACCOMPANIMENT_RECIPES } from './accompaniment-foods.js';
import { SALAD_INGREDIENTS } from './salad-builder.js';
import { DISH_CUSTOM_INGREDIENTS } from './dish-customisation.js';
import { decorateRecipe } from './catalog-metadata.js';
import { INGREDIENT_NUTRITION } from './ingredient-nutrients.js';
import { PALETTE_INGREDIENTS, PALETTE_RECIPES } from './palette-foods.js';
import { MEAT_CHOICE_INGREDIENTS } from './meat-choice-foods.js';
import { MAPO_INGREDIENTS } from './mapo-nutrition.js';
import { MAPO_RECIPES } from './mapo-foods.js';

export const DATA_VERSION = '3.9.1';

// 2026年の消費者庁の表示対象。特定原材料9品目と推奨20品目。
export const ALLERGENS = [
  ['shrimp','えび','required'], ['cashew','カシューナッツ','required'],
  ['crab','かに','required'], ['walnut','くるみ','required'],
  ['wheat','小麦','required'], ['buckwheat','そば','required'],
  ['egg','卵','required'], ['milk','乳','required'], ['peanut','落花生','required'],
  ['almond','アーモンド','recommended'], ['abalone','あわび','recommended'],
  ['squid','いか','recommended'], ['salmon_roe','いくら','recommended'],
  ['orange','オレンジ','recommended'], ['kiwi','キウイフルーツ','recommended'],
  ['beef','牛肉','recommended'], ['sesame','ごま','recommended'],
  ['salmon','さけ','recommended'], ['mackerel','さば','recommended'],
  ['soy','大豆','recommended'], ['chicken','鶏肉','recommended'],
  ['banana','バナナ','recommended'], ['pistachio','ピスタチオ','recommended'],
  ['pork','豚肉','recommended'], ['macadamia','マカダミアナッツ','recommended'],
  ['peach','もも','recommended'], ['yam','やまいも','recommended'],
  ['apple','りんご','recommended'], ['gelatin','ゼラチン','recommended'],
].map(([id,label,category]) => ({id,label,category}));

// groupsは献立の構成を見るための区分です。栄養素の定量計算には使いません。
const ing = (name, unit, allergens, groups, proteinSources, note = '') =>
  ({name, unit, allergens, groups, proteinSources, ...(note ? {note} : {})});
export const INGREDIENTS = {
  chicken: ing('鶏肉（もも肉など）','g',['chicken'],['protein'],['meat']),
  chicken_breast: ing('鶏むね肉','g',['chicken'],['protein'],['meat']),
  chicken_minced: ing('鶏ひき肉','g',['chicken'],['protein'],['meat']),
  pork: ing('豚肉（薄切り）','g',['pork'],['protein'],['meat']),
  pork_minced: ing('豚ひき肉','g',['pork'],['protein'],['meat']),
  beef: ing('牛肉（薄切り）','g',['beef'],['protein'],['meat']),
  beef_minced: ing('牛ひき肉','g',['beef'],['protein'],['meat']),
  salmon: ing('生ざけ（無塩）','g',['salmon'],['protein'],['fish']),
  mackerel: ing('生さば（無塩）','g',['mackerel'],['protein'],['fish']),
  cod: ing('生たら（無塩）','g',[],['protein'],['fish']),
  horse_mackerel: ing('あじ（三枚おろし）','g',[],['protein'],['fish']),
  sardine: ing('いわし（開いたもの）','g',[],['protein'],['fish']),
  tuna: ing('まぐろ（加熱用）','g',[],['protein'],['fish']),
  shrimp: ing('むきえび','g',['shrimp'],['protein'],['fish']),
  squid: ing('いか（下処理済み）','g',['squid'],['protein'],['fish']),
  crab: ing('ゆでかに身','g',['crab'],['protein'],['fish']),
  scallop: ing('ほたて貝柱（加熱用）','g',[],['protein'],['fish']),
  clam: ing('あさり（砂抜き済み・殻付き）','g',[],['protein'],['fish']),
  egg: ing('卵','個',['egg'],['protein'],['egg']),
  tofu: ing('木綿豆腐','g',['soy'],['protein'],['soy']),
  silken_tofu: ing('絹ごし豆腐','g',['soy'],['protein'],['soy']),
  aburaage: ing('油揚げ','g',['soy'],['protein'],['soy'],'原材料が大豆・植物油の製品を想定。製品表示を確認。'),
  natto: ing('納豆（たれ・からしを除く）','g',['soy'],['protein'],['soy']),
  soybeans: ing('ゆで大豆（味付けなし）','g',['soy'],['protein'],['soy']),
  edamame: ing('枝豆（さやを除いたもの）','g',['soy'],['protein'],['soy']),
  milk: ing('牛乳','ml',['milk'],['dairy'],[]),
  yogurt: ing('プレーンヨーグルト（無糖）','g',['milk'],['dairy'],[]),
  cheese: ing('ナチュラルチーズ','g',['milk'],['dairy'],[],'加工チーズや調味済み製品に置き換える場合は表示を確認。'),
  butter: ing('バター','g',['milk'],[],[]),
  rice: ing('ご飯（炊飯済み）','g',[],['staple'],[]),
  pasta: ing('スパゲティ（乾）','g',['wheat'],['staple'],[]),
  udon: ing('うどん（ゆで）','g',['wheat'],['staple'],[]),
  soba: ing('そば（乾・小麦入り）','g',['buckwheat','wheat'],['staple'],[],'十割そばへの変更でも製品表示を確認。'),
  bread: ing('食パン（卵・乳・大豆を含む想定）','g',['wheat','egg','milk','soy'],['staple'],[],'パンは製品差が大きいため、卵・乳・大豆も含む条件で候補判定します。'),
  flour: ing('薄力粉','g',['wheat'],[],[]),
  rice_flour: ing('米粉（米のみ）','g',[],[],[]),
  starch: ing('片栗粉（ばれいしょでん粉）','g',[],[],[]),
  breadcrumbs: ing('パン粉（卵・乳・大豆を含む想定）','g',['wheat','egg','milk','soy'],[],[],'製品表示を確認。'),
  onion: ing('玉ねぎ','g',[],['vegetable'],[]),
  carrot: ing('にんじん','g',[],['vegetable'],[]),
  potato: ing('じゃがいも','g',[],['vegetable'],[]),
  sweet_potato: ing('さつまいも','g',[],['vegetable'],[]),
  cabbage: ing('キャベツ','g',[],['vegetable'],[]),
  chinese_cabbage: ing('白菜','g',[],['vegetable'],[]),
  spinach: ing('ほうれん草','g',[],['vegetable'],[]),
  komatsuna: ing('小松菜','g',[],['vegetable'],[]),
  broccoli: ing('ブロッコリー','g',[],['vegetable'],[]),
  cucumber: ing('きゅうり','g',[],['vegetable'],[]),
  tomato: ing('トマト','g',[],['vegetable'],[]),
  canned_tomato: ing('トマト缶（トマト・トマト果汁のみ）','g',[],['vegetable'],[],'調味済みソースを使う場合は製品表示を確認。'),
  daikon: ing('大根','g',[],['vegetable'],[]),
  pumpkin: ing('かぼちゃ','g',[],['vegetable'],[]),
  aubergine: ing('なす','g',[],['vegetable'],[]),
  pepper: ing('ピーマン','g',[],['vegetable'],[]),
  paprika: ing('パプリカ','g',[],['vegetable'],[]),
  zucchini: ing('ズッキーニ','g',[],['vegetable'],[]),
  lettuce: ing('レタス','g',[],['vegetable'],[]),
  bean_sprout: ing('緑豆もやし','g',[],['vegetable'],[]),
  green_beans: ing('さやいんげん','g',[],['vegetable'],[]),
  lotus_root: ing('れんこん','g',[],['vegetable'],[]),
  burdock: ing('ごぼう','g',[],['vegetable'],[]),
  turnip: ing('かぶ','g',[],['vegetable'],[]),
  okra: ing('オクラ','g',[],['vegetable'],[]),
  celery: ing('セロリ','g',[],['vegetable'],[]),
  asparagus: ing('アスパラガス','g',[],['vegetable'],[]),
  negi: ing('長ねぎ','g',[],['vegetable'],[]),
  mushroom: ing('マッシュルーム','g',[],['vegetable'],[]),
  shimeji: ing('ぶなしめじ','g',[],['vegetable'],[]),
  enoki: ing('えのき','g',[],['vegetable'],[]),
  shiitake: ing('生しいたけ','g',[],['vegetable'],[]),
  corn: ing('とうもろこし（無調味の粒）','g',[],['vegetable'],[]),
  wakame: ing('乾燥わかめ（無調味）','g',[],['vegetable'],[]),
  hijiki: ing('乾燥ひじき','g',[],['vegetable'],[]),
  apple: ing('りんご','g',['apple'],['fruit'],[]),
  orange: ing('オレンジ','g',['orange'],['fruit'],[]),
  kiwi: ing('キウイフルーツ','g',['kiwi'],['fruit'],[]),
  banana: ing('バナナ','g',['banana'],['fruit'],[]),
  peach: ing('もも','g',['peach'],['fruit'],[]),
  grape: ing('ぶどう','g',[],['fruit'],[]),
  ginger: ing('しょうが','g',[],[],[]),
  garlic: ing('にんにく','g',[],[],[]),
  scallion_garnish: ing('小ねぎ（薬味）','g',[],[],[]),
  shiso: ing('青じそ','g',[],[],[]),
  lemon: ing('レモン汁','ml',[],[],[]),
  parsley: ing('パセリ','g',[],[],[]),
  kombu: ing('だし用昆布','g',[],[],[]),
  bonito: ing('かつお節（かつおのみ）','g',[],[],[]),
  dried_sardine: ing('煮干し（いわしのみ）','g',[],[],[]),
  salt: ing('食塩','g',[],[],[]),
  sugar: ing('砂糖','g',[],[],[]),
  oil: ing('植物油（菜種・米など）','ml',[],[],[],'ごま油・落花生油・大豆油などは別材料として確認。'),
  olive_oil: ing('オリーブ油','ml',[],[],[]),
  sesame_oil: ing('ごま油','ml',['sesame'],[],[]),
  sesame: ing('白ごま','g',['sesame'],[],[]),
  soy_sauce: ing('しょうゆ（小麦・大豆を含む）','ml',['wheat','soy'],[],[]),
  miso: ing('米みそ（大豆を含む）','g',['soy'],[],[],'麦みそ・合わせみそでは追加の原材料を確認。'),
  vinegar: ing('米酢（米由来）','ml',[],[],[]),
  mirin: ing('本みりん','ml',[],[],[]),
  sake: ing('清酒（料理用）','ml',[],[],[]),
  water: ing('水','ml',[],[],[]),
  black_pepper: ing('黒こしょう','g',[],[],[]),
  curry_powder: ing('カレー粉（香辛料のみ）','g',[],[],[],'小麦粉や調味料を加えたカレールウは想定していません。製品表示を確認。'),
  paprika_powder: ing('パプリカ粉（香辛料のみ）','g',[],[],[]),
  chilli: ing('粉とうがらし（単品）','g',[],[],[]),
  dried_basil: ing('乾燥バジル','g',[],[],[]),
  mayonnaise: ing('マヨネーズ（卵・大豆・乳・小麦を含む想定）','g',['egg','soy','milk','wheat'],[],[],'製品差があるため卵・大豆・乳・小麦を含む条件で候補判定します。使用製品の表示を確認。'),
  tomato_paste: ing('トマトペースト（トマトのみ）','g',[],[],[]),
  cashew: ing('カシューナッツ（無調味）','g',['cashew'],[],[]),
  peanut: ing('落花生（無調味）','g',['peanut'],[],[]),
  walnut: ing('くるみ（無調味）','g',['walnut'],[],[]),
  almond: ing('アーモンド（無調味）','g',['almond'],[],[]),
  yam: ing('長いも','g',['yam'],['vegetable'],[]),
  "cauliflower": {"name": "カリフラワー", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "beet": {"name": "ビーツ", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "green_pea": {"name": "グリーンピース", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "kiriboshi_daikon": {"name": "切り干し大根", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "taro": {"name": "里いも", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "red_cabbage": {"name": "紫キャベツ", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "chive": {"name": "にら", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "nameko": {"name": "なめこ", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "avocado": {"name": "アボカド", "unit": "g", "allergens": [], "groups": ["fruit"], "proteinSources": []},
  "raisin": {"name": "レーズン", "unit": "g", "allergens": [], "groups": ["fruit"], "proteinSources": []},
  "lentil_cooked": {"name": "レンズ豆（ゆで）", "unit": "g", "allergens": [], "groups": ["protein"], "proteinSources": []},
  "chickpea_cooked": {"name": "ひよこ豆（水煮）", "unit": "g", "allergens": [], "groups": ["protein"], "proteinSources": []},
  "white_bean_cooked": {"name": "白いんげん豆（水煮）", "unit": "g", "allergens": [], "groups": ["protein"], "proteinSources": []},
  "kidney_bean_cooked": {"name": "赤いんげん豆（水煮）", "unit": "g", "allergens": [], "groups": ["protein"], "proteinSources": []},
  "mozzarella": {"name": "モッツァレラチーズ", "unit": "g", "allergens": ["milk"], "groups": ["dairy"], "proteinSources": []},
  "soy_milk": {"name": "無調整豆乳（大豆・水のみ）", "unit": "ml", "allergens": ["soy"], "groups": ["protein"], "proteinSources": ["soy"], "note": "調製豆乳・豆乳飲料に置き換える場合は製品表示を確認。"},
  "coconut_milk": {"name": "ココナッツミルク（ココナッツ・水のみ）", "unit": "ml", "allergens": [], "groups": [], "proteinSources": [], "note": "調味済み製品や乳を加えた製品は想定していません。製品表示を確認。"},
  "ground_sesame": {"name": "すりごま", "unit": "g", "allergens": ["sesame"], "groups": [], "proteinSources": []},
  "lemon_slice": {"name": "レモン（薄切り）", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
  "ume": {"name": "梅干し（調味なし）", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
  "turmeric": {"name": "ターメリック", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
  "cumin": {"name": "クミン", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
  "cornstarch": {"name": "コーンスターチ", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
  tofu_dried: ing('高野豆腐（大豆を含む）','g',['soy'],['protein'],['soy'],'調味液付きではない製品を想定。製品表示を確認。'),
  okara: ing('生おから（大豆由来）','g',['soy'],['protein'],['soy']),
  daikon_leaf: ing('大根の葉','g',[],['vegetable'],[]),
  "barley": {"name": "押し麦（大麦のみ）", "unit": "g", "allergens": [], "groups": ["staple"], "proteinSources": []},
  "winter_melon": {"name": "冬瓜", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "bitter_melon": {"name": "ゴーヤ", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "dried_shiitake": {"name": "干ししいたけ（しいたけのみ）", "unit": "g", "allergens": [], "groups": ["vegetable"], "proteinSources": []},
  "mung_vermicelli": {"name": "春雨（緑豆でん粉のみ）", "unit": "g", "allergens": [], "groups": [], "proteinSources": []},
};

// 追加除外では原料を指定すると派生食材も除きます。逆方向には広げません。
const DERIVED_FROM = {
  "canned_tomato": [
    "tomato"
  ],
  "tomato_paste": [
    "tomato"
  ],
  "kiriboshi_daikon": [
    "daikon"
  ],
  "raisin": [
    "grape"
  ],
  "cornstarch": [
    "corn"
  ],
  "starch": [
    "potato"
  ],
  "chicken_breast": [
    "chicken"
  ],
  "chicken_minced": [
    "chicken"
  ],
  "pork_minced": [
    "pork"
  ],
  "beef_minced": [
    "beef"
  ],
  "yogurt": [
    "milk"
  ],
  "cheese": [
    "milk"
  ],
  "butter": [
    "milk"
  ],
  "mozzarella": [
    "milk"
  ],
  "tofu": [
    "soybeans"
  ],
  "silken_tofu": [
    "soybeans"
  ],
  "aburaage": [
    "soybeans"
  ],
  "natto": [
    "soybeans"
  ],
  "soy_milk": [
    "soybeans"
  ],
  "miso": [
    "soybeans"
  ],
  "soy_sauce": [
    "soybeans"
  ],
  "tofu_dried": [
    "soybeans"
  ],
  "okara": [
    "soybeans"
  ],
  "ground_sesame": [
    "sesame"
  ],
  "sesame_oil": [
    "sesame"
  ],
  "lemon": [
    "lemon_slice"
  ],
  "dried_shiitake": [
    "shiitake"
  ],
  "mayonnaise": [
    "egg",
    "soybeans",
    "milk"
  ],
  "bread": [
    "egg",
    "milk",
    "soybeans"
  ],
  "breadcrumbs": [
    "bread"
  ]
};
for (const [id, parents] of Object.entries(DERIVED_FROM)) INGREDIENTS[id].derivedFrom = parents;

Object.assign(INGREDIENTS, EXTRA_INGREDIENTS, EVERYDAY_INGREDIENTS, CLASSIC_MAIN_INGREDIENTS, CLASSIC_SIDE_INGREDIENTS, PREPARED_INGREDIENTS, FAMILIAR_MAIN_INGREDIENTS, FAMILIAR_SIDE_INGREDIENTS, SUSHI_INGREDIENTS, PERFORMANCE_INGREDIENTS, TAKEAWAY_INGREDIENTS, VARIED_INGREDIENTS, COMFORT_INGREDIENTS, CONFECTIONERY_INGREDIENTS, DESSERT_INGREDIENTS, ACCOMPANIMENT_INGREDIENTS, Object.fromEntries(Object.entries({...SALAD_INGREDIENTS,...DISH_CUSTOM_INGREDIENTS,...PALETTE_INGREDIENTS,...MEAT_CHOICE_INGREDIENTS,...MAPO_INGREDIENTS}).map(([id,item])=>[id,{...item}])));
for (const [id, item] of Object.entries(INGREDIENTS)) {
  // 宣言単位あたりの参考値。根拠付きの概算補完を使用し、原表の値も別に保持します。
  Object.assign(item, INGREDIENT_NUTRITION[id] ?? {
    nutritionPerUnit: {kcal:null,protein:null,fat:null,carbs:null,fiber:null,salt:null},
    nutritionSource:'栄養値は未登録です。',
  });
}

const recipe = (id, name, genre, minutes, items, steps, staple = false, tags = []) => ({
  id, name, role: 'main', genre, minutes, servings: 2,
  ingredients: items.map(([id,amount]) => ({id,amount})), steps, staple, tags,
});
const MAIN_RECIPES = [
  recipe('chicken-teriyaki','鶏の照り焼き','和食',25,
    [['chicken',300],['soy_sauce',20],['mirin',20],['sake',20],['sugar',5],['oil',5]],
    ['鶏肉を均等な厚さに開き、余分な水分を拭く。しょうゆ・みりん・酒・砂糖を混ぜる。','フライパンに油を熱し、鶏肉を皮側から焼いて裏返す。ふたをして中心75℃で1分以上加熱する。','合わせた調味料を加え、焦がさないよう煮詰めてから切り分ける。']),
  recipe('chicken-tomato','鶏肉と野菜のトマト煮','洋食',30,
    [['chicken',280],['onion',150],['carrot',100],['canned_tomato',300],['garlic',5],['olive_oil',10],['salt',2],['water',100]],
    ['鶏肉は一口大、玉ねぎ・にんじんは薄めに切る。にんにくは刻む。','鍋にオリーブ油とにんにくを入れて温め、鶏肉と野菜を炒める。','トマト缶・水・塩を加えて15〜20分煮る。鶏肉の中心75℃で1分以上を確認し、野菜も柔らかくする。']),
  recipe('chicken-steam','鶏むね肉と白菜の蒸し煮','和食',25,
    [['chicken_breast',280],['chinese_cabbage',300],['ginger',10],['sake',30],['water',60],['salt',2]],
    ['鶏むね肉は厚さ1cmにそぎ切りし、白菜はざく切り、しょうがは千切りにする。','鍋に白菜、鶏肉、しょうがを重ね、酒・水・塩を加える。','ふたをして弱めの中火で蒸し煮にし、鶏肉の中心75℃で1分以上を確認する。煮汁ごと盛る。']),
  recipe('chicken-salt-lemon','鶏肉の塩レモン焼き','洋食',25,
    [['chicken',300],['lemon',20],['garlic',5],['salt',2],['black_pepper',0.2],['olive_oil',10]],
    ['鶏肉の厚い部分を開き、レモン汁・刻んだにんにく・塩・こしょうを絡める。','フライパンにオリーブ油を入れ、鶏肉を両面焼く。','ふたをして中心75℃で1分以上加熱し、食べやすく切り分ける。']),
  recipe('chicken-cashew','鶏肉とカシューナッツ炒め','中華',25,
    [['chicken',250],['pepper',100],['onion',120],['cashew',40],['soy_sauce',15],['sake',15],['sugar',5],['starch',10],['water',40],['oil',10]],
    ['鶏肉・ピーマン・玉ねぎを一口大に切る。しょうゆ・酒・砂糖・水・片栗粉を混ぜる。','油で鶏肉を炒め、中心75℃で1分以上加熱してから野菜を加える。','カシューナッツと混ぜた調味液を加え、全体を混ぜながらとろみをつける。']),
  recipe('chicken-miso','鶏肉のみそ焼き','和食',25,
    [['chicken',300],['miso',25],['mirin',20],['sake',20],['sugar',5],['oil',5],['water',30]],
    ['鶏肉を薄めの一口大に切り、みそ・みりん・酒・砂糖を混ぜて絡める。','油を引いたフライパンで弱めの中火で焼く。焦げやすいので途中で返す。','ふたをして中心75℃で1分以上加熱する。調味液が焦げそうなら分量の水を少しずつ足す。']),
  recipe('chicken-curry-yogurt','鶏肉のヨーグルトカレー焼き','その他',30,
    [['chicken',300],['yogurt',80],['curry_powder',5],['garlic',5],['salt',2],['oil',10]],
    ['鶏肉を一口大に切り、ヨーグルト・カレー粉・刻んだにんにく・塩を絡める。','油を引いたフライパンに並べ、弱めの中火で両面を焼く。','ふたをして中心75℃で1分以上を確認する。焼き汁が水っぽければふたを外して軽く煮詰める。']),
  recipe('chicken-meatball','鶏つくね','和食',30,
    [['chicken_minced',250],['negi',60],['starch',15],['ginger',8],['soy_sauce',20],['mirin',20],['sugar',5],['oil',10],['water',30]],
    ['長ねぎとしょうがを細かく刻み、鶏ひき肉・片栗粉・水とよく混ぜて小判形にする。','油を熱したフライパンで両面を焼き、ふたをして中心75℃で1分以上加熱する。','しょうゆ・みりん・砂糖を加え、とろみが出るまで絡める。']),
  recipe('chicken-oyako','しっかり火を通す親子煮','和食',25,
    [['chicken',220],['egg',3],['onion',150],['soy_sauce',20],['mirin',20],['water',180],['bonito',3]],
    ['小鍋で水を沸かしてかつお節を加え、1分煮てこす。玉ねぎは薄切り、鶏肉は小さめに切る。','だしにしょうゆ・みりん・玉ねぎ・鶏肉を入れ、鶏肉の中心75℃で1分以上加熱する。','溶き卵を流し入れ、ふたをして卵が全体に固まるまで加熱する。']),
  recipe('chicken-rice-flour','鶏むね肉の米粉焼き','和食',25,
    [['chicken_breast',300],['rice_flour',25],['ginger',8],['sake',20],['salt',2],['oil',15]],
    ['鶏むね肉を薄くそぎ切りにし、すりおろしたしょうが・酒・塩を絡める。','米粉を薄くまぶし、油を熱したフライパンに並べる。','中火で両面を焼き、ふたをして中心75℃で1分以上加熱する。']),
  recipe('chicken-broccoli','鶏肉とブロッコリーの炒め物','中華',25,
    [['chicken_breast',250],['broccoli',250],['garlic',5],['soy_sauce',15],['sake',20],['oil',10],['water',50]],
    ['鶏肉を細く切り、ブロッコリーは小房に分ける。にんにくは刻む。','油でにんにくと鶏肉を炒め、水・酒を加えてふたをし、中心75℃で1分以上加熱する。','ブロッコリーを加えて柔らかく蒸し炒めにし、しょうゆを絡める。']),
  recipe('chicken-lotus','鶏ひき肉とれんこんの重ね焼き','和食',30,
    [['chicken_minced',250],['lotus_root',200],['starch',20],['ginger',8],['soy_sauce',20],['mirin',20],['oil',10]],
    ['れんこんを5mm厚さに切り、水にさらして水気を拭く。鶏ひき肉にしょうがと片栗粉半量を混ぜる。','れんこんに残りの片栗粉を薄く付け、肉だねを挟む。','油で両面を焼き、ふたをして中心75℃で1分以上加熱する。しょうゆ・みりんを絡める。']),
  recipe('pork-ginger','豚のしょうが焼き','和食',20,
    [['pork',280],['onion',150],['ginger',15],['soy_sauce',20],['mirin',20],['sake',20],['oil',10]],
    ['豚肉を食べやすく切り、玉ねぎは薄切り、しょうがはすりおろす。','油で玉ねぎと豚肉を炒め、肉の重なりをほぐして中心75℃で1分以上加熱する。','しょうが・しょうゆ・みりん・酒を加え、全体に絡める。']),
  recipe('pork-cabbage','豚肉とキャベツのみそ炒め','和食',20,
    [['pork',250],['cabbage',300],['pepper',80],['miso',25],['sake',20],['sugar',5],['water',30],['oil',10]],
    ['豚肉と野菜を食べやすく切り、みそ・酒・砂糖・水を混ぜる。','油で豚肉を炒め、中心75℃で1分以上加熱してから野菜を加える。','野菜がしんなりしたらみそだれを加え、焦がさず炒め合わせる。']),
  recipe('pork-vinegar','揚げない酢豚','中華',30,
    [['pork',280],['onion',150],['pepper',100],['carrot',100],['vinegar',25],['soy_sauce',20],['sugar',15],['starch',20],['water',80],['oil',15]],
    ['豚肉を一口大にまとめて片栗粉半量をまぶす。野菜を切り、にんじんは下ゆでする。','油で豚肉を両面焼き、中心75℃で1分以上加熱する。玉ねぎ・ピーマン・にんじんを加える。','酢・しょうゆ・砂糖・水・残りの片栗粉を混ぜて加え、混ぜながらとろみをつける。']),
  recipe('pork-daikon','豚肉と大根の煮物','和食',35,
    [['pork',250],['daikon',350],['ginger',10],['soy_sauce',25],['mirin',25],['sake',20],['water',350]],
    ['豚肉を切り、大根は厚さ1cmの半月切り、しょうがは薄切りにする。','鍋に水・酒・しょうが・豚肉・大根を入れ、沸騰したらアクを取る。','しょうゆ・みりんを加え、ふたを少しずらして20〜25分煮る。肉の中心75℃で1分以上と大根の柔らかさを確認する。']),
  recipe('pork-beansprout','豚肉ともやしの蒸し焼き','和食',20,
    [['pork',250],['bean_sprout',300],['negi',80],['sake',30],['water',30],['soy_sauce',15],['vinegar',15]],
    ['もやしを洗い、長ねぎは斜め切り、豚肉は食べやすく切る。','フライパンにもやし・ねぎ・豚肉を重ね、酒・水を加える。','ふたをして蒸し、肉をほぐしながら中心75℃で1分以上加熱する。しょうゆと酢を混ぜて添える。']),
  recipe('pork-meatball','肉団子の甘酢あん','中華',30,
    [['pork_minced',250],['onion',100],['starch',25],['ginger',8],['soy_sauce',20],['vinegar',20],['sugar',12],['water',100],['oil',10]],
    ['刻んだ玉ねぎ・しょうがと豚ひき肉、片栗粉の6割、水の2割を練り、小さく丸める。','油を引いたフライパンで転がして焼き、ふたをして中心75℃で1分以上加熱する。','残りの水・片栗粉としょうゆ・酢・砂糖を混ぜて加え、とろみが付くまで煮る。']),
  recipe('pork-roll','豚肉のいんげん巻き','和食',25,
    [['pork',280],['green_beans',180],['carrot',100],['soy_sauce',20],['mirin',20],['oil',10]],
    ['いんげんと棒状のにんじんを、芯が少し残る程度にゆでて水気を拭く。','豚肉を広げて野菜を巻き、巻き終わりを下にして油で焼く。','全方向を焼いてふたをし、肉の中心75℃で1分以上加熱する。しょうゆ・みりんを加えて絡める。']),
  recipe('pork-salt-cabbage','豚肉と白菜のしょうが塩炒め','中華',20,
    [['pork',250],['chinese_cabbage',300],['ginger',10],['sake',20],['salt',2],['oil',10]],
    ['豚肉と白菜を切り、しょうがは千切りにする。','油でしょうがと豚肉を炒め、肉の中心75℃で1分以上加熱する。','白菜の芯、葉の順に加えて炒め、酒と塩で調味する。']),
  recipe('pork-aubergine','なすと豚肉のしょうゆ炒め','和食',25,
    [['pork',250],['aubergine',300],['ginger',10],['soy_sauce',20],['mirin',20],['oil',15]],
    ['なすは乱切り、豚肉は食べやすく切り、しょうがは刻む。','油でなすを柔らかく炒めて一度取り出し、豚肉としょうがを炒めて中心75℃で1分以上加熱する。','なすを戻し、しょうゆ・みりんを加えて全体に絡める。']),
  recipe('pork-tofu','豚肉入り炒り豆腐','和食',25,
    [['pork_minced',180],['tofu',300],['carrot',100],['shiitake',80],['soy_sauce',20],['mirin',20],['oil',10]],
    ['豆腐をキッチンペーパーで包み水気を切る。にんじん・しいたけを細かく切る。','油でひき肉をほぐして炒め、中心75℃で1分以上加熱する。野菜を加えて柔らかくする。','豆腐を崩し入れ、しょうゆ・みりんを加え、水分を飛ばしながら炒める。']),
  recipe('beef-onion','牛肉と玉ねぎの甘辛煮','和食',25,
    [['beef',250],['onion',250],['soy_sauce',25],['mirin',25],['sake',20],['ginger',10],['water',150]],
    ['玉ねぎは薄切り、しょうがは千切り、牛肉は食べやすく切る。','鍋に水・しょうゆ・みりん・酒・しょうがを入れ、玉ねぎを煮る。','牛肉を加えてほぐし、赤い部分が残らないよう中心まで十分加熱する。']),
  recipe('beef-pepper','牛肉とピーマンの細切り炒め','中華',20,
    [['beef',250],['pepper',180],['onion',120],['soy_sauce',20],['sake',20],['starch',10],['oil',10]],
    ['牛肉と野菜を細切りにする。牛肉に酒と片栗粉を絡める。','油を熱し牛肉をほぐして中心まで十分加熱する。','野菜を加えて炒め、しょうゆを加えて混ぜる。']),
  recipe('beef-potato','牛肉の肉じゃが','和食',35,
    [['beef',220],['potato',350],['onion',180],['carrot',120],['soy_sauce',25],['mirin',25],['sugar',8],['water',350],['oil',5]],
    ['じゃがいも・にんじんは一口大、玉ねぎはくし切り、牛肉は食べやすく切る。','油で牛肉と野菜を炒め、水を加えて沸騰させ、アクを取る。','調味料を加えて落としぶたをし、肉に十分火が通り野菜が柔らかくなるまで20分ほど煮る。']),
  recipe('beef-tomato','牛肉とトマトの煮込み','洋食',30,
    [['beef',250],['onion',180],['mushroom',120],['canned_tomato',300],['garlic',5],['olive_oil',10],['salt',2],['water',100]],
    ['牛肉は切り、玉ねぎ・マッシュルーム・にんにくは薄切りにする。','オリーブ油でにんにく、牛肉、野菜を炒める。','トマト缶・水・塩を加え、肉の赤い部分がなくなり野菜が柔らかくなるまで15分ほど煮る。']),
  recipe('beef-hamburg','卵を使わない牛肉ハンバーグ','洋食',30,
    [['beef_minced',300],['onion',150],['starch',15],['salt',2],['black_pepper',0.2],['oil',10],['water',60]],
    ['玉ねぎを細かく刻み、油半量で炒めて冷ます。ひき肉・玉ねぎ・片栗粉・塩・こしょうをよく練る。','人数分の平たい小判形にし、残りの油で両面を焼く。','水を加えてふたをし、中心75℃で1分以上加熱する。切った中に生の部分がないことも確認する。']),
  recipe('beef-burdock','牛肉とごぼうのしぐれ煮','和食',30,
    [['beef',230],['burdock',180],['ginger',15],['soy_sauce',25],['mirin',25],['sake',30],['water',100]],
    ['ごぼうを薄いささがきにし、さっと水にさらす。しょうがを千切り、牛肉を食べやすく切る。','鍋に調味料・水・しょうがを沸かし、牛肉を加えてほぐす。','ごぼうを加え、肉の赤い部分がなくなりごぼうが柔らかくなるまで煮る。煮汁を少し残して止める。']),
  recipe('beef-broccoli','牛肉とブロッコリーのにんにく炒め','中華',25,
    [['beef',250],['broccoli',250],['garlic',8],['soy_sauce',20],['sake',20],['oil',10],['water',50]],
    ['ブロッコリーを小房、牛肉を一口大、にんにくを薄切りにする。','油でにんにくと牛肉を炒め、肉に十分火を通す。','ブロッコリー・水・酒を加え、ふたをして柔らかく蒸し炒めにし、しょうゆを絡める。']),
  recipe('salmon-foil','さけときのこの包み蒸し','和食',25,
    [['salmon',260],['onion',100],['shimeji',120],['sake',20],['salt',2],['water',100]],
    ['玉ねぎを薄切り、しめじを小房に分ける。さけの骨を確認して塩を振る。','耐熱のクッキングシートに玉ねぎ・さけ・しめじを置き、酒を振って包む。','フライパンに包みと水を入れてふたをし、さけの中心まで十分火が通るまで蒸す。水がなくなる前に補う。']),
  recipe('salmon-miso','さけとキャベツのみそ蒸し','和食',25,
    [['salmon',260],['cabbage',250],['carrot',80],['miso',25],['mirin',20],['sake',20],['water',80]],
    ['野菜を食べやすく切り、みそ・みりん・酒を混ぜる。さけの骨を確認する。','フライパンに野菜と水を入れ、さけを置いてみそだれを塗る。','ふたをして弱めの中火で蒸し、魚の中心まで十分火が通ったら野菜と一緒に盛る。']),
  recipe('salmon-milk','さけと小松菜のミルク煮','洋食',25,
    [['salmon',250],['komatsuna',200],['onion',100],['milk',250],['flour',15],['butter',10],['salt',2],['water',100]],
    ['さけは骨を確認して一口大、小松菜と玉ねぎは食べやすく切る。','鍋でバターを溶かし玉ねぎを炒め、薄力粉を混ぜて水を少しずつ加える。','さけ・牛乳・小松菜・塩を加え、沸騰させすぎず魚の中心まで十分火を通す。']),
  recipe('salmon-lemon','さけのレモンソテー','洋食',20,
    [['salmon',260],['lemon',20],['olive_oil',10],['salt',2],['black_pepper',0.2]],
    ['さけの骨を確認し、水分を拭いて塩・こしょうを振る。','フライパンにオリーブ油を熱し、さけの両面を焼く。','弱火にしてふたをし、中心まで十分加熱する。仕上げにレモン汁を加える。']),
  recipe('mackerel-miso','さばのみそ煮','和食',30,
    [['mackerel',280],['ginger',15],['miso',30],['sake',40],['mirin',25],['sugar',10],['water',180]],
    ['さばの骨を確認して皮に浅い切れ目を入れる。しょうがは薄切りにする。','鍋に水・酒・みりん・砂糖・しょうがを沸かし、さばを皮側を上にして入れる。','落としぶたをして煮て、みそを煮汁で溶き入れる。魚の中心まで十分火を通し、煮汁を軽く煮詰める。']),
  recipe('mackerel-tomato','さばのトマト煮','洋食',30,
    [['mackerel',280],['canned_tomato',300],['onion',150],['garlic',5],['olive_oil',10],['salt',2],['water',100]],
    ['さばの骨を確認して切り、水分を拭く。玉ねぎとにんにくを薄切りにする。','鍋でオリーブ油とにんにくを温め、玉ねぎを炒める。','トマト缶・水・塩・さばを加え、ふたをして魚の中心まで十分火が通るまで15分ほど煮る。']),
  recipe('cod-salt-steam','たらと白菜の塩蒸し','和食',25,
    [['cod',280],['chinese_cabbage',300],['negi',80],['ginger',10],['sake',30],['salt',2],['water',100]],
    ['たらの骨を確認し、白菜と長ねぎを切る。しょうがは薄切りにする。','鍋に野菜と水を入れ、たらとしょうがを置いて酒・塩を振る。','ふたをして蒸し煮にし、魚の中心まで十分火を通す。']),
  recipe('cod-sweet-vinegar','たらの野菜甘酢あん','中華',30,
    [['cod',280],['onion',120],['carrot',80],['pepper',80],['starch',25],['soy_sauce',20],['vinegar',20],['sugar',10],['water',120],['oil',15]],
    ['たらの骨を確認して切り、片栗粉の6割をまぶす。野菜を細切りにする。','油でたらを両面焼き、中心まで十分加熱して皿に取る。同じフライパンで野菜を炒める。','水・しょうゆ・酢・砂糖・残りの片栗粉を混ぜて加え、とろみが出たらたらにかける。']),
  recipe('cod-potato','たらとじゃがいもの煮込み','洋食',30,
    [['cod',280],['potato',250],['tomato',200],['onion',100],['olive_oil',10],['salt',2],['water',200]],
    ['たらの骨を確認して一口大にする。じゃがいもは薄め、トマト・玉ねぎは食べやすく切る。','鍋にオリーブ油を熱し、玉ねぎとじゃがいもを炒める。','水・トマト・塩・たらを加え、じゃがいもが柔らかく魚の中心に火が通るまで煮る。']),
  recipe('horse-mackerel-pan','あじの米粉焼き','和食',20,
    [['horse_mackerel',260],['rice_flour',25],['salt',2],['oil',15],['lemon',15]],
    ['あじの小骨を確認し、水分を拭いて塩を振る。','米粉を薄くまぶし、油を熱したフライパンで皮側から焼く。','裏返して中心まで十分加熱し、仕上げにレモン汁を添える。']),
  recipe('sardine-ginger','いわしのしょうが煮','和食',30,
    [['sardine',300],['ginger',20],['soy_sauce',25],['mirin',25],['sake',50],['water',150]],
    ['いわしの骨を確認し、流水で洗って水気を拭く。しょうがを薄切りにする。','鍋に調味料・水・しょうがを沸かし、いわしを重ならないように入れる。','落としぶたをして弱めの中火で20分ほど煮て、中心まで十分火を通す。']),
  recipe('tuna-cube','まぐろのしょうゆ焼き','和食',20,
    [['tuna',280],['soy_sauce',20],['sake',20],['ginger',10],['starch',15],['oil',10]],
    ['まぐろを2cm角に切り、しょうゆ・酒・すりおろしたしょうがを絡める。','汁気を軽く切って片栗粉をまぶし、油で各面を焼く。','ふたをして中まで十分加熱し、中心に生の部分を残さないようにする。']),
  recipe('shrimp-chilli','えびのトマトチリ炒め','中華',25,
    [['shrimp',250],['negi',80],['garlic',5],['ginger',8],['tomato_paste',30],['chilli',0.3],['sugar',8],['vinegar',10],['salt',1.5],['starch',15],['water',120],['oil',10]],
    ['えびの背わたを取り水分を拭く。ねぎ・にんにく・しょうがを刻む。','油で香味野菜とえびを炒め、えびの中心まで十分加熱する。','トマトペースト・とうがらし・砂糖・酢・塩・水・片栗粉を混ぜて加え、煮立たせてとろみを付ける。']),
  recipe('shrimp-egg','えびと卵の炒め物','中華',20,
    [['shrimp',200],['egg',3],['negi',60],['salt',2],['oil',15],['water',20]],
    ['えびの背わたを取り、ねぎを刻む。卵を溶き、塩と水を混ぜる。','油半量でえびを炒め、中心まで十分加熱して取り出す。','残りの油でねぎと卵を炒め、卵が固まったらえびを戻して合わせる。']),
  recipe('squid-pepper','いかとパプリカの炒め物','中華',20,
    [['squid',250],['paprika',180],['onion',100],['garlic',5],['soy_sauce',15],['sake',20],['oil',10]],
    ['いかとパプリカを短冊、玉ねぎとにんにくを薄切りにする。','油でにんにくと野菜を炒め、いかを加える。','酒・しょうゆを加え、いかが全体に白くなり中心まで火が通るまで炒める。']),
  recipe('scallop-broccoli','ほたてとブロッコリーの塩炒め','中華',20,
    [['scallop',240],['broccoli',250],['ginger',8],['sake',20],['salt',2],['oil',10],['water',60]],
    ['ほたてを厚さ半分、ブロッコリーを小房、しょうがを千切りにする。','油でしょうがとほたてを焼き、水・酒・ブロッコリーを加える。','ふたをして蒸し炒めにし、ほたての中心まで十分加熱して塩を加える。']),
  recipe('tofu-steak','豆腐ステーキのきのこあん','和食',30,
    [['tofu',400],['shimeji',150],['starch',25],['soy_sauce',20],['mirin',20],['water',180],['oil',10]],
    ['豆腐を水切りして食べやすく切り、片栗粉の6割をまぶす。しめじをほぐす。','油で豆腐の両面を焼いて皿に盛る。','しめじ・しょうゆ・みりん・水・残りの片栗粉を混ぜて煮立て、とろみが付いたら豆腐にかける。']),
  recipe('tofu-mapo','豆腐と豚肉の辛くない麻婆豆腐','中華',25,
    [['silken_tofu',350],['pork_minced',150],['negi',80],['ginger',8],['miso',20],['soy_sauce',15],['starch',10],['water',200],['oil',10]],
    ['豆腐は角切り、ねぎ・しょうがは細かく刻む。','油でひき肉・ねぎ・しょうがを炒め、肉の中心75℃で1分以上加熱する。','水・みそ・しょうゆ・豆腐を入れて5分煮る。片栗粉を少量の水で溶いて加え、煮立たせる。']),
  recipe('tofu-vegetable','豆腐と野菜の塩炒め','中華',25,
    [['tofu',350],['komatsuna',200],['carrot',100],['ginger',8],['salt',2],['oil',10],['water',40]],
    ['豆腐を水切りして一口大に、小松菜とにんじんは細く切る。しょうがを刻む。','油で豆腐を焼いて取り出し、しょうがとにんじんを炒める。','小松菜・水・塩を加えて野菜に火を通し、豆腐を戻して温める。']),
  recipe('tofu-burger','豆腐と鶏肉のハンバーグ','和食',30,
    [['tofu',200],['chicken_minced',200],['onion',100],['starch',20],['soy_sauce',20],['mirin',20],['oil',10],['water',50]],
    ['豆腐を水切りし、刻んだ玉ねぎ・鶏ひき肉・片栗粉とよく混ぜて人数分の小判形にまとめる。','油で両面を焼き、水を加えてふたをする。中心75℃で1分以上加熱する。','しょうゆとみりんを加え、煮詰めながら絡める。']),
  recipe('soybeans-tomato','大豆と野菜のトマト煮','洋食',30,
    [['soybeans',250],['canned_tomato',300],['onion',150],['carrot',120],['garlic',5],['olive_oil',10],['salt',2],['water',150]],
    ['玉ねぎ・にんじんを小さく切り、にんにくを刻む。','鍋でオリーブ油とにんにくを温め、玉ねぎとにんじんを炒める。','大豆・トマト缶・水・塩を加え、野菜が柔らかくなるまで15〜20分煮る。']),
  recipe('tofu-egg','豆腐と卵のそぼろ煮','和食',20,
    [['tofu',300],['egg',2],['negi',80],['soy_sauce',20],['mirin',20],['water',150]],
    ['豆腐を粗く崩し、長ねぎを小口切り、卵を溶いておく。','鍋に水・しょうゆ・みりん・豆腐・ねぎを入れ、5分ほど煮る。','溶き卵を流し入れ、混ぜながら卵が完全に固まるまで煮る。']),
  recipe('omelette-vegetable','野菜入り厚焼き卵','和食',20,
    [['egg',4],['spinach',150],['carrot',60],['salt',2],['oil',10],['water',30]],
    ['ほうれん草はゆでて水気を絞り、にんじんと一緒に細かく刻む。','卵・野菜・塩・水を混ぜる。','油を引いた小さなフライパンに流し、弱火でふたをして焼く。裏返し、卵が完全に固まるまで加熱する。']),
  recipe('egg-potato','じゃがいものスペイン風オムレツ','洋食',30,
    [['egg',4],['potato',220],['onion',120],['olive_oil',15],['salt',2]],
    ['じゃがいもと玉ねぎを薄切りにし、オリーブ油半量で柔らかく炒める。','ボウルで卵と塩を混ぜ、粗熱を取った野菜を加える。','残りの油で弱火で焼き、皿を使って裏返す。ふたをして卵の中心まで完全に固める。']),
  recipe('egg-tomato','トマトと卵の炒め物','中華',15,
    [['egg',4],['tomato',300],['salt',2],['sugar',4],['oil',15]],
    ['トマトをくし切りにし、卵に塩半量を混ぜる。','油半量で卵を炒め、完全に固まったら取り出す。','残りの油でトマトを炒め、残りの塩と砂糖を加える。卵を戻し、全体を温める。']),
  recipe('crab-omelette','かに入り卵焼き','中華',20,
    [['crab',100],['egg',4],['negi',60],['salt',1.5],['oil',10],['water',30]],
    ['かに身は殻が残っていないか確認し、ねぎを刻む。','卵・かに・ねぎ・塩・水を混ぜる。','油を引いたフライパンに流して弱火でふたをし、両面を焼く。卵の中心まで完全に火を通す。']),
  recipe('chicken-rice-bowl','鶏そぼろ丼','和食',25,
    [['chicken_minced',200],['rice',300],['egg',2],['spinach',150],['soy_sauce',20],['mirin',20],['sugar',8],['ginger',8],['oil',5]],
    ['鍋に鶏ひき肉・しょうゆ・みりん・砂糖・しょうがを入れ、混ぜながら中心75℃で1分以上加熱する。','卵を油で炒めて完全に固める。ほうれん草をゆでて水気を絞り切る。','温かいご飯に鶏そぼろ・卵・ほうれん草を盛る。'],true),
  recipe('beef-rice-bowl','牛丼','和食',25,
    [['beef',230],['onion',180],['rice',300],['soy_sauce',25],['mirin',25],['ginger',10],['water',150]],
    ['玉ねぎを薄切り、牛肉を一口大、しょうがを千切りにする。','鍋に水・しょうゆ・みりん・しょうが・玉ねぎを入れて煮る。牛肉を加えて中心まで十分火を通す。','温かいご飯に具と煮汁を分けて盛る。'],true),
  recipe('pork-rice-bowl','豚肉と小松菜の丼','和食',20,
    [['pork',220],['komatsuna',220],['rice',300],['soy_sauce',20],['mirin',20],['ginger',8],['oil',10]],
    ['豚肉と小松菜を食べやすく切り、しょうがを刻む。','油でしょうがと豚肉を炒め、中心75℃で1分以上加熱する。小松菜を加える。','しょうゆ・みりんを絡めて、温かいご飯に盛る。'],true),
  recipe('egg-fried-rice','卵と野菜のチャーハン','中華',20,
    [['rice',350],['egg',2],['carrot',80],['negi',80],['edamame',80],['soy_sauce',15],['oil',15]],
    ['にんじんとねぎを細かく刻み、枝豆は加熱しておく。卵を溶く。','油で野菜と卵を炒め、卵が固まったらご飯を加えてほぐす。','全体が熱くなるまで炒め、しょうゆを鍋肌から加えて混ぜる。'],true),
  recipe('salmon-fried-rice','さけと小松菜の混ぜご飯','和食',25,
    [['salmon',200],['komatsuna',200],['rice',350],['sesame',10],['salt',1.5],['sake',20]],
    ['さけは酒を振ってフライパンでふたをして蒸し焼きにし、中心まで十分加熱する。骨と皮を除いてほぐす。','小松菜をゆでて水気をしっかり絞り、細かく切る。','温かいご飯にさけ・小松菜・ごま・塩を混ぜる。'],true),
  recipe('tomato-chicken-curry','ルウを使わないチキンカレー','その他',35,
    [['chicken',250],['onion',200],['carrot',120],['canned_tomato',250],['rice',300],['curry_powder',8],['garlic',5],['ginger',8],['oil',15],['salt',3],['water',300]],
    ['鶏肉・玉ねぎ・にんじんを小さく切り、にんにくとしょうがを刻む。','鍋に油を熱して香味野菜、玉ねぎ、鶏肉、にんじんを炒め、カレー粉を加える。','トマト缶・水・塩を加え20分ほど煮る。鶏肉の中心75℃で1分以上を確認し、温かいご飯にかける。'],true),
  recipe('minced-dry-curry','野菜たっぷりドライカレー','その他',25,
    [['pork_minced',200],['onion',150],['carrot',100],['pepper',100],['canned_tomato',180],['rice',300],['curry_powder',7],['salt',2],['oil',10]],
    ['野菜をすべて細かく刻む。','油でひき肉をほぐして炒め、中心75℃で1分以上加熱する。野菜を加えて炒める。','カレー粉・トマト缶・塩を加え、水分が少なくなるまで煮詰めてご飯に盛る。'],true),
  recipe('tofu-rice-bowl','豆腐ときのこのあんかけ丼','和食',20,
    [['tofu',300],['shimeji',150],['carrot',80],['rice',300],['soy_sauce',20],['mirin',20],['starch',12],['water',250]],
    ['豆腐を角切り、にんじんを細切り、しめじを小房にする。','鍋に水・しょうゆ・みりん・野菜を入れて柔らかく煮て、豆腐を加えて温める。','片栗粉を少量の水で溶いて加え、煮立ててとろみを付ける。ご飯にかける。'],true),
  recipe('tofu-natto-rice','納豆豆腐の温かい丼','和食',15,
    [['natto',90],['tofu',200],['rice',300],['komatsuna',150],['soy_sauce',15],['water',80]],
    ['小松菜を切り、水と一緒に鍋で柔らかく煮る。','崩した豆腐と納豆を加え、全体が熱くなるまで加熱し、しょうゆを混ぜる。','温かいご飯に盛る。納豆付属のたれ・からしは使わない。'],true),
  recipe('pasta-meat','野菜入りミートソーススパゲティ','洋食',35,
    [['pasta',180],['beef_minced',180],['onion',150],['carrot',100],['canned_tomato',300],['garlic',5],['olive_oil',10],['salt',3],['water',1200]],
    ['玉ねぎ・にんじん・にんにくを刻み、オリーブ油でひき肉と炒める。肉は中心75℃で1分以上加熱する。','トマト缶・水の2割・塩半量を加え、15分ほど煮る。','残りの水と塩でスパゲティを袋の表示どおりゆで、湯を切ってソースと混ぜる。'],true),
  recipe('pasta-shrimp','えびとトマトのスパゲティ','洋食',25,
    [['pasta',180],['shrimp',200],['tomato',300],['garlic',8],['olive_oil',15],['salt',3],['water',1100]],
    ['えびの背わたを取り、トマトを角切り、にんにくを薄切りにする。','鍋に分量の水の9割と塩半量を入れ、スパゲティをゆでる。','フライパンに油とにんにくを入れて温め、えびとトマト・残りの水と塩を加えて加熱する。えびの中心まで火を通し、ゆでた麺を混ぜる。'],true),
  recipe('pasta-mushroom','きのこの和風スパゲティ','洋食',25,
    [['pasta',180],['shimeji',120],['shiitake',100],['tofu',150],['garlic',5],['soy_sauce',20],['olive_oil',15],['salt',2],['water',1100]],
    ['きのこをほぐして切り、豆腐を小さく崩す。にんにくを薄切りにする。','分量の水の9割と塩でスパゲティをゆでる。','油でにんにく・きのこ・豆腐を炒め、残りの水としょうゆを加える。ゆでた麺を入れ、全体を温める。'],true),
  recipe('pasta-milk-salmon','さけとほうれん草のミルクパスタ','洋食',30,
    [['pasta',180],['salmon',200],['spinach',200],['milk',250],['onion',100],['butter',10],['flour',10],['salt',3],['water',1100]],
    ['ほうれん草を下ゆでし、さけの骨を確認して切り、玉ねぎを薄切りにする。','バターで玉ねぎとさけを炒め、薄力粉を混ぜる。水の1割と牛乳を少しずつ加え、魚の中心まで十分煮る。','残りの水と塩半量で麺をゆで、ソースとほうれん草を混ぜ、残りの塩で調える。'],true),
  recipe('udon-pork','豚肉と野菜の焼きうどん','和食',25,
    [['udon',400],['pork',180],['cabbage',200],['carrot',80],['soy_sauce',20],['sake',20],['oil',10],['water',80]],
    ['豚肉と野菜を食べやすく切る。','油で豚肉を炒めて中心75℃で1分以上加熱し、野菜を加える。','うどん・水・酒を加えてほぐしながら蒸し炒めにし、しょうゆを絡める。'],true),
  recipe('udon-egg','卵と小松菜の温うどん','和食',25,
    [['udon',400],['egg',2],['komatsuna',200],['negi',80],['soy_sauce',25],['mirin',20],['water',600],['kombu',4],['bonito',5]],
    ['水に昆布を入れて温め、沸騰直前に取り出す。かつお節を加え1分煮てこす。','だしにしょうゆ・みりん・切った野菜とうどんを加え、野菜が柔らかくなるまで煮る。','溶き卵を加え、全体に固まるまで加熱する。'],true),
  recipe('soba-chicken','鶏肉とねぎの温そば','和食',30,
    [['soba',180],['chicken',200],['negi',150],['soy_sauce',25],['mirin',20],['water',1600],['kombu',4],['bonito',5]],
    ['水の4割と昆布・かつお節でだしを取り、こす。鶏肉を小さく、ねぎを斜めに切る。','だしにしょうゆ・みりん・鶏肉・ねぎを加え、鶏肉の中心75℃で1分以上加熱する。','残りの水でそばを表示時間どおりゆで、流水で洗う。つゆに加えて温めて盛る。'],true),
  recipe('rice-egg-omelette','しっかり焼くオムライス','洋食',30,
    [['rice',300],['egg',4],['chicken',150],['onion',120],['carrot',80],['tomato_paste',25],['oil',15],['salt',2],['water',40]],
    ['鶏肉と野菜を細かく切り、油の約3分の2で炒めて肉の中心75℃で1分以上加熱する。','トマトペースト・水・塩を加えて煮詰め、ご飯を混ぜて人数分の皿に盛る。','残りの油で溶き卵を人数分の薄焼き卵にして、中心まで完全に固めてご飯にのせる。'],true),
  recipe('rice-baked-cheese','野菜と豆腐の焼きカレーご飯','洋食',30,
    [['rice',300],['tofu',250],['onion',120],['canned_tomato',200],['cheese',60],['curry_powder',5],['oil',10],['salt',2]],
    ['玉ねぎを刻み、油で炒める。崩した豆腐・トマト缶・カレー粉・塩を加え、水分を飛ばす。','人数分の耐熱皿に温かいご飯と具を入れ、チーズをのせる。','オーブントースターでチーズが溶けて全体が熱くなるまで焼く。器が熱いので注意して取り出す。'],true),
  recipe('chicken-sandwich','鶏肉とキャベツの温サンド','洋食',25,
    [['bread',240],['chicken_breast',220],['cabbage',180],['yogurt',40],['lemon',10],['salt',2],['oil',10]],
    ['鶏肉を薄く切り、塩半量を振って油で両面焼き、中心75℃で1分以上加熱する。','キャベツを千切りにして加熱し、水気を絞る。ヨーグルト・レモン汁・残りの塩を混ぜる。','食パンを軽く焼き、鶏肉・キャベツ・ソースを挟んで切る。'],true),
];

const extraSide = (...args) => ({...recipe(...args), role: 'side'});
const EXTRA_MAIN_SIDE_RECIPES = [
  recipe('pork-cabbage-roll','白菜の肉巻き煮','和食',35,
    [['pork_minced',250],['chinese_cabbage',350],['onion',80],['ginger',8],['starch',15],['soy_sauce',20],['mirin',20],['water',300]],
    ['白菜の葉をゆでて柔らかくし、芯の厚い部分をそぐ。刻んだ玉ねぎ・しょうが・豚ひき肉・片栗粉を混ぜる。','肉だねを白菜で包み、巻き終わりを下にして鍋に隙間なく並べる。','水・しょうゆ・みりんを加え、ふたをして20分ほど煮る。肉だねの中心75℃で1分以上を確認する。']),
  recipe('pork-chive-egg','豚肉とにらの卵とじ','和食',25,
    [['pork',220],['chive',150],['onion',120],['egg',2],['soy_sauce',20],['mirin',20],['water',150]],
    ['豚肉・にらは食べやすく、玉ねぎは薄切りにする。卵を溶いておく。','鍋に水・しょうゆ・みりん・玉ねぎ・豚肉を入れ、肉をほぐして中心75℃で1分以上加熱する。','にらを加えて柔らかくし、卵を流し入れて全体が固まるまで加熱する。']),
  recipe('chicken-root-simmer','鶏肉と根菜の筑前煮風','和食',40,
    [['chicken',230],['lotus_root',150],['burdock',100],['carrot',100],['shiitake',80],['soy_sauce',25],['mirin',25],['sugar',8],['water',300],['oil',10]],
    ['鶏肉と野菜を一口大に切り、ごぼうとれんこんはさっと水にさらす。','鍋に油を熱し、鶏肉と野菜を炒める。水を加えて沸かし、アクを取る。','しょうゆ・みりん・砂糖を加え、落としぶたをして野菜が柔らかくなるまで煮る。鶏肉の中心75℃で1分以上を確認する。']),
  recipe('chicken-nanban-pickle','鶏肉と彩り野菜の南蛮漬け','和食',30,
    [['chicken_breast',280],['onion',120],['carrot',80],['paprika',100],['rice_flour',25],['vinegar',30],['soy_sauce',20],['sugar',12],['water',100],['oil',20]],
    ['野菜を細切りにし、水・酢・しょうゆ・砂糖と鍋でさっと煮て、耐熱容器に移す。','鶏肉を薄くそぎ切りにして米粉をまぶし、油で両面を焼く。中心75℃で1分以上加熱する。','焼きたての鶏肉を野菜と漬け汁に入れ、10分ほど置いて味をなじませる。']),
  recipe('chicken-tofu-pot','鶏肉と豆腐の塩鍋','和食',30,
    [['chicken',220],['tofu',250],['chinese_cabbage',250],['shimeji',100],['negi',100],['kombu',5],['water',600],['sake',30],['salt',3]],
    ['水と昆布を鍋に入れ、弱火で温めて沸騰直前に昆布を取り出す。肉と野菜・豆腐を食べやすく切る。','だしに鶏肉・酒・白菜の芯・長ねぎを加え、ふたをして煮る。','鶏肉の中心75℃で1分以上を確認し、豆腐・しめじ・白菜の葉を加えて煮る。塩で味を調える。']),
  recipe('tofu-dried-simmer','高野豆腐と野菜の煮物','和食',30,
    [['tofu_dried',60],['carrot',100],['shiitake',80],['green_beans',80],['kombu',4],['water',450],['soy_sauce',20],['mirin',25],['sugar',8]],
    ['高野豆腐を袋の表示どおりに戻し、水気を絞って切る。野菜を食べやすく切る。','水と昆布を温めて昆布を取り出し、しょうゆ・みりん・砂糖・にんじん・しいたけを加える。','高野豆腐を加えて落としぶたをし、弱火で15分ほど煮る。いんげんを加えて火を通す。']),
  recipe('okara-vegetable-patty','おからと野菜のもち焼き','和食',30,
    [['okara',150],['potato',200],['carrot',60],['negi',60],['starch',25],['salt',2],['oil',15]],
    ['じゃがいもを柔らかくゆでてつぶし、にんじんと長ねぎを細かく刻む。','じゃがいも・おから・野菜・片栗粉・塩を混ぜ、薄い小判形にまとめる。','油を熱したフライパンで両面を焼く。ふたをして中まで熱くなるよう加熱する。']),
  recipe('soy-hijiki-patty','大豆とひじきのつくね焼き','和食',35,
    [['soybeans',250],['hijiki',8],['onion',100],['starch',25],['soy_sauce',20],['mirin',20],['oil',15]],
    ['ひじきを袋の表示どおりに戻して洗う。大豆をつぶし、玉ねぎを細かく刻む。','大豆・ひじき・玉ねぎ・片栗粉をよく混ぜ、薄い小判形にする。','油で両面を焼き、ふたをして玉ねぎまで火を通す。しょうゆ・みりんを加えて絡める。']),
  recipe('clam-sake-steam','あさりの酒蒸し','和食',20,
    [['clam',400],['sake',50],['water',80],['ginger',10],['scallion_garnish',10]],
    ['砂抜き済みのあさりをこすり洗いし、割れた貝や傷んだ貝を除く。しょうがは千切りにする。','鍋にあさり・酒・水・しょうがを入れ、ふたをして加熱する。','口が開いてからも十分に加熱し、開かない貝は食べない。小ねぎを散らして煮汁ごと盛る。']),
  recipe('squid-daikon-simmer','いかと大根の煮物','和食',35,
    [['squid',250],['daikon',350],['ginger',10],['soy_sauce',25],['mirin',25],['sake',20],['water',300]],
    ['大根を薄めの半月切りにし、いかを輪切り、しょうがを薄切りにする。','鍋に水・調味料・しょうが・大根を入れ、柔らかくなるまで20分ほど煮る。','いかを加えて全体が白くなり中心まで火が通るまで煮る。火を止めて少し味をなじませる。']),
  recipe('cod-fishball','たらのつみれと野菜の煮物','和食',35,
    [['cod',280],['tofu',100],['ginger',10],['starch',20],['carrot',100],['negi',120],['soy_sauce',20],['mirin',20],['water',400]],
    ['たらの皮と骨を除き、包丁で細かくたたく。水切りした豆腐・すりおろしたしょうが・片栗粉と混ぜる。','鍋に水・しょうゆ・みりん・切ったにんじんとねぎを入れて煮る。','つみれをスプーンで丸めて加え、中心まで白く固まって十分火が通るまで煮る。']),
  recipe('mackerel-curry-roast','さばと根菜のカレー焼き','洋食',35,
    [['mackerel',280],['potato',250],['carrot',120],['onion',150],['curry_powder',5],['olive_oil',15],['salt',2]],
    ['じゃがいもとにんじんを薄めに切って下ゆでする。さばの骨を確認し、一口大に切る。玉ねぎはくし切りにする。','すべての材料にカレー粉・オリーブ油・塩を絡め、天板に広げる。','200℃のオーブンで20分ほど焼き、野菜が柔らかくさばの中心まで火が通ったことを確認する。']),
  recipe('cod-cheese-bake','たらとトマトのチーズ焼き','洋食',30,
    [['cod',280],['tomato',250],['onion',100],['cheese',60],['olive_oil',10],['salt',1.5],['dried_basil',1]],
    ['たらの骨を確認して切り、塩を振る。トマトと玉ねぎは薄切りにする。','耐熱皿にオリーブ油を塗り、玉ねぎ・たら・トマト・バジル・チーズを重ねる。','200℃のオーブンで20分ほど焼く。魚の中心まで十分火が通ったことを確認する。']),
  recipe('seafood-okonomiyaki','海鮮とキャベツのお好み焼き','和食',30,
    [['cabbage',300],['shrimp',100],['squid',100],['flour',120],['egg',2],['water',150],['salt',2],['oil',15],['soy_sauce',10],['vinegar',10]],
    ['キャベツを細かく切り、えびの背わたを取っていかと一緒に小さく切る。','小麦粉・卵・水・塩を混ぜ、キャベツと魚介を加える。油を引いたフライパンで人数分の平たい形に焼く。','裏返してふたをし、魚介の中心まで十分加熱する。しょうゆと酢を混ぜて添える。'],true),
  recipe('soy-taco-rice','大豆そぼろのタコライス風','その他',25,
    [['soybeans',250],['rice',300],['tomato',200],['lettuce',120],['onion',120],['curry_powder',4],['paprika_powder',2],['salt',2],['oil',10]],
    ['大豆を粗くつぶし、玉ねぎを刻む。トマトは角切り、レタスは細切りにする。','油で玉ねぎと大豆を炒め、カレー粉・パプリカ粉・塩を加え、水分を飛ばしてそぼろ状にする。','温かいご飯にレタス・大豆そぼろ・トマトを盛る。'],true),
  recipe('chicken-pilaf','鶏肉と野菜のフライパンピラフ風','洋食',25,
    [['rice',350],['chicken',180],['onion',100],['carrot',80],['corn',80],['butter',15],['salt',2]],
    ['鶏肉と野菜を小さめに切る。ご飯は温めてほぐしておく。','フライパンでバターを溶かし、鶏肉と野菜を炒める。鶏肉の中心75℃で1分以上を確認する。','ご飯とコーンを加えて炒め、塩で味を調える。'],true),
  recipe('soy-milk-risotto','きのこと豆乳のリゾット風','洋食',25,
    [['rice',300],['soy_milk',250],['shimeji',150],['onion',100],['olive_oil',10],['salt',2],['water',150]],
    ['しめじをほぐし、玉ねぎを細かく刻む。','鍋にオリーブ油を熱して玉ねぎとしめじを炒め、水を加えて野菜が柔らかくなるまで煮る。','ご飯と豆乳・塩を加え、焦がさないよう混ぜながらとろりとするまで弱火で煮る。'],true),
  recipe('egg-tofu-porridge','卵と豆腐の雑炊','和食',25,
    [['rice',250],['egg',2],['tofu',200],['komatsuna',150],['kombu',4],['water',500],['soy_sauce',15],['salt',1]],
    ['水と昆布を温め、沸騰直前に昆布を取り出す。小松菜と豆腐を食べやすく切る。','だしにご飯・豆腐・小松菜を加えて柔らかく煮て、しょうゆ・塩を加える。','溶き卵を流し入れ、全体に固まるまで加熱する。'],true),
  recipe('savoury-french-toast','野菜とチーズの甘くないフレンチトースト','洋食',25,
    [['bread',200],['egg',2],['milk',120],['cheese',40],['spinach',150],['butter',10],['salt',1]],
    ['ほうれん草をゆでて水気を絞り、細かく切る。卵・牛乳・塩を混ぜ、食パンに吸わせる。','フライパンでバターを溶かし、食パンを弱火で両面焼く。','ほうれん草とチーズをのせてふたをし、パンの内部の卵液まで完全に固まるよう加熱する。'],true),
  recipe('rice-flour-chijimi','米粉の野菜チヂミ','その他',25,
    [['rice_flour',120],['starch',30],['chive',120],['carrot',100],['egg',1],['water',160],['salt',1.5],['sesame_oil',15],['soy_sauce',10],['vinegar',10]],
    ['にらを短く切り、にんじんを千切りにする。米粉・片栗粉・卵・水・塩を混ぜ、野菜を加える。','ごま油を引いたフライパンに薄く流し、両面を焼く。','ふたをして卵と生地の中心まで完全に火を通す。しょうゆと酢を混ぜて添える。'],true),
  recipe('pork-stuffed-pepper','ピーマンの肉詰め','洋食',30,
    [['pepper',240],['pork_minced',250],['onion',100],['starch',20],['salt',2],['oil',10],['water',80]],
    ['ピーマンを縦半分に切り、種を除く。玉ねぎを刻み、ひき肉・片栗粉の半量・塩とよく混ぜる。','ピーマンの内側に残りの片栗粉を薄く付けて肉だねを詰める。肉を下にして油で焼く。','裏返して水を加え、ふたをして蒸し焼きにする。肉だねの中心75℃で1分以上を確認する。']),
  recipe('tofu-sesame-crust','豆腐のごま衣焼き','和食',25,
    [['tofu',400],['sesame',30],['rice_flour',25],['water',40],['salt',1.5],['oil',15],['lemon',15]],
    ['豆腐を水切りして食べやすく切り、塩を振る。米粉と水を混ぜる。','豆腐に米粉液を薄く付け、ごまをまぶす。','油を引いたフライパンで各面を焼き、中まで熱くする。レモン汁を添える。']),
  extraSide('potato-pepper-strips','じゃがいもとピーマンの細切り炒め','中華',20,
    [['potato',250],['pepper',120],['garlic',5],['oil',10],['vinegar',10],['salt',1.5]],
    ['じゃがいもとピーマンを細切りにし、じゃがいもは水にさらして水気を切る。にんにくを刻む。','油でにんにくとじゃがいもを炒め、柔らかくなったらピーマンを加える。','全体に火が通ったら酢と塩を加え、さっと混ぜる。']),
  extraSide('kiriboshi-cucumber','切り干し大根ときゅうりのマリネ','和食',20,
    [['kiriboshi_daikon',30],['cucumber',150],['vinegar',20],['sugar',6],['soy_sauce',10],['sesame_oil',5]],
    ['切り干し大根を洗って袋の表示どおりに戻し、さっとゆでて水気を絞る。','きゅうりを細切りにし、酢・砂糖・しょうゆ・ごま油を混ぜる。','切り干し大根ときゅうりを調味液で和え、冷蔵庫で10分ほどなじませる。']),
  extraSide('daikon-leaf-tofu','大根の葉と油揚げの炒め煮','和食',20,
    [['daikon_leaf',200],['aburaage',60],['soy_sauce',15],['mirin',15],['oil',5],['water',80]],
    ['大根の葉を洗って細かく切り、油揚げは熱湯をかけて細切りにする。','油で大根の葉と油揚げを炒める。','水・しょうゆ・みりんを加え、葉が柔らかく汁気が少なくなるまで煮る。']),
  extraSide('chickpea-carrot-lemon','ひよこ豆とにんじんのレモンサラダ','洋食',20,
    [['chickpea_cooked',180],['carrot',180],['lemon',20],['olive_oil',10],['salt',1.5],['parsley',3]],
    ['にんじんを細切りにして柔らかくゆで、水気を切る。ひよこ豆を温める。','レモン汁・オリーブ油・塩・刻んだパセリを混ぜる。','にんじんとひよこ豆を調味液で和え、粗熱を取る。']),
  extraSide('sweet-potato-apple','さつまいもとりんごの重ね煮','和食',30,
    [['sweet_potato',250],['apple',200],['water',150],['lemon',10],['sugar',8]],
    ['さつまいもとりんごを薄切りにし、さつまいもは水にさらす。りんごの芯を除く。','鍋にさつまいもとりんごを交互に重ね、水・レモン汁・砂糖を加える。','ふたをして弱火で20分ほど煮て、さつまいもが柔らかくなったら火を止める。']),
  extraSide('yam-shimeji-butter','長いもとしめじのバター焼き','洋食',20,
    [['yam',250],['shimeji',150],['butter',15],['salt',1.5],['black_pepper',0.2]],
    ['長いもを皮をむいて薄めの半月切り、しめじを小房に分ける。','フライパンにバターを溶かし、長いもとしめじを並べて両面を焼く。','ふたをして長いもが柔らかくなるまで加熱し、塩とこしょうで調える。']),
  extraSide('carrot-pumpkin-mash','にんじんとかぼちゃのマッシュ','洋食',25,
    [['carrot',180],['pumpkin',220],['milk',80],['salt',1.2],['black_pepper',0.2]],
    ['にんじんとかぼちゃの皮や種を整え、一口大に切る。','柔らかくゆでて湯を切り、熱いうちにつぶす。','牛乳を少しずつ混ぜて好みの硬さにし、塩とこしょうを加えて弱火で温める。']),
  extraSide('aubergine-tomato-cold','焼きなすとトマトの冷たい小鉢','和食',25,
    [['aubergine',250],['tomato',180],['ginger',8],['soy_sauce',15],['vinegar',10],['oil',10]],
    ['なすを縦に切り、油を引いたフライパンでふたをして中まで柔らかく焼く。','トマトを角切りにし、すりおろしたしょうが・しょうゆ・酢と混ぜる。','粗熱を取ったなすを食べやすく切り、トマトのたれをかけて冷蔵庫で冷やす。']),
];

const SIDE_SOUP_RECIPES = [
  {
    "id": "side-001",
    "name": "ほうれん草のごま和え",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "spinach",
        "amount": 180.0
      },
      {
        "id": "ground_sesame",
        "amount": 10.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "sugar",
        "amount": 3.0
      }
    ],
    "steps": [
      "ほうれん草を洗い、沸騰した湯で茎から入れて1〜2分ゆでる。冷水に取り、水気を絞って3cmに切る。",
      "すりごま、しょうゆ、砂糖をボウルで混ぜる。",
      "ほうれん草を加えてほぐし、調味料を全体にからめる。"
    ],
    "tags": [
      "野菜中心",
      "定番"
    ],
    "staple": false
  },
  {
    "id": "side-002",
    "name": "小松菜と豆腐のさっと煮",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "komatsuna",
        "amount": 160.0
      },
      {
        "id": "tofu",
        "amount": 150.0
      },
      {
        "id": "water",
        "amount": 120.0
      },
      {
        "id": "bonito",
        "amount": 2.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      }
    ],
    "steps": [
      "小松菜を4cmに切り、豆腐は食べやすい大きさに切る。",
      "鍋に水、かつお節、しょうゆ、みりんを入れて沸かし、豆腐と小松菜の茎を3分煮る。",
      "小松菜の葉を加えて2分煮て、火を止めて味をなじませる。"
    ],
    "tags": [
      "野菜中心",
      "時短"
    ],
    "staple": false
  },
  {
    "id": "side-003",
    "name": "にんじんとオレンジのサラダ",
    "role": "side",
    "genre": "洋食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "carrot",
        "amount": 160.0
      },
      {
        "id": "orange",
        "amount": 100.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "lemon",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "にんじんを細切りにし、塩をふって5分置いて水気を軽く絞る。",
      "オレンジの皮と薄皮を除き、食べやすい大きさに分ける。",
      "オリーブ油、レモン汁、こしょうを混ぜ、にんじんとオレンジを和える。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-004",
    "name": "きゅうりとわかめの酢の物",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "cucumber",
        "amount": 160.0
      },
      {
        "id": "wakame",
        "amount": 3.0
      },
      {
        "id": "vinegar",
        "amount": 15.0
      },
      {
        "id": "sugar",
        "amount": 5.0
      },
      {
        "id": "soy_sauce",
        "amount": 5.0
      },
      {
        "id": "salt",
        "amount": 0.5
      }
    ],
    "steps": [
      "きゅうりを薄切りにして塩をもみ込み、5分置いて水気を絞る。",
      "乾燥わかめを水で戻し、食べやすく切って水気を切る。",
      "米酢、砂糖、しょうゆを混ぜ、きゅうりとわかめを和える。"
    ],
    "tags": [
      "さっぱり",
      "定番"
    ],
    "staple": false
  },
  {
    "id": "side-005",
    "name": "大根のしょうが焼き",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "daikon",
        "amount": 260.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "mirin",
        "amount": 15.0
      },
      {
        "id": "oil",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 50.0
      }
    ],
    "steps": [
      "大根を厚さ1cmの半月切りにし、耐熱容器に水とともに入れ、ふんわり覆って600Wで5分加熱する。",
      "フライパンに油を熱し、水気を切った大根を両面こんがりと焼く。",
      "すりおろしたしょうが、しょうゆ、みりんを加え、汁をからめて仕上げる。"
    ],
    "tags": [
      "野菜中心",
      "香ばしい"
    ],
    "staple": false
  },
  {
    "id": "side-006",
    "name": "キャベツの梅おかか和え",
    "role": "side",
    "genre": "和食",
    "minutes": 10,
    "servings": 2,
    "ingredients": [
      {
        "id": "cabbage",
        "amount": 220.0
      },
      {
        "id": "ume",
        "amount": 12.0
      },
      {
        "id": "bonito",
        "amount": 3.0
      },
      {
        "id": "soy_sauce",
        "amount": 5.0
      }
    ],
    "steps": [
      "キャベツをざく切りにし、耐熱容器でふんわり覆って600Wで3〜4分加熱する。",
      "粗熱を取り、水気を軽く絞る。梅干しは種を除いてたたく。",
      "梅、しょうゆ、かつお節をキャベツに混ぜる。"
    ],
    "tags": [
      "時短",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-007",
    "name": "ブロッコリーときのこの蒸し焼き",
    "role": "side",
    "genre": "洋食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "broccoli",
        "amount": 180.0
      },
      {
        "id": "shimeji",
        "amount": 100.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "water",
        "amount": 40.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "ブロッコリーを小房に分け、きのこをほぐす。にんにくは薄切りにする。",
      "フライパンにオリーブ油とにんにくを入れて弱火で温め、野菜と水を加える。",
      "ふたをして5分蒸し、ふたを取って水分を飛ばし、塩とこしょうで調える。"
    ],
    "tags": [
      "野菜中心",
      "時短"
    ],
    "staple": false
  },
  {
    "id": "side-008",
    "name": "かぼちゃの含め煮",
    "role": "side",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "pumpkin",
        "amount": 300.0
      },
      {
        "id": "water",
        "amount": 200.0
      },
      {
        "id": "sugar",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      }
    ],
    "steps": [
      "かぼちゃの種とわたを取り、皮の硬い部分を薄くそいで一口大に切る。",
      "小鍋に皮を下にして並べ、水、砂糖、しょうゆ、みりんを加える。",
      "落としぶたをして弱めの中火で12〜15分煮る。竹串が通ったら火を止めて冷ます。"
    ],
    "tags": [
      "定番",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-009",
    "name": "さつまいものレモン煮",
    "role": "side",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "sweet_potato",
        "amount": 260.0
      },
      {
        "id": "lemon_slice",
        "amount": 20.0
      },
      {
        "id": "sugar",
        "amount": 12.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "salt",
        "amount": 0.3
      }
    ],
    "steps": [
      "さつまいもを皮つきの輪切りにし、水に5分さらす。",
      "小鍋に水気を切ったさつまいも、水、砂糖、塩を入れ、弱火で10分煮る。",
      "レモンを加え、さつまいもが柔らかくなるまでさらに5分ほど煮て冷ます。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-010",
    "name": "いんげんのアーモンドソテー",
    "role": "side",
    "genre": "洋食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "green_beans",
        "amount": 180.0
      },
      {
        "id": "almond",
        "amount": 15.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "いんげんの筋を取り、沸騰した湯で2分下ゆでする。アーモンドを粗く刻む。",
      "フライパンにバターを溶かし、いんげんを3分ほど炒める。",
      "アーモンド、塩、こしょうを加え、香りが立つまで炒め合わせる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-011",
    "name": "れんこんのごま照り焼き",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "lotus_root",
        "amount": 220.0
      },
      {
        "id": "sesame",
        "amount": 12.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "oil",
        "amount": 8.0
      }
    ],
    "steps": [
      "れんこんを厚さ7mmに切り、水にさらして水気を拭く。",
      "油を熱したフライパンに並べ、ふたをして両面を各3〜4分焼く。",
      "しょうゆ、みりんを加えて煮からめ、いりごまをふる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-012",
    "name": "ごぼうとにんじんのきんぴら",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "burdock",
        "amount": 140.0
      },
      {
        "id": "carrot",
        "amount": 70.0
      },
      {
        "id": "sesame_oil",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "mirin",
        "amount": 12.0
      },
      {
        "id": "sugar",
        "amount": 4.0
      },
      {
        "id": "sesame",
        "amount": 4.0
      },
      {
        "id": "water",
        "amount": 30.0
      }
    ],
    "steps": [
      "ごぼうとにんじんを細切りにし、ごぼうは水にさっとさらす。",
      "ごま油で野菜を炒め、水、しょうゆ、みりん、砂糖を加えてふたをし、4分蒸し煮にする。",
      "ふたを取って汁気を飛ばし、いりごまを混ぜる。"
    ],
    "tags": [
      "定番",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-013",
    "name": "なすの田楽みそ",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "aubergine",
        "amount": 260.0
      },
      {
        "id": "miso",
        "amount": 20.0
      },
      {
        "id": "mirin",
        "amount": 15.0
      },
      {
        "id": "sugar",
        "amount": 6.0
      },
      {
        "id": "water",
        "amount": 15.0
      },
      {
        "id": "oil",
        "amount": 10.0
      },
      {
        "id": "sesame",
        "amount": 3.0
      }
    ],
    "steps": [
      "なすを縦半分に切り、切り口に浅い格子状の切り込みを入れる。",
      "フライパンに油を熱し、なすを切り口から焼く。裏返してふたをし、柔らかくなるまで蒸し焼きにする。",
      "みそ、みりん、砂糖、水を別の小鍋で混ぜながら1分煮る。なすに塗り、ごまをふる。"
    ],
    "tags": [
      "野菜中心",
      "定番"
    ],
    "staple": false
  },
  {
    "id": "side-014",
    "name": "オクラとトマトのおかか和え",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "okra",
        "amount": 100.0
      },
      {
        "id": "tomato",
        "amount": 140.0
      },
      {
        "id": "bonito",
        "amount": 3.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "vinegar",
        "amount": 5.0
      }
    ],
    "steps": [
      "オクラのがくを整え、沸騰した湯で2分ゆでて輪切りにする。",
      "トマトを一口大に切り、しょうゆと米酢を混ぜる。",
      "オクラ、トマト、かつお節を調味料で和える。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-015",
    "name": "かぶの甘酢漬け",
    "role": "side",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "turnip",
        "amount": 240.0
      },
      {
        "id": "vinegar",
        "amount": 25.0
      },
      {
        "id": "sugar",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      }
    ],
    "steps": [
      "かぶを薄いいちょう切りにし、塩をもんで10分置き、水気を絞る。",
      "米酢、砂糖、細切りのしょうがを混ぜる。",
      "かぶを和え、冷蔵庫で10分ほど置いて味をなじませる。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-016",
    "name": "ズッキーニのチーズ焼き",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "zucchini",
        "amount": 240.0
      },
      {
        "id": "cheese",
        "amount": 40.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.6
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "ズッキーニを厚さ1cmの輪切りにし、オリーブ油と塩をからめる。",
      "天板に並べ、200℃に予熱したオーブンで10分焼く。",
      "チーズとこしょうをのせ、チーズに焼き色がつくまでさらに3〜5分焼く。"
    ],
    "tags": [
      "野菜中心",
      "香ばしい"
    ],
    "staple": false
  },
  {
    "id": "side-017",
    "name": "トマトとモッツァレラのサラダ",
    "role": "side",
    "genre": "洋食",
    "minutes": 10,
    "servings": 2,
    "ingredients": [
      {
        "id": "tomato",
        "amount": 220.0
      },
      {
        "id": "mozzarella",
        "amount": 100.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "lemon",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.5
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "トマトとモッツァレラを食べやすい厚さに切り、交互に盛る。",
      "オリーブ油、レモン汁、塩をよく混ぜる。",
      "全体にかけ、こしょうと刻んだパセリを散らす。"
    ],
    "tags": [
      "時短",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-018",
    "name": "じゃがいものガーリックロースト",
    "role": "side",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "potato",
        "amount": 300.0
      },
      {
        "id": "garlic",
        "amount": 6.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "じゃがいもを皮つきのくし形に切り、水にさらして水気をよく拭く。",
      "薄切りのにんにく、オリーブ油、塩をからめ、天板に重ならないように並べる。",
      "210℃に予熱したオーブンで20〜25分焼く。竹串が通ったら、こしょうとパセリをふる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-019",
    "name": "カリフラワーのターメリック炒め",
    "role": "side",
    "genre": "その他",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "cauliflower",
        "amount": 260.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "turmeric",
        "amount": 1.0
      },
      {
        "id": "cumin",
        "amount": 0.5
      },
      {
        "id": "oil",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 40.0
      }
    ],
    "steps": [
      "カリフラワーを小房に分け、玉ねぎを薄切りにする。",
      "油で玉ねぎを炒め、ターメリックとクミンを加えて香りを出す。",
      "カリフラワー、塩、水を加えてふたをし、5〜7分蒸す。ふたを取り、水分を飛ばす。"
    ],
    "tags": [
      "野菜中心",
      "香りを楽しむ"
    ],
    "staple": false
  },
  {
    "id": "side-020",
    "name": "ビーツのヨーグルトサラダ",
    "role": "side",
    "genre": "洋食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "id": "beet",
        "amount": 220.0
      },
      {
        "id": "yogurt",
        "amount": 70.0
      },
      {
        "id": "lemon",
        "amount": 10.0
      },
      {
        "id": "olive_oil",
        "amount": 5.0
      },
      {
        "id": "salt",
        "amount": 0.8
      }
    ],
    "steps": [
      "ビーツの皮をむいて1cm角に切り、柔らかくなるまで20分ほどゆで、水気を切って冷ます。",
      "ヨーグルト、レモン汁、オリーブ油、塩を混ぜる。",
      "ビーツを和え、冷蔵庫で5分なじませる。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-021",
    "name": "レンズ豆とセロリの温サラダ",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "lentil_cooked",
        "amount": 180.0
      },
      {
        "id": "celery",
        "amount": 80.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "vinegar",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "セロリとにんじんを小さな角切りにする。",
      "オリーブ油でにんじんとセロリを炒め、ゆでたレンズ豆を加えて温める。",
      "火を止め、米酢、塩、こしょうを混ぜ、温かいうちに盛る。"
    ],
    "tags": [
      "豆を使う",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-022",
    "name": "きのこのレモンマリネ",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "shimeji",
        "amount": 260.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "lemon",
        "amount": 15.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "きのこをほぐし、にんにくをみじん切りにする。",
      "フライパンでオリーブ油とにんにくを温め、きのこと塩を加えてしんなりするまで5分炒める。",
      "火を止めてレモン汁を混ぜ、冷ましてからパセリを散らす。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-023",
    "name": "キャベツとコーンのミルク煮",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "cabbage",
        "amount": 220.0
      },
      {
        "id": "corn",
        "amount": 80.0
      },
      {
        "id": "milk",
        "amount": 120.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "キャベツをざく切りにする。",
      "鍋にバターを溶かしてキャベツを炒め、コーンと牛乳を加える。",
      "ふたをして弱火で7分ほど煮る。塩とこしょうで味を調える。"
    ],
    "tags": [
      "野菜中心",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "side-024",
    "name": "アスパラガスの炒り卵",
    "role": "side",
    "genre": "洋食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "asparagus",
        "amount": 150.0
      },
      {
        "id": "egg",
        "amount": 2.0
      },
      {
        "id": "milk",
        "amount": 20.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "アスパラガスの硬い根元を落として斜めに切る。卵に牛乳、塩、こしょうを混ぜる。",
      "バターを溶かしたフライパンでアスパラガスを3分ほど炒める。",
      "卵液を加え、大きく混ぜながら卵に液状の部分が残らなくなるまで十分に加熱する。"
    ],
    "tags": [
      "時短",
      "卵を使う"
    ],
    "staple": false
  },
  {
    "id": "side-025",
    "name": "グリーンピースとにんじんの蒸し煮",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "green_pea",
        "amount": 140.0
      },
      {
        "id": "carrot",
        "amount": 100.0
      },
      {
        "id": "onion",
        "amount": 50.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 80.0
      },
      {
        "id": "salt",
        "amount": 0.8
      }
    ],
    "steps": [
      "にんじんと玉ねぎを小さな角切りにする。",
      "鍋にバターを溶かして玉ねぎを炒め、にんじん、グリーンピース、水を加える。",
      "ふたをして弱火で8〜10分煮て、にんじんが柔らかくなったら塩で調える。"
    ],
    "tags": [
      "野菜中心",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "side-026",
    "name": "パプリカのクミン焼き",
    "role": "side",
    "genre": "その他",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "paprika",
        "amount": 260.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "cumin",
        "amount": 1.0
      },
      {
        "id": "lemon",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 1.0
      }
    ],
    "steps": [
      "パプリカを細長く切り、玉ねぎを薄切りにする。",
      "オリーブ油で玉ねぎを炒め、パプリカとクミンを加えて焼き色がつくまで炒める。",
      "塩で調え、火を止めてレモン汁を加える。"
    ],
    "tags": [
      "野菜中心",
      "香りを楽しむ"
    ],
    "staple": false
  },
  {
    "id": "side-027",
    "name": "枝豆と豆腐のつぶし和え",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 180.0
      },
      {
        "id": "edamame",
        "amount": 100.0
      },
      {
        "id": "ground_sesame",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "sugar",
        "amount": 2.0
      }
    ],
    "steps": [
      "豆腐を耐熱容器で覆って600Wで2分加熱し、冷まして水気を切る。枝豆はゆでてさやから出す。",
      "豆腐をボウルでつぶし、すりごま、しょうゆ、砂糖を混ぜる。",
      "枝豆を加えて和える。"
    ],
    "tags": [
      "豆を使う",
      "時短"
    ],
    "staple": false
  },
  {
    "id": "side-028",
    "name": "ほうれん草とにんじんの白和え",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "spinach",
        "amount": 100.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "tofu",
        "amount": 180.0
      },
      {
        "id": "ground_sesame",
        "amount": 10.0
      },
      {
        "id": "miso",
        "amount": 8.0
      },
      {
        "id": "sugar",
        "amount": 4.0
      }
    ],
    "steps": [
      "豆腐を耐熱容器で覆って600Wで2分加熱し、水気を切って冷ます。",
      "にんじんを細切りにしてゆで、ほうれん草もゆでて水気を絞り、3cmに切る。",
      "豆腐をつぶし、すりごま、みそ、砂糖を混ぜてから野菜を和える。"
    ],
    "tags": [
      "定番",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "side-029",
    "name": "ひじきと大豆の煮物",
    "role": "side",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "hijiki",
        "amount": 10.0
      },
      {
        "id": "soybeans",
        "amount": 100.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 180.0
      },
      {
        "id": "bonito",
        "amount": 2.0
      },
      {
        "id": "soy_sauce",
        "amount": 15.0
      },
      {
        "id": "mirin",
        "amount": 15.0
      },
      {
        "id": "sugar",
        "amount": 5.0
      },
      {
        "id": "oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "ひじきは袋の指定どおりに水で戻して洗う。にんじんを細切りにする。",
      "油でにんじんとひじきを炒め、大豆、水、かつお節を加えて5分煮る。",
      "しょうゆ、みりん、砂糖を加え、汁気が少なくなるまで弱火で10分煮る。"
    ],
    "tags": [
      "定番",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "side-030",
    "name": "切り干し大根の含め煮",
    "role": "side",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "kiriboshi_daikon",
        "amount": 25.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "shiitake",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 220.0
      },
      {
        "id": "bonito",
        "amount": 2.0
      },
      {
        "id": "soy_sauce",
        "amount": 15.0
      },
      {
        "id": "mirin",
        "amount": 15.0
      },
      {
        "id": "oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "切り干し大根を水でもみ洗いして10分戻し、水気を絞る。にんじんとしいたけを細切りにする。",
      "油で材料を炒め、水とかつお節を加えて5分煮る。",
      "しょうゆ、みりんを加えて弱火で10分ほど煮て、汁を含ませる。"
    ],
    "tags": [
      "定番",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-031",
    "name": "里いものみそバター焼き",
    "role": "side",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "taro",
        "amount": 260.0
      },
      {
        "id": "miso",
        "amount": 12.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "butter",
        "amount": 10.0
      },
      {
        "id": "water",
        "amount": 30.0
      }
    ],
    "steps": [
      "里いもの皮をむいて厚さ1cmに切り、竹串が通るまでゆでて水気を切る。",
      "フライパンにバターを溶かし、里いもの両面に焼き色をつける。",
      "みそ、みりん、水を混ぜて加え、焦がさないように煮からめる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-032",
    "name": "長いもの青ねぎ焼き",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "yam",
        "amount": 260.0
      },
      {
        "id": "scallion_garnish",
        "amount": 15.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "oil",
        "amount": 8.0
      },
      {
        "id": "bonito",
        "amount": 2.0
      }
    ],
    "steps": [
      "長いもの皮をむき、厚さ1cmに切る。小ねぎを刻む。",
      "油を熱したフライパンに長いもを並べ、ふたをして両面を各4分ほど焼く。",
      "しょうゆとみりんを加えてからめ、小ねぎとかつお節を散らす。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-033",
    "name": "大根とりんごのシャキシャキサラダ",
    "role": "side",
    "genre": "その他",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "daikon",
        "amount": 180.0
      },
      {
        "id": "apple",
        "amount": 100.0
      },
      {
        "id": "lemon",
        "amount": 12.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "大根を細切りにし、塩をふって5分置き、出た水気を切る。",
      "りんごの芯を取り、皮つきの細切りにしてレモン汁をからめる。",
      "大根とりんごを合わせ、オリーブ油とこしょうを混ぜる。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-034",
    "name": "紫キャベツとレーズンの甘酢和え",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "red_cabbage",
        "amount": 220.0
      },
      {
        "id": "raisin",
        "amount": 25.0
      },
      {
        "id": "vinegar",
        "amount": 20.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "sugar",
        "amount": 4.0
      },
      {
        "id": "salt",
        "amount": 1.0
      }
    ],
    "steps": [
      "紫キャベツを細切りにして塩をふり、5分置いて水気を絞る。",
      "レーズンを少量の湯で2分戻し、水気を切る。",
      "米酢、オリーブ油、砂糖を混ぜ、キャベツとレーズンを和えて10分なじませる。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-035",
    "name": "赤いんげん豆のトマト煮",
    "role": "side",
    "genre": "その他",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "kidney_bean_cooked",
        "amount": 180.0
      },
      {
        "id": "tomato",
        "amount": 200.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "cumin",
        "amount": 0.5
      },
      {
        "id": "paprika_powder",
        "amount": 1.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 60.0
      }
    ],
    "steps": [
      "玉ねぎとにんにくをみじん切りにし、トマトを角切りにする。",
      "オリーブ油で玉ねぎとにんにくを炒め、クミンとパプリカパウダーを加える。",
      "水煮の赤いんげん豆、トマト、水、塩を加えて弱火で12分煮る。"
    ],
    "tags": [
      "豆を使う",
      "しっかり味"
    ],
    "staple": false
  },
  {
    "id": "side-036",
    "name": "カリフラワーのヨーグルト和え",
    "role": "side",
    "genre": "その他",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "cauliflower",
        "amount": 240.0
      },
      {
        "id": "yogurt",
        "amount": 80.0
      },
      {
        "id": "cumin",
        "amount": 0.5
      },
      {
        "id": "lemon",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "カリフラワーを小房に分け、柔らかくなるまで4〜5分ゆで、水気を切って冷ます。",
      "ヨーグルト、クミン、レモン汁、塩を混ぜる。",
      "カリフラワーを和え、刻んだパセリを散らす。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-037",
    "name": "きのこの茶わん蒸し",
    "role": "side",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "egg",
        "amount": 2.0
      },
      {
        "id": "shiitake",
        "amount": 60.0
      },
      {
        "id": "shimeji",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 240.0
      },
      {
        "id": "kombu",
        "amount": 2.0
      },
      {
        "id": "soy_sauce",
        "amount": 6.0
      },
      {
        "id": "salt",
        "amount": 0.5
      }
    ],
    "steps": [
      "水と昆布を弱火で温め、沸く直前に昆布を取り出して冷ます。きのこは薄切りにする。",
      "溶いた卵に昆布だし、しょうゆ、塩を混ぜ、こしてから器に入れ、きのこを加える。",
      "蒸気の上がった蒸し器で弱火で15〜20分蒸す。中心まで固まり、透明な汁が出ることを確認する。"
    ],
    "tags": [
      "卵を使う",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "side-038",
    "name": "じゃがいものチーズおやき",
    "role": "side",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "potato",
        "amount": 260.0
      },
      {
        "id": "cheese",
        "amount": 40.0
      },
      {
        "id": "cornstarch",
        "amount": 20.0
      },
      {
        "id": "milk",
        "amount": 30.0
      },
      {
        "id": "salt",
        "amount": 0.6
      },
      {
        "id": "oil",
        "amount": 8.0
      }
    ],
    "steps": [
      "じゃがいもの皮をむいてゆで、柔らかいうちにつぶす。",
      "コーンスターチ、牛乳、塩を混ぜ、4等分してチーズを包み、平たい丸形にする。",
      "油を熱したフライパンで両面を各4分ほど焼き、中まで熱くなり表面がこんがりしたら取り出す。"
    ],
    "tags": [
      "香ばしい",
      "手作り"
    ],
    "staple": false
  },
  {
    "id": "side-039",
    "name": "コーンの卵入りフリッター",
    "role": "side",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "corn",
        "amount": 160.0
      },
      {
        "id": "egg",
        "amount": 1.0
      },
      {
        "id": "flour",
        "amount": 40.0
      },
      {
        "id": "water",
        "amount": 30.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "oil",
        "amount": 20.0
      }
    ],
    "steps": [
      "ボウルに卵、薄力粉、水、塩を混ぜ、コーンを加える。",
      "フライパンに油を熱し、生地をスプーンで小さく落として平らにする。",
      "中火で両面を各3〜4分焼き、卵と粉に火が通って中に生の生地が残らないことを確かめる。"
    ],
    "tags": [
      "香ばしい",
      "卵を使う"
    ],
    "staple": false
  },
  {
    "id": "side-040",
    "name": "もやしとにらの香味炒め",
    "role": "side",
    "genre": "中華",
    "minutes": 10,
    "servings": 2,
    "ingredients": [
      {
        "id": "bean_sprout",
        "amount": 200.0
      },
      {
        "id": "chive",
        "amount": 70.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "sesame_oil",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 0.5
      }
    ],
    "steps": [
      "もやしを洗ってよく水を切り、にらを4cmに切る。にんにくとしょうがをみじん切りにする。",
      "ごま油でにんにくとしょうがを温め、もやしを入れて強めの中火で2分炒める。",
      "にら、しょうゆ、塩を加え、全体に火が通るまでさらに1〜2分炒める。"
    ],
    "tags": [
      "時短",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-041",
    "name": "蒸しなすのしょうが酢だれ",
    "role": "side",
    "genre": "中華",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "aubergine",
        "amount": 280.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "vinegar",
        "amount": 12.0
      },
      {
        "id": "sesame_oil",
        "amount": 8.0
      },
      {
        "id": "sugar",
        "amount": 3.0
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "なすを縦に4等分して耐熱皿に並べ、ふんわり覆って600Wで5〜6分加熱する。",
      "すりおろしたしょうが、しょうゆ、米酢、ごま油、砂糖を混ぜる。",
      "なすが柔らかくなったらたれをかけ、刻んだ小ねぎを散らす。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-042",
    "name": "豆腐のきのこあん",
    "role": "side",
    "genre": "中華",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 240.0
      },
      {
        "id": "shimeji",
        "amount": 100.0
      },
      {
        "id": "enoki",
        "amount": 70.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "water",
        "amount": 180.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "cornstarch",
        "amount": 8.0
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "豆腐を4等分し、きのこをほぐす。しょうがを細切りにする。コーンスターチは分量の水から大さじ1を取って溶く。",
      "鍋に残りの水、しょうゆ、みりん、しょうが、きのこ、豆腐を入れ、沸いてから5分煮る。",
      "水溶きコーンスターチを少しずつ混ぜ、とろみが出るまで煮る。最後にごま油を加える。"
    ],
    "tags": [
      "豆を使う",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "side-043",
    "name": "ピーマンと豆腐の卵炒め",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "pepper",
        "amount": 160.0
      },
      {
        "id": "tofu",
        "amount": 180.0
      },
      {
        "id": "egg",
        "amount": 1.0
      },
      {
        "id": "oil",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 0.5
      },
      {
        "id": "bonito",
        "amount": 2.0
      }
    ],
    "steps": [
      "豆腐は水を切って一口大にちぎり、ピーマンは細切りにする。卵は溶く。",
      "油を熱したフライパンで豆腐を焼き、ピーマンを加えて3分炒める。",
      "卵、しょうゆ、塩を加え、卵の液状部分がなくなるまで十分に炒め、かつお節を混ぜる。"
    ],
    "tags": [
      "卵を使う",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "side-044",
    "name": "にんじんとキャベツのコールスロー",
    "role": "side",
    "genre": "洋食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "cabbage",
        "amount": 180.0
      },
      {
        "id": "carrot",
        "amount": 80.0
      },
      {
        "id": "mayonnaise",
        "amount": 25.0
      },
      {
        "id": "vinegar",
        "amount": 10.0
      },
      {
        "id": "sugar",
        "amount": 3.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "キャベツとにんじんを細切りにし、塩をもみ込んで5分置く。",
      "野菜の水気をしっかり絞る。",
      "マヨネーズ、米酢、砂糖、こしょうを混ぜ、野菜を和える。マヨネーズは製品の原材料表示を確認する。"
    ],
    "tags": [
      "さっぱり",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-045",
    "name": "ひよこ豆のごまペースト和え",
    "role": "side",
    "genre": "その他",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "chickpea_cooked",
        "amount": 180.0
      },
      {
        "id": "ground_sesame",
        "amount": 15.0
      },
      {
        "id": "lemon",
        "amount": 15.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "garlic",
        "amount": 2.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 30.0
      }
    ],
    "steps": [
      "水煮のひよこ豆をさっと洗い、水気を切る。にんにくをすりおろす。",
      "ひよこ豆、すりごま、レモン汁、オリーブ油、にんにく、塩、水をフードプロセッサーでなめらかにする。",
      "硬ければ分量内の水を少量ずつ加えて混ぜ、器に盛る。"
    ],
    "tags": [
      "豆を使う",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-046",
    "name": "ブロッコリーのごまレモン和え",
    "role": "side",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "broccoli",
        "amount": 240.0
      },
      {
        "id": "ground_sesame",
        "amount": 12.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "lemon",
        "amount": 10.0
      },
      {
        "id": "sugar",
        "amount": 2.0
      }
    ],
    "steps": [
      "ブロッコリーを小房に分け、茎は皮をむいて薄切りにする。",
      "沸騰した湯で3〜4分ゆで、ざるに上げて水気をよく切る。",
      "すりごま、しょうゆ、レモン汁、砂糖を混ぜ、ブロッコリーを和える。"
    ],
    "tags": [
      "野菜中心",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-047",
    "name": "青菜とカシューナッツの炒め物",
    "role": "side",
    "genre": "中華",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "komatsuna",
        "amount": 200.0
      },
      {
        "id": "paprika",
        "amount": 80.0
      },
      {
        "id": "cashew",
        "amount": 25.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "oil",
        "amount": 10.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 0.5
      }
    ],
    "steps": [
      "小松菜を4cmに、パプリカを細切りにする。しょうがをみじん切りにする。",
      "フライパンでカシューナッツを弱火で軽くいり、いったん取り出す。",
      "油としょうがを熱し、小松菜の茎、パプリカ、葉の順に炒める。しょうゆ、塩、ナッツを加えて混ぜる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-048",
    "name": "アボカドとトマトのつぶしサラダ",
    "role": "side",
    "genre": "その他",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "avocado",
        "amount": 160.0
      },
      {
        "id": "tomato",
        "amount": 120.0
      },
      {
        "id": "onion",
        "amount": 30.0
      },
      {
        "id": "lemon",
        "amount": 15.0
      },
      {
        "id": "olive_oil",
        "amount": 5.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "玉ねぎを細かく刻んで水に5分さらし、水気を切る。トマトは種を軽く除いて角切りにする。",
      "アボカドの皮と種を除いて粗くつぶし、レモン汁を混ぜる。",
      "玉ねぎ、トマト、オリーブ油、塩、こしょうを加えて和える。"
    ],
    "tags": [
      "さっぱり",
      "手軽"
    ],
    "staple": false
  },
  {
    "id": "side-049",
    "name": "じゃがいもときゅうりのヨーグルトサラダ",
    "role": "side",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "potato",
        "amount": 250.0
      },
      {
        "id": "cucumber",
        "amount": 100.0
      },
      {
        "id": "yogurt",
        "amount": 60.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "lemon",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "じゃがいもの皮をむいて一口大に切り、柔らかくなるまでゆでて水気を飛ばす。",
      "きゅうりを薄切りにして塩の半量をふり、水気を絞る。",
      "じゃがいもが冷めたら、きゅうり、ヨーグルト、オリーブ油、レモン汁、残りの塩、こしょうを混ぜる。"
    ],
    "tags": [
      "さっぱり",
      "定番"
    ],
    "staple": false
  },
  {
    "id": "side-050",
    "name": "野菜のラタトゥイユ",
    "role": "side",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "aubergine",
        "amount": 100.0
      },
      {
        "id": "zucchini",
        "amount": 100.0
      },
      {
        "id": "paprika",
        "amount": 100.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "tomato",
        "amount": 200.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "野菜を2cm角に切り、にんにくはみじん切りにする。",
      "鍋にオリーブ油とにんにくを入れて温め、玉ねぎ、なす、ズッキーニ、パプリカを順に炒める。",
      "トマトと塩を加え、ふたをして弱火で15分煮る。ふたを取り、汁を少し煮詰めてこしょうをふる。"
    ],
    "tags": [
      "野菜中心",
      "定番"
    ],
    "staple": false
  },
  {
    "id": "soup-001",
    "name": "豆腐とわかめのみそ汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 120.0
      },
      {
        "id": "wakame",
        "amount": 3.0
      },
      {
        "id": "miso",
        "amount": 24.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "昆布を水に5分浸してから弱火で温め、沸く直前に取り出す。豆腐を角切りにする。",
      "昆布だしに豆腐と乾燥わかめを入れ、わかめが戻るまで2〜3分煮る。",
      "弱火にしてみそを溶き、沸騰させずに温め、刻んだ小ねぎを散らす。"
    ],
    "tags": [
      "定番",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-002",
    "name": "なめこと長ねぎのみそ汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "nameko",
        "amount": 100.0
      },
      {
        "id": "negi",
        "amount": 70.0
      },
      {
        "id": "miso",
        "amount": 24.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "bonito",
        "amount": 4.0
      }
    ],
    "steps": [
      "なめこをさっと洗い、長ねぎを薄い斜め切りにする。",
      "鍋に水とかつお節を入れて沸かし、なめこと長ねぎを加えて5分煮る。",
      "弱火にし、みそを溶いて温める。"
    ],
    "tags": [
      "定番",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-003",
    "name": "大根と豚肉のみそ汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "daikon",
        "amount": 140.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "pork",
        "amount": 100.0
      },
      {
        "id": "miso",
        "amount": 26.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      }
    ],
    "steps": [
      "大根とにんじんを薄いいちょう切りにし、豚肉を食べやすく切る。しょうがを薄切りにする。",
      "水と昆布を弱火で温めて沸く直前に昆布を取り出し、野菜としょうがを加えて8分煮る。",
      "豚肉を加えてほぐし、中心75℃で1分以上加熱する。野菜が柔らかくなったらみそを溶く。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-004",
    "name": "かぼちゃの豆乳ポタージュ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "pumpkin",
        "amount": 240.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "soy_milk",
        "amount": 200.0
      },
      {
        "id": "water",
        "amount": 200.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "かぼちゃの皮の硬い部分を取り、薄切りにする。玉ねぎも薄切りにする。",
      "鍋にオリーブ油を熱して玉ねぎを炒め、かぼちゃと水を加えて柔らかくなるまで12分ほど煮る。",
      "粗熱を取ってからブレンダーでなめらかにし、鍋に戻して豆乳を加える。弱火で温め、塩とこしょうで調える。"
    ],
    "tags": [
      "野菜中心",
      "なめらか"
    ],
    "staple": false
  },
  {
    "id": "soup-005",
    "name": "ブロッコリーのミルクスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "broccoli",
        "amount": 180.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "milk",
        "amount": 200.0
      },
      {
        "id": "water",
        "amount": 200.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "ブロッコリーを小房にし、茎は皮をむいて薄切りにする。玉ねぎをみじん切りにする。",
      "鍋にバターを溶かして玉ねぎを炒め、ブロッコリーと水を加えて7〜8分煮る。",
      "牛乳を加えて弱火で温め、塩とこしょうで調える。"
    ],
    "tags": [
      "野菜中心",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-006",
    "name": "じゃがいもと長ねぎのポタージュ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "potato",
        "amount": 220.0
      },
      {
        "id": "negi",
        "amount": 100.0
      },
      {
        "id": "milk",
        "amount": 180.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "じゃがいもの皮をむいて薄切りにし、長ねぎも薄切りにする。",
      "バターで長ねぎを焦がさず炒め、じゃがいもと水を加えて柔らかくなるまで12分煮る。",
      "粗熱を取ってからブレンダーにかけ、鍋に戻して牛乳を加え、弱火で温めて塩とこしょうを加える。"
    ],
    "tags": [
      "なめらか",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-007",
    "name": "トマトとレンズ豆のスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "tomato",
        "amount": 220.0
      },
      {
        "id": "lentil_cooked",
        "amount": 160.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "トマトを角切りにし、玉ねぎとにんじん、にんにくを細かく刻む。",
      "オリーブ油でにんにく、玉ねぎ、にんじんを炒め、トマトを加えて3分炒める。",
      "水とゆでたレンズ豆を加え、弱火で12分煮て塩とこしょうで調える。"
    ],
    "tags": [
      "具だくさん",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-008",
    "name": "にんじんとしょうがのポタージュ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "carrot",
        "amount": 250.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "milk",
        "amount": 150.0
      },
      {
        "id": "water",
        "amount": 300.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      }
    ],
    "steps": [
      "にんじんと玉ねぎを薄切りにし、しょうがを細かく刻む。",
      "オリーブ油で玉ねぎとしょうがを炒め、にんじんと水を加えて柔らかくなるまで15分煮る。",
      "粗熱を取ってからブレンダーでなめらかにし、牛乳を加えて弱火で温め、塩で調える。"
    ],
    "tags": [
      "野菜中心",
      "なめらか"
    ],
    "staple": false
  },
  {
    "id": "soup-009",
    "name": "コーンと玉ねぎのミルクスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "corn",
        "amount": 200.0
      },
      {
        "id": "onion",
        "amount": 80.0
      },
      {
        "id": "milk",
        "amount": 220.0
      },
      {
        "id": "water",
        "amount": 180.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "玉ねぎをみじん切りにする。コーンは半量を包丁で粗く刻む。",
      "バターで玉ねぎを炒め、コーンと水を加えて7分煮る。",
      "牛乳を加えて沸騰させずに温め、塩とこしょうで調える。"
    ],
    "tags": [
      "やさしい味",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-010",
    "name": "キャベツと白いんげん豆のスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "cabbage",
        "amount": 160.0
      },
      {
        "id": "white_bean_cooked",
        "amount": 160.0
      },
      {
        "id": "carrot",
        "amount": 70.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "キャベツは2cm幅、にんじんと玉ねぎは1cm角に切る。",
      "オリーブ油で玉ねぎとにんじんを炒め、キャベツ、水煮の白いんげん豆、水を加える。",
      "弱火で15分煮て、塩で味を調え、刻んだパセリを加える。"
    ],
    "tags": [
      "具だくさん",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-011",
    "name": "玉ねぎのあめ色スープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 40,
    "servings": 2,
    "ingredients": [
      {
        "id": "onion",
        "amount": 300.0
      },
      {
        "id": "butter",
        "amount": 12.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "玉ねぎを繊維を断つ向きに薄切りにする。",
      "鍋にバターを溶かし、玉ねぎを弱めの中火で20〜25分、焦がさず茶色くなるまで炒める。",
      "水を加えて鍋底をこそげ、10分煮る。塩とこしょうで調え、パセリを散らす。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-012",
    "name": "きのこのクリームスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "shimeji",
        "amount": 220.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "milk",
        "amount": 220.0
      },
      {
        "id": "water",
        "amount": 220.0
      },
      {
        "id": "butter",
        "amount": 10.0
      },
      {
        "id": "flour",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "きのこを薄切りにし、玉ねぎをみじん切りにする。",
      "バターで玉ねぎときのこを炒め、薄力粉を加えて粉っぽさがなくなるまで1分炒める。",
      "水を少しずつ加えて混ぜ、5分煮る。牛乳を加えて温め、塩とこしょうで調える。"
    ],
    "tags": [
      "なめらか",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-013",
    "name": "ほうれん草と卵のかきたま汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "spinach",
        "amount": 100.0
      },
      {
        "id": "egg",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "bonito",
        "amount": 4.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "cornstarch",
        "amount": 5.0
      }
    ],
    "steps": [
      "ほうれん草をゆでて水に取り、水気を絞って3cmに切る。卵は溶く。コーンスターチは分量の水から大さじ1を取って溶く。",
      "鍋に残りの水とかつお節を入れて沸かし、しょうゆ、塩、ほうれん草、水溶きコーンスターチを加える。",
      "汁を軽く沸かしながら卵を細く流し入れ、卵に液状部分が残らなくなるまでしっかり加熱する。"
    ],
    "tags": [
      "時短",
      "卵を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-014",
    "name": "豆腐ときのこの酸辣湯",
    "role": "soup",
    "genre": "中華",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 140.0
      },
      {
        "id": "shiitake",
        "amount": 60.0
      },
      {
        "id": "enoki",
        "amount": 60.0
      },
      {
        "id": "egg",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "vinegar",
        "amount": 18.0
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "cornstarch",
        "amount": 6.0
      },
      {
        "id": "chilli",
        "amount": 0.2
      },
      {
        "id": "salt",
        "amount": 0.5
      }
    ],
    "steps": [
      "豆腐としいたけを細切りにし、えのきをほぐす。しょうがを細切りにし、卵を溶く。コーンスターチを分量の水の一部で溶く。",
      "鍋に残りの水、しょうが、きのこ、豆腐を入れて5分煮る。しょうゆと塩を加え、水溶きコーンスターチでとろみをつける。",
      "卵を流し入れて完全に火を通し、米酢、ごま油、とうがらしを加える。"
    ],
    "tags": [
      "さっぱり",
      "卵を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-015",
    "name": "鶏肉とキャベツのしょうがスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "chicken",
        "amount": 140.0
      },
      {
        "id": "cabbage",
        "amount": 180.0
      },
      {
        "id": "ginger",
        "amount": 10.0
      },
      {
        "id": "negi",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 500.0
      },
      {
        "id": "sake",
        "amount": 15.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "鶏肉を2cm角に切り、キャベツをざく切りにする。しょうがと長ねぎを薄切りにする。",
      "鍋に水、酒、しょうが、長ねぎ、鶏肉を入れて沸かし、あくを取りながら弱火で8分煮る。",
      "キャベツを加えて5分ほど煮る。鶏肉の中心75℃で1分以上を確認し、塩とこしょうで調える。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-016",
    "name": "牛肉とトマトのスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "beef",
        "amount": 100.0
      },
      {
        "id": "tomato",
        "amount": 220.0
      },
      {
        "id": "onion",
        "amount": 80.0
      },
      {
        "id": "celery",
        "amount": 50.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "牛肉を食べやすく切る。トマトは角切り、玉ねぎとセロリは薄切りにする。",
      "オリーブ油で玉ねぎとセロリを炒め、トマト、水を加えて8分煮る。",
      "牛肉を加えてほぐし、中心まで十分に加熱する。塩とこしょうで味を調える。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-017",
    "name": "豚肉とにらのごまスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "pork",
        "amount": 120.0
      },
      {
        "id": "chive",
        "amount": 80.0
      },
      {
        "id": "bean_sprout",
        "amount": 120.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "sesame_oil",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "sesame",
        "amount": 5.0
      }
    ],
    "steps": [
      "豚肉は一口大に、にらは4cmに切り、しょうがを細切りにする。",
      "鍋でごま油としょうがを熱し、豚肉をほぐしながら炒めて水を加える。",
      "沸いたらもやしを加えて5分ほど煮る。豚肉の中心75℃で1分以上を確認し、にら、しょうゆ、塩を加えて1分煮て、ごまをふる。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-018",
    "name": "たらと大根の澄まし汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "cod",
        "amount": 160.0
      },
      {
        "id": "daikon",
        "amount": 180.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "sake",
        "amount": 15.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "たらの骨を確認して一口大に切る。大根を薄いいちょう切り、しょうがを細切りにする。",
      "水と昆布を弱火で温めて昆布を取り出し、大根としょうがを加えて8分煮る。",
      "たら、酒、しょうゆ、塩を加えて7分ほど煮る。たらが中心まで白くなり火が通ったら小ねぎを散らす。"
    ],
    "tags": [
      "魚を使う",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "soup-019",
    "name": "鮭とじゃがいものミルクスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "salmon",
        "amount": 160.0
      },
      {
        "id": "potato",
        "amount": 150.0
      },
      {
        "id": "onion",
        "amount": 80.0
      },
      {
        "id": "milk",
        "amount": 220.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "鮭の骨を除いて一口大に切り、じゃがいもは1cm角、玉ねぎは薄切りにする。",
      "バターで玉ねぎを炒め、じゃがいもと水を加えて10分煮る。",
      "鮭を加えて中心まで完全に火を通す。牛乳を加えて弱火で温め、塩とこしょうで調える。"
    ],
    "tags": [
      "魚を使う",
      "具だくさん"
    ],
    "staple": false
  },
  {
    "id": "soup-020",
    "name": "えびときのこのしょうがスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "shrimp",
        "amount": 140.0
      },
      {
        "id": "shimeji",
        "amount": 100.0
      },
      {
        "id": "enoki",
        "amount": 60.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "sake",
        "amount": 10.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "えびの背わたを除いて洗い、水気を拭く。きのこをほぐし、しょうがを細切りにする。",
      "鍋に水、酒、しょうが、きのこを入れて沸かし、5分煮る。",
      "えびを加え、中心まで不透明になり完全に火が通るまで煮る。しょうゆ、塩、ごま油を加える。"
    ],
    "tags": [
      "魚を使う",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "soup-021",
    "name": "かぼちゃのココナッツスープ",
    "role": "soup",
    "genre": "その他",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "pumpkin",
        "amount": 240.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "coconut_milk",
        "amount": 180.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "turmeric",
        "amount": 0.8
      },
      {
        "id": "cumin",
        "amount": 0.5
      },
      {
        "id": "oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.2
      }
    ],
    "steps": [
      "かぼちゃを小さめの一口大に切り、玉ねぎを薄切りにする。",
      "鍋に油を熱して玉ねぎを炒め、ターメリックとクミンを加える。かぼちゃと水を入れて12分煮る。",
      "かぼちゃが柔らかくなったらココナッツミルクと塩を加え、弱火で温める。"
    ],
    "tags": [
      "野菜中心",
      "香りを楽しむ"
    ],
    "staple": false
  },
  {
    "id": "soup-022",
    "name": "ほうれん草とひよこ豆のトマトスープ",
    "role": "soup",
    "genre": "その他",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "spinach",
        "amount": 120.0
      },
      {
        "id": "chickpea_cooked",
        "amount": 150.0
      },
      {
        "id": "tomato",
        "amount": 200.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 350.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "cumin",
        "amount": 0.5
      }
    ],
    "steps": [
      "ほうれん草をゆでて水気を絞り、3cmに切る。トマトを角切り、玉ねぎとにんにくをみじん切りにする。",
      "オリーブ油で玉ねぎとにんにくを炒め、クミン、トマト、水煮ひよこ豆、水を加えて10分煮る。",
      "ほうれん草を加えて温め、塩で味を調える。"
    ],
    "tags": [
      "豆を使う",
      "具だくさん"
    ],
    "staple": false
  },
  {
    "id": "soup-023",
    "name": "さつまいもとレンズ豆のスープ",
    "role": "soup",
    "genre": "その他",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "sweet_potato",
        "amount": 180.0
      },
      {
        "id": "lentil_cooked",
        "amount": 150.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "cumin",
        "amount": 0.5
      }
    ],
    "steps": [
      "さつまいもを1cm角に切り、水にさらす。玉ねぎとしょうがを細かく刻む。",
      "オリーブ油で玉ねぎとしょうがを炒め、さつまいも、水、クミンを加えて12分煮る。",
      "ゆでたレンズ豆を加えて5分煮て、塩で調える。"
    ],
    "tags": [
      "豆を使う",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-024",
    "name": "かぶと枝豆の豆乳スープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "turnip",
        "amount": 220.0
      },
      {
        "id": "edamame",
        "amount": 80.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "soy_milk",
        "amount": 200.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "かぶを小さなくし形に、玉ねぎを薄切りにする。枝豆はゆでてさやから出す。",
      "オリーブ油で玉ねぎを炒め、かぶと水を加えて8分煮る。",
      "枝豆と豆乳を加えて沸騰させずに温め、塩とこしょうで調える。"
    ],
    "tags": [
      "豆を使う",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-025",
    "name": "ズッキーニとトマトのスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "zucchini",
        "amount": 160.0
      },
      {
        "id": "tomato",
        "amount": 220.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "celery",
        "amount": 50.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 10.0
      },
      {
        "id": "water",
        "amount": 350.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "ズッキーニとトマトを角切りにし、玉ねぎとセロリ、にんにくを細かく刻む。",
      "オリーブ油でにんにく、玉ねぎ、セロリを炒め、ズッキーニを加えて2分炒める。",
      "トマト、水、塩を加えて12分煮て、刻んだパセリを散らす。"
    ],
    "tags": [
      "野菜中心",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "soup-026",
    "name": "わかめと豆腐のごまスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 160.0
      },
      {
        "id": "wakame",
        "amount": 3.0
      },
      {
        "id": "negi",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      },
      {
        "id": "sesame",
        "amount": 5.0
      }
    ],
    "steps": [
      "豆腐を角切りにし、長ねぎを薄切り、しょうがを細切りにする。",
      "水、しょうが、長ねぎを鍋に入れて沸かし、豆腐と乾燥わかめを加えて4分煮る。",
      "しょうゆ、塩、ごま油を加えて味を調え、いりごまをふる。"
    ],
    "tags": [
      "時短",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-027",
    "name": "根菜と豆腐のけんちん汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 140.0
      },
      {
        "id": "daikon",
        "amount": 100.0
      },
      {
        "id": "carrot",
        "amount": 70.0
      },
      {
        "id": "burdock",
        "amount": 70.0
      },
      {
        "id": "taro",
        "amount": 120.0
      },
      {
        "id": "water",
        "amount": 500.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "sesame_oil",
        "amount": 8.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 0.8
      }
    ],
    "steps": [
      "豆腐を水切りしてちぎる。大根とにんじんをいちょう切り、ごぼうを斜め薄切り、里いもを一口大に切る。",
      "水と昆布を弱火で温めて昆布を取り出す。別の鍋でごま油を熱し、根菜と豆腐を炒める。",
      "昆布だしを加え、根菜が柔らかくなるまで15〜20分煮る。しょうゆと塩で調える。"
    ],
    "tags": [
      "具だくさん",
      "豆を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-028",
    "name": "鶏肉とれんこんのとろみスープ",
    "role": "soup",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "chicken",
        "amount": 120.0
      },
      {
        "id": "lotus_root",
        "amount": 150.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 500.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "sake",
        "amount": 15.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "cornstarch",
        "amount": 6.0
      }
    ],
    "steps": [
      "鶏肉を1.5cm角、にんじんを薄切りにし、れんこんは半分を薄切り、残りをすりおろす。しょうがを細切りにする。",
      "水と昆布を弱火で温めて昆布を除き、鶏肉、にんじん、薄切りのれんこん、しょうが、酒を加えて10分ほど煮る。",
      "鶏肉の中心75℃で1分以上を確認する。すりおろしたれんこん、しょうゆ、塩を加え、少量の汁で溶いたコーンスターチを混ぜて2分煮る。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-029",
    "name": "たらとキャベツのミルク煮スープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "cod",
        "amount": 160.0
      },
      {
        "id": "cabbage",
        "amount": 200.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "milk",
        "amount": 220.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "butter",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "たらの骨を確認して一口大に切り、キャベツはざく切り、にんじんは薄切りにする。",
      "バターで野菜を炒め、水を加えて8分煮る。たらを加え、中心まで白くなって完全に火が通るまで煮る。",
      "牛乳を加えて弱火で温め、塩とこしょうで味を調える。"
    ],
    "tags": [
      "魚を使う",
      "具だくさん"
    ],
    "staple": false
  },
  {
    "id": "soup-030",
    "name": "れんこんすり流し汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "lotus_root",
        "amount": 220.0
      },
      {
        "id": "shiitake",
        "amount": 60.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "れんこんをすりおろし、しいたけを薄切りにする。しょうがをすりおろす。",
      "水と昆布を弱火で温め、沸く直前に昆布を取り出す。しいたけを加えて4分煮る。",
      "れんこんとしょうがを加え、混ぜながら5分ほど煮る。しょうゆ、塩で調え、小ねぎを散らす。"
    ],
    "tags": [
      "野菜中心",
      "やさしい味"
    ],
    "staple": false
  }
];

const EXTRA_SIDE_SOUP_RECIPES = [
  {
    "id": "side-051",
    "name": "冬瓜の鶏そぼろあん",
    "role": "side",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "winter_melon",
        "amount": 300.0
      },
      {
        "id": "chicken_minced",
        "amount": 100.0
      },
      {
        "id": "ginger",
        "amount": 6.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "mirin",
        "amount": 12.0
      },
      {
        "id": "cornstarch",
        "amount": 6.0
      }
    ],
    "steps": [
      "冬瓜の種と皮を取り、一口大に切る。しょうがを細かく刻む。水と昆布を弱火で温め、沸く直前に昆布を取り出す。",
      "昆布だしに鶏ひき肉としょうがを入れ、ほぐしながら煮る。鶏肉の中心75℃で1分以上の加熱を確認する。",
      "冬瓜、しょうゆ、みりんを加えてふたをし、冬瓜が透き通って柔らかくなるまで12〜15分煮る。",
      "コーンスターチを少量の煮汁で溶いて加え、混ぜながらとろみが出るまで煮る。"
    ],
    "tags": [
      "具だくさん",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-052",
    "name": "焼きトマトのハーブマリネ",
    "role": "side",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "tomato",
        "amount": 300.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "vinegar",
        "amount": 12.0
      },
      {
        "id": "dried_basil",
        "amount": 1.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "トマトを大きなくし形に切り、にんにくを薄切りにする。",
      "耐熱皿にトマトとにんにくを並べ、オリーブ油の半量と塩をかけ、200℃のオーブンで15〜20分焼く。",
      "残りのオリーブ油、米酢、乾燥バジル、こしょうを混ぜ、焼いたトマトにからめて粗熱を取る。"
    ],
    "tags": [
      "香ばしい",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-053",
    "name": "じゃがいもとほうれん草の豆乳グラタン",
    "role": "side",
    "genre": "洋食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "id": "potato",
        "amount": 240.0
      },
      {
        "id": "spinach",
        "amount": 120.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "soy_milk",
        "amount": 220.0
      },
      {
        "id": "flour",
        "amount": 15.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "じゃがいもを薄切りにし、柔らかくなるまでゆでる。ほうれん草も下ゆでして水気を絞り、短く切る。玉ねぎは薄切りにする。",
      "鍋にオリーブ油を熱して玉ねぎを炒め、薄力粉を加えて粉っぽさがなくなるまで炒める。",
      "豆乳を少しずつ加えて混ぜ、とろみが出たら塩とこしょうで調える。",
      "耐熱皿にじゃがいもとほうれん草を入れ、ソースをかける。220℃のオーブンで表面に焼き色がつくまで10分ほど焼く。"
    ],
    "tags": [
      "野菜中心",
      "手作り"
    ],
    "staple": false
  },
  {
    "id": "side-054",
    "name": "きゅうりといかの酢みそ和え",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "cucumber",
        "amount": 160.0
      },
      {
        "id": "squid",
        "amount": 120.0
      },
      {
        "id": "miso",
        "amount": 15.0
      },
      {
        "id": "vinegar",
        "amount": 15.0
      },
      {
        "id": "sugar",
        "amount": 6.0
      },
      {
        "id": "water",
        "amount": 15.0
      }
    ],
    "steps": [
      "いかを細切りにして沸騰した湯で中心まで完全に火を通し、ざるに上げて冷ます。",
      "きゅうりを縦半分にして斜め薄切りにする。",
      "みそ、米酢、砂糖、水をなめらかになるまで混ぜ、いかときゅうりを和える。"
    ],
    "tags": [
      "さっぱり",
      "魚を使う"
    ],
    "staple": false
  },
  {
    "id": "side-055",
    "name": "ごぼうのカリカリ揚げ",
    "role": "side",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "burdock",
        "amount": 200.0
      },
      {
        "id": "starch",
        "amount": 20.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "oil",
        "amount": 80.0
      }
    ],
    "steps": [
      "ごぼうを長さ5cmの薄い短冊切りにして水にさっとさらし、水気を拭く。",
      "しょうゆ、みりん、すりおろしたしょうがをからめて5分置き、汁気を切って片栗粉を薄くまぶす。",
      "小さめのフライパンに油を熱し、170℃を目安に少量ずつ、カリッとするまで揚げ焼きにする。油をよく切って盛る。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-056",
    "name": "ゴーヤのおかか炒め",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "bitter_melon",
        "amount": 220.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "bonito",
        "amount": 4.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 12.0
      },
      {
        "id": "oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.6
      }
    ],
    "steps": [
      "ゴーヤを縦半分にして種とわたを取り、薄切りにする。塩をもみ込んで5分置き、洗って水気を切る。玉ねぎを薄切りにする。",
      "油を熱したフライパンで玉ねぎを炒め、ゴーヤを加えて4〜5分炒める。",
      "しょうゆとみりんを加えて水分を飛ばし、火を止めてかつお節を混ぜる。"
    ],
    "tags": [
      "野菜中心",
      "香ばしい"
    ],
    "staple": false
  },
  {
    "id": "side-057",
    "name": "かぼちゃとひよこ豆のコロッケ風",
    "role": "side",
    "genre": "洋食",
    "minutes": 40,
    "servings": 2,
    "ingredients": [
      {
        "id": "pumpkin",
        "amount": 260.0
      },
      {
        "id": "chickpea_cooked",
        "amount": 100.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "breadcrumbs",
        "amount": 25.0
      },
      {
        "id": "olive_oil",
        "amount": 15.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "かぼちゃの種とわたを取り、柔らかくなるまで蒸してつぶす。水煮ひよこ豆も粗くつぶす。",
      "みじん切りの玉ねぎをオリーブ油の半量で炒め、かぼちゃ、豆、塩、こしょうと混ぜる。",
      "人数に合わせて食べやすい大きさの平たい形にし、パン粉と残りのオリーブ油を混ぜた衣を表面に押し付ける。",
      "200℃のオーブンで15〜20分、衣がこんがりするまで焼く。パン粉は原材料表示を確認する。"
    ],
    "tags": [
      "豆を使う",
      "香ばしい"
    ],
    "staple": false
  },
  {
    "id": "side-058",
    "name": "カリフラワーのくるみ衣焼き",
    "role": "side",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "cauliflower",
        "amount": 260.0
      },
      {
        "id": "walnut",
        "amount": 25.0
      },
      {
        "id": "flour",
        "amount": 15.0
      },
      {
        "id": "water",
        "amount": 30.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "カリフラワーを大きめの小房に分け、2分下ゆでして水気をよく切る。くるみを細かく刻む。",
      "薄力粉、水、塩、こしょうを混ぜて薄い衣を作り、カリフラワーの表面にからめる。",
      "くるみを押し付けて天板に並べ、オリーブ油を回しかける。",
      "200℃のオーブンで15〜20分焼き、くるみを焦がさないように仕上げる。"
    ],
    "tags": [
      "香ばしい",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "side-059",
    "name": "紫キャベツとりんごの蒸し煮",
    "role": "side",
    "genre": "洋食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "red_cabbage",
        "amount": 220.0
      },
      {
        "id": "apple",
        "amount": 120.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "butter",
        "amount": 10.0
      },
      {
        "id": "vinegar",
        "amount": 15.0
      },
      {
        "id": "water",
        "amount": 60.0
      },
      {
        "id": "salt",
        "amount": 0.8
      }
    ],
    "steps": [
      "紫キャベツを太めの細切り、玉ねぎを薄切りにする。りんごの芯を取り、薄いくし形に切る。",
      "鍋にバターを溶かして玉ねぎを炒め、紫キャベツ、りんご、水、塩を加える。",
      "ふたをして弱火で15分ほど煮る。米酢を加え、ふたを取って余分な水分を飛ばす。"
    ],
    "tags": [
      "野菜中心",
      "さっぱり"
    ],
    "staple": false
  },
  {
    "id": "side-060",
    "name": "オクラのしょうが煮",
    "role": "side",
    "genre": "和食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "okra",
        "amount": 220.0
      },
      {
        "id": "ginger",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 160.0
      },
      {
        "id": "kombu",
        "amount": 2.0
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "mirin",
        "amount": 10.0
      },
      {
        "id": "bonito",
        "amount": 2.0
      }
    ],
    "steps": [
      "オクラのがくの硬い部分を削り、しょうがを細切りにする。",
      "水と昆布を弱火で温め、沸く直前に昆布を取り出す。しょうが、しょうゆ、みりんを加える。",
      "オクラを加えて5〜7分煮て、柔らかくなったらかつお節を加え、火を止めて煮汁を含ませる。"
    ],
    "tags": [
      "やさしい味",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-031",
    "name": "トマトたっぷりガスパチョ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "tomato",
        "amount": 300.0
      },
      {
        "id": "cucumber",
        "amount": 100.0
      },
      {
        "id": "paprika",
        "amount": 80.0
      },
      {
        "id": "onion",
        "amount": 30.0
      },
      {
        "id": "garlic",
        "amount": 2.0
      },
      {
        "id": "olive_oil",
        "amount": 12.0
      },
      {
        "id": "vinegar",
        "amount": 12.0
      },
      {
        "id": "water",
        "amount": 100.0
      },
      {
        "id": "salt",
        "amount": 1.2
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      }
    ],
    "steps": [
      "野菜をよく洗い、トマトのへた、パプリカの種を取る。玉ねぎを薄切りにして水に5分さらす。",
      "トマト、きゅうり、パプリカ、玉ねぎ、にんにくを小さく切る。",
      "すべての材料をブレンダーでなめらかにし、冷蔵庫で冷やして、作った当日中に食べる。"
    ],
    "tags": [
      "さっぱり",
      "冷製"
    ],
    "staple": false
  },
  {
    "id": "soup-032",
    "name": "きゅうりとヨーグルトの冷製スープ",
    "role": "soup",
    "genre": "その他",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "id": "cucumber",
        "amount": 240.0
      },
      {
        "id": "yogurt",
        "amount": 180.0
      },
      {
        "id": "water",
        "amount": 120.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "lemon",
        "amount": 10.0
      },
      {
        "id": "garlic",
        "amount": 1.0
      },
      {
        "id": "salt",
        "amount": 1.0
      },
      {
        "id": "black_pepper",
        "amount": 0.1
      },
      {
        "id": "parsley",
        "amount": 2.0
      }
    ],
    "steps": [
      "きゅうりをよく洗って小さく切り、にんにくをすりおろす。",
      "きゅうり、ヨーグルト、水、オリーブ油、レモン汁、にんにく、塩をブレンダーでなめらかにする。",
      "冷蔵庫で冷やし、刻んだパセリとこしょうをふる。作った当日中に食べる。"
    ],
    "tags": [
      "さっぱり",
      "冷製"
    ],
    "staple": false
  },
  {
    "id": "soup-033",
    "name": "豆腐団子のすまし汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "tofu",
        "amount": 160.0
      },
      {
        "id": "starch",
        "amount": 30.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "shiitake",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 450.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "豆腐を水切りしてつぶし、片栗粉を混ぜて小さな団子にする。にんじんとしいたけを薄切りにする。",
      "水と昆布を弱火で温め、沸く直前に昆布を取り出す。にんじんとしいたけを加えて5分煮る。",
      "豆腐団子を静かに入れ、浮いてきてからさらに3分ほど煮る。しょうゆ、塩で調え、小ねぎを散らす。"
    ],
    "tags": [
      "豆を使う",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-034",
    "name": "豆乳ごま担々風スープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "pork_minced",
        "amount": 100.0
      },
      {
        "id": "bean_sprout",
        "amount": 120.0
      },
      {
        "id": "komatsuna",
        "amount": 100.0
      },
      {
        "id": "soy_milk",
        "amount": 200.0
      },
      {
        "id": "water",
        "amount": 250.0
      },
      {
        "id": "ground_sesame",
        "amount": 20.0
      },
      {
        "id": "miso",
        "amount": 15.0
      },
      {
        "id": "soy_sauce",
        "amount": 8.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      },
      {
        "id": "chilli",
        "amount": 0.2
      }
    ],
    "steps": [
      "小松菜を短く切り、しょうがを細かく刻む。",
      "鍋でごま油を温めてしょうがと豚ひき肉を炒め、水を加える。肉の中心75℃で1分以上の加熱を確認する。",
      "もやしと小松菜を加えて火を通し、みそ、しょうゆ、すりごまを混ぜる。",
      "豆乳ととうがらしを加え、沸騰させないよう弱火で温める。"
    ],
    "tags": [
      "具だくさん",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-035",
    "name": "干ししいたけと春雨のスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 40,
    "servings": 2,
    "ingredients": [
      {
        "id": "dried_shiitake",
        "amount": 8.0
      },
      {
        "id": "mung_vermicelli",
        "amount": 30.0
      },
      {
        "id": "carrot",
        "amount": 60.0
      },
      {
        "id": "negi",
        "amount": 60.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "water",
        "amount": 550.0
      },
      {
        "id": "soy_sauce",
        "amount": 12.0
      },
      {
        "id": "salt",
        "amount": 0.8
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "干ししいたけを分量の水に浸し、冷蔵庫で十分に戻す。戻し時間は調理時間に含めない。軸の硬い部分を落として薄切りにする。",
      "にんじんとしょうがを細切り、長ねぎを斜め薄切りにする。しいたけの戻し汁をこして鍋へ入れる。",
      "しいたけと野菜を加えて8分煮る。春雨を袋の表示に従って加熱し、食べやすい長さに切って加える。",
      "しょうゆ、塩、ごま油を加えて味を調える。"
    ],
    "tags": [
      "具だくさん",
      "やさしい味"
    ],
    "staple": false
  },
  {
    "id": "soup-036",
    "name": "えびとオクラのトマトスープ",
    "role": "soup",
    "genre": "その他",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "id": "shrimp",
        "amount": 120.0
      },
      {
        "id": "okra",
        "amount": 140.0
      },
      {
        "id": "tomato",
        "amount": 180.0
      },
      {
        "id": "onion",
        "amount": 60.0
      },
      {
        "id": "garlic",
        "amount": 4.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "paprika_powder",
        "amount": 1.0
      },
      {
        "id": "salt",
        "amount": 1.2
      }
    ],
    "steps": [
      "えびの背わたを取り、オクラを輪切りにする。トマトは角切り、玉ねぎとにんにくはみじん切りにする。",
      "鍋にオリーブ油を熱し、にんにくと玉ねぎを炒める。トマト、オクラ、パプリカ粉、水を加えて8分煮る。",
      "えびを加え、中心まで不透明になって完全に火が通るまで煮て、塩で味を調える。"
    ],
    "tags": [
      "具だくさん",
      "魚を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-037",
    "name": "野菜と押し麦の煮込みスープ",
    "role": "soup",
    "genre": "洋食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "id": "barley",
        "amount": 35.0
      },
      {
        "id": "carrot",
        "amount": 70.0
      },
      {
        "id": "celery",
        "amount": 60.0
      },
      {
        "id": "onion",
        "amount": 70.0
      },
      {
        "id": "cabbage",
        "amount": 100.0
      },
      {
        "id": "canned_tomato",
        "amount": 150.0
      },
      {
        "id": "water",
        "amount": 600.0
      },
      {
        "id": "olive_oil",
        "amount": 8.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "dried_basil",
        "amount": 0.5
      }
    ],
    "steps": [
      "押し麦をさっと洗う。野菜を小さな角切りにする。",
      "鍋にオリーブ油を熱して玉ねぎ、にんじん、セロリを炒める。",
      "押し麦、キャベツ、トマト缶、水、乾燥バジルを加えて弱火で20〜25分煮る。",
      "押し麦が柔らかくなったら塩で調える。水分が少なくなりすぎないよう火加減を調整する。"
    ],
    "tags": [
      "具だくさん",
      "野菜中心"
    ],
    "staple": false
  },
  {
    "id": "soup-038",
    "name": "鶏肉と野菜の手作りワンタンスープ",
    "role": "soup",
    "genre": "中華",
    "minutes": 45,
    "servings": 2,
    "ingredients": [
      {
        "id": "flour",
        "amount": 80.0
      },
      {
        "id": "chicken_minced",
        "amount": 100.0
      },
      {
        "id": "carrot",
        "amount": 40.0
      },
      {
        "id": "negi",
        "amount": 60.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "water",
        "amount": 480.0
      },
      {
        "id": "salt",
        "amount": 1.5
      },
      {
        "id": "soy_sauce",
        "amount": 10.0
      },
      {
        "id": "sesame_oil",
        "amount": 5.0
      }
    ],
    "steps": [
      "薄力粉に塩の半量と分量の水の約1割を少しずつ加え、まとまるまでこねて10分休ませる。野菜としょうがを細かく刻む。",
      "鶏ひき肉に、にんじん、長ねぎの半量、しょうが、しょうゆの半量を混ぜる。",
      "生地を薄く延ばして小さな四角に切り、肉だねを少量ずつ包む。残りの水と長ねぎを鍋で沸かし、包んだものを加える。",
      "肉だねの中心75℃で1分以上を確認し、皮が柔らかくなるまで煮る。残りの塩、しょうゆ、ごま油を加える。"
    ],
    "tags": [
      "手作り",
      "肉を使う"
    ],
    "staple": false
  },
  {
    "id": "soup-039",
    "name": "米粉すいとんと根菜の汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "rice_flour",
        "amount": 60.0
      },
      {
        "id": "daikon",
        "amount": 100.0
      },
      {
        "id": "carrot",
        "amount": 70.0
      },
      {
        "id": "burdock",
        "amount": 60.0
      },
      {
        "id": "water",
        "amount": 600.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "miso",
        "amount": 26.0
      }
    ],
    "steps": [
      "大根とにんじんを薄いいちょう切り、ごぼうを薄切りにする。分量の水の約1割を沸かし、米粉に少しずつ加えてスプーンですくえる硬さにまとめる。",
      "鍋に残りの水と昆布を入れて弱火で温め、沸く直前に昆布を取る。根菜を加え、柔らかくなるまで12分煮る。",
      "米粉の生地をスプーンで小さく落とし、中心まで火が通るまで5分ほど煮る。",
      "火を弱めてみそを溶き、温めて仕上げる。"
    ],
    "tags": [
      "手作り",
      "具だくさん"
    ],
    "staple": false
  },
  {
    "id": "soup-040",
    "name": "焼きなすのすり流し汁",
    "role": "soup",
    "genre": "和食",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "id": "aubergine",
        "amount": 280.0
      },
      {
        "id": "water",
        "amount": 400.0
      },
      {
        "id": "kombu",
        "amount": 3.0
      },
      {
        "id": "miso",
        "amount": 16.0
      },
      {
        "id": "ginger",
        "amount": 5.0
      },
      {
        "id": "scallion_garnish",
        "amount": 5.0
      }
    ],
    "steps": [
      "なすに数か所穴を開け、魚焼きグリルで中まで柔らかく焼く。触れる程度に冷まして皮をむく。",
      "水と昆布を弱火で温め、沸く直前に昆布を取り出す。粗熱を取る。",
      "なすと昆布だしをブレンダーでなめらかにして鍋へ戻し、弱火で温めてみそを溶く。",
      "すりおろしたしょうがと刻んだ小ねぎを加える。"
    ],
    "tags": [
      "野菜中心",
      "香ばしい"
    ],
    "staple": false
  }
];

// 気分タグは味や料理の構成を選ぶ目安です。栄養量の評価には使いません。
// 「さっぱり」は酢・柑橘の酸味や蒸し料理・澄んだ汁などを中心に、
// 「ガッツリ」は肉料理・丼・麺・衣焼きなどの食べ応えの印象から付けています。
// 「定番」は家庭で親しみやすい料理を選び、「時短」は目安20分以内で統一します。
// ご飯だけで気分条件を満たさないよう、主食の補助レシピにはタグを付けません。
const MOOD_RECIPE_IDS = {
  'さっぱり': new Set([
    'chicken-steam','chicken-salt-lemon','pork-beansprout','pork-salt-cabbage',
    'salmon-foil','salmon-lemon','cod-salt-steam','horse-mackerel-pan',
    'scallop-broccoli','tofu-vegetable','chicken-nanban-pickle','chicken-tofu-pot',
    'clam-sake-steam','cod-fishball','egg-tofu-porridge',
    'potato-pepper-strips','kiriboshi-cucumber','chickpea-carrot-lemon',
    'sweet-potato-apple','aubergine-tomato-cold',
    'side-002','side-003','side-004','side-006','side-009','side-014','side-015',
    'side-017','side-020','side-021','side-022','side-033','side-034','side-036',
    'side-041','side-044','side-045','side-046','side-048','side-049',
    'side-051','side-052','side-054','side-059','side-060',
    'soup-013','soup-014','soup-015','soup-018','soup-020','soup-025','soup-026',
    'soup-030','soup-031','soup-032','soup-033','soup-036','soup-040',
  ]),
  'ガッツリ': new Set([
    'chicken-teriyaki','chicken-cashew','chicken-miso','chicken-curry-yogurt',
    'chicken-meatball','chicken-lotus','pork-ginger','pork-cabbage','pork-vinegar',
    'pork-meatball','pork-roll','pork-aubergine','pork-tofu','beef-onion',
    'beef-pepper','beef-potato','beef-tomato','beef-hamburg','beef-burdock',
    'beef-broccoli','salmon-miso','salmon-milk','cod-sweet-vinegar','cod-potato',
    'shrimp-chilli','shrimp-egg','crab-omelette','tofu-mapo','tofu-burger',
    'egg-potato','chicken-rice-bowl','beef-rice-bowl','pork-rice-bowl',
    'egg-fried-rice','salmon-fried-rice','tomato-chicken-curry','minced-dry-curry',
    'tofu-rice-bowl','pasta-meat','pasta-shrimp','pasta-mushroom','pasta-milk-salmon',
    'udon-pork','udon-egg','soba-chicken','rice-egg-omelette','rice-baked-cheese',
    'chicken-sandwich','pork-cabbage-roll','pork-chive-egg','chicken-root-simmer',
    'okara-vegetable-patty','soy-hijiki-patty','mackerel-curry-roast','cod-cheese-bake',
    'seafood-okonomiyaki','soy-taco-rice','chicken-pilaf','soy-milk-risotto',
    'savoury-french-toast','rice-flour-chijimi','pork-stuffed-pepper','tofu-sesame-crust',
    'yam-shimeji-butter','side-013','side-016','side-018','side-031','side-038',
    'side-039','side-053','side-055','side-057','side-058',
    'soup-003','soup-007','soup-010','soup-016','soup-017','soup-019',
    'soup-027','soup-028','soup-029','soup-034','soup-035','soup-037',
    'soup-038','soup-039',
  ]),
  '定番': new Set([
    'chicken-teriyaki','chicken-tomato','chicken-miso','chicken-meatball',
    'chicken-oyako','pork-ginger','pork-cabbage','pork-vinegar','pork-daikon',
    'pork-meatball','pork-roll','pork-tofu','beef-onion','beef-pepper','beef-potato',
    'beef-hamburg','beef-burdock','salmon-foil','salmon-miso','salmon-lemon',
    'mackerel-miso','sardine-ginger','shrimp-chilli','shrimp-egg','tofu-steak',
    'tofu-mapo','tofu-burger','tofu-egg','omelette-vegetable','egg-potato','egg-tomato',
    'crab-omelette','chicken-rice-bowl','beef-rice-bowl','egg-fried-rice',
    'tomato-chicken-curry','minced-dry-curry','pasta-meat','pasta-mushroom',
    'udon-pork','udon-egg','soba-chicken','rice-egg-omelette',
    'pork-cabbage-roll','chicken-root-simmer','chicken-nanban-pickle',
    'chicken-tofu-pot','tofu-dried-simmer','clam-sake-steam',
    'squid-daikon-simmer','seafood-okonomiyaki','chicken-pilaf',
    'egg-tofu-porridge','pork-stuffed-pepper','daikon-leaf-tofu',
    'side-001','side-002','side-004','side-006','side-008','side-012',
    'side-013','side-027','side-028','side-029','side-030','side-037',
    'side-040','side-044','side-049','side-050','side-054','side-056',
    'soup-001','soup-002','soup-003','soup-005','soup-006','soup-009',
    'soup-012','soup-013','soup-014','soup-015','soup-018','soup-026',
    'soup-027','soup-033','soup-038','soup-039',
  ]),
};

// 「エスニック」はこの教材の料理系統の目安です。国・地域を厳密に分類する意味ではありません。
// カレー粉・クミン・ターメリック等を主な風味にした料理や、チヂミなどへ明示的に付けます。
// 由来や系統がはっきりしないサラダ・混成料理は「その他」のまま残します。
const ETHNIC_RECIPE_IDS = new Set([
  'chicken-curry-yogurt','tomato-chicken-curry','minced-dry-curry',
  'mackerel-curry-roast','rice-flour-chijimi',
  'side-019','side-026','side-035','side-036','side-045',
  'soup-021','soup-022','soup-023',
]);

const applyPreferences = item => ({
  ...item,
  genre: ETHNIC_RECIPE_IDS.has(item.id) ? 'エスニック' : item.genre,
  tags: item.role === 'staple' ? [] : [
    ...(MOOD_RECIPE_IDS['さっぱり'].has(item.id) ? ['さっぱり'] : []),
    ...(MOOD_RECIPE_IDS['ガッツリ'].has(item.id) ? ['ガッツリ'] : []),
    ...(item.minutes <= 20 ? ['時短'] : []),
    ...(MOOD_RECIPE_IDS['定番'].has(item.id) ? ['定番'] : []),
  ],
});

export const RECIPES = [...MAIN_RECIPES, ...EXTRA_MAIN_SIDE_RECIPES, ...SIDE_SOUP_RECIPES, ...EXTRA_SIDE_SOUP_RECIPES,
  {id:'plain-rice',name:'ご飯',role:'staple',genre:'和食',minutes:5,servings:2,
   ingredients:[{id:'rice',amount:300}],steps:['炊飯済みのご飯を十分温め、人数分に分けて盛る。'],tags:[],staple:true},
  ...EXPANDED_RECIPES,
  ...EVERYDAY_RECIPES,
].map(applyPreferences).concat(CLASSIC_MAIN_RECIPES, CLASSIC_SIDE_RECIPES, PREPARED_RECIPES, FAMILIAR_MAIN_RECIPES, FAMILIAR_SIDE_RECIPES, SUSHI_RECIPES, PERFORMANCE_RECIPES, TAKEAWAY_RECIPES, VARIED_RECIPES, COMFORT_RECIPES, CONFECTIONERY_RECIPES, DESSERT_RECIPES, ACCOMPANIMENT_RECIPES, PALETTE_RECIPES, MAPO_RECIPES).map(recipe=>({...recipe}));

// 選び慣れたご飯・おにぎりを別の種類として扱い、旧レシピIDも保持します。
const FAMILIAR_PORTIONS = {
  'plain-rice': {family:'rice',variantLabel:'白米',portion:{amount:150,unit:'g'},mealBase:false},
  'staple-brown-rice': {family:'rice',variantLabel:'玄米',portion:{amount:150,unit:'g'},mealBase:false},
  'staple-mixed-rice': {family:'rice',variantLabel:'白米と玄米',portion:{amount:150,unit:'g'},mealBase:false},
  'staple-barley-rice': {family:'rice',variantLabel:'麦ご飯',portion:{amount:150,unit:'g'},mealBase:false},
  'staple-wakame-rice': {family:'rice',variantLabel:'わかめ',portion:{amount:150,unit:'g'},mealBase:false},
  'staple-salt-onigiri': {family:'onigiri',variantLabel:'塩（大きめ）',portion:{amount:1,unit:'個',label:'1人分＝大きめ1個（ご飯150g）'},mealBase:false},
  'staple-grilled-onigiri': {family:'onigiri',variantLabel:'しょうゆ焼き（大きめ）',portion:{amount:1,unit:'個',label:'1人分＝大きめ1個（ご飯150g）'},mealBase:false},
  'drink-water': {family:'water',variantLabel:'水',portion:{amount:200,unit:'ml'},mealBase:false},
  'drink-lemon-water': {family:'water',variantLabel:'レモン水',portion:{amount:200,unit:'ml'},mealBase:false},
  'soup-001': {family:'miso-soup',variantLabel:'豆腐・わかめ',portion:{amount:1,unit:'杯'},mealBase:false},
  'soup-002': {family:'miso-soup',variantLabel:'なめこ・長ねぎ',portion:{amount:1,unit:'杯'},mealBase:false},
  'soup-003': {family:'miso-soup',variantLabel:'大根・豚肉',portion:{amount:1,unit:'杯'},mealBase:false},
};
for (const recipe of RECIPES) {
  if (FAMILIAR_PORTIONS[recipe.id]) Object.assign(recipe,FAMILIAR_PORTIONS[recipe.id]);
  Object.assign(recipe,decorateRecipe(recipe));
  Object.assign(recipe,decorateCookingInstructions(recipe,INGREDIENTS));
}
