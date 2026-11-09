import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOMES, SETTINGS, probabilities, expectedDelta,
  createRng, createSession, draw, compareSettings } from '../engine.js';

test('original probabilities and payouts are retained and form a full distribution', () => {
  const bigDenominators = [273.1, 269.7, 269.7, 259, 259, 255];
  const regDenominators = [439.8, 399.6, 331, 315.1, 255, 255];
  assert.deepEqual(OUTCOMES.map(row => row.payout), [252, 96, 8, 2, 3, 14, 10, 0]);
  for (const setting of SETTINGS) {
    const rows = probabilities(setting);
    assert.equal(rows[0].probability, 1 / bigDenominators[setting - 1]);
    assert.equal(rows[1].probability, 1 / regDenominators[setting - 1]);
    assert.equal(rows[2].probability, 1 / (setting === 6 ? 5.79 : 6.05));
    assert.ok(rows.every(row => row.probability >= 0));
    assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-14);
  }
  // 元の十進数分母を分数として別計算した期待値と照合します。
  assert.ok(Math.abs(expectedDelta(1) - (-0.046089810716554304)) < 1e-12);
  assert.ok(Math.abs(expectedDelta(6) - 0.23697463514584705) < 1e-12);
});

test('cumulative boundaries choose the next outcome and leave the residual to miss', () => {
  const rows = probabilities(6);
  let lowerBound = 0;
  for (const row of rows) {
    const session = createSession({ seed: 0 });
    session.rng = () => lowerBound;
    assert.equal(draw(session)[0].id, row.id);
    lowerBound += row.probability;
  }
  const session = createSession({ seed: 1 });
  session.rng = () => 1 - Number.EPSILON;
  assert.equal(draw(session)[0].id, 'miss');
});

test('balance, counts and history stay consistent through batches and negative points', () => {
  const session = createSession({ initialPoints: 0, seed: 0, targetGames: 1000 });
  session.rng = () => .99;
  assert.equal(draw(session, 100).length, 100);
  assert.equal(session.balance, -300);
  assert.equal(session.counts.miss, 100);
  assert.equal(session.history.length, 101);
  assert.equal(session.balance, session.initialPoints + session.earned - session.spent);
  assert.equal(Object.values(session.counts).reduce((sum, count) => sum + count, 0), session.games);
  assert.equal(session.last.game, 100);
  assert.equal(session.last.balance, -300);
});

test('seeded draws are repeatable regardless of batching and respect targetGames', () => {
  const whole = createSession({ seed: 0, targetGames: 311 });
  const batches = createSession({ seed: 0, targetGames: 311 });
  const expected = draw(whole, 500);
  const actual = [...draw(batches, 1), ...draw(batches, 10), ...draw(batches, 300)];
  assert.deepEqual(actual, expected);
  assert.deepEqual(batches.counts, whole.counts);
  assert.deepEqual(batches.history, whole.history);
  assert.equal(draw(whole, 100).length, 0);
  assert.equal(whole.games, 311);
});

test('32-bit seed endpoints produce finite unit-interval random values', () => {
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const random = createRng(seed);
    const again = createRng(seed);
    const values = Array.from({ length: 1000 }, () => random());
    assert.deepEqual(values, Array.from({ length: 1000 }, () => again()));
    assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value < 1));
    assert.ok(new Set(values).size > 990);
  }
});

test('a one-run comparison exactly matches an ordinary session for every setting', () => {
  const compared = compareSettings({ seed: 123, games: 1000, runs: 1 });
  for (const row of compared) {
    const session = createSession({ setting: row.setting, seed: 123 });
    draw(session, 1000);
    assert.equal(row.meanNet, session.balance - session.initialPoints);
    assert.equal(row.minNet, row.meanNet);
    assert.equal(row.maxNet, row.meanNet);
    assert.equal(row.positiveRate, row.meanNet > 0 ? 1 : 0);
    assert.deepEqual(row.meanHistory, session.history);
    assert.equal(row.expectedNet, 1000 * expectedDelta(row.setting));
  }
});

test('repeated comparison aggregates the same individual runs, including wrapping seeds', () => {
  const seed = 0xffffffff;
  const compared = compareSettings({ games: 30, runs: 3, seed, initialPoints: 80, cost: 2 });
  for (const row of compared) {
    const samples = [0, 1, 2].map(run => {
      const session = createSession({ setting: row.setting, seed: (seed + run) >>> 0,
        targetGames: 30, initialPoints: 80, cost: 2 });
      draw(session, 30);
      return session;
    });
    const nets = samples.map(session => session.balance - 80);
    assert.equal(row.meanNet, nets.reduce((sum, value) => sum + value, 0) / 3);
    assert.equal(row.minNet, Math.min(...nets));
    assert.equal(row.maxNet, Math.max(...nets));
    assert.equal(row.positiveRate, nets.filter(value => value > 0).length / 3);
    assert.ok(Math.abs(row.meanHistory.at(-1) - (80 + row.meanNet)) < 1e-10);
  }
});

test('invalid inputs fail before simulations run', () => {
  for (const setting of [0, 7, 1.5, '6', NaN]) assert.throws(() => probabilities(setting), RangeError);
  for (const seed of [-1, 0x100000000, .1, Infinity, '42']) assert.throws(() => createRng(seed), RangeError);
  for (const options of [{ initialPoints: -1 }, { initialPoints: 1000001 }, { cost: -1 },
    { cost: 10001 }, { targetGames: 0 }, { targetGames: 5001 }, { seed: NaN }]) {
    assert.throws(() => createSession(options), RangeError);
  }
  for (const count of [0, -1, 1.5, 5001, '10']) assert.throws(() => draw(createSession(), count), RangeError);
  assert.throws(() => draw(null), TypeError);
  for (const options of [{ games: 0 }, { games: 5001 }, { runs: 0 }, { runs: 101 },
    { runs: 1.5 }, { initialPoints: -1 }, { cost: Infinity }, { seed: -1 }]) {
    assert.throws(() => compareSettings(options), RangeError);
  }
  for (const value of [-.1, 1, NaN, Infinity]) {
    const session = createSession({ seed: 1 });
    session.rng = () => value;
    assert.throws(() => draw(session), RangeError);
    assert.equal(session.games, 0);
  }
});
