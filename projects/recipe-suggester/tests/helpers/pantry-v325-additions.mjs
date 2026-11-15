// v3.25の手持ち食材用に新設した2IDだけを、旧版の固定契約から分けます。
export const PANTRY_V325_INGREDIENT_IDS = Object.freeze(['beef_round_raw', 'beef_pork_mince_raw']);
export const withoutPantryV325Ingredients = ingredients => Object.fromEntries(Object.entries(ingredients)
  .filter(([id]) => !PANTRY_V325_INGREDIENT_IDS.includes(id)));
