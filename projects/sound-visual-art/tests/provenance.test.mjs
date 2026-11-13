import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {computeTargets} from '../core.js';

const fixture = JSON.parse(readFileSync(new URL('./original-parity.json', import.meta.url), 'utf8'));
const close = (actual, expected, label) => {
  assert.ok(Number.isFinite(actual), `${label}: finite value required`);
  assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} != ${expected}`);
};

test('学内原本との照合で確定したsourceハッシュをfixtureの来歴記録に保つ', () => {
  // 学生の原NotebookはBox学内配布とし、公開テストの依存物にしません。
  assert.equal(existsSync(new URL('../original/student_code.ipynb', import.meta.url)), false);
  assert.equal(fixture.sourceNotebookSha256, '9b7b4c4bd08ca4edcc5e4905ba723fa212e841590269b8c9c2ecf7b6385648ee');
  assert.deepEqual(fixture.sourceCellSha256, [
    'dd9c321407a3f54f17c9780bc893943cf4642994ad5749592426412ec5ede8c5',
    'ca5e06e9f0c661c77ba1c45153b6f945b724bab8bffc7cc4ce00932e1c25bbe3',
  ]);
});

test('公開発展教材に出力・実行番号・個人を示す不要なメタデータを含めない', () => {
  const notebook = JSON.parse(readFileSync(new URL('../lumen_lab.ipynb', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(notebook.metadata).sort(), ['kernelspec', 'language_info']);
  assert.deepEqual(notebook.metadata.kernelspec, {display_name: 'Python 3', language: 'python', name: 'python3'});
  assert.deepEqual(notebook.metadata.language_info, {name: 'python'});
  assert.ok(notebook.cells.some(cell => cell.cell_type === 'code'));
  assert.ok(notebook.cells.some(cell => cell.cell_type === 'markdown'));
  for (const cell of notebook.cells) {
    if (cell.cell_type === 'code') {
      assert.deepEqual(cell.outputs, []);
      assert.equal(cell.execution_count, null);
    }
    assert.deepEqual(cell.metadata, {});
    const source = cell.source.join('');
    assert.doesNotMatch(source, /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
    assert.doesNotMatch(source, /\b\d{2}[a-zA-Z]{2}\d{4}\b/);
  }
});

test('不足するmathをテスト側だけに与えて計算したPython真値であることを明示する', () => {
  assert.match(fixture.generator, /Python ast/);
  assert.match(fixture.generator, /missing math supplied only to the test namespace/);
  assert.match(fixture.generator, /Original notebook unchanged/);
  assert.equal(fixture.cases.length, 46);
  assert.ok(fixture.cases.some(item => item.name === 'midpoint-number-tie-even' && item.expected.numberValue === 50));
  assert.ok(fixture.cases.some(item => item.name === 'round-shape-tie-down' && item.expected.vertexCount === 4));
  assert.ok(fixture.cases.some(item => item.name === 'round-shape-tie-next-down' && item.expected.vertexCount === 6));
});

for (const item of fixture.cases) {
  test(`学生コードの計算を再現: ${item.name}`, () => {
    const {frequency, volume, reversed} = item.input;
    const actual = computeTargets(frequency, volume, reversed);
    const expected = item.expected;
    for (const key of ['pitchNorm', 'volumeNorm', 'saturation', 'brightness']) close(actual[key], expected[key], key);
    for (const key of ['hexColour', 'vertexCount', 'numberValue']) assert.equal(actual[key], expected[key], key);
    assert.equal(Math.trunc(actual.saturation * 100), expected.saturationPercent);
    assert.equal(Math.trunc(actual.brightness * 100), expected.brightnessPercent);
    assert.equal(actual.shapePoints.length, expected.shapePointCount);
    for (const {index, point} of expected.shapeSamples) {
      close(actual.shapePoints[index][0], point[0], `shapePoints[${index}].x`);
      close(actual.shapePoints[index][1], point[1], `shapePoints[${index}].y`);
    }
  });
}
