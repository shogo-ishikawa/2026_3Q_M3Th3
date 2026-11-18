// 文部科学省「日本食品標準成分表（八訂）増補2023年」第2章。2026年3月27日訂正版。
// 各行の値は可食部100g当たりの kcal、たんぱく質、脂質、炭水化物、食物繊維、食塩相当量。
const nutrientKeys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];

function fruit(id, code, name, grams, serving, ediblePart, per100g, aliases = [], options = {}) {
  return {id, code, name, grams, serving, ediblePart, per100g, aliases, ...options};
}

const varieties = [
  fruit('satsuma', '07027', '温州みかん', 100, '1個ほど', '外皮をむき、薄皮は一緒に食べる。',
    [49, 0.7, 0.1, 12, 1, 0], ['うんしゅうみかん', '蜜柑']),
  fruit('hassaku', '07105', 'はっさく', 100, '小皿1皿', '外皮と薄皮をむき、種を除く。',
    [47, 0.8, 0.1, 11.5, 1.5, 0], ['八朔']),
  fruit('ruby-grapefruit', '07164', 'グレープフルーツ（ルビー）', 100, '小さめのもの半分ほど', '赤い果肉を取り出し、薄皮と種を除く。',
    [40, 0.9, 0.1, 9.6, 0.6, 0], ['ピンクグレープフルーツ', '紅肉種']),
  fruit('gold-kiwi', '07168', 'ゴールドキウイ', 80, '1個ほど', '黄色い果肉を使い、皮と両端を除く。',
    [63, 1.1, 0.2, 14.9, 1.4, 0], ['ゴールデンキウイ', 'キウイフルーツ', '黄肉種'], {allergens:['kiwi'], derivedFrom:['kiwi']}),
  fruit('japanese-pear', '07088', '和梨', 100, '小さめのもの半分ほど', '皮をむき、芯と種を除く。',
    [38, 0.3, 0.1, 11.3, 0.9, 0], ['なし', '日本なし', '和なし', '幸水', '豊水', '二十世紀']),
  fruit('european-pear', '07091', '洋梨', 100, '小さめのもの半分ほど', '食べ頃の果肉を使い、皮と芯を除く。',
    [48, 0.3, 0.1, 14.4, 1.9, 0], ['ようなし', '洋なし', '西洋なし', 'ラ・フランス', 'ラフランス']),
  fruit('persimmon', '07049', '柿（甘柿）', 100, '小さめのもの1個ほど', 'へたと皮を取り、種があれば除く。',
    [63, 0.4, 0.2, 15.9, 1.6, 0], ['かき', '甘がき', '富有柿', '次郎柿']),
  fruit('watermelon', '07077', 'すいか', 150, 'カットすいか小皿1皿', '赤い果肉を使い、皮と種は量に含めない。',
    [41, 0.6, 0.1, 9.5, 0.3, 0], ['西瓜', 'スイカ', '赤肉種']),
  fruit('melon', '07135', 'メロン（青肉）', 100, 'カットメロン小皿1皿', '露地メロンの緑色の果肉を使い、皮と種を除く。',
    [45, 1, 0.1, 10.4, 0.5, 0], ['緑肉メロン', 'カットメロン']),
  fruit('pineapple', '07097', 'パイナップル', 100, 'カットパイン小皿1皿', '皮と硬い芯を取り除いた果肉を使う。',
    [54, 0.6, 0.1, 13.7, 1.2, 0], ['カットパイン', 'パインアップル']),
  fruit('mango', '07132', 'マンゴー', 100, 'カットマンゴー小皿1皿', '中央の平たい種と皮を除き、果肉を切り分ける。',
    [68, 0.6, 0.1, 16.9, 1.3, 0], ['カットマンゴー']),
  fruit('shine-muscat', '07187', 'シャインマスカット', 80, '小皿1皿', '房から外して洗い、皮付きの実を使う。',
    [61, 0.7, 0.2, 16.1, 0.9, 0], ['ぶどう', '葡萄', 'マスカット'], {derivedFrom:['grape']}),
  fruit('japanese-cherry', '07070', 'さくらんぼ（国産）', 60, '小皿1皿', '軸と種を除いた実の重さで記録する。',
    [64, 1, 0.2, 15.2, 1.2, 0], ['おうとう', '桜桃', '佐藤錦']),
  fruit('american-cherry', '07071', 'アメリカンチェリー', 80, '小皿1皿', '米国産さくらんぼの軸と種を除く。',
    [64, 1.2, 0.1, 17.1, 1.4, 0], ['さくらんぼ', 'ダークチェリー']),
  fruit('fig', '07015', 'いちじく', 60, '1個ほど', '生のいちじくの皮と軸を除く。',
    [57, 0.6, 0.1, 14.3, 1.9, 0], ['無花果']),
  fruit('loquat', '07114', 'びわ', 60, '小皿1皿', '薄い皮をむいて中央の大きな種を取り除く。',
    [41, 0.3, 0.1, 10.6, 1.6, 0], ['枇杷']),
  fruit('plum', '07080', 'すもも', 70, '1個ほど', '皮付きの実を使い、中央の種を除く。',
    [46, 0.6, 1, 9.4, 1.6, 0], ['プラム', '李', '日本すもも']),
  fruit('apricot', '07007', 'あんず', 60, '小皿1皿', '生の実を洗い、軸と中央の種を除く。',
    [37, 1, 0.3, 8.5, 1.6, 0], ['杏', 'アプリコット']),
  fruit('raspberry', '07146', 'ラズベリー', 50, '小皿1皿', '生の実を使う。水洗いしたらそっと水気を切る。',
    [36, 1.1, 0.1, 10.2, 4.7, 0], ['木いちご', 'キイチゴ', 'フランボワーズ']),
  fruit('dragon-fruit', '07111', 'ドラゴンフルーツ（赤肉）', 100, '小皿1皿', 'レッドピタヤの皮を除き、黒い小さな種ごと果肉を食べる。',
    [52, 1.4, 0.3, 11.8, 1.9, 0], ['ピタヤ', 'レッドピタヤ']),
  fruit('papaya', '07109', '完熟パパイヤ', 100, '小皿1皿', '完熟果の皮と中心の黒い種を除く。',
    [33, 0.5, 0.2, 9.5, 2.2, 0], ['パパイア']),
  fruit('lychee', '07144', 'ライチ', 60, '小皿1皿', '外皮と種を除いた白い果肉を使う。成分表の試料は冷凍品。',
    [61, 1, 0.1, 16.4, 0.9, 0], ['ライチー', 'れいし', '茘枝']),
];

const ingredientId = entry => `fruit_${entry.id.replaceAll('-', '_')}`;
const source = entry => `日本食品標準成分表（八訂）増補2023年・食品番号${entry.code}。可食部100g当たりの値を1gへ換算。2026年11月18日確認。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=7_${entry.code}_7`;

export const FRUIT_INGREDIENTS = Object.fromEntries(varieties.map(entry => [
  ingredientId(entry),
  {
    name: entry.name, unit: 'g', groups: ['fruit'], proteinSources: [], allergens: entry.allergens ?? [],
    ...(entry.derivedFrom && {derivedFrom: entry.derivedFrom}),
    note: `可食部の重さで計算します。${entry.ediblePart}`,
  },
]));

export const FRUIT_NUTRITION = Object.fromEntries(varieties.map(entry => {
  const perGram = Object.fromEntries(nutrientKeys.map((key, i) => [key, entry.per100g[i] / 100]));
  return [ingredientId(entry), {
    gramsPerUnit: 1, nutritionPerUnit: perGram, rawNutritionPerUnit: {...perGram},
    nutritionSource: source(entry), rawNutritionSource: source(entry), estimatedNutrients: [],
  }];
}));

export const FRUIT_RECIPES = varieties.map(entry => ({
  id: `fruit-${entry.id}`, name: entry.name, role: 'snack', family: 'fruit', genre: 'その他',
  nature: 'ready-to-eat', staple: false, mealBase: false, minutes: 3, servings: 2,
  portion: {amount: entry.grams, unit: 'g', label: `1人分＝${entry.serving}（可食部約${entry.grams}g）`},
  ingredients: [{id: ingredientId(entry), amount: entry.grams * 2}], steps: [], tags: ['時短'],
  mealOccasions: ['朝食', '間食'],
  displayCategory: 'fruit', displayMethod: 'cold', displaySecondaryCategories: [],
  allergensKnown: true, ingredientsKnown: true, shoppingKnown: true,
  searchAliases: ['果物', 'フルーツ', ...entry.aliases],
  sourceNote: `${entry.ediblePart} 1人分の量は目安です。${source(entry)}`,
}));
