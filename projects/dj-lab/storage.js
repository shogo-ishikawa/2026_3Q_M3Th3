// 保存先はこのブラウザのIndexedDB。音声をサーバーへ送る処理はありません。
const DB_NAME = 'LoopRoomSessions';
const STORE = 'sessions';
const KEY = 'current';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PCM_BYTES = 128 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

const number = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}が不正です。`);
  return value;
};

export function validateSession(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.slots) || data.slots.length !== 16) throw new Error('この保存データには対応していません。');
  number(data.bpm, 40, 200, 'BPM');
  if (![0, 1, 4, 8].includes(data.quantise) || typeof data.exclusive !== 'boolean') throw new Error('保存した再生設定が不正です。');
  const bounds = {volume:[0,1.5],filter:[0,1],echo:[0,0.4],low:[-12,12],high:[-12,12]};
  const master = {};
  for (const [key,[min,max]] of Object.entries(bounds)) master[key] = number(data.master?.[key],min,max,key);
  let bytes = 0;
  const slots = data.slots.map((slot,index) => {
    if (slot === null) return null;
    if (!slot || !['demo','file'].includes(slot.kind)) throw new Error(`音源${index+1}の保存データが不正です。`);
    const raw = slot.raw;
    if (slot.kind === 'file' && (!(raw instanceof ArrayBuffer) || !raw.byteLength || raw.byteLength > MAX_FILE_BYTES)) throw new Error('保存した音源のサイズが不正です。');
    bytes += slot.kind === 'file' ? raw.byteLength : 0;
    if (bytes > MAX_PCM_BYTES) throw new Error('保存した音源が大きすぎます。');
    if (slot.kind === 'demo' && (typeof slot.demoId !== 'string' || slot.demoId.length > 80)) throw new Error('デモ音源の識別子が不正です。');
    for (const key of ['loop','sync','muted']) if (typeof slot[key] !== 'boolean') throw new Error('保存した音源設定が不正です。');
    return {name:String(slot.name ?? '').slice(0,180),kind:slot.kind,demoId:slot.kind==='demo'?slot.demoId:null,raw:slot.kind==='file'?raw:null,
      volume:number(slot.volume,0,1.5,'音源音量'),pan:number(slot.pan,-1,1,'パン'),beats:number(slot.beats,1,64,'拍数'),loop:slot.loop,sync:slot.sync,muted:slot.muted};
  });
  return {version:1,bpm:data.bpm,quantise:data.quantise,exclusive:data.exclusive,master,slots};
}

function openDatabase() {
  return new Promise((resolve,reject) => {
    if (!globalThis.indexedDB) return reject(new Error('このブラウザでは保存機能を使えません。'));
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('ブラウザの保存領域を開けませんでした。'));
    request.onblocked = () => reject(new Error('他のタブを閉じてから、もう一度お試しください。'));
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    let result;
    const tx = db.transaction(STORE,mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => { result=request.result; };
    tx.oncomplete = () => { db.close();resolve(result); };
    tx.onerror = tx.onabort = () => { db.close();reject(new Error('保存領域が使えません。容量やブラウザの設定を確認してください。現在の配置は変更していません。')); };
  });
}

export async function saveSession(data) {
  const clean=validateSession(data);
  await transact('readwrite',store=>store.put(clean,KEY));
}
export async function readSession() {
  const data=await transact('readonly',store=>store.get(KEY));
  return data === undefined ? null : validateSession(data);
}
export async function deleteSession() { await transact('readwrite',store=>store.delete(KEY)); }
