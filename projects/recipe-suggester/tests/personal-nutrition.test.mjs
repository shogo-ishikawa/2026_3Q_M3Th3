import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveReference} from '../dietary-reference.js';
import {derivePersonalNutrition, PERSONAL_LIMITS} from '../personal-nutrition.js';

const profile = {age: 40, heightCm: 170, weightKg: 65, sex: 'male', activity: 'moderate'};

test('体格と年齢から基礎代謝を求め、活動係数を掛けた後だけ50 kcal単位に丸める', () => {
  const male = derivePersonalNutrition(profile);
  assert.ok(Math.abs(male.basalKcal - 1464.16627) < 0.00001);
  assert.equal(male.targets.kcal, 2550);
  const female = derivePersonalNutrition({...profile, heightCm: 160, weightKg: 55, sex: 'female'});
  assert.ok(Math.abs(female.basalKcal - 1162.61347) < 0.00001);
  assert.equal(female.targets.kcal, 2050);
  assert.equal(male.labels.kcal, '体重を維持するエネルギーの目安');
  assert.match(male.notes.join(''), /妊娠・授乳/);
});

test('65歳と75歳で身体活動レベルを切り替え、75歳以上の高いは計算しない', () => {
  for (const [age, band, pal] of [
    [18, '18-29', [1.5, 1.75, 2]], [29, '18-29', [1.5, 1.75, 2]],
    [30, '30-49', [1.5, 1.75, 2]], [49, '30-49', [1.5, 1.75, 2]],
    [50, '50-64', [1.5, 1.75, 2]], [64, '50-64', [1.5, 1.75, 2]],
    [65, '65-74', [1.5, 1.7, 1.9]], [74, '65-74', [1.5, 1.7, 1.9]],
    [75, '75-plus', [1.4, 1.7, null]], [79, '75-plus', [1.4, 1.7, null]],
  ]) {
    for (const [index, activity] of ['low', 'moderate', 'high'].entries()) {
      const result = derivePersonalNutrition({...profile, age, activity});
      assert.equal(result?.activityFactor ?? null, pal[index]);
      if (result) assert.equal(result.ageBand, band);
    }
  }
});

test('脂質・炭水化物のg範囲は推定エネルギーに合わせ、たんぱく質の推奨量・食物繊維・塩分は原表を保つ', () => {
  const personal = derivePersonalNutrition(profile);
  const reference = deriveReference({ageBand: '30-49', sex: 'male', activity: 'moderate'});
  assert.deepEqual(personal.energyPercentRanges, reference.energyPercentRanges);
  for (const nutrient of ['protein', 'fiber', 'salt']) {
    assert.equal(personal.targets[nutrient], reference.targets[nutrient]);
  }
  assert.deepEqual(personal.ranges.protein, {min: 82.875, max: 127.5, unit: 'g'});
  assert.equal(personal.ranges.carbs.min, 318.75);
  assert.ok(Math.abs(personal.targets.fat - (2550 * 0.25 / 9)) < 0.0001);
  const older = derivePersonalNutrition({...profile, age: 78, sex: 'female', heightCm: 145, weightKg: 40, activity: 'low'});
  assert.equal(older.ranges.protein.min, 50);
  assert.equal(derivePersonalNutrition({...profile, age: 79, sex: 'female', heightCm: 100, weightKg: 30, activity: 'low'}), null);
});

test('未登録、型・単位の誤り、検証範囲外は推定せず、数値の入力端を受け入れる', () => {
  for (const value of [null, [], {}, {age: 30}, {...profile, age: 18.5}, {...profile, age: 17},
    {...profile, age: 80}, {...profile, sex: 'unset'}, {...profile, activity: '__proto__'},
    {...profile, heightCm: '170'}, {...profile, weightKg: NaN}, {...profile, weightKg: Infinity},
    {...profile, weightKg: 29.9}, {...profile, weightKg: 250.1}, {...profile, heightCm: 1.7},
    {...profile, heightCm: 240.1}]) assert.equal(derivePersonalNutrition(value), null);
  for (const weightKg of [PERSONAL_LIMITS.minWeightKg, PERSONAL_LIMITS.maxWeightKg])
    assert.ok(derivePersonalNutrition({...profile, weightKg}));
  for (const heightCm of [PERSONAL_LIMITS.minHeightCm, PERSONAL_LIMITS.maxHeightCm])
    assert.ok(derivePersonalNutrition({...profile, heightCm}));
});
