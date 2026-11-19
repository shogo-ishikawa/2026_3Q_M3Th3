import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weeklyReview} from '../weekly-review.js';

function entry(date, kcal, salt, status = 'eaten') {
  return {date, meal: 'lunch', status, items: [{quantity: 1, nutrition: {kcal, salt}}]};
}
const row = (review, key) => review.rows.find(item => item.key === key);

test('選んだ日を含む二つの週で、成分別の完了日数と量の差を求める', () => {
  const entries = [
    entry('2025-12-25', 5000, 9), entry('2025-12-26', 1000, 3), entry('2026-01-01', 1200, null),
    entry('2026-01-02', 1300, 2), entry('2026-01-08', 1500, 4), entry('2026-01-09', 6000, 8),
    entry('2026-01-07', 999, 8), entry('2026-01-08', 999, 8, 'planned'),
  ];
  const review = weeklyReview(entries, ['2025-12-25','2025-12-26','2026-01-01','2026-01-02','2026-01-08','2026-01-09'], '2026-01-08');
  assert.deepEqual([review.recent.from,review.recent.to,review.previous.from,review.previous.to],
    ['2026-01-02','2026-01-08','2025-12-26','2026-01-01']);
  assert.deepEqual(row(review,'kcal'), {key:'kcal',current:1400,prior:1100,currentDays:2,priorDays:2,difference:300});
  assert.deepEqual(row(review,'salt'), {key:'salt',current:3,prior:3,currentDays:2,priorDays:1,difference:0});
  assert.equal(row(review,'fiber').difference, null);
});

test('明示的な飲食なしの日だけ0、未完了・メモだけの日は差の計算から除く', () => {
  const review = weeklyReview([{date:'2026-02-25', status:'eaten', meal:'dinner', items:[]}], ['2026-02-25','2026-03-01'], '2026-03-04');
  assert.deepEqual(row(review,'kcal'), {key:'kcal',current:0,prior:null,currentDays:1,priorDays:0,difference:null});
  assert.equal(row(weeklyReview([], [], '2026-03-04'),'kcal').current, null);
});

test('最初の記録可能日も集計でき、前の7日間と同じ日を二重に数えない', () => {
  const review = weeklyReview([entry('2000-01-01', 200, 0)], ['2000-01-01'], '2000-01-01');
  assert.equal(review.recent.from, '2000-01-01');
  assert.equal(review.previous, null);
  assert.equal(row(review,'kcal').difference, null);
  const following = weeklyReview([], ['2000-01-01'], '2000-01-08');
  assert.deepEqual([following.previous.from,following.previous.to], ['2000-01-01','2000-01-01']);
  assert.equal(row(following,'kcal').currentDays, 0);
});
