import { OUTCOMES, probabilities, expectedDelta, createSession, draw, compareSettings } from './engine.js';

const $ = selector => document.querySelector(selector);
const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
const fineNumber = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const signed = (value, formatter = nf) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${formatter.format(Math.abs(value))}`;
const colourClass = value => value > 0 ? 'positive' : value < 0 ? 'negative' : '';
const STORAGE_KEY = 'lottery-lab-v1';
const COLOURS = ['#8a9d91', '#a77c65', '#8486ad', '#39949b', '#d49b35', '#245d56'];
let session = createSession();
let sessionRecorded = false;
let busy = false;
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
        && Number.isInteger(row.bonus) && row.bonus >= 0).slice(0, 5);
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

function renderCollection() {
  const found = Object.values(collection).filter(count => count > 0).length;
  $('#collection-count').textContent = `${found} / 7`;
  $('#collection').innerHTML = OUTCOMES.filter(row => row.id !== 'miss').map(row => {
    const count = collection[row.id];
    return `<div class="collection-card ${count ? '' : 'locked'}" aria-label="${row.name} ${count ? `発見済み 累計${count}回` : 'まだ出ていません'}"><span class="collect-icon" aria-hidden="true">${row.icon}</span><b>${row.name}</b><small>${count ? `累計 ${nf.format(count)} 回` : 'まだ出ていません'}</small>${count ? '<span class="found-check" aria-hidden="true">✓</span>' : ''}</div>`;
  }).join('');
}

function renderPrevious() {
  $('#previous-runs').innerHTML = previous.length ? previous.map(row => `<article class="previous-run"><p>設定${row.setting} · ${row.games}回</p><b class="${colourClass(row.net)}">${signed(row.net)} <small style="display:inline">pt</small></b><small>BIG / REG 合計${row.bonus}回</small></article>`).join('') : '<p class="empty-note">「新しく始める」で、今の結果がここに残ります。</p>';
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
  $('#draw-one span').textContent = done ? 'もう一度遊ぶ' : 'くじを引く';
  for (const button of document.querySelectorAll('.draw-button')) button.disabled = busy || (done && button.id !== 'draw-one');
  $('#draw-rest').disabled = busy || done;
  $('#export-csv').disabled = busy || !session.games;
  $('#setting').disabled = busy;
  $('#new-round').disabled = busy;
  const delta = expectedDelta(session.setting, session.cost);
  drawChart($('#history-chart'), [
    { values: session.history.map((_, index) => session.initialPoints + delta * index), colour: '#a6b0a1', dashed: true },
    { values: session.history, colour: '#245d56' },
  ], { maxGames: Math.max(50, session.games), description: `設定${session.setting}、${session.games}回。所持${session.balance}ポイント、収支${signed(net)}ポイント。` });
  $('#probability-table caption').textContent = `設定${session.setting} · 理論上の1回あたりの平均収支 ${signed(delta, fineNumber)} pt`;
  $('#probability-table tbody').innerHTML = probabilities(session.setting).map(row => `<tr><td>${row.name}</td><td>${nf.format(row.probability * 100)}%${row.id !== 'miss' ? `（約1/${nf.format(1 / row.probability)}）` : ''}</td><td>${row.payout} pt</td><td>${session.counts[row.id]} 回</td></tr>`).join('');
}

function archiveSession() {
  if (session.games && !sessionRecorded) {
    previous.unshift({ setting: session.setting, games: session.games, net: session.balance - session.initialPoints, seed: session.seed, bonus: session.counts.BIG + session.counts.REG });
    previous = previous.slice(0, 5);
    sessionRecorded = true;
    saveRecords();
  }
}

function newRound() {
  if (busy) return;
  archiveSession();
  session = createSession({ setting: Number($('#setting').value) });
  sessionRecorded = false;
  $('#ticket').dataset.result = 'ready';
  $('#ticket').classList.remove('drawing', 'celebrate');
  $('#ticket-serial').textContent = 'TICKET / 0000';
  $('#result-icon').textContent = '?';
  $('#result-name').textContent = '最初のくじを引こう';
  $('#result-detail').textContent = '1回 3 pt · 当選するとポイント獲得';
  $('#batch-note').textContent = '新しいチャレンジです。同じ設定でも結果は変わります。';
  renderSession();
  renderPrevious();
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const container = $('#confetti');
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty('--drift', `${Math.random() * 180 - 90}px`);
    piece.style.background = ['#e87950', '#f7c867', '#8aaf9d', '#eac4b2'][i % 4];
    piece.style.animationDelay = `${Math.random() * .25}s`;
    fragment.append(piece);
  }
  container.replaceChildren(fragment);
  setTimeout(() => container.replaceChildren(), 2300);
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
  if (busy) return;
  if (session.games === session.targetGames) { newRound(); return; }
  busy = true;
  renderSession();
  $('#ticket').classList.remove('drawing', 'celebrate');
  $('#result-icon').textContent = '✳';
  $('#result-name').textContent = 'くじを開いています';
  $('#result-detail').textContent = 'なにが出るかな…';
  await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260));
  const results = draw(session, count);
  const counts = Object.fromEntries(OUTCOMES.map(row => [row.id, 0]));
  const discoveries = [];
  for (const result of results) {
    counts[result.id]++;
    if (result.id !== 'miss') {
      if (!collection[result.id]) discoveries.push(result.name);
      collection[result.id]++;
    }
  }
  const best = results.reduce((choice, row) => row.payout > choice.payout ? row : choice, results.at(-1));
  const outcome = OUTCOMES.find(row => row.id === best.id);
  $('#ticket').dataset.result = best.id;
  $('#ticket-serial').textContent = `TICKET / ${String(best.game).padStart(4, '0')}`;
  $('#result-icon').textContent = outcome.icon;
  $('#result-name').textContent = best.id === 'BIG' ? 'BIG！' : best.name;
  $('#result-detail').textContent = best.id === 'miss' ? '今回は 0 pt。次のくじはどうかな？' : `${best.payout} pt 獲得！`;
  $('#ticket').classList.add('drawing');
  const bonus = counts.BIG + counts.REG > 0;
  if (bonus) { $('#ticket').classList.add('celebrate'); confetti(); }
  void chime(bonus);
  const parts = OUTCOMES.filter(row => row.id !== 'miss' && counts[row.id]).map(row => `${row.name}×${counts[row.id]}`);
  const done = session.games === session.targetGames;
  let note = results.length === 1 ? `${session.games}回目の結果です。` : `${results.length}回分：${parts.length ? parts.join(' / ') : 'すべてハズレ'}。表示は獲得ポイントが一番大きいくじです。`;
  if (discoveries.length) note += ` ${discoveries.join('・')}を初めて発見！`;
  if (done) note += ` 1000回達成！収支は${signed(session.balance - session.initialPoints)} ptでした。もう一度遊んでみましょう。`;
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
  $('#comparison-status').textContent = `各設定で${nf.format(games)}回のくじを${runs}試行ずつ引いています…`;
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const seed = createSession().seed;
    const rows = compareSettings({ games, runs, seed });
    $('#comparison-results').hidden = false;
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
  const rows = [['setting', 'seed', 'game', 'balance', 'net'], ...session.history.map((balance, game) => [session.setting, session.seed, game, balance, balance - session.initialPoints])];
  const blob = new Blob(['\ufeff', rows.map(row => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lottery-setting${session.setting}-${session.seed}.csv`;
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
