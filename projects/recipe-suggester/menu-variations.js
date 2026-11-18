/** 同じ料理の違いを選択肢へまとめます。元のレシピや保存済みの記録は変更しません。 */
import {recipeNature} from './catalog.js';
import {japaneseQueryRank, normaliseJapaneseSearch} from './japanese-search.js';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const meal = (id, label, recipeIds, extra = {}) => ({
  id, label, recipeIds, role: 'staple', nature: 'home-cooked', staple: true, mealBase: true, ...extra,
});
const dish = (id, label, recipeIds, extra = {}) => meal(id, label, recipeIds,
  {role:'main', staple:false, mealBase:false, ...extra});
const side = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'side', ...extra});
const soup = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'soup', ...extra});
const drink = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'drink', ...extra});
const snack = (id, label, recipeIds, extra = {}) => dish(id, label, recipeIds, {role:'snack', ...extra});

// 検索語や並び順に依存せず、各入口で最初に開く標準の料理を固定します。
// 味・具材まで指定した検索では、下の検索順位を優先します。
const standardRecipeIds = Object.freeze({
  'nikujaga':'beef-potato',
  'okonomiyaki':'seafood-okonomiyaki',
  'rice':'plain-rice',
  'onigiri':'staple-salt-onigiri',
  'udon':'daily-udon-plain',
  'soba':'daily-soba-plain',
  'pasta':'daily-pasta-peperoncino',
  'curry':'daily-curry-pork',
  'naan':'world-naan-plain',
  'retort-curry':'prepared-retort-beef-curry',
  'yakisoba':'daily-yakisoba-sauce',
  'cup-yakisoba':'prepared-cup-yakisoba-sauce',
  'cup-udon':'prepared-cup-udon-kitsune',
  'cup-ramen':'prepared-cup-ramen-soy',
  'bag-ramen':'prepared-bag-ramen-soy',
  'miso-soup':'soup-001',
  'omelette':'classic-omelette-plain',
  'nigiri':'classic-sushi-assorted',
  'hosomaki':'sushi-hosomaki-kappa',
  'futomaki':'sushi-futomaki-egg-vegetable',
  'gunkan':'sushi-gunkan-ikura',
  'pizza':'daily-pizza-margherita',
  'fried-rice':'daily-fried-rice-egg',
  'ramen':'daily-ramen-soy',
  'chinese-noodles':'noodle-aburasoba',
  'donburi':'daily-donburi-oyako',
  'omelette-rice':'classic-omelette-rice-cheese',
  'retort-donburi':'prepared-retort-gyudon',
  'burger':'prepared-burger-plain',
  'bought-sandwich':'prepared-sandwich-egg',
  'hot-sandwich':'bread-hot-sandwich-ham-cheese',
  'toast':'bread-toast-custom',
  'sliced-bread':'staple-plain-bread',
  'oatmeal':'staple-oatmeal-water',
  'hamburg':'classic-hamburg',
  'mapo-tofu':'mapo-tofu-chen-style',
  'gyoza':'classic-gyoza',
  'karaage':'classic-karaage-thigh',
  'grilled-fish':'classic-grilled-salmon',
  'sashimi':'classic-sashimi-assorted',
  'croquette':'classic-croquette-potato',
  'stew':'familiar-beef-stew',
  'nabe':'familiar-yose-nabe',
  'yakitori':'familiar-yakitori-negima',
  'takeaway-yakitori':'takeaway-yakitori-momo-tare',
  'tempura':'familiar-tempura-assorted',
  'vegetable-tempura':'varied-vegetable-tempura',
  'takeaway-tempura':'takeaway-tempura-shrimp',
  'potage':'familiar-side-corn-potage',
  'clear-soup':'soup311-osuimono-tofu-wakame',
  'arajiru':'soup311-arajiru-salmon',
  'clam-chowder':'familiar-side-clam-chowder',
  'consomme':'soup311-consomme-plain',
  'wonton-soup':'soup311-wonton-pork',
  'instant-potage':'takeaway-knorr-corn',
  'instant-harusame':'takeaway-harusame-wonton',
  'oden':'palette-oden',
  'bagel':'palette-bagel',
  'sandwich':'palette-sandwich',
  'english-muffin':'bread-english-muffin-ham-cheese',
});
const formerRiceBowls = new Set(['chicken-rice-bowl','beef-rice-bowl','pork-rice-bowl','tofu-rice-bowl','tofu-natto-rice']);
const standardQueryAliases = Object.freeze({karaage:['唐揚げ']});

/** 明示した既存IDだけをまとめます。新しい料理を名前だけで自動所属させません。 */
export const MENU_VARIATION_GROUPS = freeze([
  meal('nikujaga', '肉じゃが', ['beef-potato'], {role:'main', staple:false, mealBase:false, customiserKind:'nikujaga'}),
  meal('okonomiyaki', 'お好み焼き', ['seafood-okonomiyaki'], {role:'main', customiserKind:'okonomiyaki'}),
  meal('rice', 'ご飯', [
    'plain-rice','staple-brown-rice','staple-mixed-rice','staple-barley-rice','staple-wakame-rice',
    'staple-corn-rice','staple-mushroom-rice','staple-turmeric-rice','daily-rice-gomoku',
    'daily-rice-chicken-burdock','daily-rice-green-peas','daily-rice-hijiki','salmon-fried-rice',
  ], {mealBase:false, recipeProfiles:{
      'salmon-fried-rice':{role:'main', mealBase:true},
    }}),
  meal('onigiri', 'おにぎり', [
    'staple-salt-onigiri','staple-grilled-onigiri','daily-onigiri-salt','daily-onigiri-salmon',
    'daily-onigiri-plum','daily-onigiri-tuna-mayo','daily-onigiri-kombu','daily-onigiri-okaka',
    'daily-onigiri-sesame','daily-onigiri-grilled',
  ], {mealBase:false}),
  meal('udon', 'うどん', [
    'staple-plain-udon','staple-chilled-udon','daily-udon-plain','daily-udon-kitsune','daily-udon-tanuki',
    'daily-udon-wakame','daily-udon-meat','daily-udon-tempura','daily-udon-curry','kyoto-keiran-udon',
    'udon-egg','udon-pork',
  ], {recipeProfiles:{
      'udon-egg':{role:'main'},
      'udon-pork':{role:'main'},
    }}),
  meal('soba', 'そば', [
    'staple-sesame-soba','staple-warm-soba','daily-soba-plain','daily-soba-kitsune','daily-soba-tanuki',
    'daily-soba-wakame','daily-soba-meat','daily-soba-tempura','daily-soba-curry','soba-chicken',
  ], {recipeProfiles:{
      'soba-chicken':{role:'main'},
    }}),
  meal('pasta', 'パスタ', [
    'staple-olive-pasta','staple-tomato-pasta','daily-pasta-peperoncino','daily-pasta-carbonara',
    'daily-pasta-genovese','daily-pasta-bolognese','daily-pasta-arrabbiata','daily-pasta-pescatore',
    'daily-pasta-napolitan','daily-pasta-japanese-mushroom','daily-pasta-tuna-tomato','daily-pasta-vongole',
    'pasta-meat','pasta-shrimp','pasta-mushroom','pasta-milk-salmon',
  ], {recipeProfiles:{
      'pasta-meat':{role:'main'},
      'pasta-shrimp':{role:'main'},
      'pasta-mushroom':{role:'main'},
      'pasta-milk-salmon':{role:'main'},
    }}),
  meal('curry', 'カレー', [
    'daily-curry-chicken','daily-curry-pork','daily-curry-beef','daily-curry-vegetable','daily-curry-keema',
    'varied-green-curry-rice','varied-butter-chicken-rice','world-massaman-chicken','world-mutton-curry',
    'world-saag-chicken','world-saag-paneer','tomato-chicken-curry','minced-dry-curry','rice-baked-cheese',
  ], {recipeProfiles:{
      'tomato-chicken-curry':{role:'main'},
      'minced-dry-curry':{role:'main'},
      'rice-baked-cheese':{role:'main'},
    }}),
  meal('naan', 'ナン', ['world-naan-plain','world-naan-garlic','world-naan-butter','world-naan-cheese','world-naan-sesame','world-naan-wholewheat'], {mealBase:false}),
  meal('retort-curry', 'レトルトカレー', [
    'prepared-retort-beef-curry','prepared-retort-pork-curry','prepared-retort-chicken-curry',
    'prepared-retort-vegetable-curry','prepared-retort-keema-curry',
  ], {nature:'retort'}),
  meal('yakisoba', '焼きそば', ['daily-yakisoba-sauce','daily-yakisoba-salt','daily-yakisoba-seafood']),
  meal('cup-yakisoba', 'カップ焼きそば', ['prepared-cup-yakisoba-sauce','prepared-cup-yakisoba-salt'], {nature:'instant'}),
  meal('cup-udon', 'カップうどん', ['prepared-cup-udon-kitsune','prepared-cup-udon-tempura'], {nature:'instant'}),
  meal('cup-ramen', 'カップラーメン', [
    'prepared-cup-ramen-soy','prepared-cup-ramen-salt','prepared-cup-ramen-miso','prepared-cup-ramen-tonkotsu',
    'prepared-cup-ramen-seafood','prepared-cup-ramen-nonfried-soy','prepared-cup-ramen-nonfried-salt',
  ], {nature:'instant'}),
  meal('bag-ramen', '袋入り即席ラーメン', [
    'prepared-bag-ramen-soy','prepared-bag-ramen-miso','prepared-bag-ramen-salt','prepared-bag-ramen-nonfried',
  ], {nature:'instant'}),
  meal('miso-soup', 'みそ汁', [
    'soup-001','soup-002','soup-003','calendar-soup-cabbage-egg','daily-miso-onion','daily-miso-clam',
    'daily-miso-tonjiru','daily-miso-potato','daily-miso-aburaage-daikon',
  ], {role:'soup', staple:false, mealBase:false}),
  dish('omelette', 'オムレツ', [
    'classic-omelette-plain','classic-omelette-cheese','classic-omelette-spinach','classic-omelette-bacon',
    'egg-potato','breakfast-spinach-omelette',
  ]),
  meal('nigiri', 'にぎり寿司', [
    'classic-sushi-tuna','classic-sushi-salmon','classic-sushi-shrimp','classic-sushi-squid',
    'palette-nigiri-chutoro','palette-nigiri-seabream','palette-nigiri-yellowtail','palette-nigiri-scallop',
    'palette-nigiri-octopus','palette-nigiri-egg','palette-nigiri-anago',
    'classic-sushi-assorted',
  ]),
  meal('hosomaki', '細巻き', [
    'sushi-hosomaki-kappa','sushi-hosomaki-tekka','sushi-hosomaki-natto','sushi-hosomaki-ume-shiso','sushi-hosomaki-tuna-mayo',
  ]),
  meal('futomaki', '太巻き', ['sushi-futomaki-egg-vegetable','sushi-futomaki-seafood','sushi-futomaki-salad']),
  meal('gunkan', '軍艦巻き', [
    'sushi-gunkan-ikura','sushi-gunkan-negitoro','sushi-gunkan-tuna-mayo','sushi-gunkan-corn-mayo',
    'sushi-gunkan-natto','sushi-gunkan-crab','sushi-gunkan-shirasu',
  ]),
  meal('tea', 'お茶・紅茶', [
    'drink-green-tea','drink-roasted-tea','drink-barley-tea','drink-oolong-tea','drink-black-tea','drink-milk-tea','drink-ginger-tea',
  ], {role:'drink', staple:false, mealBase:false}),
  meal('coffee', 'コーヒー', ['drink-coffee','drink-cafe-au-lait','drink-soy-latte'], {role:'drink', staple:false, mealBase:false}),
  // 同じ料理の味・主材料の違いを詳細の選択肢へまとめます。
  // 古い主菜扱いの主食は対象IDだけを明示し、献立で使う区分をそのまま保ちます。
  meal('pizza', 'ピザ', ['daily-pizza-margherita','daily-pizza-mixed','daily-pizza-teriyaki','daily-pizza-seafood']),
  meal('fried-rice', 'チャーハン', [
    'daily-fried-rice-egg','daily-fried-rice-gomoku','daily-fried-rice-kimchi','daily-fried-rice-shrimp',
    'egg-fried-rice',
  ], {recipeProfiles:{
      'egg-fried-rice':{role:'main'},
    }}),
  meal('ramen', 'ラーメン', ['daily-ramen-soy','daily-ramen-salt','daily-ramen-miso','daily-ramen-tanmen',
    'noodle-ramen-niboshi','noodle-ramen-miso-butter-corn','noodle-ramen-tonkotsu','noodle-ramen-iekei',
    'noodle-ramen-jiro','noodle-ramen-seabura','noodle-ramen-tantan']),
  meal('chinese-noodles', '油そば・冷たい中華麺・汁なし担々麺', ['noodle-aburasoba','noodle-hiyashi-chuka','noodle-soupless-tantan']),
  meal('donburi', '丼もの', [
    'daily-donburi-oyako','daily-donburi-pork','daily-donburi-mapo','daily-donburi-chinese',
    'daily-donburi-teriyaki','familiar-katsudon','familiar-sauce-katsudon','familiar-chicken-katsudon',
    'familiar-tendon','familiar-kakiage-don','familiar-tenshinhan','familiar-kaisen-don',
    'familiar-tekka-don','familiar-salmon-don','varied-yakitori-don','varied-yakiniku-don','varied-unadon',
    'chicken-rice-bowl','beef-rice-bowl','pork-rice-bowl','tofu-rice-bowl','tofu-natto-rice',
  ], {recipeProfiles:{
      'chicken-rice-bowl':{role:'main'},
      'beef-rice-bowl':{role:'main'},
      'pork-rice-bowl':{role:'main'},
      'tofu-rice-bowl':{role:'main'},
      'tofu-natto-rice':{role:'main'},
    }}),
  meal('omelette-rice', 'オムライス', [
    'classic-omelette-rice-cheese','classic-omelette-rice-mushroom','classic-omelette-rice-tomato',
    'rice-egg-omelette',
  ], {recipeProfiles:{
      'rice-egg-omelette':{role:'main'},
    }}),
  meal('retort-donburi', 'レトルト丼', [
    'prepared-retort-gyudon','prepared-retort-oyakodon','prepared-retort-chukadon','prepared-retort-mapodon',
  ], {nature:'retort'}),
  meal('burger', 'ハンバーガー', [
    'prepared-burger-plain','prepared-burger-cheese','prepared-burger-teriyaki',
    'prepared-burger-chicken','prepared-burger-fish','prepared-burger-double',
  ], {nature:'fast-food'}),
  meal('bought-sandwich', 'サンドイッチ（購入品）', [
    'prepared-sandwich-egg','prepared-sandwich-ham','prepared-sandwich-tuna','prepared-sandwich-vegetable',
    'convenience-egg-sandwich',
  ], {nature:'ready-to-eat'}),
  meal('hot-sandwich', 'ホットサンド', [
    'chicken-sandwich','breakfast-egg-sandwich',
    'bread-hot-sandwich-ham-cheese','bread-hot-sandwich-egg-cheese','bread-hot-sandwich-tuna-melt',
    'bread-hot-sandwich-chicken-cabbage','bread-hot-sandwich-bacon-egg','bread-hot-sandwich-sausage-cheese',
    'bread-hot-sandwich-pizza','bread-hot-sandwich-corn-cheese','bread-hot-sandwich-mushroom-cheese',
    'bread-hot-sandwich-avocado-ham','bread-hot-sandwich-custom',
  ], {role:'main',defaultRecipeId:'bread-hot-sandwich-ham-cheese'}),
  meal('toast', 'トースト', [
    'staple-butter-toast','staple-garlic-toast','staple-cheese-toast','staple-sesame-toast',
    'staple-avocado-toast','bread-toast-jam-butter','bread-toast-marmalade-butter',
    'bread-toast-honey-butter','bread-toast-avocado','bread-toast-pizza','bread-toast-peanut-butter',
    'bread-toast-custom','breakfast-chickpea-toast',
  ], {mealBase:false, recipeProfiles:{
      'breakfast-chickpea-toast':{role:'main', mealBase:true},
    }}),
  meal('sliced-bread', '食パン', ['staple-plain-bread','staple-wholegrain-bread'], {nature:'ready-to-eat', mealBase:false}),
  meal('oatmeal', 'オートミールがゆ', ['staple-oatmeal-water','staple-oatmeal-milk','staple-oatmeal-soy'], {mealBase:false}),
  dish('hamburg', 'ハンバーグ', [
    'beef-hamburg','tofu-burger','classic-hamburg','familiar-hamburg-oroshi','familiar-hamburg-stew','familiar-hamburg-cheese','bistro-cheese-in-hamburg',
  ]),
  dish('mapo-tofu', '麻婆豆腐', ['mapo-tofu-chen-style','tofu-mapo'], {defaultRecipeId:'mapo-tofu-chen-style'}),
  dish('gyoza', '餃子', ['classic-gyoza','varied-boiled-gyoza','varied-shrimp-boiled-gyoza','varied-fried-gyoza']),
  dish('karaage', '鶏の唐揚げ', [
    'daily-snack-oven-karaage','classic-karaage-thigh','classic-karaage-breast','classic-karaage-salt',
    'canteen-sweet-spicy-sesame-karaage',
  ]),
  dish('grilled-fish', '焼き魚', [
    'tuna-cube','classic-grilled-salmon','classic-grilled-mackerel','classic-grilled-hokke',
    'classic-grilled-aji','classic-grilled-saury','classic-grilled-shishamo','familiar-buri-teriyaki',
  ]),
  dish('sashimi', '刺身', [
    'classic-sashimi-tuna','classic-sashimi-tuna-mediumfat','classic-sashimi-salmon',
    'classic-sashimi-yellowtail','classic-sashimi-seabream','classic-sashimi-bonito','classic-sashimi-aji',
    'classic-sashimi-squid','classic-sashimi-octopus','classic-sashimi-scallop','classic-sashimi-assorted',
    'seafood-sashimi-mizudako','seafood-sashimi-amaebi','seafood-sashimi-inada','seafood-sashimi-hirame',
    'seafood-sashimi-tsubu','seafood-sashimi-shimesaba','seafood-sashimi-iwashi','seafood-sashimi-sanma',
    'seafood-sashimi-akaebi','seafood-sashimi-hiramasa','sashimi-kanpachi','sashimi-suzuki',
    'sashimi-negitoro','sashimi-torotaku',
  ], {nature:'ready-to-eat', recipeProfiles:{
      'sashimi-negitoro':{nature:'home-cooked'},
      'sashimi-torotaku':{nature:'home-cooked'},
    }}),
  dish('croquette', 'コロッケ', ['classic-croquette-potato','classic-croquette-pumpkin','classic-croquette-cream','world-crab-cream-croquette']),
  dish('stew', 'シチュー', ['familiar-beef-stew','familiar-chicken-cream-stew','familiar-pork-cream-stew']),
  dish('nabe', '鍋料理', [
    'familiar-yose-nabe','familiar-kimchi-nabe','familiar-sesame-soy-nabe','familiar-chanko-nabe',
    'chicken-tofu-pot','familiar-mizutaki','familiar-sukiyaki','familiar-pork-shabu','familiar-yudofu',
    'simmered-pork-millefeuille-nabe','simmered-pork-mizore-nabe','simmered-chicken-yuzu-kosho-nabe',
    'simmered-chicken-salt-lemon-nabe','simmered-ishikari-nabe','simmered-beef-motsu-nabe',
    'simmered-oyster-miso-nabe','simmered-duck-negi-nabe','simmered-chicken-tomato-cheese-nabe',
    'simmered-chicken-curry-nabe','simmered-soy-milk-tantan-nabe','simmered-pork-spinach-joya-nabe',
    'evening-main-tuna-negi-nabe','kyoto-yudofu',
  ]),
  dish('yakitori', '焼き鳥', [
    'familiar-yakitori-negima','varied-yakitori-thigh-salt','varied-yakitori-thigh-tare','varied-yakitori-breast-salt',
    'varied-yakitori-skin','varied-yakitori-tsukune','varied-yakitori-tsukune-cheese','varied-yakitori-ume-shiso',
  ]),
  dish('takeaway-yakitori', '焼き鳥（テイクアウト）', [
    'takeaway-yakitori-momo-tare','takeaway-yakitori-momo-salt','takeaway-yakitori-negima-tare',
    'takeaway-yakitori-tsukune-tare','takeaway-yakitori-kawa-tare','takeaway-yakitori-sunagimo-salt',
  ], {nature:'ready-to-eat'}),
  dish('tempura', '天ぷら', [
    'familiar-tempura-assorted','varied-shrimp-tempura','varied-squid-tempura','varied-whitefish-tempura',
    'varied-kakiage','varied-toriten',
  ]),
  dish('vegetable-tempura', '野菜・きのこの天ぷら', ['varied-vegetable-tempura','varied-shimeji-tempura'], {role:'side'}),
  dish('takeaway-tempura', '天ぷら（外食）', [
    'takeaway-tempura-shrimp','takeaway-tempura-squid','takeaway-tempura-maitake',
  ], {nature:'ready-to-eat', recipeProfiles:{
      'takeaway-tempura-maitake':{role:'side'},
    }}),
  dish('potage', 'ポタージュ', [
    'soup-004','soup-006','soup-008','calendar-soup-cauliflower-potato','familiar-side-corn-potage','soup311-pumpkin-milk-potage',
  ], {role:'soup'}),
  dish('clear-soup', 'お吸い物・すまし汁', ['soup-018','soup-033','soup311-osuimono-tofu-wakame','soup311-osuimono-asari'], {role:'soup'}),
  dish('arajiru', 'あら汁', ['soup311-arajiru-salmon','soup311-arajiru-buri'], {role:'soup'}),
  dish('clam-chowder', 'クラムチャウダー', ['familiar-side-clam-chowder','soup311-clam-chowder-tomato'], {role:'soup'}),
  dish('consomme', 'コンソメスープ', ['soup311-consomme-plain','soup311-consomme-vegetable'], {role:'soup'}),
  dish('wonton-soup', 'ワンタンスープ', ['soup-038','soup311-wonton-pork'], {role:'soup'}),
  dish('instant-potage', 'カップスープ', [
    'takeaway-knorr-corn','takeaway-knorr-potage','takeaway-knorr-mushroom','takeaway-knorr-spinach','takeaway-knorr-pumpkin','takeaway-knorr-tomato',
  ], {role:'soup', nature:'instant'}),
  dish('instant-harusame', '春雨スープ（即席）', [
    'takeaway-harusame-wonton','takeaway-harusame-egg','takeaway-harusame-tantan',
    'takeaway-harusame-wakame-vegetable','takeaway-harusame-wakame-gomtang',
  ], {role:'soup', nature:'instant'}),
  snack('yoghurt', 'ヨーグルト', [
    'snack-banana-yogurt','snack-kiwi-yogurt','snack-berry-yogurt','snack-apple-raisin-yogurt',
    'snack-sweet-potato-yogurt','snack-plain-yogurt',
  ], {recipeProfiles:{
      'snack-plain-yogurt':{nature:'ready-to-eat'},
    }}),
  snack('cheese', 'チーズ', [
    'daily-snack-plain-cheese','daily-snack-mozzarella','palette-cheese-camembert','palette-cheese-cheddar',
    'palette-cheese-cream','palette-cheese-blue','palette-cheese-processed','palette-cheese-parmesan',
  ], {nature:'ready-to-eat'}),
  snack('nuts', 'ナッツ', [
    'snack-almond','snack-walnut','snack-cashew','snack-peanut','snack-nuts-raisin',
    'palette-nuts-pistachio','palette-nuts-macadamia','palette-nuts-pine',
  ], {nature:'ready-to-eat'}),
  drink('milk', '牛乳・豆乳', ['drink-milk','drink-soy-milk'], {nature:'ready-to-eat'}),
  drink('flavoured-milk', 'フルーツミルク・豆乳', ['drink-banana-soy','drink-strawberry-milk']),
  drink('juice', '果汁・野菜ジュース', ['drink-orange-juice','drink-apple-juice','drink-tomato-juice'], {nature:'ready-to-eat'}),
  drink('tomato-juice-product', 'トマトジュース（市販品）', ['takeaway-tomato-unsalted','takeaway-tomato-low-salt'], {nature:'ready-to-eat'}),
  drink('water', '水・無糖炭酸水', ['drink-water','daily-drink-sparkling-water'], {nature:'ready-to-eat'}),
  drink('lemon-water', 'レモン水・レモン炭酸水', ['drink-lemon-water','daily-drink-lemon-sparkling']),
  // 選択式の料理は1つの入口を用意し、具材の組み合わせ自体はDBへ列挙しません。
  dish('oden', 'おでん', ['palette-oden']),
  meal('bagel', 'ベーグル', [
    'palette-bagel','breakfast-bagel-plain','breakfast-bagel-egg-cheese','breakfast-bagel-ham-cheese',
  ], {mealBase:false, nature:'ready-to-eat', recipeProfiles:{
      'breakfast-bagel-egg-cheese':{nature:'home-cooked', mealBase:true},
      'breakfast-bagel-ham-cheese':{nature:'home-cooked', mealBase:true},
    }}),
  snack('waffle', 'ワッフル', ['palette-waffle']),
  snack('muffin', 'マフィン', ['palette-muffin']),
  meal('sandwich', 'サンドイッチ', [
    'palette-sandwich','bread-sandwich-egg-mayo','bread-sandwich-tuna-cucumber',
    'bread-sandwich-ham-cheese','bread-sandwich-vegetable','bread-sandwich-chicken','bread-sandwich-custom',
  ]),
  // パンだけの旧レシピを保持し、調理済みの具入りタイプと同じ入口で選びます。
  // 元レシピごとの提供形態・構成条件を照合します。
  meal('english-muffin', 'イングリッシュマフィン', [
    'palette-english-muffin','bread-english-muffin-ham-cheese','bread-english-muffin-egg-cheese',
    'bread-english-muffin-sausage-egg-cheese','bread-english-muffin-bacon-egg-cheese','bread-english-muffin-tuna-cheese',
    'breakfast-english-muffin-egg','breakfast-english-muffin-ham-cheese',
  ], {defaultRecipeId:'bread-english-muffin-ham-cheese',
    recipeProfiles:{'palette-english-muffin':{nature:'ready-to-eat',mealBase:false}}}),

  meal('rice-porridge', 'おかゆ', ['staple-rice-porridge','staple-sweet-potato-porridge'], {mealBase:false, defaultRecipeId:'staple-rice-porridge'}),
  meal('bought-onigiri', 'おにぎり（購入品）', [
    'convenience-tuna-mayo-onigiri','convenience-salmon-onigiri',
  ], {mealBase:false, nature:'ready-to-eat', defaultRecipeId:'convenience-tuna-mayo-onigiri'}),
  dish('tamagoyaki', '卵焼き・だし巻き', [
    'classic-tamagoyaki','classic-dashimaki','kyoto-dashimaki','omelette-vegetable','crab-omelette',
    'tavern-chive-omelette','varied-umaki','breakfast-cheese-mushroom-egg',
  ], {defaultRecipeId:'kyoto-dashimaki', recipeProfiles:{
      'tavern-chive-omelette':{role:'side'},
    }}),
  dish('fried-eggs', '目玉焼き・ハムエッグ', [
    'classic-fried-egg','breakfast-ham-egg','breakfast-bacon-egg','breakfast-chashu-egg',
  ], {defaultRecipeId:'breakfast-ham-egg'}),
  dish('scrambled-eggs', 'スクランブルエッグ', ['classic-scrambled-egg','breakfast-tomato-scramble'], {defaultRecipeId:'classic-scrambled-egg'}),
  dish('spring-roll', '春巻き', ['varied-spring-roll','kyoto-egg-spring-roll'], {defaultRecipeId:'varied-spring-roll'}),
  dish('shumai', 'シュウマイ', ['classic-shumai','varied-shrimp-shumai'], {defaultRecipeId:'varied-shrimp-shumai'}),
  dish('tsukune', '鶏つくね', ['chicken-meatball','classic-chicken-okara-lotus','canteen-hijiki-chicken-tsukune'], {defaultRecipeId:'chicken-meatball'}),
  dish('meatballs', '肉団子', ['pork-meatball','classic-meatballs-teriyaki'], {defaultRecipeId:'pork-meatball'}),
  dish('meuniere', '魚のムニエル', [
    'familiar-salmon-meuniere','familiar-cod-meuniere','familiar-aji-meuniere',
  ], {defaultRecipeId:'familiar-salmon-meuniere'}),
  dish('fish-tatsuta', '魚の竜田揚げ', [
    'familiar-mackerel-tatsuta','canteen-hokke-tatsuta-negi','evening-main-katsuo-tatsuta',
  ], {defaultRecipeId:'familiar-mackerel-tatsuta'}),
  dish('sweet-sour-pork', '酢豚', ['familiar-sweet-sour-pork','pork-vinegar'], {defaultRecipeId:'pork-vinegar'}),
  dish('tongue-grill', '牛タンの塩焼き', ['comfort-tongue-salt','varied-beef-tongue-negi'], {defaultRecipeId:'comfort-tongue-salt'}),
  dish('chijimi', 'チヂミ', [
    'rice-flour-chijimi','classic-pork-nira-chijimi',
  ], {staple:true, mealBase:true, defaultRecipeId:'rice-flour-chijimi', recipeProfiles:{
      'classic-pork-nira-chijimi':{staple:false, mealBase:false},
    }}),
  dish('bought-fried-chicken', 'フライドチキン（購入品）', [
    'convenience-l-chiki','convenience-famichiki',
  ], {nature:'ready-to-eat', defaultRecipeId:'convenience-l-chiki'}),
  side('hiyayakko', '冷奴', [
    'classic-side-hiyayakko','classic-side-shirasu-tofu','classic-side-okra-tofu','classic-side-ume-tofu',
    'breakfast-natto-okra','tavern-chive-kimchi-tofu',
  ], {defaultRecipeId:'classic-side-hiyayakko'}),
  side('namul', 'ナムル', [
    'classic-side-bean-sprout-namul','classic-side-carrot-namul','classic-side-spinach-namul',
  ], {defaultRecipeId:'classic-side-bean-sprout-namul'}),
  side('asazuke', '浅漬け', [
    'classic-side-cucumber-pickle','classic-side-cabbage-pickle','classic-side-hakusai-pickle',
    'evening-side-pickled-celery',
  ], {defaultRecipeId:'classic-side-cucumber-pickle'}),
  side('ohitashi', 'お浸し', [
    'classic-side-spinach-ohitashi','classic-side-komatsuna-ohitashi','familiar-side-okra-ohitashi',
  ], {defaultRecipeId:'classic-side-spinach-ohitashi'}),
  side('cucumber-sunomono', 'きゅうりの酢の物', [
    'classic-side-cucumber-sunomono','side-004','classic-side-octopus-cucumber','varied-uzaku',
  ], {defaultRecipeId:'classic-side-cucumber-sunomono'}),
  side('dengaku', '田楽', [
    'classic-side-tofu-dengaku','classic-tofu-negi-miso','side-013','kyoto-namafu-dengaku',
  ], {defaultRecipeId:'kyoto-namafu-dengaku', recipeProfiles:{
      'classic-tofu-negi-miso':{role:'main'},
    }}),
  side('taro-simmered', '里いもの煮物', ['classic-side-taro-simmered','kyoto-koimo'], {defaultRecipeId:'kyoto-koimo'}),
  side('hijiki-simmered', 'ひじきの煮物', ['side-029','classic-side-hijiki-aburaage'], {defaultRecipeId:'side-029'}),
  side('coleslaw', 'コールスロー', ['side-044','familiar-side-corn-coleslaw'], {defaultRecipeId:'side-044'}),
  side('natto', '納豆', ['classic-natto-plain','classic-natto-grated-daikon'], {nature:'ready-to-eat', defaultRecipeId:'classic-natto-plain'}),
  side('tuna-can', 'ツナ缶', ['acmp-tuna-oil','acmp-tuna-water'], {nature:'ready-to-eat', defaultRecipeId:'acmp-tuna-oil'}),
  side('sesame-dressed', 'ごま和え', ['side-001','snack-soybean','evening-side-tuna-peppers'], {defaultRecipeId:'side-001'}),
  soup('minestrone', 'ミネストローネ', ['familiar-side-minestrone','calendar-soup-tomato-barley'], {defaultRecipeId:'familiar-side-minestrone'}),
  soup('surinagashi', 'すり流し汁', ['soup-030','soup-040'], {defaultRecipeId:'soup-030'}),
  soup('milk-soup', 'ミルクスープ', [
    'soup-005','soup-009','soup-019','soup-029','calendar-soup-sweet-potato-milk',
  ], {defaultRecipeId:'calendar-soup-sweet-potato-milk'}),
  soup('soy-milk-soup', '豆乳スープ', ['soup-024','calendar-soup-edamame-corn','calendar-soup-oat-mushroom'], {defaultRecipeId:'soup-024'}),
  soup('vermicelli-soup', '春雨スープ', ['soup-035','varied-chicken-ball-vermicelli-soup'], {defaultRecipeId:'soup-035'}),
  drink('cocoa', 'ココア', ['drink-milk-cocoa','drink-soy-cocoa'], {defaultRecipeId:'drink-milk-cocoa'}),
  drink('beer', 'ビール', ['performance-beer','performance-black_beer'], {nature:'ready-to-eat', defaultRecipeId:'performance-beer'}),
  drink('wine', 'ワイン', ['performance-wine_red','performance-wine_white'], {nature:'ready-to-eat', defaultRecipeId:'performance-wine_red'}),
  drink('protein-powder-drinks', 'プロテインドリンク（粉末）', [
    'performance-soy_powder-water','performance-soy_powder-milk','performance-whey_powder-water',
    'performance-whey_powder-milk',
  ], {nature:'ready-to-eat', defaultRecipeId:'performance-soy_powder-water'}),
  drink('energy-drinks', 'エナジードリンク', ['performance-energy','performance-energy_zero'], {nature:'ready-to-eat', defaultRecipeId:'performance-energy'}),
  snack('fresh-kiwi', 'キウイフルーツ', ['snack-kiwi','fruit-gold-kiwi'], {nature:'ready-to-eat', defaultRecipeId:'fruit-gold-kiwi'}),
  snack('fresh-pear', '梨', ['fruit-japanese-pear','fruit-european-pear'], {nature:'ready-to-eat', defaultRecipeId:'fruit-japanese-pear'}),
  snack('fresh-grape', 'ぶどう', ['snack-grape','fruit-shine-muscat'], {nature:'ready-to-eat', defaultRecipeId:'snack-grape'}),
  snack('fresh-cherry', 'さくらんぼ', ['fruit-japanese-cherry','fruit-american-cherry'], {nature:'ready-to-eat', defaultRecipeId:'fruit-japanese-cherry'}),
  snack('bought-doughnuts', 'ドーナツ（市販品）', [
    'dessert-old-fashioned','dessert-french-cruller','dessert-cream-doughnut','dessert-honey-glazed',
    'dessert-chewy-ring',
  ], {nature:'ready-to-eat', defaultRecipeId:'dessert-old-fashioned'}),
  snack('bought-cheesecake', 'チーズケーキ（市販品）', [
    'dessert-souffle-cheesecake','dessert-rare-cheesecake',
  ], {nature:'ready-to-eat', defaultRecipeId:'dessert-souffle-cheesecake'}),
  snack('bought-shortcake', 'ショートケーキ（市販品）', [
    'dessert-strawberry-shortcake','dessert-chocolate-shortcake',
  ], {nature:'ready-to-eat', defaultRecipeId:'dessert-strawberry-shortcake'}),
  snack('bought-salad-chicken', 'サラダチキン（市販品）', [
    'performance-chicken_plain','performance-chicken_herb','performance-chicken_smoke',
    'convenience-salad-chicken-bar',
  ], {nature:'ready-to-eat', defaultRecipeId:'performance-chicken_plain'}),
  snack('bought-steamed-buns', '中華まん（市販品）', [
    'daily-snack-pork-bun','convenience-pork-bun','convenience-pizza-bun',
  ], {nature:'ready-to-eat', defaultRecipeId:'daily-snack-pork-bun'}),
  snack('protein-bars', 'プロテインバー', [
    'performance-bar_baked_choco','performance-bar_baked_bitter','performance-bar_manzoku',
  ], {nature:'ready-to-eat', defaultRecipeId:'performance-bar_baked_choco'}),
  snack('calorie-blocks', 'カロリーメイト ブロック', [
    'performance-calorie_block_choco','performance-calorie_block_cheese',
  ], {nature:'ready-to-eat', defaultRecipeId:'performance-calorie_block_choco'}),
  snack('chocolate-bars', '板チョコレート', [
    'confectionery-milk-chocolate','confectionery-black-chocolate',
  ], {nature:'ready-to-eat', defaultRecipeId:'confectionery-milk-chocolate'}),
].map(group => Object.hasOwn(standardRecipeIds, group.id)
  ? {...group, defaultRecipeId:standardRecipeIds[group.id]} : group));

/** 追加時の重複所属を検知し、ある料理が複数の入口へ消えることを防ぎます。 */
export function validateVariationDefinitions(definitions = MENU_VARIATION_GROUPS) {
  if (!Array.isArray(definitions)) throw Error('メニューの種類の一覧を確認してください。');
  const groups = new Set(), recipes = new Set();
  for (const group of definitions) {
    if (!group || typeof group !== 'object' || typeof group.id !== 'string' || !group.id.trim() || groups.has(group.id) ||
        typeof group.label !== 'string' || !group.label.trim() || !Array.isArray(group.recipeIds) || !group.recipeIds.length) {
      throw Error('メニューの種類の名前と識別子を確認してください。');
    }
    groups.add(group.id);
    if(group.defaultRecipeId!==undefined&&!group.recipeIds.includes(group.defaultRecipeId))throw Error('最初に表示する料理を種類の一覧に含めてください。');
    if(group.recipeProfiles!==undefined){
      if(!group.recipeProfiles||typeof group.recipeProfiles!=='object'||Array.isArray(group.recipeProfiles))throw Error('料理の提供形態の条件を確認してください。');
      for(const [id,profile] of Object.entries(group.recipeProfiles)){
        if(!group.recipeIds.includes(id)||!profile||typeof profile!=='object'||Array.isArray(profile)||
          Object.keys(profile).some(key=>!['role','nature','staple','mealBase'].includes(key))||
          (profile.role!==undefined&&!['staple','main','side','soup','drink','snack'].includes(profile.role))||
          (profile.staple!==undefined&&typeof profile.staple!=='boolean')||
          (profile.nature!==undefined&&!['unspecified','home-cooked','instant','retort','fast-food','ready-to-eat'].includes(profile.nature))||
          (profile.mealBase!==undefined&&typeof profile.mealBase!=='boolean'))throw Error('料理の提供形態の条件を確認してください。');
      }
    }
    for (const id of group.recipeIds) {
      if (typeof id !== 'string' || !id.trim() || recipes.has(id)) throw Error('同じ料理を複数の種類に登録できません。');
      recipes.add(id);
    }
  }
  return true;
}
validateVariationDefinitions();
const definitionByRecipe = new Map(MENU_VARIATION_GROUPS.flatMap(group => group.recipeIds.map(id => [id, group])));

function checkedRecipes(recipes) {
  if (!Array.isArray(recipes)) throw Error('メニューの一覧を確認してください。');
  const ids = new Set();
  for (const recipe of recipes) {
    if (!recipe || typeof recipe !== 'object' || typeof recipe.id !== 'string' || !recipe.id ||
        typeof recipe.name !== 'string' || !recipe.name || ids.has(recipe.id)) throw Error('メニューの識別子と料理名を確認してください。');
    ids.add(recipe.id);
  }
  return recipes;
}

function definitionFor(recipe) {
  if (recipe.custom === true) return null;
  const definition = definitionByRecipe.get(recipe.id);
  const profile=definition?.recipeProfiles?.[recipe.id];
  if (!definition || recipe.role !== (profile?.role??definition.role) || recipeNature(recipe) !== (profile?.nature??definition.nature) ||
      recipe.staple !== (profile?.staple??definition.staple) || recipe.mealBase !== (profile?.mealBase??definition.mealBase)) return null;
  return definition;
}

/** 表示用の検索データへ足す見出し名。元レシピの名前や読みは変更しません。 */
export function variationSearchAliases(recipe) {
  if (!recipe || typeof recipe !== 'object' || typeof recipe.id !== 'string') throw Error('料理の情報を確認してください。');
  const definition = definitionFor(recipe);
  if (!definition) return [];
  const aliases = [definition.label];
  if (definition.id === 'curry') aliases.push('カレーライス');
  if (definition.id === 'retort-curry') aliases.push('レトルトカレーライス');
  if (formerRiceBowls.has(recipe.id)) aliases.push('具だくさんの丼');
  if (definition.id === 'bought-sandwich' && recipe.id !== 'convenience-egg-sandwich') aliases.push('サンドイッチ（購入品の一般例）');
  if (definition.id === 'yoghurt' && recipe.id !== 'snack-plain-yogurt') aliases.push('ヨーグルト（トッピング）');
  return aliases;
}

/** 元の小分類名を尊重します。量の単位や別のレシピ名へ置き換えません。 */
export function variantLabel(recipe) {
  if (!recipe || typeof recipe !== 'object' || typeof recipe.name !== 'string') throw Error('料理の名前を確認してください。');
  return typeof recipe.variantLabel === 'string' && recipe.variantLabel.trim() ? recipe.variantLabel : recipe.name;
}

function selection(recipes, definition, selectedRecipeId) {
  const recipe = recipes.find(item => item.id === selectedRecipeId) ?? recipes[0];
  return {
    key: definition ? `group:${definition.id}` : `recipe:${recipe.id}`,
    label: definition?.label ?? recipe.name,
    recipes: [...recipes], recipe, selectedRecipeId: recipe.id,
    groupId: definition?.id ?? null, variantCount: recipes.length, isGroup: Boolean(definition),
    ...(definition?.customiserKind ? {customiserKind: definition.customiserKind} : {}),
  };
}

/**
 * すでに絞った候補だけをまとめ、同じ種類を1つの入口へ表示します。
 * allRecipesを渡しても、非表示・除外済みの候補を補って戻すことはありません。
 * recipesの順序は候補の順を保ち、検索中の代表だけは料理名の一致を優先します。
 */
export function groupMenuRecipes(candidates, {query = ''} = {}) {
  checkedRecipes(candidates);
  if (typeof query !== 'string') throw Error('検索する料理名を確認してください。');
  const entries = [], byKey = new Map();
  for (const recipe of candidates) {
    const definition = definitionFor(recipe), key = definition ? `group:${definition.id}` : `recipe:${recipe.id}`;
    if (!byKey.has(key)) {
      const entry = {definition, recipes: []}; byKey.set(key, entry); entries.push(entry);
    }
    byKey.get(key).recipes.push(recipe);
  }
  return entries.map(entry => {
    const generic = entry.definition && [entry.definition.label,...(standardQueryAliases[entry.definition.id]??[])]
      .some(label=>normaliseJapaneseSearch(label)===normaliseJapaneseSearch(query));
    const ranked = query.trim() && !generic ? entry.recipes.map((recipe, index) => ({recipe, index,
      rank:japaneseQueryRank([recipe.name, variantLabel(recipe)], query)}))
      .sort((a,b) => a.rank - b.rank || Number(b.recipe.id===entry.definition?.defaultRecipeId)-Number(a.recipe.id===entry.definition?.defaultRecipeId) || a.index - b.index) : [];
    const preferred=entry.recipes.find(recipe=>recipe.id===entry.definition?.defaultRecipeId);
    return selection(entry.recipes, entry.definition, ranked[0]?.recipe.id ?? preferred?.id ?? entry.recipes[0].id);
  });
}

/** 開いた料理を選んだまま、許可された種類を標準・定義順で表示します。 */
export function getVariationGroup(recipeId, allRecipes) {
  const list = checkedRecipes(allRecipes), source = list.find(recipe => recipe.id === recipeId);
  if (!source) return null;
  const definition = definitionFor(source);
  if (!definition) return null;
  const matches = new Map(list.filter(recipe => definitionFor(recipe) === definition).map(recipe => [recipe.id, recipe]));
  const standard = definition.defaultRecipeId;
  const order = standard ? [standard, ...definition.recipeIds.filter(id => id !== standard)] : definition.recipeIds;
  return selection(order.map(id => matches.get(id)).filter(Boolean), definition, recipeId);
}
