import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNutrient} from '../nutrient-format.js';

test('エネルギーは整数、他の栄養は小数第一位まで表示する', () => {
  assert.equal(formatNutrient(148.8, 'kcal'), '149');
  assert.equal(formatNutrient(297.6, 'kcal'), '298');
  assert.equal(formatNutrient(1999.5, 'kcal'), '2,000');
  for (const key of ['protein', 'fat', 'carbs', 'fiber', 'salt']) {
    assert.equal(formatNutrient(10.68, key), '10.7');
    assert.equal(formatNutrient(5.344, key), '5.3');
    assert.equal(formatNutrient(0.72, key), '0.7');
    assert.equal(formatNutrient(0, key), '0');
  }
});

test('未知の値を0とせず、小さな負の差の丸めには負の0を残さない', () => {
  for (const value of [null, undefined, NaN, Infinity, '10']) assert.equal(formatNutrient(value, 'kcal'), '—');
  assert.equal(formatNutrient(-0.04, 'salt'), '0');
  assert.equal(formatNutrient(-0.2, 'kcal'), '0');
  assert.equal(formatNutrient(-1.24, 'protein'), '-1.2');
  assert.throws(() => formatNutrient(10, 'weight'), /栄養成分/);
});
