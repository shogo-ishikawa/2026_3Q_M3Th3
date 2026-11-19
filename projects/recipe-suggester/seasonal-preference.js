// 食材IDはレシピに明記されたものだけを比較する。産地や購入時期は推測しない。
// 関東農政局・東京都中央卸売市場の季節例。出典と季節の区切りは docs/celebration-recipes.md に記載。
const seasons = [
  {label: '冬', ingredients: {chinese_cabbage: '白菜', daikon: '大根', yellowtail: 'ぶり',
    yellowtail_sashimi: 'ぶり', fruit_satsuma: 'みかん', spinach: 'ほうれん草', lotus_root: 'れんこん'}},
  {label: '春', ingredients: {asparagus: 'アスパラガス', bamboo_shoot_cooked: 'たけのこ',
    clam: 'あさり', strawberry: 'いちご', turnip: 'かぶ', chive: 'にら'}},
  {label: '夏', ingredients: {cucumber: 'きゅうり', tomato: 'トマト', horse_mackerel: 'あじ',
    horse_mackerel_sashimi: 'あじ', fruit_watermelon: 'すいか', edamame: '枝豆', pepper: 'ピーマン'}},
  {label: '秋', ingredients: {sweet_potato: 'さつまいも', fruit_persimmon: '柿', saury: 'さんま',
    seafood_sanma: 'さんま', shiitake: 'しいたけ', grape: 'ぶどう', aubergine: 'なす'}},
];

/** 献立日の日本の旬を一品につき一度だけ軽く優先する。量の多い材料を理由として示す。 */
export function seasonalIngredientPreference(recipe, date) {
  const month = typeof date === 'string' ? Number(date.slice(5, 7)) : NaN;
  if (!(month >= 1 && month <= 12) || !recipe?.ingredients?.length || !(recipe.servings > 0)) return null;
  const season = seasons[Math.floor((month % 12) / 3)];
  let match;
  for (const part of recipe.ingredients) {
    // 対象はすべてg単位。1人分10g未満の薬味・飾りは季節を選ぶ理由にしない。
    if (Object.hasOwn(season.ingredients, part.id) && part.amount >= 10 * recipe.servings &&
        (!match || part.amount > match.amount)) match = part;
  }
  return match ? {score: 3, reason: `${season.label}が旬の${season.ingredients[match.id]}を使った料理`} : null;
}
