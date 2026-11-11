/* 顔画像は保存しません。任意で残すのは照合用の数値と設定だけです。 */
export const STORAGE_KEY = 'facegate.browser.v1';
export const DEFAULT_SETTINGS = Object.freeze({threshold: 0.70, voteWindow: 3, blurUnknown: true, persist: false, profile: 'fast', maxFaces: 6, cameraId: '', mirror: false});
export const MAX_MEMBERS = 100;
export const MAX_TEMPLATES = 12;
export const MAX_STORAGE_CHARS = 4_000_000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function unitVector(values) {
  if (!Array.isArray(values) || values.length !== 128 || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('顔の特徴量は有限な128個の数で指定してください。');
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm < 1e-8) throw new Error('空または範囲外の顔特徴量は登録できません。');
  return values.map(v => v / norm);
}

export function meanTemplate(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 30) throw new Error('顔のサンプルは1〜30枚分にしてください。');
  const vectors = samples.map(unitVector);
  return unitVector(Array.from({length: 128}, (_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length));
}

export function validateState(raw) {
  if (!plain(raw) || raw.version !== 1 || !plain(raw.settings) || !Array.isArray(raw.members) || raw.members.length > MAX_MEMBERS) throw new Error('保存データの形式が合いません。');
  const s = raw.settings;
  if (typeof s.threshold !== 'number' || !Number.isFinite(s.threshold) || s.threshold < 0 || s.threshold > 1 || ![3, 5, 10, 15, 30].includes(s.voteWindow) || typeof s.blurUnknown !== 'boolean' || typeof s.persist !== 'boolean') throw new Error('保存した設定を読み込めません。');
  const profile=s.profile===undefined?DEFAULT_SETTINGS.profile:s.profile;
  const maxFaces=s.maxFaces===undefined?DEFAULT_SETTINGS.maxFaces:s.maxFaces;
  const cameraId=s.cameraId===undefined?DEFAULT_SETTINGS.cameraId:s.cameraId;
  const mirror=s.mirror===undefined?DEFAULT_SETTINGS.mirror:s.mirror;
  if(!['fast','group'].includes(profile)||![6,12,20,30,50].includes(maxFaces)||typeof cameraId!=='string'||cameraId.length>256||/[\u0000-\u001f\u007f]/.test(cameraId)||typeof mirror!=='boolean')throw new Error('保存した撮影設定を読み込めません。');
  const ids = new Set();
  const members = raw.members.map(m => {
    if (!plain(m) || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id) || ids.has(m.id) || typeof m.name !== 'string' || !m.name.trim() || [...m.name].length > 40 || /[\u0000-\u001f\u007f]/.test(m.name) || typeof m.consentAt !== 'string' || !Number.isFinite(Date.parse(m.consentAt)) || !Number.isInteger(m.samples) || m.samples < 1 || m.samples > 30) throw new Error('登録者の情報を読み込めません。');
    ids.add(m.id);
    const templates=m.templates===undefined?[unitVector(m.embedding)]:m.templates;
    if(!Array.isArray(templates)||!templates.length||templates.length>MAX_TEMPLATES)throw new Error('登録した特徴量の件数が不正です。');
    const normalised=templates.map(unitVector);
    const embedding=m.embedding===undefined?[...normalised[0]]:unitVector(m.embedding);
    return {id: m.id, name: m.name.trim(), consentAt: m.consentAt, samples: m.samples, embedding, templates:normalised};
  });
  return {version: 1, settings: {threshold: s.threshold, voteWindow: s.voteWindow, blurUnknown: s.blurUnknown, persist: s.persist,profile,maxFaces,cameraId,mirror}, members};
}

export function emptyState() { return {version: 1, settings: {...DEFAULT_SETTINGS}, members: []}; }

export function loadState(storage) {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) return {state: emptyState(), warning: ''};
    if (value.length > MAX_STORAGE_CHARS) throw new Error('保存データが大きすぎます。');
    const state = validateState(JSON.parse(value));
    if (!state.settings.persist) return {state: emptyState(), warning: ''};
    return {state, warning: ''};
  } catch {
    return {state: emptyState(), warning: '保存データを読み込めなかったため、このページを開いている間だけ使う状態で始めました。'};
  }
}

export function saveState(state, storage) {
  const clean = validateState(state);
  try {
    if (clean.settings.persist) {
      const serialised=JSON.stringify(clean);
      if(serialised.length>MAX_STORAGE_CHARS)throw new Error('登録データが大きすぎます。');
      storage.setItem(STORAGE_KEY,serialised);
    }
    else storage.removeItem(STORAGE_KEY);
    return {ok: true, warning: ''};
  } catch {
    return {ok: false, warning: clean.settings.persist ? 'この端末に保存できませんでした。現在の登録はページを開いている間は使えます。' : '端末の保存データを削除できませんでした。ブラウザのサイトデータも確認してください。'};
  }
}

export function removeMember(state, logs, memberId) {
  return {state: {...state, members: state.members.filter(m => m.id !== memberId)}, logs: logs.filter(row => row.member_id !== memberId)};
}

/* 表計算ソフトで数式として実行されないよう、文字列セルの先頭を処理します。 */
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) && typeof value !== 'number') text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function exportCSV(rows, columns) {
  return '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n');
}
