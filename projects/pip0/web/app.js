import { DEFAULT_RULES, buildPlan, searchEntries, validateRules, formatBytes } from './core.js';
import { makeDemoEntries } from './demo.js';
import { importFiles, analyseEntries, findDuplicates, createZip, copyToDirectory, planDocument, downloadBlob } from './io.js';

const $ = (id) => document.getElementById(id);
const state = { entries: [], rows: [], rules: structuredClone(DEFAULT_RULES), duplicates: [], duplicatesChecked: false, demo: true, edited: false, busy: null, tab: 'organise', renameMode: 'keep', dateFolders: false };
const RULES_KEY = 'pip0-web-rules-v1';
const supportsFolder = typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); $('status').hidden = !message; }
function dateLabel(ms) { return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleDateString('ja-JP') : '更新日不明'; }
function errorMessage(error) { if (['SecurityError', 'NotAllowedError'].includes(error?.name) && !error.folderName) return 'ブラウザがこの操作を許可しませんでした。直接保存が使えない場合は「整理済みZIPを保存」をお使いください。'; return error?.name === 'AbortError' ? (error.folderName ? error.message : '中止しました。元のファイルは変更していません。') : (error?.message || '処理を完了できませんでした。'); }
function switchTab(name, focus = false) {
  state.tab = name;
  for (const button of document.querySelectorAll('[data-tab]')) { const active = button.dataset.tab === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; if (active && focus) button.focus(); }
  for (const panel of document.querySelectorAll('.tabpanel')) panel.hidden = panel.id !== `panel-${name}`;
  if (name === 'search') renderSearch();
}
for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => { const tabs = [...document.querySelectorAll('[data-tab]')]; let index = tabs.indexOf(button); if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (index + 1) % tabs.length; else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length; else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1; else return; event.preventDefault(); switchTab(tabs[index].dataset.tab, true); });
}
function confirmAction(title, message) {
  $('confirm-title').textContent = title; $('confirm-message').textContent = message;
  const dialog = $('confirm-dialog'); dialog.returnValue = '';
  return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }); dialog.showModal(); });
}
function updateControls() {
  const busy = Boolean(state.busy);
  for (const control of document.querySelectorAll('button,input,select,textarea')) if (control.id !== 'cancel-operation') control.disabled = busy;
  const none = !state.rows.some((row) => row.selected);
  $('export-zip').disabled = busy || none; $('save-plan').disabled = busy || none;
  $('export-folder').disabled = busy || none || !supportsFolder;
  $('check-duplicates').disabled = busy || !state.entries.length;
  $('clear-files').disabled = busy || !state.entries.length;
  $('rebuild-plan').disabled = busy || !state.entries.length;
  $('select-all').disabled = busy || !state.rows.length;
  $('busy-overlay').hidden = !busy;
}
async function run(label, action) {
  if (state.busy) return;
  state.busy = new AbortController(); $('busy-label').textContent = label; updateControls();
  const signal = state.busy.signal;
  const onProgress = (info) => { if (typeof info === 'string') $('busy-label').textContent = info; else if (info && typeof info === 'object') { const current = info.completed ?? info.current ?? info.done; const total = info.total; $('busy-label').textContent = info.message || (Number.isFinite(current) ? `${label} ${current}${Number.isFinite(total) ? ' / ' + total : ''}` : label); } };
  try { await action({ signal, onProgress }); } catch (error) { status(errorMessage(error), error?.name !== 'AbortError'); } finally { state.busy = null; updateControls(); }
}
$('cancel-operation').addEventListener('click', () => state.busy?.abort());
function updateStats() {
  const selected = state.rows.filter((row) => row.selected);
  $('nav-total').textContent = state.entries.length;
  $('stat-files').replaceChildren(document.createTextNode(state.entries.length), el('small', '', '件'));
  $('stat-selected').replaceChildren(document.createTextNode(selected.length), el('small', '', '件'));
  $('stat-size').textContent = formatBytes(state.entries.reduce((sum, entry) => sum + entry.size, 0));
  $('stat-duplicates').textContent = state.duplicatesChecked ? `${state.duplicates.length}組` : '—';
  $('select-all').checked = state.rows.length > 0 && selected.length === state.rows.length;
  $('select-all').indeterminate = selected.length > 0 && selected.length < state.rows.length;
  const folders = new Set(selected.map((row) => row.folder));
  $('plan-summary').textContent = state.entries.length ? `${selected.length}件を${folders.size}か所へ。整理先と名前は編集できます。` : 'ファイルを取り込むと提案が表示されます';
  $('session-badge').textContent = state.demo ? 'デモデータ' : '自分のファイル';
  $('demo-banner').hidden = !state.demo;
  updateControls();
}
function fileSymbol(entry) { const ext = (entry.name.match(/\.([^.]*)$/)?.[1] || 'FILE').slice(0, 5).toUpperCase(); return el('span', 'file-symbol ' + (/PNG|JPG|JPEG|WEBP|GIF|BMP/.test(ext) ? 'image' : /TXT|MD|CSV|JSON/.test(ext) ? 'text' : ''), ext); }
function renderPlan() {
  const body = $('plan-body'); body.replaceChildren(); const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const duplicateIds = new Set(state.duplicates.flat());
  for (const row of state.rows) {
    const entry = byId.get(row.entryId); if (!entry) continue;
    const tr = el('tr', row.selected ? '' : 'excluded');
    const checkCell = el('td', 'check-col'); const check = el('input'); check.type = 'checkbox'; check.checked = row.selected; check.setAttribute('aria-label', `${entry.name}を書き出す`);
    check.addEventListener('change', () => { row.selected = check.checked; tr.classList.toggle('excluded', !row.selected); state.edited = true; updateStats(); }); checkCell.append(check);
    const fileCell = el('td'); const file = el('div', 'file-cell'); const fileText = el('div', 'file-text'); const name = el('span', 'file-name', entry.name); name.title = entry.path;
    fileText.append(name, el('span', 'file-meta', `${formatBytes(entry.size)} · ${dateLabel(entry.lastModified)}`)); if (entry.path !== entry.name) { const path = el('span', 'file-meta', entry.path); path.title = entry.path; fileText.append(path); }
    file.append(fileSymbol(entry), fileText); fileCell.append(file);
    const targetCell = el('td'); const dest = el('div', 'destination');
    const folder = el('input', 'folder-input'); folder.value = row.folder; folder.setAttribute('list', 'folder-options'); folder.setAttribute('aria-label', `${entry.name}の整理先`); folder.maxLength = 200;
    const newName = el('input'); newName.value = row.newName; newName.setAttribute('aria-label', `${entry.name}の新しい名前`); newName.maxLength = 180;
    const edited = () => { row.folder = folder.value.trim(); row.newName = newName.value.trim(); row.targetPath = row.folder ? `${row.folder}/${row.newName}` : row.newName; if (!row.reasons.includes('整理先または名前を手動で変更しています。')) row.reasons.push('整理先または名前を手動で変更しています。'); state.edited = true; reasonCell.textContent = row.reasons.join(' / '); if (duplicateIds.has(entry.id)) reasonCell.append(el('br'), el('span', 'duplicate-pill', '同じ内容あり')); updateStats(); };
    folder.addEventListener('input', edited); newName.addEventListener('input', edited); folder.addEventListener('change', edited); newName.addEventListener('change', edited); dest.append(folder, newName); targetCell.append(dest);
    const reasonCell = el('td', 'reasons'); reasonCell.textContent = row.reasons.join(' / '); if (duplicateIds.has(entry.id)) reasonCell.append(el('br'), el('span', 'duplicate-pill', '同じ内容あり'));
    tr.append(checkCell, fileCell, el('td', 'arrow-col', '→'), targetCell, reasonCell); body.append(tr);
  }
  $('plan-empty').hidden = state.entries.length > 0;
  const folderOptions = $('folder-options'); folderOptions.replaceChildren(...[...new Set([...state.rules.map((rule) => rule.folder), '未分類'])].map((value) => { const option = el('option'); option.value = value; return option; }));
  updateStats();
}
function planFor(entries) { return buildPlan(entries, state.rules, { renameMode: $('rename-mode').value, dateFolders: $('date-folders').checked }); }
function commitPlan() { state.renameMode = $('rename-mode').value; state.dateFolders = $('date-folders').checked; state.edited = false; renderPlan(); }
function build() { const rows = planFor(state.entries); state.rows = rows; commitPlan(); }
async function rebuild() { if (state.busy) return; if (state.edited && !await confirmAction('提案を作り直しますか？', '手動で変更した整理先・名前・チェック状態を初期化し、現在の設定で提案し直します。')) { $('rename-mode').value = state.renameMode; $('date-folders').checked = state.dateFolders; return; } build(); status('現在のルールで提案を作り直しました。'); }
$('rebuild-plan').addEventListener('click', rebuild);
for (const id of ['rename-mode', 'date-folders']) $(id).addEventListener('change', rebuild);
$('select-all').addEventListener('change', () => { for (const row of state.rows) row.selected = $('select-all').checked; state.edited = true; renderPlan(); });
async function replaceEntries(entries, demo, skipped = []) {
  await run('ファイルを取り込んでいます', async (options) => {
    const next = $('analyse-content').checked ? await analyseEntries(entries, options) : entries.map(({ text, analysis, ...entry }) => entry);
    options.signal.throwIfAborted(); const rows = planFor(next); state.entries = next; state.rows = rows; state.demo = demo; state.duplicates = []; state.duplicatesChecked = false;
    $('duplicate-notice').hidden = true; $('duplicate-detail').textContent = ''; commitPlan(); renderSearch(); switchTab('organise');
    status(`${next.length}件を取り込みました。${skipped.length ? '\n取り込めなかったファイル：\n' + skipped.slice(0, 12).join('\n') + (skipped.length > 12 ? '\nほか' + (skipped.length - 12) + '件' : '') : ''}`);
  });
}
async function loadDemo() { if (state.busy) return; if (!state.demo && state.entries.length && !await confirmAction('デモに切り替えますか？', '現在の一覧と提案をデモデータに置き換えます。元のファイルは変更しません。')) return; await replaceEntries(await makeDemoEntries(), true); }
$('load-demo').addEventListener('click', loadDemo);
$('choose-files').addEventListener('click', () => { if (!state.busy) $('file-input').click(); });
$('choose-folder').addEventListener('click', () => { if (!state.busy) $('folder-input').click(); });
async function acceptFiles(files) {
  if (state.busy || !files.length) return;
  if (!state.demo && state.entries.length && !await confirmAction('新しい一覧に置き換えますか？', '表示中のファイル一覧と提案を、新しく選んだファイルに置き換えます。元のファイルは変更しません。')) return;
  try { const imported = await importFiles(files); await replaceEntries(imported.entries, false, imported.skipped); } catch (error) { status(errorMessage(error), true); }
}
for (const id of ['file-input', 'folder-input']) $(id).addEventListener('change', async (event) => { const files = [...event.target.files]; event.target.value = ''; await acceptFiles(files); });
const dropzone = $('dropzone');
for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, (event) => { event.preventDefault(); if (!state.busy) dropzone.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', async (event) => {
  if (state.busy) return;
  const items = [...(event.dataTransfer?.items || [])];
  if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) { status('フォルダーは「フォルダーを選ぶ」から取り込んでください。ファイル単位ならドロップできます。'); return; }
  await acceptFiles([...(event.dataTransfer?.files || [])]);
});
// Dropping outside the import zone must not navigate away and expose the file.
window.addEventListener('dragover', (event) => event.preventDefault()); window.addEventListener('drop', (event) => event.preventDefault());
$('analyse-content').addEventListener('change', async () => {
  if (!state.entries.length || state.busy) return;
  const enabled = $('analyse-content').checked;
  if (state.edited && !await confirmAction('解析設定を変えて提案し直しますか？', '手動で変更した整理先・名前・チェック状態を初期化します。キャンセルすると現在の提案を維持します。')) { $('analyse-content').checked = !enabled; return; }
  if (!enabled) {
    const entries = state.entries.map(({ text, analysis, ...entry }) => entry);
    const rows = planFor(entries); state.entries = entries; state.rows = rows; commitPlan(); renderSearch(); status('名前・種類・容量・更新日だけを使う状態に戻しました。'); return;
  }
  let succeeded = false;
  await run('本文と画像を調べています', async (options) => { const entries = await analyseEntries(state.entries, options); options.signal.throwIfAborted(); const rows = planFor(entries); state.entries = entries; state.rows = rows; commitPlan(); renderSearch(); succeeded = true; status('対応するテキストと画像を調べました。PDFやOffice文書は名前と基本情報を使います。'); });
  if (!succeeded) $('analyse-content').checked = false;
});
$('check-duplicates').addEventListener('click', () => run('同じ内容のファイルを調べています', async (options) => {
  const groups = await findDuplicates(state.entries, options); options.signal.throwIfAborted(); state.duplicates = groups; state.duplicatesChecked = true;
  $('duplicate-notice').hidden = !groups.length;
  $('duplicate-notice').textContent = groups.length ? `${groups.length}組で内容の一致を確認しました。コピーが不要なものはチェックを外してください。同じ内容でも自動では除外しません。` : '';
  $('duplicate-detail').textContent = groups.length ? `SHA-256で内容を比較：${groups.length}組` : '内容の一致は見つかりませんでした';
  renderPlan(); status(groups.length ? `${groups.length}組で同じ内容を確認しました。` : '同じ内容のファイルはありませんでした。');
}));
function checkedRows() {
  const rows = state.rows.filter((row) => row.selected); if (!rows.length) throw new Error('書き出すファイルを選んでください。');
  const seen = new Set(); const bad = /[\\<>:"|?*\u0000-\u001f\u007f]/;
  for (const row of rows) { const parts = row.targetPath.split('/'); if (parts.some((part) => !part || part === '.' || part === '..' || bad.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`整理先または名前に使用できない文字があります：${row.targetPath}`);
    const key = row.targetPath.normalize('NFKC').toLowerCase(); if (seen.has(key)) throw new Error(`書き出し先が重複しています。名前か整理先を変更してください：${row.targetPath}`); seen.add(key);
  }
  planDocument(state.entries, rows);
  return rows;
}
$('export-zip').addEventListener('click', () => run('整理済みZIPを作っています', async (options) => { const rows = checkedRows(); const zip = await createZip(state.entries, rows, options); options.signal.throwIfAborted(); downloadBlob(zip, 'pip0-organised.zip'); status(`${rows.length}件のコピーをZIPにまとめました。ブラウザのダウンロード一覧から開けます。`); }));
$('folder-support').textContent = supportsFolder ? '選んだ保存先の中に新しいフォルダーを作ります。書き込み後に内容も照合します。' : 'このブラウザでは直接保存に対応していません。「整理済みZIPを保存」をお使いください。';
$('export-folder').addEventListener('click', async () => {
  if (state.busy || !supportsFolder) return;
  let rows, handle; try { rows = checkedRows(); handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pip0-output' }); } catch (error) { if (error?.name !== 'AbortError') status(errorMessage(error), true); return; }
  if (!await confirmAction('この保存先にコピーしますか？', `${rows.length}件を「${handle.name}」の中の新しいフォルダーにコピーします。元のファイルは残ります。`)) return;
  await run('新しいフォルダーへコピーしています', async (options) => { const result = await copyToDirectory(handle, state.entries, rows, options); status(`${result.count}件を「${result.folderName}」にコピーし、内容を照合しました。`); });
});
$('save-plan').addEventListener('click', () => { try { const document = planDocument(state.entries, checkedRows()); downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), 'pip0-plan.json'); status('整理計画を保存しました。ファイル名と対応表が含まれます。'); } catch (error) { status(errorMessage(error), true); } });
$('clear-files').addEventListener('click', async () => { if (state.busy || !await confirmAction('一覧を空にしますか？', '取り込んだ一覧と提案、解析した内容をこの画面から取り除きます。元のファイルや保存済みのコピーは変更しません。')) return; state.entries = []; state.rows = []; state.duplicates = []; state.duplicatesChecked = false; state.edited = false; $('duplicate-notice').hidden = true; $('duplicate-detail').textContent = ''; renderPlan(); renderSearch(); status('一覧を空にしました。'); });
$('dismiss-banner').addEventListener('click', () => { $('demo-banner').hidden = true; });
function renderSearch() {
  const results = searchEntries(state.entries, $('search-input').value, { now: Date.now() }); const full = results.filter((item) => !item.partial).length;
  $('search-count').textContent = !state.entries.length ? 'まずファイルを取り込んでください' : $('search-input').value.trim() ? `一致 ${full}件${results.length > full ? ' / 一部一致 ' + (results.length - full) + '件' : ''}` : `${results.length}件のファイル`;
  const container = $('search-results'); container.replaceChildren();
  if (!results.length) { const empty = el('div', 'empty-state'); empty.append(el('strong', '', '手掛かりに合うファイルがありません'), el('p', '', '言葉を短くするか、更新日や種類を変えてみてください。')); container.append(empty); return; }
  for (const result of results) { const { entry, reasons, partial } = result; const card = el('article', 'search-result' + (partial ? ' partial' : '')); const content = el('div');
    content.append(el('span', 'match-badge', partial ? '一部の手掛かりだけ一致' : '一致'), el('h2', '', entry.name), el('p', '', `${entry.path} · ${formatBytes(entry.size)} · ${dateLabel(entry.lastModified)}`), el('p', '', reasons.join(' / ')));
    const save = el('button', 'text-button', 'このファイルのコピーを保存'); save.type = 'button'; save.addEventListener('click', () => downloadBlob(entry.file, entry.name)); content.append(save); card.append(fileSymbol(entry), content); container.append(card);
  }
}
$('search-form').addEventListener('submit', (event) => { event.preventDefault(); renderSearch(); });
$('search-input').addEventListener('input', renderSearch);
for (const button of document.querySelectorAll('[data-query]')) button.addEventListener('click', () => { $('search-input').value = button.dataset.query; renderSearch(); });
function renderRules() {
  $('rules-json').value = JSON.stringify(state.rules, null, 2); const cards = $('rule-cards'); cards.replaceChildren();
  for (const rule of state.rules) { const card = el('article', 'rule-card'); card.append(el('h2', '', rule.name), el('p', 'rule-folder', `整理先：${rule.folder}`), el('p', '', `言葉：${rule.keywords.join('・') || '指定なし'}`), el('p', '', `種類：${rule.extensions.join(' / ') || '指定なし'}`)); cards.append(card); }
}
function readRules() { let parsed; try { parsed = JSON.parse($('rules-json').value); } catch { throw new Error('JSONの形式を確認してください。括弧やカンマ、引用符の抜けがないか見てみましょう。'); } const result = validateRules(parsed); if (!result.ok) throw new Error(result.errors.join('\n')); return result.rules; }
$('apply-rules').addEventListener('click', async () => {
  try { const rules = readRules(); if (state.edited && !await confirmAction('新しいルールで提案しますか？', '手動で変更した整理先・名前・チェック状態を初期化し、編集したルールで提案し直します。')) return; state.rules = rules; $('rules-error').textContent = ''; renderRules(); build(); status('新しいルールで提案を作りました。'); switchTab('organise'); } catch (error) { $('rules-error').textContent = errorMessage(error); }
});
$('persist-rules').addEventListener('click', () => { try { const rules = readRules(); localStorage.setItem(RULES_KEY, JSON.stringify(rules)); $('rules-error').textContent = ''; status('編集したルールをこのブラウザに保存しました。「このルールで提案する」で現在の一覧にも適用できます。'); } catch (error) { $('rules-error').textContent = errorMessage(error); } });
$('reset-rules').addEventListener('click', async () => { if (!await confirmAction('初期設定に戻しますか？', '編集したルールと保存済みルールを初期化し、整理の提案を作り直します。')) return; try { localStorage.removeItem(RULES_KEY); } catch { /* Disabled storage does not prevent a session reset. */ } state.rules = structuredClone(DEFAULT_RULES); $('rules-error').textContent = ''; renderRules(); build(); status('ルールを初期設定に戻しました。'); });
try { const saved = localStorage.getItem(RULES_KEY); if (saved && saved.length < 100000) { const validated = validateRules(JSON.parse(saved)); if (validated.ok) state.rules = validated.rules; } } catch { /* Storage is optional; entries are never persisted. */ }
renderRules(); updateControls(); loadDemo().catch((error) => status(errorMessage(error), true));
