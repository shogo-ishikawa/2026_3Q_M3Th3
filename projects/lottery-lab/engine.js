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

export function probabilities(setting) {
  validateSetting(setting);
  const bonus = BONUS_DENOMINATORS[setting - 1];
  const values = [1 / bonus[0], 1 / bonus[1],
    1 / (setting === 6 ? 5.79 : 6.05), 1 / 35.6, 1 / 7.3, 1 / 1024, 1 / 1024];
  values.push(1 - values.reduce((total, value) => total + value, 0));
  return OUTCOMES.map((outcome, index) => ({ ...outcome, probability: values[index] }));
}

export function expectedDelta(setting, cost = 3) {
  integer(cost, '1回の消費ポイント', 0, 10000);
  return probabilities(setting).reduce((total, row) => total + row.probability * row.payout, 0) - cost;
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
  seed = freshSeed(), targetGames = 1000 } = {}) {
  validateSetting(setting);
  integer(initialPoints, '初期ポイント', 0, 1000000);
  integer(cost, '1回の消費ポイント', 0, 10000);
  integer(targetGames, '抽選回数', 1, 5000);
  const rng = createRng(seed);
  return {
    setting, initialPoints, cost, seed, targetGames,
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
  const rows = probabilities(session.setting);
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
  initialPoints = 50, cost = 3 } = {}) {
  integer(games, '1セットの抽選回数', 1, 5000);
  integer(runs, '繰り返すセット数', 1, 100);
  integer(seed, '乱数の種', 0, 0xffffffff);
  integer(initialPoints, '初期ポイント', 0, 1000000);
  integer(cost, '1回の消費ポイント', 0, 10000);
  return SETTINGS.map(setting => {
    const rows = probabilities(setting);
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
    return { setting, meanNet: totalNet / runs, minNet, maxNet,
      positiveRate: positives / runs, expectedNet: games * expectedDelta(setting, cost), meanHistory };
  });
}
