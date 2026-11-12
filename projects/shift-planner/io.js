/** CSV / Excel adapters. All parsing and workbook creation stays in this browser. */
import * as XLSX from './vendor/xlsx.mjs';

export const SCHEMAS = Object.freeze({
  staff: ['id', 'name', 'weight', 'minHours', 'maxHours', 'maxDays', 'skills'],
  slots: ['id', 'date', 'start', 'end', 'required', 'skill', 'fixed'],
  availability: ['staffId', 'slotId', 'preference'],
  history: ['staffId', 'date', 'start', 'end'],
});
const SHEETS = {staff: 'スタッフ', slots: 'シフト枠', availability: '勤務可能', history: '過去実績'};
const REQUIRED = {staff: ['id', 'name'], slots: ['id', 'date', 'start', 'end', 'required'], availability: ['staffId', 'slotId'], history: ['staffId', 'date', 'start', 'end']};
const DEFAULTS = {staff: {weight: 1, minHours: 0, maxHours: 40, maxDays: 5, skills: ''}, slots: {skill: '', fixed: ''}, availability: {preference: 1}, history: {}};
const NUMERIC = new Set(['weight', 'minHours', 'maxHours', 'maxDays', 'required', 'preference']);
const DEFAULT_SETTINGS = {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000};
const MAX_ROWS = 5000;
const MAX_BYTES = 10 * 1024 * 1024;

/** RFC 4180 style CSV: quotes, embedded line breaks, BOM, CRLF and trailing cells. */
export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSVは文字列で指定してください。');
  if (text.length > MAX_BYTES) throw new Error('CSVが大きすぎます。10 MB以内に分けてください。');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', state = 'plain';
  const pushCell = () => { row.push(cell); cell = ''; if (row.length > 30) throw new Error('CSVの列が多すぎます。テンプレートの列を使用してください。'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new Error(`CSVは見出しを除き${MAX_ROWS}行までです。`); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else state = 'closed'; }
      else cell += c;
    } else if (c === ',') { pushCell(); state = 'plain'; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); state = 'plain'; }
    else if (c === '"' && !cell && state === 'plain') state = 'quoted';
    else if (state === 'closed' || c === '"') throw new Error(`CSV ${rows.length + 1}行目の引用符を確認してください。`);
    else cell += c;
  }
  if (state === 'quoted') throw new Error(`CSV ${rows.length + 1}行目の引用符が閉じていません。`);
  if (cell || row.length || state === 'closed') pushRow();
  return rows;
}

// Apostrophe escaping prevents spreadsheet formula interpretation. Doubling an
// original leading apostrophe makes our own exports reversible on re-import.
function csvText(value) {
  let text = String(value ?? '');
  if (typeof value !== 'number' && (/^'/.test(text) || /^[\s]*[=+\-@]/.test(text))) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
function unescapeText(value) {
  const s = String(value ?? '');
  return /^''/.test(s) || /^'[\s]*[=+\-@]/.test(s) ? s.slice(1) : s;
}
export function encodeCSV(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvText).join(',')).join('\r\n') + '\r\n';
}
export function tableRows(kind, records) {
  const keys = kind === 'schedule' ? ['slotId', 'date', 'start', 'end', 'staffId', 'name'] : SCHEMAS[kind];
  if (!keys) throw new Error('取り込む表の種類を選んでください。');
  return [keys, ...records.map(record => keys.map(key => record[key] ?? ''))];
}

function dateText(value, date1904 = false) {
  let s;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 2958465) throw new Error('日付セルは日付だけにしてください。');
    const d = XLSX.SSF.parse_date_code(value, {date1904});
    if (!d) throw new Error('Excelの日付を読み取れません。');
    s = `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  } else s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日付は YYYY-MM-DD（例：2026-11-16）にしてください。');
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== s) throw new Error('実在する日付を指定してください。');
  return s;
}
function timeText(value, allowMidnight = false) {
  if (allowMidnight && (value === 1 || value === '24:00' || value === '24:00:00')) return '24:00';
  if (typeof value === 'number') {
    const minutes = Math.round(value * 1440);
    if (value < 0 || value >= 1 || minutes >= 1440 || Math.abs(value * 1440 - minutes) > 0.00001) throw new Error('時刻セルは0:00〜23:59の分単位にしてください。');
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const s = String(value ?? '').trim();
  const m = /^(\d{1,2}):([0-5]\d)(?::00)?$/.exec(s);
  if (!m || +m[1] > 23) throw new Error('時刻は HH:MM（例：09:00）にしてください。');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
/** Validate table shape/types here; cross-table constraints are solver's job. */
export function importTable(kind, rows, options = {}) {
  const keys = SCHEMAS[kind];
  if (!keys) throw new Error('取り込む表の種類を選んでください。');
  if (!Array.isArray(rows) || !rows.length) throw new Error('見出し行がありません。テンプレートを使用してください。');
  if (rows.length > MAX_ROWS + 1) throw new Error(`表は見出しを除き${MAX_ROWS}行までです。`);
  const header = rows[0].map(v => String(v ?? '').replace(/^\uFEFF/, '').trim());
  if (new Set(header).size !== header.length || header.some(h => !keys.includes(h))) throw new Error(`見出しが不正か重複しています。使用できる列：${keys.join(', ')}`);
  for (const key of REQUIRED[kind]) if (!header.includes(key)) throw new Error(`見出し「${key}」がありません。`);
  return rows.slice(1).flatMap((row, index) => {
    if (!row.some(v => v !== '' && v != null)) return [];
    try {
      if (row.length > header.length && row.slice(header.length).some(v => v !== '' && v != null)) throw new Error('見出しのない列にデータがあります。');
      const record = {...DEFAULTS[kind]};
      header.forEach((key, i) => {
        const value = row[i] ?? '';
        if (NUMERIC.has(key)) {
          if (String(value).trim() === '') { if (Object.hasOwn(DEFAULTS[kind], key)) return; throw new Error(`${key} が空欄です。`); }
          if (typeof value === 'boolean' || !/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(String(value).trim())) throw new Error(`${key} は数値にしてください。`);
          const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${key} は有限の数値にしてください。`);
          record[key] = n;
        } else if (key === 'date') record[key] = dateText(value, options.date1904);
        else if (key === 'start' || key === 'end') record[key] = timeText(value, key === 'end');
        else {
          if (typeof value === 'object' || typeof value === 'boolean') throw new Error(`${key} は文字列にしてください。`);
          const s = options.csv ? unescapeText(value) : String(value);
          if (s.length > 500) throw new Error(`${key} は500文字以内にしてください。`);
          record[key] = s.trim();
        }
      });
      for (const key of REQUIRED[kind]) if (record[key] === '') throw new Error(`${key} が空欄です。`);
      return [record];
    } catch (error) { throw new Error(`${SHEETS[kind]} ${index + 2}行目：${error.message}`); }
  });
}

function assertZipSize(bytes) {
  // Check ZIP central-directory uncompressed sizes before the Excel parser runs.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Excel .xlsx ファイルを選んでください。');
  const count = view.getUint16(eocd + 10, true), offset = view.getUint32(eocd + 16, true);
  if (count > 1000 || offset > bytes.length) throw new Error('Excelファイルの構成が大きすぎます。');
  let p = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('Excelファイルが破損しています。');
    total += view.getUint32(p + 24, true);
    if (total > 40 * 1024 * 1024) throw new Error('Excelの展開後サイズが40 MBを超えています。小さなファイルに分けてください。');
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
}
function sheetRows(sheet, name) {
  if (!sheet) throw new Error(`Excelに「${name}」シートがありません。テンプレートを使用してください。`);
  const ref = sheet['!fullref'] || sheet['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r >= MAX_ROWS + 1 || range.e.c >= 30) throw new Error(`${name}シートは${MAX_ROWS}行・30列以内にしてください。`);
  }
  for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && cell?.f != null) throw new Error(`${name} ${address}：数式は使えません。値を貼り付けてください。`);
  return XLSX.utils.sheet_to_json(sheet, {header: 1, raw: true, defval: '', blankrows: true});
}
function settingsRows(rows) {
  if (rows.length && (rows[0][0] !== 'key' || rows[0][1] !== 'value')) throw new Error('設定シートは key,value の見出しにしてください。');
  const settings = {...DEFAULT_SETTINGS}, seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const [key, value] = rows[i];
    if (!Object.hasOwn(settings, key) || seen.has(key)) throw new Error(`設定 ${i + 1}行目：項目名が不正か重複しています。`);
    seen.add(key);
    let parsed;
    try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error(`設定 ${i + 1}行目：値が不正です。`); }
    if ((key === 'includeHistory' && typeof parsed !== 'boolean') || (key !== 'includeHistory' && (typeof parsed !== 'number' || !Number.isFinite(parsed)))) throw new Error(`設定 ${i + 1}行目：${key} の型が違います。`);
    settings[key] = parsed;
  }
  return settings;
}
async function fileBytes(file) {
  if (!file || file.size > MAX_BYTES) throw new Error('ファイルは10 MB以内にしてください。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('ファイルは10 MB以内にしてください。');
  return bytes;
}
function csvDecode(bytes) {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return new TextDecoder(encoding, {fatal: true}).decode(bytes);
  } catch { try { return new TextDecoder('shift_jis', {fatal: true}).decode(bytes); } catch { throw new Error('CSVの文字コードを読み取れません。UTF-8で保存してください。'); } }
}
function readBook(bytes) {
  assertZipSize(bytes);
  try { return XLSX.read(bytes, {type: 'array', sheetRows: MAX_ROWS + 2, cellFormula: true, cellDates: false, cellHTML: false, bookVBA: false}); }
  catch { throw new Error('Excelファイルを読み取れません。暗号化を解除し、.xlsxで保存し直してください。'); }
}
export async function readFile(file, kind) {
  const bytes = await fileBytes(file);
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.csv')) {
    if (kind === 'workbook') throw new Error('一括取り込みにはExcel .xlsxを使用してください。CSVは対象の入力タブから取り込めます。');
    return importTable(kind, parseCSV(csvDecode(bytes)), {csv: true});
  }
  if (!name.endsWith('.xlsx')) throw new Error('CSVまたはExcel .xlsxファイルを選んでください。');
  const book = readBook(bytes);
  const options = {date1904: !!book.Workbook?.WBProps?.date1904};
  if (kind !== 'workbook') {
    const sheet = book.Sheets[SHEETS[kind]] || book.Sheets[book.SheetNames[0]];
    return importTable(kind, sheetRows(sheet, SHEETS[kind] || kind), options);
  }
  const data = {};
  for (const key of Object.keys(SHEETS)) data[key] = importTable(key, sheetRows(book.Sheets[SHEETS[key]], SHEETS[key]), options);
  data.settings = book.Sheets['設定'] ? settingsRows(sheetRows(book.Sheets['設定'], '設定')) : {...DEFAULT_SETTINGS};
  return data;
}
/** Reuse a previous result as actual work history; never re-import older history. */
export async function readPastSchedule(file) {
  const bytes = await fileBytes(file), name = String(file.name || '').toLowerCase();
  let rows, options = {}, grouped = false;
  if (name.endsWith('.csv')) {
    rows = parseCSV(csvDecode(bytes)); options.csv = true;
  } else if (name.endsWith('.xlsx')) {
    const book = readBook(bytes);
    if (!book.Sheets['完成シフト']) throw new Error('「完成シフト」シートがありません。以前の結果をExcel出力したファイルを選んでください。');
    rows = sheetRows(book.Sheets['完成シフト'], '完成シフト');
    options.date1904 = !!book.Workbook?.WBProps?.date1904;
    grouped = true;
  } else throw new Error('以前の完成シフトのCSVまたはExcel .xlsxを選んでください。');
  if (!rows.length) throw new Error('完成シフトの見出しがありません。');
  const header = rows[0].map(v => String(v ?? '').replace(/^\uFEFF/, '').trim());
  const allowed = grouped ? ['slotId', 'date', 'start', 'end', 'required', 'staffIds', 'staffNames'] : ['slotId', 'date', 'start', 'end', 'staffId', 'name'];
  const personKey = grouped ? 'staffIds' : 'staffId';
  if (new Set(header).size !== header.length || header.some(h => !allowed.includes(h))) throw new Error('完成シフトの見出しが不正か重複しています。結果として書き出したファイルを選んでください。');
  for (const key of ['date', 'start', 'end', personKey]) if (!header.includes(key)) throw new Error(`完成シフトの見出し「${key}」がありません。`);
  const get = (row, key) => row[header.indexOf(key)] ?? '';
  // Validate each source row separately to retain its Excel/CSV row number even
  // when the Excel result expands one shift into several staff assignments.
  const history = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row.some(v => v !== '' && v != null)) continue;
    try {
      if (row.length > header.length && row.slice(header.length).some(v => v !== '' && v != null)) throw new Error('見出しのない列にデータがあります。');
      const raw = get(row, personKey);
      if (grouped && String(raw).length > 50000) throw new Error('スタッフIDの一覧が長すぎます。');
      const ids = grouped ? String(raw).split(',').map(v => v.trim()).filter(Boolean) : [raw];
      if (ids.length > 100) throw new Error('1枠のスタッフ数は100人以内にしてください。');
      if (!ids.length || new Set(ids).size !== ids.length) throw new Error('スタッフIDが空欄か重複しています。');
      if (grouped && header.includes('required') && Number(get(row, 'required')) !== ids.length) throw new Error('必要人数と配置人数が一致しません。');
      for (const id of ids) history.push(...importTable('history', [['staffId', 'date', 'start', 'end'], [id, get(row, 'date'), get(row, 'start'), get(row, 'end')]], options));
      if (history.length > MAX_ROWS) throw new Error(`履歴は${MAX_ROWS}件以内に分けてください。`);
    } catch (error) { throw new Error(`完成シフト ${i + 1}行目：${error.message.replace(/^過去実績 2行目：/, '')}`); }
  }
  if (!history.length) throw new Error('完成シフトに勤務の記録がありません。');
  return history;
}
export function csvBlob(kind, records) {
  return new Blob([encodeCSV(tableRows(kind, records))], {type: 'text/csv;charset=utf-8'});
}
export function workbookBlob(data, result = null) {
  const book = XLSX.utils.book_new();
  const append = (rows, name) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = rows[0].map(() => ({wch: 20}));
    XLSX.utils.book_append_sheet(book, sheet, name);
  };
  for (const kind of Object.keys(SHEETS)) append(tableRows(kind, data[kind] || []), SHEETS[kind]);
  append([['key', 'value'], ...Object.entries({...DEFAULT_SETTINGS, ...data.settings}).filter(([key]) => Object.hasOwn(DEFAULT_SETTINGS, key)).map(([key, value]) => [key, JSON.stringify(value)])], '設定');
  if (result) {
    if (!['optimal', 'feasible'].includes(result.status)) throw new Error('条件を満たす完成シフトがありません。');
    const slots = new Map(data.slots.map(s => [s.id, s])), names = new Map(data.staff.map(s => [s.id, s.name]));
    append([['slotId', 'date', 'start', 'end', 'required', 'staffIds', 'staffNames'], ...result.schedule.map(s => {const slot = slots.get(s.slotId); return [s.slotId, slot?.date || '', slot?.start || '', slot?.end || '', slot?.required || '', s.staffIds.join(','), s.staffIds.map(id => names.get(id) || id).join(' / ')];})], '完成シフト');
    const keys = ['staffId', 'name', 'hours', 'historyHours', 'totalHours', 'days', 'targetHours'];
    append([keys, ...result.stats.map(s => keys.map(k => k === 'name' ? names.get(s.staffId) || s.staffId : s[k] ?? ''))], '勤務集計');
  }
  return new Blob([XLSX.write(book, {bookType: 'xlsx', type: 'array', compression: true})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
