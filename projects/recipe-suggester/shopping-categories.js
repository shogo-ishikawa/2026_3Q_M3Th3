/** 買い物の売り場に近い区分です。栄養計算やアレルギー判定には使いません。 */
export const INGREDIENT_GROUPS = Object.freeze([
  ['vegetable', '野菜・いも・きのこ'], ['meat', '肉・ハム・ソーセージ'],
  ['fish', '魚介・練り物'], ['eggsoy', '卵・豆腐・豆類'],
  ['fruit', '果物'], ['dairy', '乳製品'], ['grain', '米・パン・麺・粉類'],
  ['seaweed', '海藻'], ['nuts', 'ナッツ・種子'], ['seasoning', '調味料・香辛料・だし'],
  ['oil', '油・調理用の脂'], ['water', '水'], ['drink', '飲み物'],
  ['prepared', '惣菜・即席食品・補助食品'], ['snack', 'お菓子・デザート'], ['other', 'その他'],
].map(([id, label]) => Object.freeze({id, label})));

// 「家にあることが多いもの」を一括選択する候補。実際の除外は利用者が選びます。
// 調味料に分類された材料をすべて自動で除外する機能ではありません。
export const COMMON_PANTRY_IDS = Object.freeze([
  'water', 'oil', 'olive_oil', 'sesame_oil', 'salt', 'sugar', 'soy_sauce',
  'miso', 'vinegar', 'mirin', 'sake', 'black_pepper', 'mayonnaise',
  'kyoto_usukuchi', 'bread_ketchup', 'worcestershire_sauce', 'soup311_consomme',
]);

const ids = value => new Set(value.split(' '));
const OILS = ids('oil olive_oil sesame_oil mapo_chilli_oil noodle_chicken_oil noodle_pork_fat');
const DRINKS = ids('carbonated_water green_tea roasted_tea barley_tea oolong_tea black_tea coffee cocoa_powder orange_juice apple_juice tomato_juice cola sports_drink perf_beer perf_black_beer perf_sake perf_wine_red perf_wine_white perf_shochu perf_whisky perf_umeshu perf_chuhai perf_cola_zero perf_ion_water perf_energy perf_energy_zero perf_ginger_ale perf_milk_protein takeaway_tomato_unsalted takeaway_tomato_low_salt');
const NUTS = ids('cashew peanut walnut almond pine_nuts palette_pistachio palette_macadamia sesame ground_sesame');
const SEAWEEDS = ids('nori acmp_seasoned_nori wakame hijiki mozuku mekabu canteen_aonori');
const VEGETABLES = ids('ginger garlic scallion_garnish shiso parsley green_chilli konjac shirataki');
const GRAINS = ids('flour rice_flour starch breadcrumbs cornstarch mung_vermicelli soup311_wonton_wrappers');
const FRUITS = ids('lemon_slice');
const DAIRY = ids('butter');
const PREPARED = ids('steamed_pork_bun perf_soy_powder perf_whey_powder perf_chicken_plain perf_chicken_herb perf_chicken_smoke');
const SWEETS = ids('chocolate potato_chips rice_cracker biscuit vanilla_ice_cream');

export function ingredientGroup(id, data) {
  const ingredient = data?.ingredients?.[id];
  if (!ingredient) return 'other';
  if (id === 'water') return 'water';
  if (['kyoto_kombu_dashi','kyoto_usukuchi','stock_kombu_strained','stock_bonito_strained'].includes(id)) return 'seasoning';
  if (id === 'kyoto_namafu') return 'grain';
  if (id.startsWith('convenience_') || id.startsWith('quick_purchase_')) return 'prepared';
  if (OILS.has(id)) return 'oil';
  if (DRINKS.has(id)) return 'drink';
  if (id.startsWith('confectionery_') || id.startsWith('dessert_') ||
      id.startsWith('perf_bar_') || id.startsWith('perf_calorie_') || SWEETS.has(id)) return 'snack';
  if (/^(prepared_item_|retort_|cup_|bag_|takeaway_)/.test(id) || PREPARED.has(id)) return 'prepared';
  if (SEAWEEDS.has(id)) return 'seaweed';
  if (NUTS.has(id)) return 'nuts';
  if (GRAINS.has(id) || ingredient.groups?.includes('staple')) return 'grain';
  if (DAIRY.has(id) || ingredient.groups?.includes('dairy')) return 'dairy';
  if (FRUITS.has(id) || ingredient.groups?.includes('fruit')) return 'fruit';
  if (VEGETABLES.has(id) || ingredient.groups?.includes('vegetable')) return 'vegetable';
  if (ingredient.proteinSources?.includes('meat')) return 'meat';
  if (ingredient.proteinSources?.includes('fish')) return 'fish';
  if (ingredient.proteinSources?.some(source => ['egg', 'soy'].includes(source)) ||
      ingredient.groups?.includes('protein')) return 'eggsoy';
  // 未分類の追加食材を勝手に調味料とみなさず、利用者が「その他」から探せるようにします。
  if (/^(lemon|kombu|bonito|dried_sardine|salt|sugar|soy_sauce|miso|vinegar|mirin|sake|black_pepper|curry_powder|paprika_powder|chilli|dried_basil|mayonnaise|tomato_paste|coconut_milk|ume|turmeric|cumin|worcestershire_sauce|oyster_sauce|fish_sauce|palette_baking_powder|palette_maple_syrup|palette_honey|mapo_doubanjiang|mapo_tianmianjiang|mapo_douchi|mapo_huajiao|world_lime_juice|world_tomyum_paste|world_garam_masala|noodle_chinese_stock|noodle_niboshi_stock|noodle_tonkotsu_concentrate|simmered_yuzu_kosho|canteen_black_vinegar|soup311_awase_dashi|soup311_consomme|bread_strawberry_jam|bread_marmalade|bread_peanut_butter|bread_ketchup)$/.test(id)) return 'seasoning';
  return 'other';
}

export function ingredientGroupLabel(id, data) {
  const group = ingredientGroup(id, data);
  return INGREDIENT_GROUPS.find(item => item.id === group).label;
}

export function commonPantryIds(data) {
  return COMMON_PANTRY_IDS.filter(id => Object.hasOwn(data?.ingredients ?? {}, id));
}
