import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../vendor/xlsx.mjs';
import {parseCSV, encodeCSV, tableRows, importTable, csvBlob, workbookBlob, readFile, readPastSchedule} from '../io.js';

const fixture = () => ({
  staff: [{id: 'A', name: '=SUM(1,2)', weight: 1.5, minHours: 0, maxHours: 24, maxDays: 4, skills: 'レジ,接客'}, {id: 'B', name: "'スタッフB", weight: 1, minHours: 0, maxHours: 30, maxDays: 5, skills: ''}],
  slots: [{id: 'M1', date: '2026-11-16', start: '09:00', end: '13:00', required: 1, skill: '', fixed: 'A'}],
  availability: [{staffId: 'A', slotId: 'M1', preference: 2}],
  history: [{staffId: 'A', date: '2026-11-15', start: '09:00', end: '12:00'}],
  settings: {includeHistory: true, minRestHours: 8, maxConsecutiveDays: 5, maxDailyHours: 8, timeLimitMs: 2500},
});
const asFile = (blob, name) => ({size: blob.size, name, arrayBuffer: () => blob.arrayBuffer()});
const bookFile = book => asFile(new Blob([XLSX.write(book, {type: 'array', bookType: 'xlsx', compression: true})]), 'input.xlsx');

test('CSV parses multiline quoted Japanese fields and CRLF without losing final empty cells', () => {
  assert.deepEqual(parseCSV('\uFEFFid,name,skills\r\nA,"スタッフ\nA","レジ,""接客"""\r\nB,スタッフB,\r\n'), [
    ['id', 'name', 'skills'], ['A', 'スタッフ\nA', 'レジ,"接客"'], ['B', 'スタッフB', ''],
  ]);
  assert.deepEqual(parseCSV('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseCSV(''), []);
});
test('CSV rejects malformed quoting instead of guessing field boundaries', () => {
  for (const csv of ['id,name\nA,"未完', 'a"x,b', '"x"junk,y']) assert.throws(() => parseCSV(csv), /引用符/);
});
test('CSV staff export is safe for spreadsheets and round trips formula-like text/apostrophes', async () => {
  const records = fixture().staff;
  const blob = csvBlob('staff', records), csv = await blob.text();
  assert.match(csv, /'=SUM/);
  assert.match(csv, /''スタッフB/);
  assert.deepEqual(await readFile(asFile(blob, 'staff.csv'), 'staff'), records);
  const unsafe = ['=1+1', '+cmd', '-cmd', '@SUM', ' \t=1', "'literal"];
  const encoded = encodeCSV([unsafe]);
  assert.ok(parseCSV(encoded)[0].every(v => v.startsWith("'")));
});
test('CSV import supplies documented optional defaults and reports exact bad rows', () => {
  assert.deepEqual(importTable('staff', [['id', 'name'], ['A', 'スタッフA']]), [{id: 'A', name: 'スタッフA', weight: 1, minHours: 0, maxHours: 40, maxDays: 5, skills: ''}]);
  assert.throws(() => importTable('staff', [['id', 'name', 'weight'], ['A', 'A', 'not a number']]), /スタッフ 2行目.*数値/);
  assert.throws(() => importTable('staff', [['id', 'name', 'id']]), /重複/);
  assert.throws(() => importTable('staff', [['id', 'nam']]), /見出し/);
  assert.throws(() => importTable('staff', [['id', 'name'], ['A', 'A', 'extra']]), /2行目.*見出しのない列/);
});
test('date/time validation rejects impossible dates and fractional minute cells', () => {
  const rows = tableRows('slots', fixture().slots);
  rows[1][1] = '2026-02-30';
  assert.throws(() => importTable('slots', rows), /実在する日付/);
  rows[1][1] = '2026-11-16'; rows[1][2] = 0.5001;
  assert.throws(() => importTable('slots', rows), /分単位/);
  rows[1][2] = '9:00:00';
  assert.equal(importTable('slots', rows)[0].start, '09:00');
});
test('24:00 is accepted only as a slot or history end, including Excel serial 1', () => {
  const rows = tableRows('slots', fixture().slots);
  rows[1][3] = '24:00';
  assert.equal(importTable('slots', rows)[0].end, '24:00');
  rows[1][3] = 1;
  assert.equal(importTable('slots', rows)[0].end, '24:00');
  rows[1][2] = '24:00';
  assert.throws(() => importTable('slots', rows), /HH:MM/);
  rows[1][2] = 1;
  assert.throws(() => importTable('slots', rows), /23:59/);
});
test('complete real XLSX workbook round trip preserves all inputs, settings, Japanese, and literal formula text', async () => {
  const original = fixture(), blob = workbookBlob(original);
  const restored = await readFile(asFile(blob, 'shift.xlsx'), 'workbook');
  assert.deepEqual(restored, original);
  const book = XLSX.read(await blob.arrayBuffer(), {type: 'array'});
  assert.equal(book.Sheets['スタッフ'].B2.t, 's');
  assert.equal(book.Sheets['スタッフ'].B2.f, undefined);
  assert.deepEqual(book.SheetNames, ['スタッフ', 'シフト枠', '勤務可能', '過去実績', '設定']);
});
test('one sheet workbook import interprets Excel serial dates and times', async () => {
  const book = XLSX.utils.book_new();
  const dateSerial = (Date.UTC(2026, 10, 16) - Date.UTC(1899, 11, 30)) / 86400000;
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['id', 'date', 'start', 'end', 'required'], ['S', dateSerial, 9 / 24, 13 / 24, 2]]), 'Sheet1');
  const [slot] = await readFile(bookFile(book), 'slots');
  assert.deepEqual(slot, {id: 'S', date: '2026-11-16', start: '09:00', end: '13:00', required: 2, skill: '', fixed: ''});
});
test('1904 Excel date system is honoured', async () => {
  const book = XLSX.utils.book_new();
  book.Workbook = {WBProps: {date1904: true}};
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['staffId', 'date', 'start', 'end'], ['A', 0, .5, .75]]), '過去実績');
  assert.equal((await readFile(bookFile(book), 'history'))[0].date, '1904-01-01');
});
test('Excel formulas rejected with precise sheet and cell; missing input sheets fail clearly', async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['id', 'name'], ['A', 'placeholder']]);
  sheet.B2 = {t: 's', f: '"injected"', v: 'cached'};
  XLSX.utils.book_append_sheet(book, sheet, 'スタッフ');
  await assert.rejects(readFile(bookFile(book), 'staff'), /スタッフ B2.*数式/);
  sheet.B2 = {t: 's', v: 'A'};
  await assert.rejects(readFile(bookFile(book), 'workbook'), /シフト枠.*シートがありません/);
});
test('Excel validation row numbers retain blank worksheet rows', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['id', 'name', 'weight'], ['A', 'A', 1], [], ['B', 'B', 'wrong']]), 'スタッフ');
  await assert.rejects(readFile(bookFile(book), 'staff'), /スタッフ 4行目/);
});
test('UTF-16LE Excel CSV is recognised', async () => {
  const body = Buffer.from('id,name\r\nA,スタッフA\r\n', 'utf16le');
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  assert.equal((await readFile(asFile(new Blob([bytes]), 'staff.csv'), 'staff'))[0].name, 'スタッフA');
});
test('Excel completed schedule and summaries exported only for a feasible result', async () => {
  const data = fixture();
  assert.throws(() => workbookBlob(data, {status: 'infeasible'}), /完成シフト/);
  const result = {status: 'feasible', schedule: [{slotId: 'M1', staffIds: ['A']}], stats: [{staffId: 'A', hours: 4, historyHours: 3, totalHours: 7, days: 1, targetHours: 4.2}]};
  const blob = workbookBlob(data, result), book = XLSX.read(await blob.arrayBuffer(), {type: 'array'});
  assert.equal(book.Sheets['完成シフト'].G2.v, data.staff[0].name);
  assert.equal(book.Sheets['勤務集計'].C2.v, 4);
  assert.deepEqual(await readFile(asFile(blob, 'done.xlsx'), 'workbook'), data);
});
test('result schedule CSV has one assignment per row and safe staff names', async () => {
  const rows = [{slotId: 'M1', date: '2026-11-16', start: '09:00', end: '13:00', staffId: 'A', name: '=formula'}];
  assert.deepEqual(parseCSV(await csvBlob('schedule', rows).text()), [['slotId', 'date', 'start', 'end', 'staffId', 'name'], ['M1', '2026-11-16', '09:00', '13:00', 'A', "'=formula"]]);
});
test('own result CSV becomes reusable history, including midnight and escaped IDs', async () => {
  const rows = [{slotId: 'M1', date: '2026-11-16', start: '20:00', end: '24:00', staffId: '=A', name: '=formula'}, {slotId: 'M1', date: '2026-11-16', start: '20:00', end: '24:00', staffId: 'B', name: 'B'}];
  assert.deepEqual(await readPastSchedule(asFile(csvBlob('schedule', rows), 'past.csv')), rows.map(({staffId, date, start, end}) => ({staffId, date, start, end})));
});
test('own result XLSX expands assignments to history and excludes older history already in workbook', async () => {
  const data = fixture(); data.slots[0].required = 2;
  const result = {status: 'optimal', schedule: [{slotId: 'M1', staffIds: ['A', 'B']}], stats: []};
  const history = await readPastSchedule(asFile(workbookBlob(data, result), 'past.xlsx'));
  assert.deepEqual(history, ['A', 'B'].map(staffId => ({staffId, date: '2026-11-16', start: '09:00', end: '13:00'})));
  assert.equal(history.length, 2);
});
test('past results reject missing result sheets, malformed records and formulas', async () => {
  await assert.rejects(readPastSchedule(asFile(workbookBlob(fixture()), 'input-template.xlsx')), /完成シフト.*ありません/);
  await assert.rejects(readPastSchedule(asFile(new Blob([encodeCSV([['date', 'start', 'end', 'staffId'], ['2026-11-16', '25:00', '24:00', 'A']])]), 'past.csv')), /完成シフト 2行目.*HH:MM/);
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['date', 'start', 'end', 'required', 'staffIds'], ['2026-11-16', '09:00', '13:00', 2, 'A']]);
  XLSX.utils.book_append_sheet(book, sheet, '完成シフト');
  await assert.rejects(readPastSchedule(bookFile(book)), /必要人数と配置人数/);
  sheet.E2 = {t: 's', f: '"A,B"', v: 'A,B'};
  await assert.rejects(readPastSchedule(bookFile(book)), /完成シフト E2.*数式/);
});
test('file/row limits and disguised files fail before allocation-heavy Excel parsing', async () => {
  await assert.rejects(readFile({size: 11 * 1024 * 1024, name: 'huge.xlsx'}, 'workbook'), /10 MB/);
  await assert.rejects(readFile(asFile(new Blob(['not a zip']), 'fake.xlsx'), 'staff'), /xlsx/);
  await assert.rejects(readFile(asFile(new Blob(['id,name']), 'input.xls'), 'staff'), /xlsx/);
  assert.throws(() => importTable('staff', Array.from({length: 5002}, () => ['id', 'name'])), /5000行/);
});
