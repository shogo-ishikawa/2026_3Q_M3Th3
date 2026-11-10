import { OUTCOMES, probabilities, expectedDelta, createSession, draw, compareSettings, theoreticalStats, simulateDistribution, tailEstimate, moneyComparison } from './engine.js';

const $ = selector => document.querySelector(selector);
const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
const fineNumber = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const percentage = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
const signed = (value, formatter = nf) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${formatter.format(Math.abs(value))}`;
const colourClass = value => value > 0 ? 'positive' : value < 0 ? 'negative' : '';
const STORAGE_KEY = 'lottery-lab-v1';
const COLOURS = ['#8a9d91', '#a77c65', '#8486ad', '#39949b', '#d49b35', '#245d56'];
const modelName = model => model === 'published' ? '公式値に合わせたモデル' : '学生の簡略モデル';
let session = createSession({ setting: Number($('#setting').value), model: $('#model-select').value });
let sessionRecorded = false;
let busy = false;
let analysisBusy = false;
let latestAnalysis = null;
let pendingSpin = null;
let sound = false;
let audioContext;
let collection = Object.fromEntries(OUTCOMES.filter(row => row.id !== 'miss').map(row => [row.id, 0]));
let previous = [];

// 保存するのは役の発見数と直近の集計だけ。名前や外部サービスは使いません。
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    for (const id of Object.keys(collection)) {
      if (Number.isSafeInteger(saved.collection?.[id]) && saved.collection[id] >= 0) collection[id] = saved.collection[id];
    }
    if (Array.isArray(saved.previous)) {
      previous = saved.previous.filter(row => row && Number.isInteger(row.setting) && row.setting >= 1 && row.setting <= 6
        && Number.isInteger(row.games) && row.games > 0 && row.games <= 1000
        && Number.isSafeInteger(row.net) && Number.isSafeInteger(row.seed)
        && Number.isInteger(row.bonus) && row.bonus >= 0
        && (row.model === undefined || ['student', 'published'].includes(row.model)))
        .slice(0, 5).map(row => ({ ...row, model: row.model ?? 'student' }));
    }
  }
} catch {
  $('#storage-note').textContent = 'このブラウザでは記録を保存できません。遊ぶことはできます。';
}

function saveRecords() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ collection, previous })); }
  catch { $('#storage-note').textContent = '記録を保存できませんでした。この画面では続けて遊べます。'; }
}

function drawChart(element, series, { width = 500, height = 235, maxGames, description }) {
  const margin = { left: 51, right: 15, top: 17, bottom: 32 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  let low = Infinity, high = -Infinity;
  for (const row of series) for (const value of row.values) { low = Math.min(low, value); high = Math.max(high, value); }
  const pad = Math.max(12, (high - low) * .12);
  low = Math.floor((low - pad) / 10) * 10;
  high = Math.ceil((high + pad) / 10) * 10;
  const x = index => margin.left + index / maxGames * plotW;
  const y = value => margin.top + (high - value) / (high - low) * plotH;
  let content = `<title>${description}</title><desc>横軸はくじの回数、縦軸は所持ポイントです。</desc>`;
  for (let step = 0; step <= 4; step++) {
    const value = low + (high - low) * step / 4;
    const at = y(value);
    content += `<line x1="${margin.left}" y1="${at}" x2="${width - margin.right}" y2="${at}" stroke="#e4e7dc"/><text x="${margin.left - 9}" y="${at + 4}" text-anchor="end" fill="#7c877c" font-size="11">${nf.format(value)}</text>`;
  }
  for (let step = 0; step <= 4; step++) {
    const value = Math.round(maxGames * step / 4);
    content += `<text x="${x(value)}" y="${height - 10}" text-anchor="middle" fill="#7c877c" font-size="11">${value}${step === 4 ? '回' : ''}</text>`;
  }
  // 5000点でも画面上では600点程度へ間引き、末尾は必ず残します。
  for (const row of series) {
    const stride = Math.max(1, Math.floor(row.values.length / 600));
    const points = [];
    row.values.forEach((value, index) => {
      if (index % stride === 0 || index === row.values.length - 1) points.push(`${x(index).toFixed(2)},${y(value).toFixed(2)}`);
    });
    content += `<polyline fill="none" stroke="${row.colour}" stroke-width="${row.dashed ? 1.8 : 2.3}" ${row.dashed ? 'stroke-dasharray="5 5"' : ''} stroke-linejoin="round" stroke-linecap="round" points="${points.join(' ')}"/>`;
    if (!row.dashed) content += `<circle cx="${x(row.values.length - 1)}" cy="${y(row.values.at(-1))}" r="3.3" fill="${row.colour}"/>`;
  }
  element.innerHTML = content;
}

function resetAnalysis() {
  latestAnalysis = null;
  $('#risk-results').hidden = true;
  $('#analysis-status').textContent = '何回か回したら、同じモデル・設定・回数の結果と比べてみましょう。';
}

function renderReflection() {
  const net = session.balance - session.initialPoints;
  const stats = theoreticalStats(session.setting, session.cost, session.model);
  const expected = stats.mean * session.games;
  const money = moneyComparison(net, Number($('#yen-per-point').value));
  $('#expected-net').textContent = `${signed(expected)} pt`;
  $('#expectation-gap').textContent = `${signed(net - expected)} pt`;
  $('#yen-net').textContent = `${signed(money.yenNet)} 円`;
  $('#yen-net').className = colourClass(money.yenNet);
  $('#model-return').textContent = `${percentage.format(stats.returnRate * 100)}%`;
  $('#official-return').textContent = `${percentage.format(stats.officialReturnRate * 100)}%`;
  $('#model-description').textContent = session.model === 'published'
    ? 'BIG・REG確率と理論出玉率をメーカー公表値に合わせたモデルです。公表表にない小役は仮定し、ブドウ確率だけを調整しています。実機の結果分布やリールの完全再現ではありません。'
    : '学生作品の確率と配当を使う簡略モデルです。BIG・REG確率はメーカー公表表と一致しますが、小役を含む全体の出玉率は実機と異なります。';
  if (money.lossYen > 0) {
    $('#money-note').textContent = `差し引きの損失は、仮の換算で${nf.format(money.lossYen)}円です。使わずに残していれば、例えば次の予算に充てられました。`;
    const affordable = money.examples.filter(row => row.count > 0);
    $('#loss-examples').innerHTML = affordable.length
      ? affordable.map(row => `<article class="budget-card"><strong>${row.name}なら ${nf.format(row.count)} 回分</strong><span>1回 ${nf.format(row.price)} 円の予算例</span></article>`).join('')
      : '<p class="empty-note">少額でも使えば手元から減ります。買い物例は800円の昼食予算から表示します。</p>';
  } else {
    $('#money-note').textContent = session.games
      ? '今回は差し引きで損失が出ていません。プラスでも、それが次回の結果を保証するわけではありません。'
      : '金額は仮の換算です。実際の現金の出入りや交換額ではありません。';
    $('#loss-examples').innerHTML = '<p class="empty-note">収支がマイナスになったら、同じ金額のほかの使い道を表示します。</p>';
  }
}

function drawDistribution(sample, observed, expected) {
  const narrow = matchMedia('(max-width: 650px)').matches;
  const width = narrow ? 520 : 900, height = 250;
  $('#distribution-chart').setAttribute('viewBox', `0 0 ${width} ${height}`);
  const fontSize = narrow ? 18 : 14;
  const margin = { left: 53, right: 24, top: 40, bottom: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const min = Math.min(sample.sortedNets[0], observed, expected);
  const max = Math.max(sample.sortedNets.at(-1), observed, expected);
  const padding = Math.max(1, (max - min) * .03);
  const low = min - padding, high = max + padding;
  const bins = new Array(30).fill(0);
  for (const value of sample.nets) {
    const index = Math.min(bins.length - 1, Math.floor((value - low) / (high - low) * bins.length));
    bins[index]++;
  }
  const peak = Math.max(...bins) / sample.runs;
  const x = value => margin.left + (value - low) / (high - low) * plotWidth;
  const y = value => margin.top + plotHeight * (1 - value / peak);
  let content = '<title>同条件で繰り返した収支の分布</title><desc>横軸は収支、縦軸は比較した試行の割合。橙線は今回、緑の点線は理論平均です。</desc>';
  content += `<rect x="${x(sample.lower95)}" y="${margin.top}" width="${x(sample.upper95) - x(sample.lower95)}" height="${plotHeight}" fill="#e2e9d9"/>`;
  for (let i = 0; i <= 3; i++) {
    const proportion = peak * i / 3;
    content += `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(proportion)}" y2="${y(proportion)}" stroke="#d6ddce"/><text x="${margin.left - 9}" y="${y(proportion) + 4}" text-anchor="end" fill="#647764" font-size="${fontSize}">${percentage.format(proportion * 100)}%</text>`;
  }
  bins.forEach((count, index) => {
    const barWidth = plotWidth / bins.length;
    content += `<rect x="${margin.left + index * barWidth + 1}" y="${y(count / sample.runs)}" width="${barWidth - 2}" height="${plotHeight * count / sample.runs / peak}" fill="#71977b"/>`;
  });
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    content += `<text x="${x(value)}" y="${height - 13}" text-anchor="middle" fill="#647764" font-size="${fontSize}">${nf.format(Math.round(value))}</text>`;
  }
  content += `<line x1="${x(expected)}" x2="${x(expected)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#1c574d" stroke-width="2" stroke-dasharray="5 4"/><text x="${x(expected)}" y="14" text-anchor="middle" fill="#245d56" font-size="14">理論平均</text>`;
  content += `<line x1="${x(observed)}" x2="${x(observed)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#c2633d" stroke-width="3"/><text x="${x(observed)}" y="31" text-anchor="middle" fill="#ab4e2b" font-size="14">今回</text>`;
  $('#distribution-chart').innerHTML = content;
}

async function analyseResult() {
  if (busy || analysisBusy || !session.games) return;
  analysisBusy = true;
  renderSession();
  const snapshot = { model: session.model, setting: session.setting, games: session.games,
    cost: session.cost, net: session.balance - session.initialPoints };
  $('#analysis-status').textContent = '同じモデル・設定・回数で5000試行を比較しています…';
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const seed = createSession().seed;
    const sample = simulateDistribution({ ...snapshot, runs: 5000, seed });
    const tail = tailEstimate(sample, snapshot.net);
    latestAnalysis = { ...snapshot, sample, tail };
    $('#risk-results').hidden = false;
    $('#tail-heading').textContent = snapshot.net >= 0 ? '今回以上の収支になった割合' : '今回以下の収支になった割合';
    $('#tail-estimate').textContent = tail.count ? `推定 ${percentage.format(tail.probability * 100)}%` : '5000試行中 0回';
    const frequency = tail.count >= 5 ? `約${nf.format(tail.oneIn)}試行に1回の割合です。` : '';
    $('#tail-note').textContent = `${modelName(snapshot.model)}・設定${snapshot.setting}で${nf.format(snapshot.games)}回ずつ試したところ、5000試行中${nf.format(tail.count)}試行でした。${frequency}${tail.count === 0 ? '今回見つからなくても、起きる確率が0という意味ではありません。' : tail.count < 5 ? '発生件数が少ないため、この推定は特に不安定です。' : ''}`;
    $('#tail-interval').textContent = `推定割合の95%信頼区間（Wilson法）：${percentage.format(tail.lower95 * 100)}〜${percentage.format(tail.upper95 * 100)}%。`;
    const expected = snapshot.games * theoreticalStats(snapshot.setting, snapshot.cost, snapshot.model).mean;
    drawDistribution(sample, snapshot.net, expected);
    $('#analysis-range').textContent = `${signed(sample.lower95)} 〜 ${signed(sample.upper95)} pt`;
    $('#distribution-caption').textContent = '横軸：収支（pt）／縦軸：各範囲の試行割合。薄緑は試行結果の中央95%。平均の信頼区間とは別です。';
    $('#analysis-status').textContent = `${nf.format(snapshot.games)}回 × 5000試行を比較しました。ゲームの回数や残高には加算していません。`;
  } catch (error) {
    latestAnalysis = null;
    $('#risk-results').hidden = true;
    $('#analysis-status').textContent = `比較できませんでした。${error.message}`;
  } finally {
    analysisBusy = false;
    renderSession();
  }
}

function renderCollection() {
  const found = Object.values(collection).filter(count => count > 0).length;
  $('#collection-count').textContent = `${found} / 7`;
  $('#collection').innerHTML = OUTCOMES.filter(row => row.id !== 'miss').map(row => {
    const count = collection[row.id];
    return `<div class="collection-card ${count ? '' : 'locked'}" aria-label="${row.name} ${count ? `発見済み 累計${count}回` : 'まだ出ていません'}"><span class="collect-icon" aria-hidden="true">${row.icon}</span><b>${row.name}</b><small>${count ? `累計 ${nf.format(count)} 回` : 'まだ出ていません'}</small>${count ? '<span class="found-check" aria-hidden="true">✓</span>' : ''}</div>`;
  }).join('');
}

function renderPrevious() {
  $('#previous-runs').innerHTML = previous.length ? previous.map(row => `<article class="previous-run"><p>${modelName(row.model)}</p><p>設定${row.setting} · ${row.games}回</p><b class="${colourClass(row.net)}">${signed(row.net)} <small style="display:inline">pt</small></b><small>BIG / REG 合計${row.bonus}回</small></article>`).join('') : '<p class="empty-note">「新しく始める」で、今の結果がここに残ります。</p>';
}

function renderSession() {
  const net = session.balance - session.initialPoints;
  $('#balance').textContent = nf.format(session.balance);
  $('#net').textContent = `${signed(net)} pt`;
  $('#net').className = colourClass(net);
  $('#game-count').textContent = nf.format(session.games);
  $('#big-count').textContent = session.counts.BIG;
  $('#reg-count').textContent = session.counts.REG;
  $('#game-progress').value = session.games;
  const done = session.games === session.targetGames;
  $('#progress-message').textContent = done ? '1000回、完走！' : `あと${nf.format(session.targetGames - session.games)}回`;
  $('#seed-label').textContent = `今回の乱数の種：${session.seed}`;
  $('#draw-one span').textContent = done ? 'もう一度試す' : '1回回す';
  const blocked = busy || analysisBusy;
  for (const button of document.querySelectorAll('.draw-button')) button.disabled = blocked || (done && button.id !== 'draw-one');
  $('#draw-rest').disabled = blocked || done;
  $('#export-csv').disabled = blocked || !session.games;
  $('#setting').disabled = blocked;
  $('#model-select').disabled = blocked;
  $('#new-round').disabled = blocked;
  $('#analyse-result').disabled = blocked || !session.games;
  const delta = expectedDelta(session.setting, session.cost, session.model);
  drawChart($('#history-chart'), [
    { values: session.history.map((_, index) => session.initialPoints + delta * index), colour: '#a6b0a1', dashed: true },
    { values: session.history, colour: '#245d56' },
  ], { maxGames: Math.max(50, session.games), description: `設定${session.setting}、${session.games}回。所持${session.balance}ポイント、収支${signed(net)}ポイント。` });
  $('#probability-table caption').textContent = `${modelName(session.model)}・設定${session.setting} · 理論上の1回あたりの平均収支 ${signed(delta, fineNumber)} pt`;
  $('#probability-table tbody').innerHTML = probabilities(session.setting, session.model).map(row => `<tr><td>${row.name}${row.id === 'grape' && session.model === 'published' ? '（補正値）' : ''}</td><td>${nf.format(row.probability * 100)}%${row.id !== 'miss' ? `（約1/${nf.format(1 / row.probability)}）` : ''}</td><td>${row.payout} pt</td><td>${session.counts[row.id]} 回</td></tr>`).join('');
  renderReflection();
}

function archiveSession() {
  if (session.games && !sessionRecorded) {
    previous.unshift({ model: session.model, setting: session.setting, games: session.games, net: session.balance - session.initialPoints, seed: session.seed, bonus: session.counts.BIG + session.counts.REG });
    previous = previous.slice(0, 5);
    sessionRecorded = true;
    saveRecords();
  }
}

function newRound() {
  if (busy || analysisBusy) return;
  const nextModel = $('#model-select').value;
  if (nextModel !== session.model) {
    $('#comparison-results').hidden = true;
    $('#comparison-status').textContent = 'モデルを切り替えました。選んだモデルでもう一度比較できます。';
  }
  archiveSession();
  session = createSession({ setting: Number($('#setting').value), model: nextModel });
  sessionRecorded = false;
  resetAnalysis();
  $('#ticket').dataset.result = 'ready';
  $('#ticket').classList.remove('drawing', 'celebrate');
  $('#ticket-serial').textContent = 'DRAW / 0000';
  $('#result-icon').textContent = '?';
  $('#result-name').textContent = 'リールを回してみよう';
  $('#result-detail').textContent = '1回 3 pt · 当選するとポイント獲得';
  $('#batch-note').textContent = '新しい実験です。同じモデル・設定でも結果は変わります。';
  for (let index = 0; index < 3; index++) {
    $(`#reel-${index}`).textContent = ['7', '🍇', '🔔'][index];
    $(`#stop-reel-${index}`).disabled = true;
  }
  setBonusLamp(false);
  renderSession();
  renderPrevious();
}

function setBonusLamp(lit) {
  $('#bonus-lamp').classList.toggle('lit', lit);
  $('#bonus-lamp').dataset.lit = String(lit);
  $('#bonus-lamp').setAttribute('aria-label', lit ? 'ボーナス当選' : 'ボーナス未当選');
}

function stopReel(index) {
  if (!pendingSpin || pendingSpin.stopped.has(index)) return;
  const spin = pendingSpin;
  spin.stopped.add(index);
  $(`#reel-${index}`).classList.remove('rolling');
  $(`#reel-${index}`).textContent = spin.symbols[index];
  $(`#stop-reel-${index}`).disabled = true;
  if (spin.stopped.size === 3) {
    pendingSpin = null;
    spin.resolve();
  }
}

function animateReels(outcome) {
  const symbols = {
    BIG: ['7', '7', '7'], REG: ['BAR', 'BAR', 'BAR'],
    grape: ['🍇', '🍇', '🍇'], cherry: ['🍒', '🍒', '🍒'],
    replay: ['↻', '↻', '↻'], bell: ['🔔', '🔔', '🔔'],
    clown: ['🃏', '🃏', '🃏'], miss: ['🍇', '🔔', '↻'],
  }[outcome.id];
  setBonusLamp(false);
  return new Promise(resolve => {
    const spin = { symbols, stopped: new Set(), resolve };
    pendingSpin = spin;
    for (let index = 0; index < 3; index++) {
      $(`#reel-${index}`).classList.add('rolling');
      $(`#reel-${index}`).textContent = '✳';
      $(`#stop-reel-${index}`).disabled = false;
      // STOPは決定済みの結果を表示するだけ。抽選し直さず、連打でも1回です。
      setTimeout(() => {
        if (pendingSpin === spin) stopReel(index);
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420 + index * 240);
    }
  });
}

async function chime(bonus) {
  if (!sound) return;
  try {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    audioContext ||= new Constructor();
    await audioContext.resume();
    const notes = bonus ? [523.25, 659.25, 783.99] : [440];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = audioContext.currentTime + index * .1;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.045, start + .01);
      gain.gain.exponentialRampToValueAtTime(.001, start + .18);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + .2);
    });
  } catch {
    sound = false;
    $('#sound-toggle').textContent = '音：オフ';
    $('#sound-toggle').setAttribute('aria-pressed', 'false');
    $('#storage-note').textContent = 'このブラウザでは効果音を使えません。';
  }
}

async function play(count) {
  if (busy || analysisBusy) return;
  if (session.games === session.targetGames) { newRound(); return; }
  busy = true;
  resetAnalysis();
  renderSession();
  $('#ticket').classList.remove('drawing', 'celebrate');
  $('#result-icon').textContent = '✳';
  $('#result-name').textContent = 'リール回転中';
  $('#result-detail').textContent = '自動で止まります。STOPでも止められます。';
  const results = draw(session, count);
  const shown = results.at(-1);
  await animateReels(shown);
  const counts = Object.fromEntries(OUTCOMES.map(row => [row.id, 0]));
  const discoveries = [];
  for (const result of results) {
    counts[result.id]++;
    if (result.id !== 'miss') {
      if (!collection[result.id]) discoveries.push(result.name);
      collection[result.id]++;
    }
  }
  const outcome = OUTCOMES.find(row => row.id === shown.id);
  $('#ticket').dataset.result = shown.id;
  $('#ticket-serial').textContent = `DRAW / ${String(shown.game).padStart(4, '0')}`;
  $('#result-icon').textContent = outcome.icon;
  $('#result-name').textContent = shown.name;
  $('#result-detail').textContent = shown.id === 'miss' ? '今回の獲得は 0 pt（消費 3 pt）' : `今回の獲得 ${shown.payout} pt（消費 3 pt）`;
  $('#ticket').classList.add('drawing');
  const bonus = ['BIG', 'REG'].includes(shown.id);
  setBonusLamp(bonus);
  void chime(bonus);
  const parts = OUTCOMES.filter(row => row.id !== 'miss' && counts[row.id]).map(row => `${row.name}×${counts[row.id]}`);
  const done = session.games === session.targetGames;
  let note = results.length === 1 ? `${session.games}回目の結果です。` : `${results.length}回分：${parts.length ? parts.join(' / ') : 'すべてハズレ'}。リールは最後の1回を表示しています。`;
  if (discoveries.length) note += ` ${discoveries.join('・')}を初めて発見！`;
  if (done) note += ` 1000回の実験が終わりました。収支は${signed(session.balance - session.initialPoints)} ptです。下の分析で比べられます。`;
  $('#batch-note').textContent = note;
  busy = false;
  if (done) archiveSession();
  saveRecords();
  renderSession();
  renderCollection();
  renderPrevious();
}

for (const button of document.querySelectorAll('[data-draw]')) button.addEventListener('click', () => void play(Number(button.dataset.draw)));
$('#draw-rest').addEventListener('click', () => void play(session.targetGames - session.games));
$('#new-round').addEventListener('click', newRound);
$('#setting').addEventListener('change', newRound);
$('#model-select').addEventListener('change', newRound);
$('#yen-per-point').addEventListener('change', renderReflection);
$('#analyse-result').addEventListener('click', () => void analyseResult());
for (let index = 0; index < 3; index++) $(`#stop-reel-${index}`).addEventListener('click', () => stopReel(index));
$('#sound-toggle').addEventListener('click', () => {
  sound = !sound;
  $('#sound-toggle').textContent = `音：${sound ? 'オン' : 'オフ'}`;
  $('#sound-toggle').setAttribute('aria-pressed', String(sound));
  if (sound) void chime(false);
});

for (const name of ['play', 'compare']) {
  $(`#${name}-tab`).addEventListener('click', () => {
    for (const view of ['play', 'compare']) {
      $(`#${view}-tab`).classList.toggle('active', view === name);
      $(`#${view}-tab`).setAttribute('aria-pressed', String(view === name));
      $(`#${view}-view`).hidden = view !== name;
    }
  });
}

$('#comparison-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#compare-button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '比べています…';
  const games = Number($('#compare-games').value);
  const runs = Number($('#compare-runs').value);
  const model = session.model;
  $('#comparison-status').textContent = `各設定で${nf.format(games)}回のくじを${runs}試行ずつ引いています…`;
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const seed = createSession().seed;
    const rows = compareSettings({ games, runs, seed, model });
    if (model !== session.model) return;
    $('#comparison-results').hidden = false;
    $('#comparison-model-note').textContent = `${modelName(model)}で比べています。モデルは「回してみる」画面で切り替えられます。`;
    drawChart($('#comparison-chart'), rows.map((row, index) => ({ values: row.meanHistory, colour: COLOURS[index] })), { width: 900, height: 300, maxGames: games, description: `${games}回を${runs}試行ずつ行った全設定の平均ポイント` });
    $('#comparison-legend').innerHTML = rows.map((row, index) => `<span><i class="legend-line" style="border-color:${COLOURS[index]}"></i>設定${row.setting}</span>`).join('');
    $('#comparison-body').innerHTML = rows.map(row => `<tr><td>設定 ${row.setting}</td><td class="${colourClass(row.meanNet)}">${signed(row.meanNet)}</td><td>${signed(row.minNet)} 〜 ${signed(row.maxNet)}</td><td>${nf.format(row.positiveRate * 100)}%</td><td>${signed(row.expectedNet)}</td></tr>`).join('');
    $('#comparison-status').textContent = `${nf.format(games)}回 × ${runs}試行 × 6設定を実験しました。乱数の種：${seed}`;
  } catch (error) { $('#comparison-status').textContent = error.message; }
  finally {
    button.disabled = false;
    button.textContent = 'もう一度比べる ↗';
  }
});

$('#export-csv').addEventListener('click', () => {
  if (!session.games) return;
  const rows = [['model', 'setting', 'seed', 'game', 'balance', 'net'], ...session.history.map((balance, game) => [session.model, session.setting, session.seed, game, balance, balance - session.initialPoints])];
  const blob = new Blob(['\ufeff', rows.map(row => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lottery-${session.model}-setting${session.setting}-${session.seed}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#clear-records').addEventListener('click', () => {
  if (!confirm('コレクションと前のチャレンジの記録を消しますか？ 今回のくじはそのまま続けられます。')) return;
  for (const id of Object.keys(collection)) collection[id] = 0;
  previous = [];
  saveRecords();
  renderCollection();
  renderPrevious();
  $('#storage-note').textContent = '保存した記録を消しました。';
});

renderSession();
renderCollection();
renderPrevious();
