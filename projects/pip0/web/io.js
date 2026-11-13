/** Browser-local file I/O. Originals are read only; every export is a new copy. */
export const LIMITS = Object.freeze({maxFiles: 500, maxFileBytes: 100 * 1024 ** 2, maxTotalBytes: 250 * 1024 ** 2, maxTextBytes: 1024 ** 2, maxImageBytes: 20 * 1024 ** 2, maxImagePixels: 16 * 1024 ** 2});
const encoder = new TextEncoder();
const TEXT_EXTENSIONS = new Set(['txt','md','csv','tsv','json','log','py','js','mjs','ts','css','html','xml','yaml','yml','toml','tex']);
const IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','gif','bmp']);
const ROOT = 'pip0-organised/';
const MANIFEST = '_pip0_manifest.json';
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const fold = value => String(value).normalize('NFKC').toLocaleLowerCase('en-GB');
const ext = value => String(value).split('.').at(-1).toLowerCase();
function checkAbort(signal) { if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError'); }
function progress(fn, done, total, name = '') { fn?.({done, total, name}); }
function notFound(error) { return error?.name === 'NotFoundError'; }
function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 900 || value.startsWith('/') || /[\\\u0000-\u001f\u007f<>:"|?*]/.test(value)) throw new Error('安全でないファイルの保存先です。');
  const parts = value.split('/');
  if (parts.length > 8 || parts.some(part => {
    const normal = part.normalize('NFKC');
    return !part || normal === '.' || normal === '..' || Array.from(part).length > 120 || encoder.encode(part).length > 255 || /[. ]$/.test(normal) || reserved.test(normal) || /[\\/\u0000-\u001f\u007f<>:"|?*]/.test(normal);
  })) throw new Error('安全でないファイルの保存先です。各名前は120文字・UTF-8で255バイト以内、階層は8段以内にしてください。');
  return parts.join('/');
}
function newId(index) { return `file-${index}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`; }

/** Select metadata only; this function never reads file content. */
export function importFiles(fileList) {
  const entries = [], skipped = [], paths = new Set();
  let total = 0;
  for (const file of Array.from(fileList ?? [])) {
    const label = String(file?.name ?? '名前のない項目').slice(0, 240);
    try {
      if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('通常のファイルではありません');
      if (entries.length >= LIMITS.maxFiles) throw new Error(`一度に扱えるのは${LIMITS.maxFiles}件までです`);
      const path = safePath(file.webkitRelativePath || file.name);
      if (paths.has(path)) throw new Error('同じパスのファイルが既にあります');
      if (file.size > LIMITS.maxFileBytes) throw new Error('1ファイル100 MiBを超えています');
      if (total + file.size > LIMITS.maxTotalBytes) throw new Error('合計250 MiBを超えています');
      paths.add(path); total += file.size;
      const modified = Number(file.lastModified);
      entries.push({id: newId(entries.length), name: path.split('/').at(-1), path, size: file.size, lastModified: Number.isFinite(modified) && modified >= 0 ? modified : 0, file, source: ''});
    } catch (error) { skipped.push(`${label}：${error.message}`); }
  }
  return {entries, skipped};
}
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > LIMITS.maxFiles) throw new Error('ファイル数の上限を超えています。');
  const ids = new Set(); let total = 0;
  for (const entry of entries) {
    safePath(entry.path);
    if (typeof entry.id !== 'string' || ids.has(entry.id)) throw new Error('ファイルの識別子が重複しています。');
    ids.add(entry.id);
    if (!entry.file || typeof entry.file.arrayBuffer !== 'function' || !Number.isSafeInteger(entry.size) || entry.size !== entry.file.size || entry.size < 0 || entry.size > LIMITS.maxFileBytes) throw new Error('ファイルのサイズを確認できません。');
    total += entry.size;
  }
  if (total > LIMITS.maxTotalBytes) throw new Error('合計250 MiBまでのファイルを選んでください。');
}
function selectedFiles(entries, rows) {
  validateEntries(entries);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const paths = new Set(), ids = new Set(), selected = [];
  if (!Array.isArray(rows) || rows.length > LIMITS.maxFiles) throw new Error('整理計画を確認できません。');
  for (const row of rows) {
    if (row.selected === false) continue;
    const entry = byId.get(row.entryId);
    if (!entry || ids.has(row.entryId)) throw new Error('整理計画のファイルが重複しているか見つかりません。');
    const path = safePath(row.targetPath);
    if (fold(path.split('/')[0]) === fold(MANIFEST) || paths.has(fold(path))) throw new Error('整理先のファイル名が重複しています。名前を変更してください。');
    const parts = path.split('/');
    if (parts.some((_, index) => paths.has(fold(parts.slice(0, index + 1).join('/')))) || [...paths].some(existing => existing.startsWith(fold(path) + '/'))) throw new Error('ファイルとフォルダーの保存先が重なっています。');
    paths.add(fold(path)); ids.add(row.entryId); selected.push({entry, row, path});
  }
  if (!selected.length) throw new Error('書き出すファイルを1件以上選んでください。');
  return selected;
}
export function planDocument(entries, rows) {
  const selected = selectedFiles(entries, rows);
  return {version: 1, app: 'pip0 Web', createdAt: new Date().toISOString(), mode: 'copy', files: selected.map(({entry, row, path}) => ({source: entry.path, destination: path, size: entry.size, lastModified: entry.lastModified, reasons: Array.isArray(row.reasons) ? row.reasons.map(reason => String(reason).slice(0, 500)).slice(0, 20) : []}))};
}

// Read dimensions before decoding. Malformed and exceptionally large images are skipped.
function imageDimensions(data, extension) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), n = data.length;
  if (extension === 'png' && n >= 24 && [137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v)) return [view.getUint32(16), view.getUint32(20)];
  if (extension === 'gif' && n >= 10 && String.fromCharCode(...data.slice(0,6)).match(/^GIF8[79]a$/)) return [view.getUint16(6,true), view.getUint16(8,true)];
  if (extension === 'bmp' && n >= 26 && data[0]===66 && data[1]===77 && view.getUint32(14,true)>=40) return [Math.abs(view.getInt32(18,true)), Math.abs(view.getInt32(22,true))];
  if ((extension === 'jpg' || extension === 'jpeg') && n > 4 && data[0]===255 && data[1]===216) {
    let at = 2;
    while (at + 3 < n) {
      if (data[at++] !== 255) break;
      while (data[at] === 255) at++;
      const marker = data[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 0 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > n) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > n) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) return [view.getUint16(at+5), view.getUint16(at+3)];
      at += length;
    }
  }
  if (extension === 'webp' && n >= 30 && String.fromCharCode(...data.slice(0,4)) === 'RIFF' && String.fromCharCode(...data.slice(8,12)) === 'WEBP') {
    const format = String.fromCharCode(...data.slice(12,16));
    if (format === 'VP8X') return [1+data[24]+(data[25]<<8)+(data[26]<<16), 1+data[27]+(data[28]<<8)+(data[29]<<16)];
    if (format === 'VP8L' && data[20] === 47) return [1+data[21]+((data[22]&63)<<8), 1+(data[22]>>6)+(data[23]<<2)+((data[24]&15)<<10)];
    if (format === 'VP8 ' && data[23]===157 && data[24]===1 && data[25]===42) return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
  }
  return null;
}
function pixelColour(r,g,b) {
  r /= 255; g /= 255; b /= 255;
  const high = Math.max(r,g,b), low = Math.min(r,g,b), delta = high-low;
  if (high < .10 || delta < .12 || delta / high < .22) return 'grey';
  let hue = high===r ? ((g-b)/delta)%6 : high===g ? (b-r)/delta+2 : (r-g)/delta+4;
  hue = (hue*60+360)%360;
  if (hue<15 || hue>=345) return 'red';
  if (hue<45) return 'orange'; if (hue<70) return 'yellow'; if (hue<165) return 'green';
  if (hue<200) return 'cyan'; if (hue<265) return 'blue'; if (hue<295) return 'purple'; return 'pink';
}
async function analyseImage(entry, signal) {
  if (entry.size > LIMITS.maxImageBytes) return {note: '画像の色を調べる対象は20 MiB以下です。'};
  const data = new Uint8Array(await entry.file.arrayBuffer()); checkAbort(signal);
  const dimensions = imageDimensions(data, ext(entry.name));
  if (!dimensions || dimensions.some(n => !Number.isInteger(n) || n <= 0 || n > 16384) || dimensions[0]*dimensions[1] > LIMITS.maxImagePixels) return {note: '画像の形式や大きさを確認できないため色を調べていません。'};
  if (typeof globalThis.createImageBitmap !== 'function') return {note: 'このブラウザでは画像の色を調べられません。'};
  const bitmap = await createImageBitmap(entry.file, {resizeWidth:64, resizeHeight:64});
  try {
    checkAbort(signal);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(64,64) : Object.assign(document.createElement('canvas'), {width:64,height:64});
    const context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) return {note:'画像の色を調べる機能が使えません。'};
    context.drawImage(bitmap,0,0,64,64);
    const pixels = context.getImageData(0,0,64,64).data, counts = new Map();
    for (let i=0;i<pixels.length;i+=4) if(pixels[i+3]>127) { const colour=pixelColour(pixels[i],pixels[i+1],pixels[i+2]); counts.set(colour,(counts.get(colour)||0)+1); }
    const dominant = [...counts].sort((a,b)=>b[1]-a[1])[0];
    return dominant ? {colour:dominant[0],note:'画像全体の主な色です。写っている物や文字は判定していません。'} : {note:'透明な画像のため主な色を判定できません。'};
  } finally { bitmap.close(); }
}
/** Explicit opt-in only. PDF and Office files are not parsed by this version. */
export async function analyseEntries(entries, {signal, onProgress} = {}) {
  validateEntries(entries); const result=[];
  for (const [index, entry] of entries.entries()) {
    checkAbort(signal); const next={...entry, text:'', analysis:{}}; const extension=ext(entry.name);
    try {
      if (TEXT_EXTENSIONS.has(extension)) {
        if (entry.size > LIMITS.maxTextBytes) next.analysis={note:'本文を調べる対象は1 MiB以下のテキストです。'};
        else {
          const data = new Uint8Array(await entry.file.arrayBuffer()); checkAbort(signal);
          const content = new TextDecoder('utf-8', {fatal:true}).decode(data);
          if (content.includes('\0')) next.analysis={note:'テキストとして読めないため本文を調べていません。'};
          else {next.text=content; next.analysis={note:'UTF-8のテキスト本文を検索と仕分けに使います。'};}
        }
      } else if (IMAGE_EXTENSIONS.has(extension)) next.analysis=await analyseImage(entry,signal);
      else next.analysis={note:'この形式はファイル名と更新日時で扱います。PDF・Officeの本文や画像内の文字は読み取りません。'};
    } catch (error) {
      if (error?.name==='AbortError' || signal?.aborted) throw error;
      next.analysis={note:'このファイルは解析できませんでした。ファイル名と更新日時で扱います。'};
    }
    result.push(next); progress(onProgress,index+1,entries.length,entry.name);
  }
  checkAbort(signal); return result;
}
async function digestFile(file, signal) {
  checkAbort(signal);
  if (!globalThis.crypto?.subtle) throw new Error('内容の確認にはHTTPSで開いた対応ブラウザが必要です。');
  const data=await file.arrayBuffer(); checkAbort(signal);
  const digest=await crypto.subtle.digest('SHA-256',data); checkAbort(signal);
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function findDuplicates(entries, {signal,onProgress} = {}) {
  validateEntries(entries); checkAbort(signal);
  const sizes=new Map(); for(const entry of entries) {const group=sizes.get(entry.size)||[];group.push(entry);sizes.set(entry.size,group);}
  const candidates=[...sizes.values()].filter(group=>group.length>1).flat(), hashes=new Map(); let done=0;
  for(const entry of candidates) {const digest=await digestFile(entry.file,signal); const key=`${entry.size}:${digest}`;const group=hashes.get(key)||[];group.push(entry.id);hashes.set(key,group);progress(onProgress,++done,candidates.length,entry.name);}
  checkAbort(signal); return [...hashes.values()].filter(group=>group.length>1);
}
const CRC_TABLE = Uint32Array.from({length:256},(_,value)=>{let c=value;for(let bit=0;bit<8;bit++) c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data) {let crc=0xffffffff;for(const value of data) crc=CRC_TABLE[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zipDate(ms) {const date=new Date(Number.isFinite(ms)&&ms>0?ms:Date.UTC(1980,0,1));const year=Math.min(2107,Math.max(1980,date.getFullYear()));return [((date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1)),((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()];}
/** Standard ZIP STORE with CRC32, UTF-8 names and a readable copy manifest. */
export async function createZip(entries, rows, {signal,onProgress} = {}) {
  const selected=selectedFiles(entries,rows); checkAbort(signal);
  const manifest=encoder.encode(JSON.stringify(planDocument(entries,rows),null,2)+'\n');
  const items=[...selected.map(({entry,path})=>({name:ROOT+path,file:entry.file,modified:entry.lastModified})),{name:ROOT+MANIFEST,file:new Blob([manifest]),modified:Date.now()}];
  const pieces=[], directory=[]; let offset=0,done=0;
  for(const item of items) {
    checkAbort(signal); const data=new Uint8Array(await item.file.arrayBuffer()); checkAbort(signal);
    const name=encoder.encode(item.name), crc=crc32(data), [time,date]=zipDate(item.modified);
    const local=new Uint8Array(30+name.length), header=new DataView(local.buffer);
    header.setUint32(0,0x04034b50,true);header.setUint16(4,20,true);header.setUint16(6,0x800,true);header.setUint16(10,time,true);header.setUint16(12,date,true);header.setUint32(14,crc,true);header.setUint32(18,data.length,true);header.setUint32(22,data.length,true);header.setUint16(26,name.length,true);local.set(name,30);
    const central=new Uint8Array(46+name.length), view=new DataView(central.buffer);
    view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x800,true);view.setUint16(12,time,true);view.setUint16(14,date,true);view.setUint32(16,crc,true);view.setUint32(20,data.length,true);view.setUint32(24,data.length,true);view.setUint16(28,name.length,true);view.setUint32(42,offset,true);central.set(name,46);
    pieces.push(local,data);directory.push(central);offset+=local.length+data.length;progress(onProgress,++done,items.length,item.name);
  }
  checkAbort(signal);
  const directorySize=directory.reduce((n,item)=>n+item.length,0), end=new Uint8Array(22), view=new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,items.length,true);view.setUint16(10,items.length,true);view.setUint32(12,directorySize,true);view.setUint32(16,offset,true);
  return new Blob([...pieces,...directory,end],{type:'application/zip'});
}
function sessionName() {const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);const random=globalThis.crypto?.randomUUID?.().slice(0,8)??Math.random().toString(36).slice(2,10);return `pip0-organised-${stamp}-${random}`;}
async function assertMissing(directory,name) {
  try {await directory.getFileHandle(name);throw new Error('既にあるファイルを上書きしないため中止しました。');}
  catch(error) {if (!notFound(error)) throw error;}
}
async function newDirectory(handle) {
  for(let attempt=0;attempt<10;attempt++) {
    const name=sessionName()+(attempt?`-${attempt}`:'');
    try {await handle.getDirectoryHandle(name);continue;} catch(error) {if(error?.name==='TypeMismatchError') continue;if(!notFound(error)) throw error;}
    const directory=await handle.getDirectoryHandle(name,{create:true});return {name,directory};
  }
  throw new Error('新しい保存先を作れませんでした。もう一度お試しください。');
}
async function writeNewFile(root,path,file,signal) {
  const parts=path.split('/');let directory=root;
  for(const part of parts.slice(0,-1)) {checkAbort(signal);directory=await directory.getDirectoryHandle(part,{create:true});}
  const name=parts.at(-1);checkAbort(signal);await assertMissing(directory,name);checkAbort(signal);
  const handle=await directory.getFileHandle(name,{create:true});let writer;
  try {writer=await handle.createWritable({keepExistingData:false});checkAbort(signal);await writer.write(file);checkAbort(signal);await writer.close();writer=null;}
  finally {if(writer) {try {await writer.abort();} catch { /* Preserve partial output, never delete. */ }}}
  checkAbort(signal);
  const result=await handle.getFile();
  if(result.size!==file.size || await digestFile(result,signal)!==await digestFile(file,signal)) throw new Error('コピーした内容が一致しません。元ファイルは変更していません。');
}
/** Copy only. This module intentionally contains no delete, rename or move operation. */
export async function copyToDirectory(handle, entries, rows, {signal,onProgress} = {}) {
  const selected=selectedFiles(entries,rows);checkAbort(signal);
  if(!handle || typeof handle.getDirectoryHandle!=='function') throw new Error('保存先のフォルダーを選び直してください。');
  if(!globalThis.crypto?.subtle) throw new Error('コピー内容の確認に対応していないためZIPで保存してください。');
  let folderName='',count=0,bytes=0;
  try {
    const created=await newDirectory(handle);folderName=created.name;checkAbort(signal);
    for(const {entry,path} of selected) {await writeNewFile(created.directory,path,entry.file,signal);count++;bytes+=entry.size;progress(onProgress,count,selected.length,entry.name);}
    const manifest=new Blob([JSON.stringify(planDocument(entries,rows),null,2)+'\n'],{type:'application/json'});
    await writeNewFile(created.directory,MANIFEST,manifest,signal);checkAbort(signal);
    return {folderName,count,bytes};
  } catch(error) {
    if(folderName) {const partial=new Error(`${error?.name==='AbortError'?'処理を中止しました。':error.message+' '}保存先の「${folderName}」には途中までのファイルが残っています（確認済み${count}件）。元ファイルは変更していません。`);partial.name=error?.name==='AbortError'?'AbortError':'Error';partial.folderName=folderName;partial.completedFiles=count;partial.partial=true;throw partial;}
    throw error;
  }
}
export function downloadBlob(blob,name) {
  const safe=String(name||'pip0-download').replace(/[\\/\u0000-\u001f<>:"|?*]/g,'_');
  const url=URL.createObjectURL(blob), anchor=document.createElement('a');anchor.href=url;anchor.download=safe;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
