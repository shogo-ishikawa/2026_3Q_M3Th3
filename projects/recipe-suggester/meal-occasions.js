import {recipeFamily} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';

export const MEAL_OCCASIONS = Object.freeze(['朝食', '昼食', '夕食', '間食', '晩酌']);

// 同じ分類の収録料理をIDでまとめます。新規料理はレシピ側の mealOccasions に明記します。
const reviewedGroups = [
  [['昼食', '夕食', '晩酌'], `
    chicken-teriyaki chicken-salt-lemon chicken-meatball pork-daikon pork-aubergine beef-burdock beef-broccoli
    mackerel-miso horse-mackerel-pan sardine-ginger tuna-cube shrimp-chilli squid-pepper scallop-broccoli
    crab-omelette chicken-nanban-pickle clam-sake-steam squid-daikon-simmer seafood-okonomiyaki rice-flour-chijimi
    tofu-sesame-crust yam-shimeji-butter aubergine-tomato-cold side-011 side-012 side-013 side-016 side-018
    side-022 side-027 side-031 side-032 side-037 side-038 side-039 side-040 side-041 side-054 side-055
    staple-garlic-toast snack-soybean daily-snack-oven-karaage daily-snack-bacon-cheese-roll classic-karaage-thigh
    classic-karaage-breast classic-karaage-salt classic-grilled-hokke classic-grilled-saury classic-sashimi-tuna
    classic-sashimi-tuna-mediumfat classic-sashimi-salmon classic-sashimi-yellowtail classic-sashimi-seabream
    classic-sashimi-bonito classic-sashimi-aji classic-sashimi-squid classic-sashimi-octopus
    classic-sashimi-scallop classic-sashimi-assorted classic-croquette-potato classic-croquette-pumpkin
    classic-croquette-cream classic-menchi classic-tonkatsu classic-chicken-katsu classic-aji-fry classic-gyoza
    classic-shumai classic-chicken-plum-shiso classic-chicken-negi-salt classic-tofu-negi-miso
    classic-shrimp-tofu-dumpling classic-chicken-okara-lotus classic-pork-nira-chijimi classic-natto-yam-pan-fry
    classic-side-unohana classic-side-hijiki-aburaage classic-side-potato-salad classic-side-cucumber-sunomono
    classic-side-mozuku-vinegar classic-side-taro-simmered classic-side-bamboo-tosa classic-side-daikon-konjac
    classic-side-aubergine-nibitashi classic-side-smashed-cucumber classic-side-octopus-cucumber
    classic-side-burdock-konjac classic-side-bean-sprout-namul classic-side-carrot-namul
    classic-side-spinach-namul classic-side-namasu classic-side-edamame-ginger classic-side-tofu-dengaku
    classic-side-taro-mushroom-miso classic-side-mushroom-konjac familiar-buri-daikon familiar-buri-teriyaki
    familiar-mackerel-tatsuta familiar-shrimp-fry familiar-white-fish-fry familiar-squid-rings
    familiar-tempura-assorted familiar-pork-kakuni familiar-pork-kimchi familiar-yurinchi familiar-bangbangji
    familiar-mapo-aubergine familiar-yakitori-negima familiar-yudofu familiar-side-sticks-miso-mayo
    familiar-side-shrimp-salad familiar-side-tofu-seaweed-salad familiar-side-choregi
    familiar-side-daikon-shirasu-salad familiar-side-potato-butter familiar-side-german-potatoes
    familiar-side-asparagus-butter familiar-side-grilled-shiitake familiar-side-enoki-butter
    familiar-side-onion-slice familiar-side-agedashi-tofu familiar-side-mushroom-foil familiar-side-salt-cabbage
    familiar-side-okra-ohitashi takeaway-yakitori-momo-tare takeaway-yakitori-momo-salt
    takeaway-yakitori-negima-tare takeaway-yakitori-tsukune-tare takeaway-yakitori-kawa-tare
    takeaway-yakitori-sunagimo-salt takeaway-eel-kabayaki takeaway-shumai takeaway-frozen-suigyoza
    takeaway-spring-roll takeaway-tempura-shrimp takeaway-tempura-squid takeaway-tempura-maitake
    takeaway-beef-karubi varied-boiled-gyoza varied-shrimp-boiled-gyoza varied-spring-roll varied-shrimp-shumai
    varied-fried-gyoza varied-hoikoro varied-chinjao-rousu varied-kanitama-sauce varied-tandoori-chicken
    varied-yakitori-thigh-salt varied-yakitori-thigh-tare varied-yakitori-breast-salt varied-yakitori-skin
    varied-yakitori-tsukune varied-yakitori-tsukune-cheese varied-yakitori-ume-shiso varied-beef-karubi
    varied-beef-tongue-negi varied-beef-yakiniku-garlic varied-pork-belly-yakiniku varied-bulgogi
    varied-eel-kabayaki varied-umaki varied-uzaku varied-shrimp-tempura varied-squid-tempura
    varied-whitefish-tempura varied-vegetable-tempura varied-kakiage varied-toriten varied-shimeji-tempura
    comfort-nikudofu-pork comfort-motsu-stew comfort-bokkake comfort-tongue-salt acmp-tuna-oil palette-oden
    palette-oyster-fry palette-prosciutto seafood-sashimi-mizudako seafood-sashimi-amaebi seafood-sashimi-inada
    seafood-sashimi-hirame seafood-sashimi-tsubu seafood-sashimi-shimesaba seafood-sashimi-iwashi
    seafood-sashimi-sanma seafood-sashimi-akaebi seafood-sashimi-hiramasa canteen-chicken-yuzu-grill
    canteen-chicken-mushroom-yuzu-steam canteen-chicken-avocado-yuzu-salad canteen-chikuwa-isobe
    canteen-sweet-spicy-sesame-karaage canteen-hokke-tatsuta-negi canteen-prawn-broccoli-egg-salad
    canteen-tuna-natto-okra-tororo canteen-hijiki-chicken-tsukune tavern-liver-chive
    tavern-spicy-pork-kimchi-vegetables tavern-pork-chive tavern-pork-wood-ear-egg tavern-motsu-miso-stir-fry
    tavern-chive-omelette tavern-negi-chashu tavern-chive-kimchi-tofu tavern-fluffy-yam-pan
    tavern-grilled-chicken-mayo-salad tavern-chicken-mentaiko-mayo tavern-tare-chicken-katsu-egg
    tavern-gizzard-heart-ponzu tavern-negi-kombu bistro-chicken-onion-garlic bistro-cod-shrimp-butter
    bistro-garlic-shrimp bistro-lamb-spice-skewers bistro-beef-cut-steak bistro-seafood-broccoli-ajillo
    bistro-mussel-garlic-bake bistro-escargot-herb-butter bistro-red-cabbage-two-cheeses bistro-onion-rings
    bistro-camembert-fry bistro-mentaiko-cheese-baked-potato bistro-chilli-bean-cheese-bake evening-main-aji-sanga
    evening-main-iwashi-kabayaki evening-main-ika-poppo evening-main-katsuo-tatsuta evening-main-tonpei
    evening-main-keichan evening-main-chicken-jibuni evening-main-goya-chanpuru evening-main-beef-yanagawa
    evening-main-egg-pouches evening-side-grilled-negi evening-side-tuna-peppers evening-side-ume-lotus-root
    evening-side-negi-miso-atsuage evening-side-natto-aburaage evening-side-tarako-potato
    evening-side-shiitake-konjac evening-side-pickled-celery evening-side-nori-taro
  `],
  [['昼食', '夕食'], `
    chicken-tomato chicken-steam chicken-cashew chicken-miso chicken-curry-yogurt chicken-oyako chicken-rice-flour
    chicken-broccoli chicken-lotus pork-ginger pork-cabbage pork-vinegar pork-beansprout pork-meatball pork-roll
    pork-salt-cabbage pork-tofu beef-onion beef-pepper beef-potato beef-tomato beef-hamburg salmon-foil
    salmon-miso salmon-milk salmon-lemon mackerel-tomato cod-salt-steam cod-sweet-vinegar cod-potato shrimp-egg
    tofu-steak tofu-mapo tofu-vegetable tofu-burger soybeans-tomato tofu-egg egg-tomato chicken-rice-bowl
    beef-rice-bowl pork-rice-bowl egg-fried-rice salmon-fried-rice tomato-chicken-curry minced-dry-curry
    tofu-rice-bowl tofu-natto-rice pasta-meat pasta-shrimp pasta-mushroom pasta-milk-salmon udon-pork udon-egg
    soba-chicken rice-egg-omelette rice-baked-cheese pork-cabbage-roll pork-chive-egg chicken-root-simmer
    tofu-dried-simmer okara-vegetable-patty soy-hijiki-patty cod-fishball mackerel-curry-roast cod-cheese-bake
    soy-taco-rice chicken-pilaf soy-milk-risotto pork-stuffed-pepper potato-pepper-strips kiriboshi-cucumber
    daikon-leaf-tofu chickpea-carrot-lemon carrot-pumpkin-mash side-002 side-005 side-007 side-010 side-014
    side-019 side-020 side-021 side-024 side-025 side-026 side-035 side-036 side-042 side-043 side-045 side-047
    side-048 side-050 soup-007 soup-011 soup-012 soup-014 soup-015 soup-016 soup-017 soup-018 soup-020 soup-021
    soup-022 soup-023 soup-025 soup-026 soup-028 soup-029 side-051 side-052 side-053 side-056 side-057 side-058
    side-059 side-060 soup-031 soup-032 soup-033 soup-034 soup-035 soup-036 soup-037 soup-038 soup-039
    staple-potato staple-plain-udon staple-chilled-udon staple-olive-pasta staple-tomato-pasta staple-sesame-soba
    staple-somen staple-warm-soba snack-sesame-potato breakfast-tofu-scramble breakfast-lentil-potato
    breakfast-chicken-cabbage breakfast-sardine-tomato breakfast-pork-pumpkin breakfast-tofu-broccoli
    breakfast-shrimp-pea calendar-side-cucumber-chickpea calendar-side-aubergine-sesame
    calendar-side-lotus-edamame calendar-side-tomato-bean calendar-side-pumpkin-almond
    calendar-side-mushroom-beans calendar-soup-tomato-barley calendar-soup-daikon-lentil
    calendar-soup-lettuce-tofu calendar-soup-tomato-egg calendar-soup-carrot-chickpea daily-udon-plain
    daily-udon-kitsune daily-udon-tanuki daily-udon-wakame daily-udon-meat daily-udon-tempura daily-udon-curry
    daily-soba-plain daily-soba-kitsune daily-soba-tanuki daily-soba-wakame daily-soba-meat daily-soba-tempura
    daily-soba-curry daily-yakisoba-sauce daily-yakisoba-salt daily-yakisoba-seafood daily-pasta-peperoncino
    daily-pasta-carbonara daily-pasta-genovese daily-pasta-bolognese daily-pasta-arrabbiata daily-pasta-pescatore
    daily-pasta-napolitan daily-pasta-japanese-mushroom daily-pasta-tuna-tomato daily-pasta-vongole
    daily-curry-chicken daily-curry-pork daily-curry-beef daily-curry-vegetable daily-curry-keema
    daily-pizza-margherita daily-pizza-mixed daily-pizza-teriyaki daily-pizza-seafood daily-fried-rice-egg
    daily-fried-rice-gomoku daily-fried-rice-kimchi daily-fried-rice-shrimp daily-ramen-soy daily-ramen-salt
    daily-ramen-miso daily-ramen-tanmen daily-donburi-oyako daily-donburi-pork daily-donburi-mapo
    daily-donburi-chinese daily-donburi-teriyaki daily-miso-tonjiru classic-omelette-rice-cheese
    classic-omelette-rice-mushroom classic-omelette-rice-tomato classic-sushi-assorted classic-sushi-tuna
    classic-sushi-salmon classic-sushi-shrimp classic-sushi-squid classic-sushi-roll classic-sushi-inari
    classic-sushi-chirashi classic-hamburg classic-chicken-nanban classic-meatballs-teriyaki
    classic-pork-mushroom-steam classic-beef-tofu-sukini classic-pork-potato-curry
    classic-chicken-lotus-sweet-sour classic-pork-cabbage-millefeuille classic-koya-egg-simmer
    classic-salmon-potato-miso-butter classic-cod-komatsuna-ginger classic-mackerel-daikon-vinegar
    classic-squid-cabbage-ginger classic-pork-vermicelli classic-beef-pepper-tomato classic-chicken-pumpkin-sesame
    classic-side-macaroni-salad classic-side-vermicelli-salad classic-side-potato-soboro
    classic-side-pumpkin-soboro classic-side-asparagus-enoki classic-side-lotus-soy-curry
    classic-side-paprika-bean-marinade classic-side-carrot-cumin-yogurt classic-side-zucchini-chickpea
    classic-side-komatsuna-peanut-egg classic-side-cabbage-lentil classic-side-daikon-tuna prepared-cup-ramen-soy
    prepared-cup-ramen-salt prepared-cup-ramen-miso prepared-cup-ramen-tonkotsu prepared-cup-ramen-seafood
    prepared-cup-ramen-nonfried-soy prepared-cup-ramen-nonfried-salt prepared-cup-udon-kitsune
    prepared-cup-udon-tempura prepared-cup-soba-tempura prepared-cup-yakisoba-sauce prepared-cup-yakisoba-salt
    prepared-bag-ramen-soy prepared-bag-ramen-miso prepared-bag-ramen-salt prepared-bag-ramen-nonfried
    prepared-retort-beef-curry prepared-retort-pork-curry prepared-retort-chicken-curry
    prepared-retort-vegetable-curry prepared-retort-keema-curry prepared-retort-gyudon prepared-retort-oyakodon
    prepared-retort-chukadon prepared-retort-mapodon prepared-burger-plain prepared-burger-cheese
    prepared-burger-teriyaki prepared-burger-chicken prepared-burger-fish prepared-burger-double
    familiar-salmon-meuniere familiar-cod-meuniere familiar-aji-meuniere familiar-flounder-simmer
    familiar-hamburg-oroshi familiar-hamburg-stew familiar-hamburg-cheese familiar-beef-stew
    familiar-chicken-cream-stew familiar-pork-cream-stew familiar-cabbage-roll familiar-pork-saute
    familiar-happosai familiar-sweet-sour-pork familiar-meat-vegetable-stir-fry familiar-sundubu familiar-katsudon
    familiar-sauce-katsudon familiar-chicken-katsudon familiar-tendon familiar-kakiage-don familiar-tenshinhan
    familiar-kaisen-don familiar-tekka-don familiar-salmon-don familiar-loco-moco familiar-chicken-macaroni-gratin
    familiar-side-caesar familiar-side-chicken-sesame-salad familiar-side-roast-vegetables
    familiar-side-vegetable-stir-fry familiar-side-green-pea-egg familiar-side-pot-au-feu familiar-side-minestrone
    familiar-side-onion-gratin-soup sushi-hosomaki-kappa sushi-hosomaki-tekka sushi-hosomaki-natto
    sushi-hosomaki-ume-shiso sushi-hosomaki-tuna-mayo sushi-futomaki-egg-vegetable sushi-futomaki-seafood
    sushi-futomaki-salad sushi-gunkan-ikura sushi-gunkan-negitoro sushi-gunkan-tuna-mayo sushi-gunkan-corn-mayo
    sushi-gunkan-natto sushi-gunkan-crab sushi-gunkan-shirasu takeaway-harusame-wonton takeaway-harusame-egg
    takeaway-harusame-tantan takeaway-harusame-wakame-vegetable takeaway-harusame-wakame-gomtang takeaway-unaju
    varied-green-curry-rice varied-butter-chicken-rice varied-gapao-rice varied-coconut-chicken
    varied-chickpea-spice varied-yakitori-don varied-yakiniku-don varied-bibimbap varied-unadon
    varied-chinese-corn-soup varied-chicken-ball-vermicelli-soup varied-yukgaejang-soup varied-wakame-clear-soup
    comfort-sobameshi acmp-tuna-water palette-nigiri-chutoro palette-nigiri-seabream palette-nigiri-yellowtail
    palette-nigiri-scallop palette-nigiri-octopus palette-nigiri-egg palette-nigiri-anago mapo-tofu-chen-style
    world-tomyum-kung world-massaman-chicken world-mutton-curry world-saag-chicken world-saag-paneer
    world-crab-cream-croquette world-naan-plain world-naan-garlic world-naan-butter world-naan-cheese
    world-naan-sesame world-naan-wholewheat noodle-ramen-niboshi noodle-ramen-miso-butter-corn
    noodle-ramen-tonkotsu noodle-ramen-iekei noodle-ramen-jiro noodle-ramen-seabura noodle-ramen-tantan
    noodle-aburasoba noodle-hiyashi-chuka noodle-soupless-tantan canteen-chicken-vegetable-black-vinegar
    canteen-pork-aubergine-spicy-miso canteen-chicken-katsu-mizore canteen-pork-katsu-toji canteen-miso-katsu-ni
    canteen-millefeuille-pork-katsu canteen-vegetable-black-vinegar bistro-cheese-in-hamburg
    bistro-chicken-mushroom-cream bistro-pumpkin-meat-gratin soup311-arajiru-salmon soup311-arajiru-buri
    soup311-clam-chowder-tomato soup311-wonton-pork
  `],
  [['朝食', '昼食', '夕食'], `
    omelette-vegetable egg-potato chicken-sandwich egg-tofu-porridge side-001 side-003 side-008 side-023 side-028
    side-029 side-030 side-033 side-034 side-044 side-049 soup-001 soup-002 soup-003 soup-004 soup-005 soup-006
    soup-008 soup-009 soup-010 soup-013 soup-019 soup-024 soup-027 soup-030 soup-040 plain-rice staple-brown-rice
    staple-mixed-rice staple-barley-rice staple-plain-bread staple-wholegrain-bread staple-sesame-toast
    staple-wakame-rice staple-corn-rice staple-mushroom-rice staple-turmeric-rice staple-rice-porridge
    staple-sweet-potato-porridge breakfast-tomato-scramble breakfast-spinach-omelette
    breakfast-cheese-mushroom-egg breakfast-salmon-spinach calendar-side-carrot-raisin calendar-side-broccoli-corn
    calendar-side-komatsuna-walnut calendar-side-cabbage-apple calendar-side-okra-corn calendar-side-turnip-leaf
    calendar-soup-oat-mushroom calendar-soup-sweet-potato-milk calendar-soup-edamame-corn
    calendar-soup-cabbage-egg calendar-soup-cauliflower-potato daily-rice-gomoku daily-rice-chicken-burdock
    daily-rice-green-peas daily-rice-hijiki daily-miso-onion daily-miso-clam daily-miso-potato
    daily-miso-aburaage-daikon classic-omelette-plain classic-omelette-cheese classic-omelette-spinach
    classic-omelette-bacon classic-fried-egg classic-scrambled-egg classic-natto-plain classic-natto-grated-daikon
    classic-side-egg-salad classic-side-gomoku-beans classic-side-komatsuna-ohitashi classic-side-spinach-ohitashi
    classic-side-carrot-shirishiri classic-side-koya-tofu classic-side-spinach-egg familiar-hayashi-rice
    familiar-seafood-doria familiar-side-raw-vegetable familiar-side-green-vinaigrette
    familiar-side-broccoli-egg-salad familiar-side-corn-coleslaw familiar-side-warm-vegetables
    familiar-side-corn-potage familiar-side-clam-chowder familiar-side-wakame-egg-soup takeaway-knorr-corn
    takeaway-knorr-potage takeaway-knorr-mushroom takeaway-knorr-spinach takeaway-knorr-pumpkin
    takeaway-knorr-tomato varied-khao-man-gai acmp-egg-raw acmp-seasoned-nori acmp-salmon-flakes palette-ham
    soup311-osuimono-tofu-wakame soup311-osuimono-asari soup311-pumpkin-milk-potage soup311-consomme-plain
    soup311-consomme-vegetable bread-hot-sandwich-tuna-melt bread-hot-sandwich-chicken-cabbage
    bread-hot-sandwich-bacon-egg bread-hot-sandwich-sausage-cheese bread-hot-sandwich-pizza breakfast-ham-egg
    breakfast-bacon-egg
  `],
  [['夕食', '晩酌'], `
    chicken-tofu-pot familiar-yose-nabe familiar-kimchi-nabe familiar-mizutaki familiar-sukiyaki
    familiar-pork-shabu familiar-sesame-soy-nabe familiar-chanko-nabe simmered-pork-millefeuille-nabe
    simmered-pork-mizore-nabe simmered-chicken-yuzu-kosho-nabe simmered-chicken-salt-lemon-nabe
    simmered-ishikari-nabe simmered-beef-motsu-nabe simmered-oyster-miso-nabe simmered-duck-negi-nabe
    simmered-pork-spinach-joya-nabe evening-main-tuna-negi-nabe
  `],
  [['朝食', '昼食', '間食'], `
    savoury-french-toast staple-butter-toast staple-cheese-toast staple-avocado-toast breakfast-banana-pancake
    daily-snack-pork-bun daily-snack-hash-brown palette-bagel palette-english-muffin bread-toast-jam-butter
    bread-toast-marmalade-butter bread-toast-honey-butter bread-toast-peanut-butter
  `],
  [['昼食', '夕食', '間食'], `
    sweet-potato-apple staple-sweet-potato
  `],
  [['朝食', '昼食', '夕食', '晩酌'], `
    side-004 side-006 side-015 side-017 side-046 snack-cheese-tomato breakfast-natto-okra daily-snack-plain-cheese
    daily-snack-mozzarella classic-grilled-salmon classic-grilled-mackerel classic-grilled-aji
    classic-grilled-shishamo classic-tamagoyaki classic-dashimaki classic-side-hiyayakko classic-side-shirasu-tofu
    classic-side-okra-tofu classic-side-ume-tofu classic-side-mekabu classic-side-cabbage-pickle
    classic-side-hakusai-pickle classic-side-cucumber-pickle classic-side-chilled-tomato
    classic-side-broccoli-bonito classic-side-nameko-oroshi familiar-side-corn-butter familiar-side-spinach-bacon
    familiar-side-yam-tanzaku familiar-side-miso-cucumber familiar-side-ume-cucumber familiar-side-seasoned-egg
    acmp-onsen-egg acmp-tarako acmp-mentaiko palette-bacon palette-takuan breakfast-chashu-egg
  `],
  [['朝食', '昼食', '夕食', '間食'], `
    side-009 staple-salt-onigiri staple-grilled-onigiri drink-water drink-green-tea drink-roasted-tea
    drink-barley-tea drink-oolong-tea drink-black-tea drink-coffee drink-milk drink-soy-milk drink-tomato-juice
    drink-lemon-water snack-pumpkin daily-onigiri-salt daily-onigiri-salmon daily-onigiri-plum
    daily-onigiri-tuna-mayo daily-onigiri-kombu daily-onigiri-okaka daily-onigiri-sesame daily-onigiri-grilled
    daily-drink-sparkling-water daily-drink-lemon-sparkling
  `],
  [['朝食', '昼食'], `
    staple-oatmeal-water staple-oatmeal-milk staple-oatmeal-soy breakfast-chickpea-toast breakfast-egg-sandwich
    breakfast-oat-egg prepared-sandwich-egg prepared-sandwich-ham prepared-sandwich-tuna
    prepared-sandwich-vegetable palette-sandwich bread-english-muffin-ham-cheese bread-english-muffin-egg-cheese
    bread-english-muffin-sausage-egg-cheese bread-english-muffin-bacon-egg-cheese bread-english-muffin-tuna-cheese
    bread-sandwich-egg-mayo bread-sandwich-tuna-cucumber bread-sandwich-ham-cheese bread-sandwich-vegetable
    bread-sandwich-chicken bread-sandwich-custom bread-hot-sandwich-ham-cheese bread-hot-sandwich-egg-cheese
    bread-hot-sandwich-corn-cheese bread-hot-sandwich-mushroom-cheese bread-hot-sandwich-avocado-ham
    bread-hot-sandwich-custom bread-toast-avocado bread-toast-pizza bread-toast-custom breakfast-bagel-plain
    breakfast-bagel-egg-cheese breakfast-bagel-ham-cheese breakfast-english-muffin-egg
    breakfast-english-muffin-ham-cheese
  `],
  [['朝食', '間食'], `
    drink-cafe-au-lait drink-milk-tea drink-soy-latte drink-milk-cocoa drink-soy-cocoa drink-orange-juice
    drink-apple-juice drink-yogurt drink-ginger-tea drink-banana-soy drink-strawberry-milk snack-apple
    snack-orange snack-kiwi snack-banana snack-peach snack-grape snack-strawberry snack-blueberry
    snack-plain-yogurt snack-banana-yogurt snack-kiwi-yogurt snack-berry-yogurt snack-apple-raisin-yogurt
    snack-sweet-potato-yogurt snack-baked-banana snack-stewed-apple snack-fruit-plate daily-snack-plain-pancake
    daily-snack-sweet-french-toast performance-soy_powder-water performance-soy_powder-milk
    performance-whey_powder-water performance-whey_powder-milk performance-milk_protein
    performance-calorie_block_choco performance-calorie_block_cheese performance-calorie_jelly_apple
    takeaway-tomato-unsalted takeaway-tomato-low-salt palette-waffle palette-muffin
  `],
  [['朝食', '間食', '晩酌'], `
    snack-almond snack-walnut snack-cashew
  `],
  [['間食', '晩酌'], `
    snack-peanut snack-nuts-raisin daily-snack-potato-chips daily-snack-cheese-crisp confectionery-jagarico
    confectionery-kappa-ebisen confectionery-sayaendo confectionery-miino confectionery-cheeza
    confectionery-karamucho confectionery-sucorn confectionery-popcorn confectionery-kakinotane
    palette-cheese-camembert palette-cheese-cheddar palette-cheese-blue palette-cheese-parmesan
    palette-nuts-pistachio palette-nuts-macadamia palette-nuts-pine
  `],
  [['昼食', '夕食', '間食', '晩酌'], `
    snack-edamame daily-snack-oven-chicken daily-snack-oven-fries daily-snack-takoyaki performance-chicken_plain
    performance-chicken_herb performance-chicken_smoke palette-chicken-nugget
  `],
  [['間食'], `
    snack-rice-milk snack-soy-cocoa-pudding snack-cocoa-oat-balls daily-drink-cola daily-drink-sports
    daily-drink-lemonade daily-snack-rice-cracker daily-snack-butter-cookie daily-snack-chocolate
    daily-snack-chocolate-cookie daily-snack-vanilla-ice daily-snack-cocoa-ice daily-snack-custard-pudding
    daily-snack-yoghurt-parfait daily-snack-strawberry-crepe daily-snack-banana-cake daily-snack-chocolate-cake
    daily-snack-apple-cookie-bowl performance-ion_water performance-energy performance-energy_zero
    performance-bar_baked_choco performance-bar_baked_bitter performance-bar_manzoku confectionery-pocky
    confectionery-pretz confectionery-bisco confectionery-marie confectionery-moonlight confectionery-choice
    confectionery-alfort confectionery-lumonde confectionery-milk-chocolate confectionery-black-chocolate
    confectionery-cacao72 confectionery-almond-chocolate confectionery-kinoko confectionery-dars
    confectionery-chocoball confectionery-milk-caramel confectionery-hi-chew confectionery-ramune
    confectionery-golden-milk-candy confectionery-kaju-gummy confectionery-pure-gummy confectionery-cororo
    confectionery-tough-gummy confectionery-happy-turn confectionery-soft-salad dessert-old-fashioned
    dessert-french-cruller dessert-cream-doughnut dessert-honey-glazed dessert-chewy-ring dessert-honey-churro
    dessert-strawberry-shortcake dessert-souffle-cheesecake dessert-mont-blanc dessert-rare-cheesecake
    dessert-chocolate-mousse-cake dessert-chocolate-shortcake dessert-apple-pie dessert-chocolate-mille-crepe
    dessert-custard-cream-puff dessert-custard-eclair dessert-dorayaki dessert-salt-bean-daifuku
    dessert-ogura-yokan dessert-chocolate-monaka dessert-soda-ice-lolly dessert-grape-ice-bites
    dessert-baked-pudding dessert-mandarin-jelly
  `],
  [['朝食', '昼食', '夕食', '間食', '晩酌'], `
    classic-boiled-egg palette-wiener
  `],
  [['晩酌'], `
    performance-beer performance-black_beer performance-sake performance-wine_red performance-wine_white
    performance-shochu performance-whisky performance-umeshu performance-chuhai performance-highball
    evening-main-pork-onion-kushikatsu evening-side-octopus-kimchi evening-side-okaka-cream-cheese
    evening-side-garlic-edamame
  `],
  [['昼食', '間食'], `
    performance-cola_zero performance-ginger_ale
  `],
  [['朝食', '昼食', '間食', '晩酌'], `
    palette-cheese-cream palette-cheese-processed
  `],
  [['夕食'], `
    simmered-chicken-tomato-cheese-nabe simmered-chicken-curry-nabe simmered-soy-milk-tantan-nabe
  `],
];

const reviewed = new Map();
for (const [occasions, ids] of reviewedGroups) {
  Object.freeze(occasions);
  for (const id of ids.trim().split(/\s+/)) {
    if (reviewed.has(id)) throw Error(`食事区分が重複しています：${id}`);
    reviewed.set(id, occasions);
  }
}

const LABELS = {breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食'};
const alcoholOccasions = Object.freeze(['晩酌']);

// 個人レシピや授業で差し替えた小規模データには、登録時の区分と料理の役割を使います。
function fallbackOccasions(recipe, family) {
  const evening = recipe.tags?.includes('晩酌') || (family === 'sashimi' && !recipe.staple);
  const result = new Set();
  if (Array.isArray(recipe.mealSuitability)) {
    for (const meal of recipe.mealSuitability) if (LABELS[meal]) result.add(LABELS[meal]);
  } else if (recipe.role === 'snack') {
    result.add('間食');
    if (['fruit', 'yoghurt'].includes(family)) result.add('朝食');
  } else {
    result.add('昼食'); result.add('夕食');
    const method = recipe.custom !== true ? dishClassification(recipe).method : null;
    if (recipe.role === 'staple' && ['rice', 'onigiri', 'bread', 'oatmeal'].includes(family)
        || recipe.role === 'drink' && ['water', 'tea', 'coffee', 'milk', 'juice'].includes(family)
        || recipe.role === 'main' && ['egg-main', 'grilled-fish'].includes(family) && ['grill', 'other'].includes(method)
        || recipe.role === 'side' && recipe.ingredients?.every(part => !(part.proteinSources ?? []).length) && ['cold', 'steam', 'other'].includes(method)
        || recipe.role === 'soup' && ['miso-soup', 'clear-soup', 'vegetable-soup', 'soup'].includes(family) && method) result.add('朝食');
  }
  if (recipe.role === 'snack') result.add('間食');
  if (evening) result.add('晩酌');
  return MEAL_OCCASIONS.filter(label => result.has(label));
}

export function hasReviewedMealOccasions(recipe) {
  if (recipe.mealOccasions === undefined) return reviewed.has(recipe.id);
  const labels = recipe.mealOccasions;
  return Array.isArray(labels) && labels.length > 0 && new Set(labels).size === labels.length
    && labels.every(label => MEAL_OCCASIONS.includes(label))
    && (recipeFamily(recipe) !== 'alcohol' || labels.length === 1 && labels[0] === '晩酌');
}

export function mealOccasionsFor(recipe) {
  // 酒類を記録用に検索できるのは晩酌だけです。
  if (recipeFamily(recipe) === 'alcohol') return alcoholOccasions;
  if (Array.isArray(recipe.mealOccasions)) return MEAL_OCCASIONS.filter(label => recipe.mealOccasions.includes(label));
  return reviewed.get(recipe.id) ?? fallbackOccasions(recipe, recipeFamily(recipe));
}
