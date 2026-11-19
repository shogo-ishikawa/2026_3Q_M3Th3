import {deriveReference, nutrientComparisons} from './dietary-reference.js';

// 身長・体重の範囲は単位の取り違えを防ぐ入力上の制限。医学的な基準値ではありません。
export const PERSONAL_LIMITS = Object.freeze({
  minAge: 18, maxAge: 79, minHeightCm: 100, maxHeightCm: 240, minWeightKg: 30, maxWeightKg: 250,
});

const ADULT_ACTIVITY = {low: 1.50, moderate: 1.75, high: 2.00};
const OLDER_ACTIVITY = {low: 1.50, moderate: 1.70, high: 1.90};
const OLDEST_ACTIVITY = {low: 1.40, moderate: 1.70};

function within(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function ageBandFor(age) {
  if (age < 30) return '18-29';
  if (age < 50) return '30-49';
  if (age < 65) return '50-64';
  if (age < 75) return '65-74';
  return '75-plus';
}

/** 健康な一般成人向け。入力がそろわないときや適用できない組み合わせにはnullを返します。 */
export function derivePersonalNutrition(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const {age, heightCm, weightKg, sex, activity} = profile;
  const limits = PERSONAL_LIMITS;
  if (!Number.isInteger(age) || !within(age, limits.minAge, limits.maxAge) ||
      !within(heightCm, limits.minHeightCm, limits.maxHeightCm) ||
      !within(weightKg, limits.minWeightKg, limits.maxWeightKg)) return null;

  const ageBand = ageBandFor(age);
  const reference = deriveReference({ageBand, sex, activity});
  if (!reference) return null;
  const factors = age < 65 ? ADULT_ACTIVITY : age < 75 ? OLDER_ACTIVITY : OLDEST_ACTIVITY;
  const activityFactor = factors[activity];

  // 日本人の食事摂取基準（2025年版）エネルギー・表2（基礎代謝量）と表4（身体活動レベル）。
  const offset = sex === 'male' ? 0.4235 : 0.9708;
  const basalKcal = (0.0481 * weightKg + 0.0234 * heightCm - 0.0138 * age - offset) * 1000 / 4.186;
  const kcal = Math.round(basalKcal * activityFactor / 50) * 50;
  const nutrition = nutrientComparisons(ageBand, sex, kcal);
  if (nutrition.ranges.protein.min > nutrition.ranges.protein.max) return null;

  return {
    ...reference, ...nutrition, ageBand, basalKcal, activityFactor,
    label: '身長・体重を使った目安（' + reference.label + '）',
    labels: {...reference.labels, kcal: '体重を維持するエネルギーの目安'},
    notes: [
      '健康な一般成人を対象に、基礎代謝量の推定値と普段の活動量から1日あたりのエネルギーを概算します。体重の推移と併せて振り返ってください。',
      '妊娠・授乳中や治療中の食事はこの計算の対象外です。',
      ...reference.notes.slice(1),
    ],
    references: [
      {title: '厚生労働省「日本人の食事摂取基準（2025年版）」エネルギー', location: '本文65頁 表2、67頁 表4（分割PDF 14・16ページ）', url: 'https://www.mhlw.go.jp/content/10904750/001316461.pdf'},
      ...reference.references,
    ],
  };
}
