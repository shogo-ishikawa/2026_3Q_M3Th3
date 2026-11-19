// 一つの記録は最大2 MiB。Firestoreの1文書上限に収まるよう分割し、全体を同時に更新する。
const PART_UNITS = 96 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PARTS = 32;
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function journalParts(raw) {
  if (typeof raw !== 'string' || !raw.length || new TextEncoder().encode(raw).length > MAX_BYTES) {
    throw Error('記録が保存できる大きさを超えています。');
  }
  const parts = [];
  let start = 0;
  while (start < raw.length) {
    let end = Math.min(start + PART_UNITS, raw.length);
    // サロゲートペアを二つの文書に分けると、UTF-8への変換で文字が変わる。
    if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1])) end--;
    parts.push(raw.slice(start, end));
    start = end;
  }
  return parts;
}

function header(snapshot) {
  if (!snapshot.exists()) return {revision: null, partCount: 0};
  const data = snapshot.data();
  if (!REVISION.test(data.revision) || !Number.isInteger(data.partCount) ||
      data.partCount < 1 || data.partCount > MAX_PARTS) {
    throw Error('クラウドの記録を読み込めません。');
  }
  return data;
}

export function firestoreJournal({api, db, uid, assertActive}) {
  const root = api.doc(db, 'users', uid, 'mealJournal', 'current');
  const part = index => api.doc(root, 'parts', String(index));
  return {
    async read(known) {
      return api.runTransaction(db, async transaction => {
        assertActive();
        const {revision, partCount} = header(await transaction.get(root));
        if (!revision || revision === known) return {revision};
        const docs = await Promise.all(Array.from({length: partCount}, (_, i) => transaction.get(part(i))));
        if (docs.some(doc => !doc.exists() || typeof doc.data().text !== 'string')) {
          throw Error('クラウドの記録の一部を読み込めません。');
        }
        const raw = docs.map(doc => doc.data().text).join('');
        if (new TextEncoder().encode(raw).length > MAX_BYTES) throw Error('クラウドの記録が大きすぎます。');
        return {revision, raw};
      }, {maxAttempts: 3});
    },
    async write(record) {
      const parts = journalParts(record.raw);
      return api.runTransaction(db, async transaction => {
        assertActive();
        const {revision, partCount} = header(await transaction.get(root));
        if (revision === record.id) return {revision};
        // 送信直後に端末が閉じた場合、受領を記録できなかった直系の変更も引き継ぐ。
        if (revision !== record.base && !record.ancestors.includes(revision)) return {conflict: true, revision};
        assertActive();
        transaction.set(root, {revision: record.id, partCount: parts.length});
        parts.forEach((text, i) => transaction.set(part(i), {text}));
        for (let i = parts.length; i < partCount; i++) transaction.delete(part(i));
        return {revision: record.id};
      }, {maxAttempts: 3});
    },
    watch(notify, failed) {
      return api.onSnapshot?.(root, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          try { notify(header(snapshot).revision); } catch (error) { failed(error); }
        }
      }, failed);
    }
  };
}
