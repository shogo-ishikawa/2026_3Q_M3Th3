/** ジャンル → 食材の種類 → 具体的な食材。栄養やアレルギーの分類とは分けます。 */
import {INGREDIENT_GROUPS, ingredientGroup} from './shopping-categories.js';
import {FRUIT_INGREDIENTS} from './fruit-varieties.js';
import {matchesJapaneseQuery} from './japanese-search.js';

// 各種類の順序と、その中の食材IDの並びをそのまま選択欄に使います。
// 一般的な部位を先に置き、内臓・特殊部位・調理済みの加工品とは区別します。
const TABLE = {
  "meat": [
    ["beef", "牛肉", "beef beef_stew_cut beef_round_raw beef_short_rib beef_minced beef_tendon_boiled beef_tongue meat_beef_small_intestine_raw meat_beef_rumen_boiled"],
    ["pork", "豚肉", "pork pork_loin dish_pork_belly_sliced pork_belly pork_minced pork_small_intestine_boiled tavern_pork_liver"],
    ["chicken", "鶏肉", "chicken chicken_breast chicken_minced chicken_skin tavern_chicken_gizzard tavern_chicken_heart"],
    ["processed", "ハム・ソーセージ・加工肉", "bacon ready_sliced_ham breakfast_ham breakfast_bacon breakfast_chashu palette_wiener palette_prosciutto noodle_chashu palette_chicken_nugget burger_chicken_patty"],
    ["mixed", "合い挽き・混合", "beef_pork_mince_raw burger_meat_patty"],
    ["other", "羊・鴨・その他の肉", "world_mutton bistro_lamb_loin simmered_duck"],
  ],
  "vegetable": [
    ["leaf", "葉物野菜", "cabbage chinese_cabbage lettuce spinach komatsuna red_cabbage simmered_mizuna daikon_leaf"],
    ["fruiting", "実・茎の野菜", "cucumber tomato canned_tomato aubergine pepper paprika zucchini broccoli salad_broccoli_boiled cauliflower asparagus celery negi bean_sprout chive winter_melon bitter_melon"],
    ["root", "根菜・いも", "onion carrot daikon potato sweet_potato pumpkin burdock lotus_root turnip yam taro beet bamboo_shoot_cooked kiriboshi_daikon"],
    ["mushroom", "きのこ", "shimeji enoki shiitake mushroom nameko simmered_maitake dried_shiitake tavern_wood_ear_dried"],
    ["beans", "豆・とうもろこし", "green_beans okra corn green_pea"],
    ["aromatics", "薬味・ハーブ", "ginger garlic scallion_garnish shiso parsley fresh_basil green_chilli mapo_garlic_shoots"],
    ["prepared", "漬物・こんにゃくなど", "konjac shirataki kimchi palette_takuan noodle_menma_water"],
  ],
  "fish": [
    ["fish", "加熱用の魚", "salmon mackerel cod horse_mackerel sardine tuna yellowtail flounder saury"],
    ["sashimi", "刺身", "tuna_lean_sashimi tuna_mediumfat_sashimi salmon_sashimi yellowtail_sashimi seabream_sashimi bonito_sashimi horse_mackerel_sashimi seafood_inada seafood_hirame seafood_shimesaba seafood_iwashi seafood_sanma seafood_hiramasa kyoto_kanpachi kyoto_suzuki"],
    ["shrimp", "えび・かに", "shrimp crab seafood_amaebi seafood_akaebi"],
    ["squid", "いか・たこ", "squid octopus squid_sashimi seafood_mizudako"],
    ["shellfish", "貝", "scallop clam scallop_sashimi seafood_tsubu simmered_oyster bistro_mussel_raw bistro_escargot_canned"],
    ["dried", "干物・魚卵", "atka_mackerel_dried shishamo shirasu_dried ikura_salted acmp_tarako acmp_mentaiko"],
    ["processed", "缶詰・練り物・調理済み", "tuna_canned acmp_tuna_oil acmp_salmon_flakes palette_chikuwa palette_hanpen simmered_satsumaage simmered_tsumire simmered_gobomaki shrimp_tempura ready_breaded_fish palette_oyster_fry eel_shirayaki palette_anago_steamed"],
  ],
  "eggsoy": [
    ["egg", "卵", "egg acmp_onsen_egg tavern_onsen_egg simmered_quail_egg_boiled"],
    ["tofu", "豆腐・大豆加工品", "tofu silken_tofu palette_atsuage aburaage tofu_dried palette_ganmodoki okara natto soy_milk"],
    ["beans", "豆類", "soybeans edamame chickpea_cooked lentil_cooked white_bean_cooked kidney_bean_cooked"],
  ],
  "dairy": [
    ["milk", "牛乳・ヨーグルト", "milk yogurt"],
    ["cheese", "チーズ", "cheese mozzarella palette_processed_cheese palette_cheddar palette_camembert palette_cream_cheese parmesan_cheese palette_blue_cheese world_paneer"],
    ["cream", "バター・クリーム", "butter palette_whipped_cream"],
  ],
  "grain": [
    ["rice", "米・ご飯・もち", "uncooked_rice rice brown_rice barley cooked_barley dish_mochi"],
    ["bread", "パン", "bread wholegrain_bread hamburger_bun palette_bagel breakfast_bagel palette_english_muffin breakfast_english_muffin pizza_base"],
    ["noodles", "麺・春雨", "udon soba pasta somen ramen_noodles yakisoba_noodles macaroni mung_vermicelli"],
    ["flour", "粉・パン粉・皮", "flour world_bread_flour world_wholemeal_flour rice_flour starch cornstarch breadcrumbs dumpling_wrappers spring_roll_wrappers soup311_wonton_wrappers simmered_chikuwabu kyoto_namafu"],
    ["cereal", "オートミール・焼き菓子生地", "oatmeal palette_waffle palette_muffin_base"],
  ],
  "fruit": [
    ["fresh", "生の果物", `apple banana orange kiwi strawberry grape peach blueberry avocado lemon_slice ${Object.keys(FRUIT_INGREDIENTS).join(' ')}`],
    ["dried", "ドライフルーツ", "raisin"],
  ],
  "seasoning": [
    ["basic", "基本調味料", "salt sugar soy_sauce kyoto_usukuchi miso vinegar mirin sake black_pepper"],
    ["stock", "だし・スープの素", "kombu bonito dried_sardine soup311_awase_dashi kyoto_kombu_dashi stock_kombu_strained stock_bonito_strained soup311_consomme noodle_chinese_stock noodle_niboshi_stock noodle_tonkotsu_concentrate"],
    ["sauce", "ソース・たれ・ペースト", "mayonnaise bread_ketchup worcestershire_sauce oyster_sauce fish_sauce tomato_paste mapo_doubanjiang mapo_tianmianjiang mapo_douchi world_tomyum_paste simmered_yuzu_kosho"],
    ["spice", "香辛料・乾燥ハーブ", "curry_powder paprika_powder chilli dried_basil turmeric cumin mapo_huajiao world_garam_masala"],
    ["sweet", "ジャム・甘味料・製菓", "palette_honey palette_maple_syrup bread_strawberry_jam bread_marmalade bread_peanut_butter palette_baking_powder"],
    ["other", "酢・果汁・その他", "lemon world_lime_juice canteen_black_vinegar coconut_milk ume"],
  ],
  "drink": [
    ["tea", "お茶・コーヒー", "green_tea roasted_tea barley_tea oolong_tea black_tea coffee cocoa_powder"],
    ["juice", "果汁・野菜ジュース", "orange_juice apple_juice tomato_juice takeaway_tomato_unsalted takeaway_tomato_low_salt"],
    ["soft", "炭酸・スポーツ飲料など", "carbonated_water cola perf_cola_zero sports_drink perf_ion_water perf_energy perf_energy_zero perf_ginger_ale"],
    ["protein", "プロテイン飲料", "perf_milk_protein"],
    ["alcohol", "お酒", "perf_beer perf_black_beer perf_sake perf_wine_red perf_wine_white perf_shochu perf_whisky perf_umeshu perf_chuhai"],
  ],
  "seaweed": [
    ["seaweed", "海藻", "nori acmp_seasoned_nori wakame hijiki mozuku mekabu canteen_aonori"],
  ],
  "nuts": [
    ["nuts", "ナッツ・種子", "almond walnut peanut cashew palette_pistachio palette_macadamia pine_nuts sesame ground_sesame"],
  ],
  "oil": [
    ["oil", "油・調理用の脂", "oil olive_oil sesame_oil mapo_chilli_oil noodle_chicken_oil noodle_pork_fat"],
  ],
  "water": [
    ["water", "水", "water"],
  ],
  "prepared": [
    ["sweet-bread", "菓子パン", "convenience_anpan convenience_cream_pan convenience_melon_pan convenience_strawberry_coppe convenience_milk_france convenience_apple_danish convenience_chocolate_croissant convenience_chocolate_chip_bread"],
    ["convenience-meal", "コンビニのおにぎり・弁当・麺", "convenience_salmon_onigiri convenience_tuna_mayo_onigiri convenience_nori_bento convenience_napolitan convenience_zaru_soba"],
    ["counter-food", "ホットスナック・中華まん", "convenience_famichiki convenience_karaage_kun convenience_l_chiki convenience_pork_bun convenience_pizza_bun convenience_corn_dog"],
    ["noodles", "即席麺", "cup_ramen_soy_dry cup_ramen_salt_dry cup_ramen_nonfried_dry cup_udon_dry cup_soba_dry cup_yakisoba_dry bag_fried_noodles_dry bag_nonfried_noodles_dry"],
    ["rice", "レトルトの具", "retort_beef_curry retort_pork_curry retort_chicken_curry retort_oyakodon_topping retort_mapo_topping retort_vegetable_curry_model retort_keema_curry_model retort_gyudon_model retort_chukadon_model"],
    ["bread", "バーガー・サンドイッチ", "prepared_item_burger_plain prepared_item_burger_cheese prepared_item_burger_teriyaki prepared_item_burger_chicken prepared_item_burger_fish prepared_item_burger_double prepared_item_sandwich_egg prepared_item_sandwich_ham prepared_item_sandwich_tuna prepared_item_sandwich_vegetable convenience_egg_sandwich"],
    ["soup", "即席スープ", "takeaway_harusame_wonton takeaway_harusame_egg takeaway_harusame_tantan takeaway_harusame_wakame_vegetable takeaway_harusame_wakame_gomtang takeaway_knorr_corn takeaway_knorr_potage takeaway_knorr_mushroom takeaway_knorr_spinach takeaway_knorr_pumpkin takeaway_knorr_tomato"],
    ["protein", "サラダチキン・プロテイン粉", "perf_chicken_plain perf_chicken_herb perf_chicken_smoke perf_soy_powder perf_whey_powder"],
    ["deli", "惣菜・持ち帰り料理", "steamed_pork_bun takeaway_yakitori_momo_tare takeaway_yakitori_momo_salt takeaway_yakitori_negima_tare takeaway_yakitori_tsukune_tare takeaway_yakitori_kawa_tare takeaway_yakitori_sunagimo_salt takeaway_eel_kabayaki takeaway_unaju takeaway_shumai takeaway_frozen_suigyoza takeaway_spring_roll takeaway_tempura_shrimp takeaway_tempura_squid takeaway_tempura_maitake takeaway_beef_karubi convenience_vegetable_salad convenience_salted_egg convenience_salad_chicken_bar"],
  ],
  "snack": [
    ["chocolate", "チョコレート", "chocolate confectionery_pocky confectionery_milk_chocolate confectionery_black_chocolate confectionery_cacao72 confectionery_almond_chocolate confectionery_kinoko confectionery_dars confectionery_chocoball"],
    ["biscuit", "クッキー・ビスケット", "biscuit confectionery_bisco confectionery_marie confectionery_moonlight confectionery_choice confectionery_alfort confectionery_lumonde"],
    ["candy", "飴・キャラメル・グミ", "confectionery_milk_caramel confectionery_hi_chew confectionery_ramune confectionery_golden_milk_candy confectionery_kaju_gummy confectionery_pure_gummy confectionery_cororo confectionery_tough_gummy"],
    ["snack", "スナック・せんべい", "potato_chips rice_cracker confectionery_pretz confectionery_jagarico confectionery_kappa_ebisen confectionery_sayaendo confectionery_miino confectionery_cheeza confectionery_karamucho confectionery_sucorn confectionery_popcorn confectionery_kakinotane confectionery_happy_turn confectionery_soft_salad"],
    ["dessert", "ケーキ・和菓子・デザート", "dessert_old_fashioned dessert_french_cruller dessert_cream_doughnut dessert_honey_glazed dessert_chewy_ring dessert_honey_churro dessert_strawberry_shortcake dessert_souffle_cheesecake dessert_mont_blanc dessert_rare_cheesecake dessert_chocolate_mousse_cake dessert_chocolate_shortcake dessert_apple_pie dessert_chocolate_mille_crepe dessert_custard_cream_puff dessert_custard_eclair dessert_dorayaki dessert_salt_bean_daifuku dessert_ogura_yokan dessert_baked_pudding dessert_mandarin_jelly"],
    ["ice", "アイス・氷菓", "vanilla_ice_cream dessert_chocolate_monaka dessert_soda_ice_lolly dessert_grape_ice_bites"],
    ["supplement", "栄養補助食品", "perf_bar_baked_choco perf_bar_baked_bitter perf_bar_manzoku perf_calorie_block_choco perf_calorie_block_cheese perf_calorie_jelly_apple"],
  ],
  "other": [
    ["other", "その他", ""],
  ],
};
export const PANTRY_SUBGROUPS = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([group, rows]) =>
  [group, Object.freeze(rows.map(([id, label, ingredients]) => Object.freeze({id, label, ingredientIds: Object.freeze(ingredients.split(' ').filter(Boolean))}))) ])));
const GROUP_RANK = new Map(INGREDIENT_GROUPS.map((group, index) => [group.id, index]));
const KNOWN = new Map();
for (const [group, rows] of Object.entries(PANTRY_SUBGROUPS)) for (const [subgroupRank, subgroup] of rows.entries()) {
  for (const [rank, id] of subgroup.ingredientIds.entries()) {
    if (KNOWN.has(id)) throw Error(`手持ち食材の分類が重複しています：${id}`);
    KNOWN.set(id, {group, subgroup: subgroup.id, subgroupLabel: subgroup.label, subgroupRank, rank});
  }
}

export function pantryClassification(id, data) {
  if (!Object.hasOwn(data?.ingredients ?? {}, id)) return null;
  const known = KNOWN.get(id), group = known?.group ?? ingredientGroup(id, data);
  return {group, groupLabel: INGREDIENT_GROUPS.find(item => item.id === group)?.label ?? 'その他',
    subgroup: known?.subgroup ?? 'other', subgroupLabel: known?.subgroupLabel ?? 'その他',
    subgroupRank: known?.subgroupRank ?? Number.MAX_SAFE_INTEGER, rank: known?.rank ?? Number.MAX_SAFE_INTEGER};
}

export function comparePantryIngredients(a, b, data) {
  const leftId = typeof a === 'string' ? a : a.id, rightId = typeof b === 'string' ? b : b.id;
  const left = pantryClassification(leftId, data), right = pantryClassification(rightId, data);
  if (!left || !right) return left ? -1 : right ? 1 : String(leftId).localeCompare(String(rightId));
  return (GROUP_RANK.get(left.group) ?? 999) - (GROUP_RANK.get(right.group) ?? 999) ||
    left.subgroupRank - right.subgroupRank || left.rank - right.rank ||
    data.ingredients[leftId].name.localeCompare(data.ingredients[rightId].name, 'ja') || leftId.localeCompare(rightId);
}

/** 存在する食材だけを数えるので、追加食材をまだ持たない旧DBでも使えます。 */
export function pantrySubgroups(group, data) {
  if (!INGREDIENT_GROUPS.some(item => item.id === group)) return [];
  const counts = new Map();
  for (const id of Object.keys(data?.ingredients ?? {})) {
    const category = pantryClassification(id, data);
    if (category.group === group) counts.set(category.subgroup, (counts.get(category.subgroup) ?? 0) + 1);
  }
  const result = (PANTRY_SUBGROUPS[group] ?? []).filter(subgroup => counts.has(subgroup.id))
    .map(({id, label}) => ({id, label, count: counts.get(id)}));
  if (counts.has('other') && !result.some(item => item.id === 'other')) result.push({id:'other', label:'その他', count:counts.get('other')});
  return result;
}

/** 検索語はジャンル・種類のラベルにも照合。未分類の追加食材も必ず一覧へ残します。 */
export function pantryIngredients(group = 'all', subgroup = 'all', query = '', data) {
  return Object.entries(data?.ingredients ?? {}).filter(([id, ingredient]) => {
    const category = pantryClassification(id, data);
    return (!group || group === 'all' || category.group === group) &&
      (!subgroup || subgroup === 'all' || category.subgroup === subgroup) &&
      (!query || matchesJapaneseQuery([ingredient.name, id, category.groupLabel, category.subgroupLabel], query));
  }).map(([id, ingredient]) => ({...ingredient, id, groupId:pantryClassification(id,data).group, subgroupId:pantryClassification(id,data).subgroup}))
    .sort((a, b) => comparePantryIngredients(a, b, data));
}
