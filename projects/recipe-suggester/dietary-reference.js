/**
 * 「日本人の食事摂取基準（2025年版）」から一般成人の比較値を作ります。
 * 参照体位に対する表の値です。個人の必要量や健康状態の診断には使いません。
 * 原表・ページ・換算の根拠は docs/dietary-reference-sources.md を参照してください。
 */
export const REFERENCE_EDITION = '日本人の食事摂取基準（2025年版）';
export const AGE_BANDS = Object.freeze([
  Object.freeze({id: '18-29', label: '18〜29歳'}),
  Object.freeze({id: '30-49', label: '30〜49歳'}),
  Object.freeze({id: '50-64', label: '50〜64歳'}),
  Object.freeze({id: '65-74', label: '65〜74歳'}),
  Object.freeze({id: '75-plus', label: '75歳以上'}),
]);
export const SEX_OPTIONS = Object.freeze([
  Object.freeze({id: 'male', label: '男性'}),
  Object.freeze({id: 'female', label: '女性'}),
]);
export const ACTIVITY_OPTIONS = Object.freeze([
  Object.freeze({id: 'low', label: '低い'}),
  Object.freeze({id: 'moderate', label: 'ふつう'}),
  Object.freeze({id: 'high', label: '高い'}),
]);

// 各配列は身体活動レベル「低い・ふつう・高い」の順。nullは原表に値がない組合せ。
const ENERGY_KCAL = {
  male: {
    '18-29': [2250, 2600, 3000],
    '30-49': [2350, 2750, 3150],
    '50-64': [2250, 2650, 3000],
    '65-74': [2100, 2350, 2650],
    '75-plus': [1850, 2250, null],
  },
  female: {
    '18-29': [1700, 1950, 2250],
    '30-49': [1750, 2050, 2350],
    '50-64': [1700, 1950, 2250],
    '65-74': [1650, 1850, 2050],
    '75-plus': [1450, 1750, null],
  },
};
const PROTEIN_RECOMMENDED = {
  male: {'18-29': 65, '30-49': 65, '50-64': 65, '65-74': 60, '75-plus': 60},
  female: {'18-29': 50, '30-49': 50, '50-64': 50, '65-74': 50, '75-plus': 50},
};
const FIBRE_GOAL = {
  male: {'18-29': 20, '30-49': 22, '50-64': 22, '65-74': 21, '75-plus': 20},
  female: {'18-29': 18, '30-49': 18, '50-64': 18, '65-74': 18, '75-plus': 17},
};
const SALT_LIMIT = {male: 7.5, female: 6.5};
const ACTIVITY_INDEX = {low: 0, moderate: 1, high: 2};
const PROTEIN_PERCENT = {'18-29': [13, 20], '30-49': [13, 20], '50-64': [14, 20], '65-74': [15, 20], '75-plus': [15, 20]};
const FAT_PERCENT = [20, 30];
const CARBS_PERCENT = [50, 65];
const round = value => Math.round(value * 10000) / 10000;
const has = (record, key) => Object.hasOwn(record, key);

export const DIETARY_REFERENCE_SOURCES = Object.freeze([
  Object.freeze({title: '厚生労働省：日本人の食事摂取基準（2025年版）報告書', url: 'https://www.mhlw.go.jp/stf/newpage_44138.html', location: '2025年3月25日訂正反映版'}),
  Object.freeze({title: '厚生労働省：食事による栄養摂取量の基準', url: 'https://www.mhlw.go.jp/web/t_doc?dataId=78ab4652&dataType=0', location: '令和6年告示第339号による改正、2025年4月1日適用。参考一・別表第二・別表第五・別表第六'}),
  Object.freeze({title: 'エネルギー産生栄養素バランス', url: 'https://www.mhlw.go.jp/content/10904750/001316465.pdf', location: '冊子149ページ／分割PDF 5ページ'}),
  Object.freeze({title: 'たんぱく質', url: 'https://www.mhlw.go.jp/content/10904750/001316462.pdf', location: '冊子103ページ／分割PDF 18ページ'}),
  Object.freeze({title: '食物繊維', url: 'https://www.mhlw.go.jp/content/10904750/001316464.pdf', location: '冊子144ページ／分割PDF 16ページ'}),
  Object.freeze({title: 'ナトリウム（食塩相当量）', url: 'https://www.mhlw.go.jp/content/10904750/001316468.pdf', location: '冊子281ページ／分割PDF 39ページ'}),
]);

/**
 * profile.modeは表示側で使います。この関数は明示された3項目だけから計算します。
 * 未選択、対応外の値、75歳以上の「高い」には他の区分を推測せずnullを返します。
 */
export function deriveReference(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const {ageBand, sex, activity} = profile;
  if (![ageBand, sex, activity].every(value => typeof value === 'string')) return null;
  if (!has(ENERGY_KCAL, sex) || !has(ENERGY_KCAL[sex], ageBand) || !has(ACTIVITY_INDEX, activity)) return null;
  const kcal = ENERGY_KCAL[sex][ageBand][ACTIVITY_INDEX[activity]];
  if (kcal === null) return null;
  const protein = PROTEIN_RECOMMENDED[sex][ageBand];
  const percentRanges = {protein: PROTEIN_PERCENT[ageBand], fat: FAT_PERCENT, carbs: CARBS_PERCENT};
  const ranges = {};
  const energyPercentRanges = {};
  for (const [key, [min, max]] of Object.entries(percentRanges)) {
    const kcalPerGram = key === 'fat' ? 9 : 4;
    ranges[key] = {min: round(kcal * min / 100 / kcalPerGram), max: round(kcal * max / 100 / kcalPerGram), unit: 'g'};
    energyPercentRanges[key] = {min, max, unit: '%エネルギー'};
  }
  // 原表の高齢者の注記に合わせ、推奨量より低い下限は使いません。
  if (['65-74', '75-plus'].includes(ageBand)) ranges.protein.min = Math.max(protein, ranges.protein.min);
  const targets = {
    kcal,
    protein,
    fat: round((ranges.fat.min + ranges.fat.max) / 2),
    carbs: round((ranges.carbs.min + ranges.carbs.max) / 2),
    fiber: FIBRE_GOAL[sex][ageBand],
    salt: SALT_LIMIT[sex],
  };
  return {
    targets,
    ranges,
    energyPercentRanges,
    indicators: {kcal: 'estimated', protein: 'recommended', fat: 'range', carbs: 'range', fiber: 'minimum-inclusive', salt: 'maximum-exclusive'},
    labels: {
      kcal: '推定エネルギー必要量（参照体位）',
      protein: '推奨量。目標エネルギー比率の範囲とは別の指標です。',
      fat: '目標量の範囲。比較値は範囲の中央から計算しています。',
      carbs: '目標量の範囲。比較値は範囲の中央から計算しています。',
      fiber: '目標量：この量以上',
      salt: '目標量：この量未満',
    },
    references: DIETARY_REFERENCE_SOURCES.map(source => ({...source})),
    label: `${AGE_BANDS.find(item => item.id === ageBand).label}・${SEX_OPTIONS.find(item => item.id === sex).label}・活動量${ACTIVITY_OPTIONS.find(item => item.id === activity).label}`,
    notes: [
      '参照体位の一般成人に対する比較用です。体格による調整、妊娠・授乳中、18歳未満、治療用の基準には対応していません。',
      '習慣的な食事を振り返る目安です。1日分の記録や未入力を含む記録から、健康状態や栄養不足を判定するものではありません。',
      '脂質と炭水化物の比較値は、公式のエネルギー比率の範囲をgへ換算した中央の参考値です。公式の推奨量ではありません。',
    ],
  };
}
