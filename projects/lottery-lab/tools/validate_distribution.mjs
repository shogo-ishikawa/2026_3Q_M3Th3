// 当選頻度と平均収支を、同じエンジンの長い独立抽選で確かめます。
// 1本の結果が理論値と完全一致するような調整はしません。
import { performance } from 'node:perf_hooks';
import { SETTINGS, MODELS, probabilities, theoreticalStats, createRng } from '../engine.js';

const started = performance.now();
const drawsPerSetting = 2000000;
const seed = 20261110;
const cost = 3;
const settings = [];

for (const model of MODELS) for (const setting of SETTINGS) {
  const rows = probabilities(setting, model);
  const random = createRng(seed);
  const thresholds = [];
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.probability;
    thresholds.push(cumulative);
  }
  const counts = new Array(rows.length).fill(0);
  let net = -drawsPerSetting * cost;
  for (let draw = 0; draw < drawsPerSetting; draw += 1) {
    const value = random();
    let index = 0;
    while (index < rows.length - 1 && value >= thresholds[index]) index += 1;
    counts[index] += 1;
    net += rows[index].payout;
  }
  const stats = theoreticalStats(setting, cost, model);
  const observedMean = net / drawsPerSetting;
  const standardError = stats.sd / Math.sqrt(drawsPerSetting);
  settings.push({
    model, setting, draws: drawsPerSetting, seed,
    theoreticalMean: stats.mean, observedMean, standardError,
    zScore: (observedMean - stats.mean) / standardError,
    modelReturnRate: stats.returnRate, referenceMachineReturnRate: stats.officialReturnRate,
    outcomes: rows.map((row, index) => ({ id: row.id, name: row.name,
      count: counts[index], observedProbability: counts[index] / drawsPerSetting,
      theoreticalProbability: row.probability })),
  });
}

console.log(JSON.stringify({
  method: '2モデル×6設定、それぞれ200万回。同じ乱数列を使い、モデル・設定差を比べます。モデル・設定間の検証結果は独立ではありません。',
  publishedModel: 'BB/RBと配当、ブドウ以外の小役は学生モデルと同じ。公表出玉率へ期待配当を合わせるため、ブドウ確率だけを逆算し、減った分をハズレへ加えます。補正値は公式のブドウ確率ではなく、実機の完全再現でもありません。',
  elapsedMilliseconds: performance.now() - started,
  totalDraws: MODELS.length * SETTINGS.length * drawsPerSetting,
  settings,
}, null, 2));
