import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveReference, AGE_BANDS, SEX_OPTIONS, ACTIVITY_OPTIONS, DIETARY_REFERENCE_SOURCES} from '../dietary-reference.js';

const profile = (ageBand = '18-29', sex = 'male', activity = 'moderate') => ({ageBand, sex, activity, mode: 'reference'});
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00011, `${a} ≠ ${b}`);

test('未選択や対応外の区分から年齢・性別・活動量を推測しない', () => {
  for (const value of [undefined, null, {}, [], 'male', profile('unset'), profile('under-18'), profile('18-29', 'unset'), profile('18-29', 'other'), profile('18-29', 'male', 'unset'), profile('18-29', 'male', 'very-high'), profile('__proto__'), profile('18-29', '__proto__'), profile('18-29', 'male', 'constructor'), profile(18), profile('18-29', {toString: () => 'male'})]) assert.equal(deriveReference(value), null);
});

test('若年成人の男女と活動量別のエネルギーを告示原表に合わせる', () => {
  const male = [2250, 2600, 3000], female = [1700, 1950, 2250];
  for (const [index, {id}] of ACTIVITY_OPTIONS.entries()) {
    assert.equal(deriveReference(profile('18-29', 'male', id)).targets.kcal, male[index]);
    assert.equal(deriveReference(profile('18-29', 'female', id)).targets.kcal, female[index]);
  }
});

test('全年齢・性別・活動量の値は告示原表と一致する', () => {
  // 行は年代順、列は男性の低い・ふつう・高い、女性の低い・ふつう・高い。
  const originalTable = [
    [2250, 2600, 3000, 1700, 1950, 2250],
    [2350, 2750, 3150, 1750, 2050, 2350],
    [2250, 2650, 3000, 1700, 1950, 2250],
    [2100, 2350, 2650, 1650, 1850, 2050],
    [1850, 2250, null, 1450, 1750, null],
  ];
  for (const [index, {id: age}] of AGE_BANDS.entries()) {
    const calculated = SEX_OPTIONS.flatMap(({id: sex}) => ACTIVITY_OPTIONS.map(({id: activity}) => deriveReference(profile(age, sex, activity))?.targets.kcal ?? null));
    assert.deepEqual(calculated, originalTable[index]);
  }
});

test('75歳以上で表にない高い活動量は補間やふつうへの置換をしない', () => {
  for (const sex of ['male', 'female']) assert.equal(deriveReference(profile('75-plus', sex, 'high')), null);
  assert.equal(deriveReference(profile('75-plus', 'male', 'low')).targets.kcal, 1850);
  assert.equal(deriveReference(profile('75-plus', 'female', 'low')).targets.kcal, 1450);
});

test('たんぱく質の推奨量と年齢による目標比率を混同しない', () => {
  const young = deriveReference(profile());
  assert.equal(young.targets.protein, 65);
  assert.deepEqual(young.energyPercentRanges.protein, {min: 13, max: 20, unit: '%エネルギー'});
  assert.deepEqual(young.ranges.protein, {min: 84.5, max: 130, unit: 'g'});
  const middle = deriveReference(profile('50-64'));
  assert.equal(middle.targets.protein, 65);
  assert.equal(middle.energyPercentRanges.protein.min, 14);
  const older = deriveReference(profile('65-74'));
  assert.equal(older.targets.protein, 60);
  assert.equal(older.energyPercentRanges.protein.min, 15);
  assert.equal(deriveReference(profile('75-plus', 'female')).targets.protein, 50);
});

test('脂質9kcal/g・炭水化物4kcal/gで範囲と中央の比較値を別に換算する', () => {
  const r = deriveReference(profile());
  close(r.ranges.fat.min, 2600 * 0.20 / 9);
  close(r.ranges.fat.max, 2600 * 0.30 / 9);
  close(r.targets.fat, 2600 * 0.25 / 9);
  close(r.ranges.carbs.min, 2600 * 0.50 / 4);
  close(r.ranges.carbs.max, 2600 * 0.65 / 4);
  close(r.targets.carbs, 2600 * 0.575 / 4);
  assert.match(r.notes.join(''), /公式の推奨量ではありません/);
});

test('食物繊維の以上と食塩相当量の未満を区別し年齢・性別の値を保つ', () => {
  const males = [20, 22, 22, 21, 20], females = [18, 18, 18, 18, 17];
  for (const [index, {id: age}] of AGE_BANDS.entries()) for (const sex of ['male', 'female']) {
    const r = deriveReference(profile(age, sex));
    assert.equal(r.targets.fiber, (sex === 'male' ? males : females)[index]);
    assert.equal(r.targets.salt, sex === 'male' ? 7.5 : 6.5);
    assert.equal(r.indicators.fiber, 'minimum-inclusive');
    assert.equal(r.indicators.salt, 'maximum-exclusive');
    assert.match(r.labels.salt, /未満/);
  }
});

test('すべての対応区分で非負の比較値と整合する範囲を返す', () => {
  let supported = 0;
  for (const {id: age} of AGE_BANDS) for (const {id: sex} of SEX_OPTIONS) for (const {id: activity} of ACTIVITY_OPTIONS) {
    const r = deriveReference(profile(age, sex, activity));
    if (!r) continue;
    supported++;
    for (const value of Object.values(r.targets)) assert.ok(Number.isFinite(value) && value > 0);
    for (const key of ['protein', 'fat', 'carbs']) assert.ok(r.ranges[key].min <= r.ranges[key].max);
    for (const key of ['fat', 'carbs']) assert.ok(r.targets[key] >= r.ranges[key].min && r.targets[key] <= r.ranges[key].max);
  }
  assert.equal(supported, 28);
});

test('入力や原表を変更せずmodeに依存しない独立した比較値を返す', () => {
  const input = profile();
  const original = structuredClone(input);
  const a = deriveReference(input), b = deriveReference({...input, mode: 'manual'});
  assert.deepEqual(a, b);
  a.targets.kcal = 1; a.ranges.fat.min = 1; a.references[0].title = 'changed';
  assert.equal(deriveReference(input).targets.kcal, 2600);
  assert.notEqual(deriveReference(input).ranges.fat.min, 1);
  assert.notEqual(DIETARY_REFERENCE_SOURCES[0].title, 'changed');
  assert.deepEqual(input, original);
});

test('出典は一次資料で比較の適用範囲を記載する', () => {
  const r = deriveReference(profile());
  assert.ok(r.references.every(source => new URL(source.url).hostname === 'www.mhlw.go.jp'));
  assert.match(r.notes.join(''), /参照体位/);
  assert.match(r.notes.join(''), /妊娠・授乳/);
  assert.match(r.notes.join(''), /1日分の記録/);
  assert.match(r.label, /18〜29歳・男性・活動量ふつう/);
});
