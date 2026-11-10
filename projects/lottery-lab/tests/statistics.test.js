import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, OFFICIAL_RETURN_RATES, probabilities, expectedDelta,
  theoreticalStats, simulateDistribution, compareSettings,
  tailEstimate, moneyComparison, createSession, draw } from '../engine.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`);

test('theoretical moments agree with enumerating every two-draw result', () => {
  // 元の数表から独立に作り、全8×8通りの収支を足し合わせます。
  const p = [1 / 273.1, 1 / 439.8, 1 / 6.05, 1 / 35.6, 1 / 7.3, 1 / 1024, 1 / 1024];
  p.push(1 - p.reduce((sum, value) => sum + value, 0));
  const payouts = [252, 96, 8, 2, 3, 14, 10, 0];
  const possibilities = p.flatMap((left, i) => p.map((right, j) => ({
    probability: left * right, net: payouts[i] + payouts[j] - 6,
  })));
  const twoMean = possibilities.reduce((sum, row) => sum + row.probability * row.net, 0);
  const twoVariance = possibilities.reduce((sum, row) => sum + row.probability * (row.net - twoMean) ** 2, 0);
  const stats = theoreticalStats(1);
  near(stats.mean * 2, twoMean);
  near(stats.variance * 2, twoVariance);
  near(stats.sd ** 2, stats.variance);
  near(stats.bonusProbability, p[0] + p[1]);
  near(theoreticalStats(1, 2).mean, stats.mean + 1);
  near(theoreticalStats(1, 2).variance, stats.variance);
  assert.equal(theoreticalStats(1, 0).returnRate, null);
});

test('reference machine returns and simplified-model returns remain distinct', () => {
  assert.deepEqual(OFFICIAL_RETURN_RATES, [.970, .980, .995, 1.011, 1.033, 1.055]);
  const low = theoreticalStats(1);
  const high = theoreticalStats(6);
  near(low.returnRate, (3 - .046089810716554304) / 3);
  near(high.returnRate, (3 + .23697463514584705) / 3);
  assert.notEqual(low.returnRate, low.officialReturnRate);
  assert.notEqual(high.returnRate, high.officialReturnRate);
});

test('published calibration matches each published return while preserving disclosed bonus probabilities', () => {
  assert.deepEqual(MODELS, ['student', 'published']);
  for (let setting = 1; setting <= 6; setting++) {
    const original = probabilities(setting);
    const student = probabilities(setting, 'student');
    const published = probabilities(setting, 'published');
    assert.deepEqual(student, original);
    assert.ok(published.every(row => row.probability >= 0 && row.probability <= 1));
    near(published.reduce((sum, row) => sum + row.probability, 0), 1);
    for (let index = 0; index < student.length; index++) {
      assert.equal(published[index].payout, student[index].payout);
      if (![2, 7].includes(index)) assert.equal(published[index].probability, student[index].probability);
    }
    assert.ok(published[2].probability < student[2].probability);
    near(student[2].probability - published[2].probability, published[7].probability - student[7].probability);
    const stats = theoreticalStats(setting, 3, 'published');
    assert.equal(stats.model, 'published');
    near(stats.returnRate, OFFICIAL_RETURN_RATES[setting - 1]);
    near(expectedDelta(setting, 3, 'published'), 3 * (OFFICIAL_RETURN_RATES[setting - 1] - 1));
    near(stats.mean, expectedDelta(setting, 3, 'published'));
  }
  assert.ok(expectedDelta(3, 3, 'student') > 0);
  assert.ok(expectedDelta(3, 3, 'published') < 0);
});

test('distribution draws match ordinary sessions for each trial and wrapping seeds', () => {
  for (const model of MODELS) for (const setting of [1, 2, 3, 4, 5, 6]) {
    const options = { setting, model, games: 31, runs: 12, seed: 0xffffffff, cost: 2 };
    const sample = simulateDistribution(options);
    const nets = Array.from({ length: options.runs }, (_, run) => {
      const session = createSession({ setting, model, initialPoints: 71, targetGames: options.games,
        seed: (options.seed + run) >>> 0, cost: options.cost });
      assert.equal(session.model, model);
      draw(session, options.games);
      return session.balance - session.initialPoints;
    });
    assert.deepEqual(sample.nets, nets);
    assert.equal(sample.model, model);
    assert.deepEqual(sample, simulateDistribution(options));
    assert.deepEqual(sample.sortedNets, [...nets].sort((a, b) => a - b));
    assert.equal(sample.meanNet, nets.reduce((sum, value) => sum + value, 0) / nets.length);
    assert.equal(sample.lossRate, nets.filter(net => net < 0).length / nets.length);
    assert.equal(sample.lower95, sample.sortedNets[0]);
    assert.equal(sample.upper95, sample.sortedNets.at(-1));
  }
  const single = simulateDistribution({ setting: 3, games: 1, runs: 1, seed: 0 });
  assert.equal(single.meanNet, single.lower95);
  assert.equal(single.meanNet, single.upper95);
});

test('model choice propagates through repeated comparison and defaults preserve the student sequence', () => {
  for (const model of MODELS) {
    const rows = compareSettings({ games: 60, runs: 1, seed: 93, model });
    for (const row of rows) {
      const session = createSession({ setting: row.setting, model, seed: 93, targetGames: 60 });
      draw(session, 60);
      assert.equal(row.model, model);
      assert.equal(row.meanNet, session.balance - session.initialPoints);
      assert.deepEqual(row.meanHistory, session.history);
      near(row.expectedNet, 60 * expectedDelta(row.setting, 3, model));
    }
  }
  const omitted = createSession({ seed: 123 });
  const explicit = createSession({ seed: 123, model: 'student' });
  assert.deepEqual(draw(omitted, 1000), draw(explicit, 1000));
  assert.deepEqual(compareSettings({ seed: 42 }), compareSettings({ seed: 42, model: 'student' }));
  assert.deepEqual(simulateDistribution({ games: 10, runs: 5 }),
    simulateDistribution({ games: 10, runs: 5, model: 'student' }));
});

test('rarity uses all trials and inclusive tails, with zero treated as upper', () => {
  const distribution = { nets: [-10, -10, -3, 0, 4, 4, 20, 20], runs: 8 };
  const won = tailEstimate(distribution, 4);
  assert.equal(won.direction, 'upper');
  assert.equal(won.count, 4);
  assert.equal(won.total, 8);
  assert.equal(won.probability, .5);
  assert.equal(won.oneIn, 2);
  assert.equal(tailEstimate(distribution, 20).count, 2);
  const lost = tailEstimate(distribution, -10);
  assert.equal(lost.direction, 'lower');
  assert.equal(lost.count, 2);
  assert.equal(lost.probability, .25);
  const zero = tailEstimate(distribution, 0);
  assert.equal(zero.direction, 'upper');
  assert.equal(zero.count, 5);
});

test('Wilson intervals keep unobserved events uncertain instead of declaring impossibility', () => {
  const nets = Array.from({ length: 100 }, (_, index) => index < 50 ? -1 : 1);
  const half = tailEstimate({ nets }, 1);
  near(half.lower95, .4038315303659957);
  near(half.upper95, .5961684696340044);
  const absent = tailEstimate({ nets }, 500);
  assert.equal(absent.count, 0);
  assert.equal(absent.probability, 0);
  assert.equal(absent.oneIn, null);
  assert.equal(absent.lower95, 0);
  near(absent.upper95, .03699349820698568);
  const all = tailEstimate({ nets: [0, 1, 2] }, 0);
  assert.equal(all.probability, 1);
  assert.equal(all.upper95, 1);
  assert.ok(all.lower95 > 0 && all.lower95 < 1);
});

test('money examples use net loss, not the current balance or total repeated stakes', () => {
  const lost = moneyComparison(-81 - 50, 20); // 残高−81、初期50なら損失は131 ptです。
  assert.equal(lost.yenNet, -2620);
  assert.equal(lost.lossYen, 2620);
  assert.deepEqual(lost.examples.map(row => [row.name, row.price, row.count]), [
    ['昼食', 800, 3], ['本', 1500, 1], ['映画', 2000, 1], ['イヤホン', 5000, 0], ['小旅行', 20000, 0],
  ]);
  const won = moneyComparison(100);
  assert.equal(won.yenNet, 2000);
  assert.equal(won.lossYen, 0);
  assert.ok(won.examples.every(row => row.count === 0));
  assert.equal(moneyComparison(-100, 5).lossYen, 500);
  assert.equal(moneyComparison(-40, .5).lossYen, 20);
  assert.equal(moneyComparison(0).lossYen, 0);
});

test('new statistics APIs reject invalid and oversized inputs', () => {
  for (const options of [{ setting: 0 }, { setting: 7 }, { games: 0 }, { games: 5001 },
    { games: 1.5 }, { runs: 0 }, { runs: 10001 }, { seed: -1 }, { seed: 0x100000000 },
    { cost: -1 }, { cost: 10001 }, { runs: '5000' }]) {
    assert.throws(() => simulateDistribution(options), RangeError);
  }
  for (const cost of [-1, 10001, NaN]) assert.throws(() => theoreticalStats(1, cost), RangeError);
  for (const invalid of [{}, { nets: [] }, { nets: [NaN] }, { nets: [1], runs: 2 }]) {
    assert.throws(() => tailEstimate(invalid, 0), TypeError);
  }
  for (const net of [NaN, Infinity, '100']) {
    assert.throws(() => tailEstimate({ nets: [0] }, net), RangeError);
    assert.throws(() => moneyComparison(net), RangeError);
  }
  for (const conversion of [0, -1, NaN, Infinity, 1000001, '20']) {
    assert.throws(() => moneyComparison(-1, conversion), RangeError);
  }
  assert.throws(() => moneyComparison(Number.MAX_SAFE_INTEGER, 20), RangeError);
  for (const model of ['', 'official', null, 'STUDENT', 1]) {
    assert.throws(() => probabilities(1, model), RangeError);
    assert.throws(() => expectedDelta(1, 3, model), RangeError);
    assert.throws(() => theoreticalStats(1, 3, model), RangeError);
    assert.throws(() => createSession({ model }), RangeError);
    assert.throws(() => compareSettings({ model }), RangeError);
    assert.throws(() => simulateDistribution({ model }), RangeError);
    const session = createSession({ seed: 1 });
    session.model = model;
    assert.throws(() => draw(session), RangeError);
    assert.equal(session.games, 0);
  }
});
