import {SETS, buildAlphabet, validatePassword, generatePassword, searchSpace} from './engine.js';
import {digestCandidate} from './worker.js';
import {detectGPU, runGPU} from './gpu.js';

const $ = id => document.getElementById(id);
const methodNames = {dictionary:'教材用の辞書', pattern:'よくある規則', brute:'総当たり'};
const controls = [...document.querySelectorAll('input, select, button')].filter(el => el.id !== 'stop' && el.id !== 'show-password');
let jobId = 0, worker = null, aborter = null, active = false;
let generatedAlphabet = null, current = null, results = [];

export function formatCount(value) {
  const n = BigInt(value);
  return n < 1000000000000n ? n.toLocaleString('ja-JP') : Number(n).toExponential(2).replace('e+', ' × 10^');
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '計測できませんでした';
  if (seconds < 0.001) return '0.001秒未満';
  if (seconds < 1) return `${seconds.toFixed(3)}秒`;
  if (seconds < 60) return `約${seconds.toFixed(1)}秒`;
  if (seconds < 3600) return `約${(seconds / 60).toFixed(1)}分`;
  if (seconds < 86400) return `約${(seconds / 3600).toFixed(1)}時間`;
  if (seconds < 31557600) return `約${(seconds / 86400).toFixed(1)}日`;
  const years = seconds / 31557600;
  return years < 1e6 ? `約${years.toLocaleString('ja-JP', {maximumFractionDigits:1})}年` : `約${years.toExponential(2)}年`;
}
function inferredAlphabet(password) {
  const groups = Object.keys(SETS).filter(key => [...password].some(c => SETS[key].includes(c)));
  return groups.length ? buildAlphabet(groups) : '';
}
function assumptionText(password, alphabet) {
  return `文字数${password.length}・使える文字${alphabet.length}種類が既知として探索します。${generatedAlphabet ? '生成時に選んだ文字集合' : '入力に含まれる文字種の集合'}を使用します。`;
}
function updateAssumptions() {
  const password = $('password').value;
  const alphabet = generatedAlphabet || inferredAlphabet(password);
  $('assumptions').textContent = !password ? 'パスワードを入力するか、自動生成してください。' : /^[!-~]{1,32}$/.test(password) ? assumptionText(password, alphabet) : 'この教材の対象は、空白を除く半角英数字・記号の1〜32文字です。';
}
function setActive(value) {
  active = value;
  controls.forEach(el => { el.disabled = value; });
  $('stop').disabled = !value;
  $('run').textContent = value ? '照合しています…' : '試してみる';
}
function clearResults() {
  current = null;
  results = [];
  $('results').replaceChildren();
  $('sensitivity').replaceChildren();
  $('verdict').textContent = 'まずは、試してみよう';
  $('verdict').dataset.level = 'neutral';
  $('result-summary').textContent = '実際に照合した結果と、条件付きの推定を分けて表示します。';
  for (const id of ['space-value','average-time','worst-time','cpu-rate']) $(id).textContent = '—';
  $('status').textContent = '';
  $('error').textContent = '';
  $('progress-area').hidden = true;
}
function invalidate() { if (!active) { clearResults(); updateAssumptions(); } }
function addRow(result, hardware = 'CPU') {
  results.push({...result, hardware});
  const row = document.createElement('tr');
  const status = {found:'発見', budget:'上限で停止・未発見', exhausted:result.method === 'brute' ? '全候補を照合・未発見' : 'リスト内に一致なし', unavailable:'利用できません', cancelled:'停止'}[result.status] || '未実行';
  for (const value of [methodNames[result.method] || result.method, hardware, result.attempts?.toLocaleString('ja-JP') ?? '—', status, result.status === 'unavailable' || result.elapsedMs == null ? '—' : formatTime(result.elapsedMs / 1000)]) {
    const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
  }
  if (result.status === 'found') row.className = 'found-row';
  $('results').append(row);
  updateVerdict();
}
function updateVerdict() {
  const found = results.filter(r => r.status === 'found').sort((a,b) => a.elapsedMs - b.elapsedMs)[0];
  if (found) {
    $('verdict').textContent = '要注意：教材内で見つかりました';
    $('verdict').dataset.level = 'caution';
    const matches = results.filter(r => r.status === 'found');
    const least = matches.reduce((a,b) => a.attempts <= b.attempts ? a : b);
    $('result-summary').textContent = `発見した方式：${matches.map(r => `${methodNames[r.method]}・${r.hardware}`).join('、')}。最少の照合数は${least.attempts.toLocaleString('ja-JP')}候補です。実測時間は下の表で比べられます。`;
  } else {
    $('verdict').textContent = active ? '探索しています' : '今回は見つかりませんでした';
    $('verdict').dataset.level = 'neutral';
    $('result-summary').textContent = '短い試行で見つからなくても、安全の証明にはなりません。辞書や規則は教材用の小さなリストです。';
  }
}
function showEstimates(rate) {
  if (!current || !(rate > 0)) return;
  const n = searchSpace(current.alphabet, current.length);
  $('space-value').textContent = `${formatCount(n)}通り`;
  $('average-time').textContent = formatTime((Number(n) + 1) / 2 / rate);
  $('worst-time').textContent = formatTime(Number(n) / rate);
  $('cpu-rate').textContent = `約${Math.round(rate).toLocaleString('ja-JP')}候補/秒`;
  $('sensitivity').replaceChildren();
  for (const length of [...new Set([4,8,12,16,current.length,Math.min(32,current.length+1)])].sort((a,b) => a-b)) {
    const space = searchSpace(current.alphabet, length);
    const row = document.createElement('tr');
    if (length === current.length) row.className = 'current-length';
    for (const value of [`${length}文字${length === current.length ? '（今回）' : ''}`, formatCount(space), formatTime((Number(space) + 1) / 2 / rate)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    $('sensitivity').append(row);
  }
}
function finish() {
  worker?.terminate(); worker = null;
  setActive(false);
  $('status').textContent = '実験が終わりました。文字数や作り方を変えて比べてみましょう。';
  $('progress-area').hidden = true;
  updateVerdict();
}
async function gpuStage(id, options) {
  if (id !== jobId) return;
  if (!$('use-gpu').checked || options.mode !== 'sha256') { finish(); return; }
  $('status').textContent = 'WebGPUで同じ総当たりを試しています。初回の準備には時間がかかる場合があります。';
  aborter = new AbortController();
  const result = await runGPU({...options, signal:aborter.signal, onProgress: p => {
    if (id === jobId) $('progress-text').textContent = `WebGPU：${p.attempts.toLocaleString('ja-JP')}候補を照合`;
  }});
  if (id !== jobId) return;
  addRow({...result, method:'brute'}, result.label || 'WebGPU');
  if (result.status === 'unavailable') $('gpu-status').textContent = 'WebGPUは利用できませんでした。CPUの結果はそのまま確認できます。';
  finish();
}
async function run() {
  clearResults();
  const password = $('password').value;
  if (!password) { $('error').textContent = '練習用パスワードを入力するか、自動生成してください。'; return; }
  if (!/^[!-~]{1,32}$/.test(password)) { $('error').textContent = 'この教材では空白を除く半角英数字・記号の1〜32文字を使います。'; return; }
  const alphabet = generatedAlphabet || inferredAlphabet(password);
  const check = validatePassword(password, alphabet);
  if (!check.ok) { $('error').textContent = check.error; return; }
  if (!crypto.subtle && $('hash-mode').value === 'pbkdf2') { $('error').textContent = 'PBKDF2はHTTPSで開いてください。'; return; }
  const id = ++jobId;
  setActive(true);
  $('progress-area').hidden = false;
  $('search-progress').removeAttribute('value');
  $('status').textContent = 'この端末の照合速度を計測しています。';
  $('progress-text').textContent = '計測用の候補を照合中';
  try {
    const salt = generatePassword(8, SETS.digits + SETS.lower + SETS.upper);
    const options = {alphabet, length:password.length, salt, mode:$('hash-mode').value, timeLimitMs:Number($('budget').value), maxAttempts:1000000};
    current = {...options};
    options.targetHash = await digestCandidate(password, salt, options.mode);
    if (id !== jobId) return;
    worker = new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
    worker.onmessage = ({data}) => {
      if (data.jobId !== jobId) return;
      if (data.type === 'calibration') showEstimates(data.result.rate);
      if (data.type === 'start') $('status').textContent = `${methodNames[data.method]}をCPUで試しています。`;
      if (data.type === 'progress') $('progress-text').textContent = `${methodNames[data.method]}：${data.attempts.toLocaleString('ja-JP')}候補を照合`;
      if (data.type === 'result') addRow(data.result);
      if (data.type === 'done') { worker?.terminate(); worker = null; gpuStage(id, options).catch(error => fail(id, error)); }
      if (data.type === 'error') fail(id, new Error(data.message));
    };
    worker.onerror = event => {
      console.error('CPU Worker:', event.message, event.filename, event.lineno);
      fail(id, new Error('探索を開始できませんでした。PagesまたはローカルのHTTPサーバーで開き直してください。'));
    };
    worker.postMessage({jobId:id, options});
  } catch (error) { fail(id, error); }
}
function fail(id, error) {
  if (id !== jobId) return;
  worker?.terminate(); worker = null; aborter?.abort();
  setActive(false); $('progress-area').hidden = true;
  $('error').textContent = error.message || '実行できませんでした。';
  $('status').textContent = '実験を停止しました。条件を確認してもう一度試してください。';
}
$('run').addEventListener('click', run);
$('stop').addEventListener('click', () => {
  ++jobId; worker?.terminate(); worker = null; aborter?.abort();
  setActive(false); $('progress-area').hidden = true;
  $('status').textContent = '停止しました。完了した方式の結果だけ表示しています。';
  updateVerdict();
});
$('password').addEventListener('input', () => { generatedAlphabet = null; invalidate(); });
$('generate').addEventListener('click', () => {
  try {
    const groups = Object.keys(SETS).filter(key => $(`use-${key}`).checked);
    const alphabet = buildAlphabet(groups);
    $('password').value = generatePassword(Number($('length').value), alphabet);
    generatedAlphabet = alphabet; invalidate();
    $('status').textContent = '生成しました。選んだ集合から各文字を均等に選びます。すべての種類を必ず含む方式ではありません。';
  } catch (error) { $('error').textContent = error.message; }
});
$('show-password').addEventListener('click', () => {
  const show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password';
  $('show-password').textContent = show ? '隠す' : '表示'; $('show-password').setAttribute('aria-pressed', String(show));
});
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.demo;
  generatedAlphabet = key === 'random' ? buildAlphabet(['digits','lower','upper','symbols']) : null;
  $('password').value = key === 'digits' ? '123456' : key === 'word' ? 'Password123!' : generatePassword(12, generatedAlphabet);
  invalidate();
}));
for (const id of ['length','use-digits','use-lower','use-upper','use-symbols','hash-mode','budget','use-gpu']) $(id).addEventListener('change', invalidate);
$('hash-mode').addEventListener('change', () => {
  $('gpu-status').textContent = $('hash-mode').value === 'pbkdf2' ? 'PBKDF2はCPUで実測します。WebGPUとの比較はSHA-256を選んでください。' : 'WebGPUは対応する環境でのみ実行します。未対応でもCPUで試せます。';
});
clearResults(); $('password').value = '123456'; updateAssumptions();
detectGPU().then(state => { if (!active && $('hash-mode').value === 'sha256') $('gpu-status').textContent = state.available ? `${state.label}を利用できます（任意）。` : state.reason; }).catch(() => { $('gpu-status').textContent = 'WebGPUは利用できません。CPUで実験できます。'; });
