// 学生作品の確率と配当を引き継ぐ、画面から独立した抽選処理です。
export const OUTCOMES = Object.freeze([
  { id: 'BIG', name: 'BIG', icon: '★', payout: 252 },
  { id: 'REG', name: 'REG', icon: '◆', payout: 96 },
  { id: 'grape', name: 'ブドウ', icon: '🍇', payout: 8 },
  { id: 'cherry', name: 'チェリー', icon: '🍒', payout: 2 },
  { id: 'replay', name: 'リプレイ', icon: '↻', payout: 3 },
  { id: 'bell', name: 'ベル', icon: '🔔', payout: 14 },
  { id: 'clown', name: 'ピエロ', icon: '🃏', payout: 10 },
  { id: 'miss', name: 'ハズレ', icon: '·', payout: 0 },
].map(Object.freeze));

export const SETTINGS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const MODELS = Object.freeze(['student', 'published']);
// メーカー公表の予測出玉率。公開値に合わせたモデルも実機の完全再現ではありません。
// https://www.kitadenshi.co.jp/slot/neoimjugglerex/
export const OFFICIAL_RETURN_RATES = Object.freeze([.970, .980, .995, 1.011, 1.033, 1.055]);
const BONUS_DENOMINATORS = Object.freeze([
  [273.1, 439.8], [269.7, 399.6], [269.7, 331.0],
  [259.0, 315.1], [259.0, 255.0], [255.0, 255.0],
]);

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name}は${min}〜${max}の整数で指定してください。`);
  }
  return value;
}

function validateSetting(setting) {
  return integer(setting, '設定', 1, 6);
}

function validateModel(model) {
  if (!MODELS.includes(model)) throw new RangeError('モデルはstudentまたはpublishedを指定してください。');
  return model;
}

export function probabilities(setting, model = 'student') {
  validateSetting(setting);
  validateModel(model);
  const bonus = BONUS_DENOMINATORS[setting - 1];
  const values = [1 / bonus[0], 1 / bonus[1],
    1 / (setting === 6 ? 5.79 : 6.05), 1 / 35.6, 1 / 7.3, 1 / 1024, 1 / 1024];
  if (model === 'published') {
    // BB/RBと他の小役は元の数表を保ち、ブドウだけで公表出玉率へ合わせます。
    // 逆算した補正値であり、メーカーが公表したブドウ確率ではありません。
    const otherExpectedPayout = values.reduce((sum, probability, index) =>
      sum + (index === 2 ? 0 : probability * OUTCOMES[index].payout), 0);
    values[2] = (3 * OFFICIAL_RETURN_RATES[setting - 1] - otherExpectedPayout) / OUTCOMES[2].payout;
  }
  values.push(1 - values.reduce((total, value) => total + value, 0));
  return OUTCOMES.map((outcome, index) => ({ ...outcome, probability: values[index] }));
}

export function expectedDelta(setting, cost = 3, model = 'student') {
  integer(cost, '1回の消費ポイント', 0, 10000);
  return probabilities(setting, model).reduce((total, row) => total + row.probability * row.payout, 0) - cost;
}

// Mulberry32。seedが同じなら同じ抽選列になり、0も有効なseedです。
export function createRng(seed) {
  integer(seed, '乱数の種', 0, 0xffffffff);
  let state = seed;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function freshSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

export function createSession({ setting = 6, initialPoints = 50, cost = 3,
  seed = freshSeed(), targetGames = 1000, model = 'student' } = {}) {
  validateSetting(setting);
  validateModel(model);
  integer(initialPoints, '初期ポイント', 0, 1000000);
  integer(cost, '1回の消費ポイント', 0, 10000);
  integer(targetGames, '抽選回数', 1, 5000);
  const rng = createRng(seed);
  return {
    setting, model, initialPoints, cost, seed, targetGames,
    games: 0, balance: initialPoints, spent: 0, earned: 0,
    counts: Object.fromEntries(OUTCOMES.map(row => [row.id, 0])),
    history: [initialPoints], last: null, rng,
  };
}

function selectOutcome(rows, randomValue) {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('乱数は0以上1未満である必要があります。');
  }
  let cumulative = 0;
  for (const outcome of rows) {
    cumulative += outcome.probability;
    if (randomValue < cumulative) return outcome;
  }
  // 小数の丸めで総和が1をわずかに下回っても、残りはハズレです。
  return rows[rows.length - 1];
}

export function draw(session, count = 1) {
  integer(count, '今回引く回数', 1, 5000);
  if (!session || typeof session.rng !== 'function') {
    throw new TypeError('createSessionで抽選を準備してください。');
  }
  const rows = probabilities(session.setting, session.model);
  const length = Math.min(count, session.targetGames - session.games);
  const results = [];
  for (let index = 0; index < length; index += 1) {
    const outcome = selectOutcome(rows, session.rng());
    session.games += 1;
    session.spent += session.cost;
    session.earned += outcome.payout;
    session.balance += outcome.payout - session.cost;
    session.counts[outcome.id] += 1;
    session.history.push(session.balance);
    const result = { id: outcome.id, name: outcome.name, payout: outcome.payout,
      balance: session.balance, game: session.games };
    session.last = result;
    results.push(result);
  }
  return results;
}

export function compareSettings({ games = 1000, runs = 50, seed = 42,
  initialPoints = 50, cost = 3, model = 'student' } = {}) {
  integer(games, '1セットの抽選回数', 1, 5000);
  integer(runs, '繰り返すセット数', 1, 100);
  integer(seed, '乱数の種', 0, 0xffffffff);
  integer(initialPoints, '初期ポイント', 0, 1000000);
  integer(cost, '1回の消費ポイント', 0, 10000);
  validateModel(model);
  return SETTINGS.map(setting => {
    const rows = probabilities(setting, model);
    const meanHistory = new Array(games + 1).fill(0);
    meanHistory[0] = initialPoints;
    let totalNet = 0;
    let minNet = Infinity;
    let maxNet = -Infinity;
    let positives = 0;
    for (let run = 0; run < runs; run += 1) {
      // 各設定で同じrunの乱数列を使い、確率設定の違いを比較します。
      const random = createRng((seed + run) >>> 0);
      let balance = initialPoints;
      for (let game = 1; game <= games; game += 1) {
        balance += selectOutcome(rows, random()).payout - cost;
        meanHistory[game] += balance / runs;
      }
      const net = balance - initialPoints;
      totalNet += net;
      minNet = Math.min(minNet, net);
      maxNet = Math.max(maxNet, net);
      if (net > 0) positives += 1;
    }
    return { setting, model, meanNet: totalNet / runs, minNet, maxNet,
      positiveRate: positives / runs, expectedNet: games * expectedDelta(setting, cost, model), meanHistory };
  });
}

export function theoreticalStats(setting, cost = 3, model = 'student') {
  integer(cost, '1回の消費ポイント', 0, 10000);
  const rows = probabilities(setting, model);
  const expectedPayout = rows.reduce((sum, row) => sum + row.probability * row.payout, 0);
  const mean = expectedPayout - cost;
  const variance = rows.reduce((sum, row) => sum + row.probability * (row.payout - expectedPayout) ** 2, 0);
  return {
    model, mean, variance, sd: Math.sqrt(variance),
    returnRate: cost ? expectedPayout / cost : null,
    officialReturnRate: OFFICIAL_RETURN_RATES[setting - 1],
    bonusProbability: rows[0].probability + rows[1].probability,
  };
}

// 各試行の収支だけを残すため、5000試行でも全ポイント履歴を持つ必要がありません。
// この結果はモンテカルロ推定用であり、厳密な確率分布ではありません。
export function simulateDistribution({ setting = 6, games = 1000, runs = 5000,
  seed = 20261110, cost = 3, model = 'student' } = {}) {
  integer(games, '1試行の抽選回数', 1, 5000);
  integer(runs, '試行数', 1, 10000);
  integer(seed, '乱数の種', 0, 0xffffffff);
  integer(cost, '1回の消費ポイント', 0, 10000);
  const rows = probabilities(setting, model);
  const thresholds = [];
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.probability;
    thresholds.push(cumulative);
  }
  const nets = new Array(runs);
  let totalNet = 0;
  let losses = 0;
  for (let run = 0; run < runs; run += 1) {
    const random = createRng((seed + run) >>> 0);
    let net = -games * cost;
    for (let game = 0; game < games; game += 1) {
      const value = random();
      let index = 0;
      while (index < thresholds.length - 1 && value >= thresholds[index]) index += 1;
      net += rows[index].payout;
    }
    nets[run] = net;
    totalNet += net;
    if (net < 0) losses += 1;
  }
  const sortedNets = [...nets].sort((left, right) => left - right);
  // 経験分布のnearest-rank。これは平均の信頼区間ではなく、各試行の結果の幅です。
  const quantile = fraction => sortedNets[Math.max(0, Math.ceil(fraction * runs) - 1)];
  return {
    nets, sortedNets, meanNet: totalNet / runs,
    lower95: quantile(.025), upper95: quantile(.975), lossRate: losses / runs,
    runs, games, seed, setting, cost, model,
  };
}

export function tailEstimate(distribution, observedNet) {
  if (!Number.isFinite(observedNet)) throw new RangeError('収支には有限の数を指定してください。');
  if (!distribution || !Array.isArray(distribution.nets) || !distribution.nets.length
    || distribution.nets.length > 10000 || !distribution.nets.every(Number.isFinite)
    || (distribution.runs !== undefined && distribution.runs !== distribution.nets.length)) {
    throw new TypeError('simulateDistributionの試行結果を指定してください。');
  }
  // 勝ちなら「同じ収支以上」、負けなら「同じ収支以下」。分母には全試行を使います。
  // 収支0は「0以上」とし、勝ちのときと同じ上側で数えます。
  const direction = observedNet >= 0 ? 'upper' : 'lower';
  const count = distribution.nets.filter(net => direction === 'upper' ? net >= observedNet : net <= observedNet).length;
  const total = distribution.nets.length;
  const probability = count / total;
  const z = 1.959963984540054;
  const divisor = 1 + z * z / total;
  const centre = (probability + z * z / (2 * total)) / divisor;
  const halfWidth = z / divisor * Math.sqrt(probability * (1 - probability) / total + z * z / (4 * total * total));
  return {
    direction, count, total, probability,
    lower95: count ? Math.max(0, centre - halfWidth) : 0,
    upper95: count < total ? Math.min(1, centre + halfWidth) : 1,
    oneIn: count ? total / count : null,
  };
}

const EXAMPLE_BUDGETS = Object.freeze([
  { name: '昼食', price: 800 },
  { name: '本', price: 1500 },
  { name: '映画', price: 2000 },
  { name: 'イヤホン', price: 5000 },
  { name: '小旅行', price: 20000 },
].map(Object.freeze));

export function moneyComparison(net, yenPerPoint = 20) {
  if (!Number.isFinite(net) || !Number.isFinite(yenPerPoint) || yenPerPoint <= 0
    || yenPerPoint > 1000000 || !Number.isSafeInteger(Math.trunc(net * yenPerPoint))) {
    throw new RangeError('収支と1ポイントあたりの仮の金額に、範囲内の有限な数を指定してください。');
  }
  const yenNet = net * yenPerPoint;
  const lossYen = Math.max(0, -yenNet);
  return {
    yenNet, lossYen,
    // 比較用に決めた予算例です。実売価格や実際の交換率を表しません。
    examples: EXAMPLE_BUDGETS.map(row => ({ ...row, count: Math.floor(lossYen / row.price) })),
  };
}
