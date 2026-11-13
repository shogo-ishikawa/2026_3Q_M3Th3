import test from 'node:test';
import assert from 'node:assert/strict';
import {LIMITS, importFiles, analyseEntries, findDuplicates, createZip, copyToDirectory, planDocument} from '../io.js';
const txt = (name, text='hello', lastModified=1700000000000) => new File([text],name,{lastModified,type:'text/plain'});
const importEntry = (name,text='hello') => importFiles([txt(name,text)]).entries[0];
const row = (entry,path=`資料/${entry.name}`) => ({entryId:entry.id,targetPath:path,selected:true,reasons:['テスト用の整理先']});
const exception = (name,message=name) => Object.assign(new Error(message),{name});
class Directory {
  constructor(name='', options={}) {this.name=name;this.kind='directory';this.items=new Map();this.options=options;this.writes=0;}
  async getDirectoryHandle(name,{create=false}={}) {
    if(this.items.has(name)) {const item=this.items.get(name);if(item.kind!=='directory') throw exception('TypeMismatchError');return item;}
    if(!create) throw exception('NotFoundError');
    const directory=new Directory(name,this.options);this.items.set(name,directory);this.options.onNewDirectory?.(directory);return directory;
  }
  async getFileHandle(name,{create=false}={}) {
    if(this.items.has(name)) {const item=this.items.get(name);if(item.kind!=='file') throw exception('TypeMismatchError');return item;}
    if(!create) throw exception('NotFoundError');
    const directory=this, item={kind:'file',name,file:txt(name,''),writes:0, async getFile(){return directory.options.readCorrupt?.(name)?txt(name,'world'):this.file;}, async createWritable(){
      if(directory.options.failWrite?.(name)) throw exception('NotAllowedError','書き込みできません。');
      let pending=null;return {async write(file){pending=file;directory.options.onWrite?.(name);},async close(){item.file=new File([pending],name);item.writes++;directory.writes++;},async abort(){pending=null;directory.options.onAbort?.(name);}};
    }};
    this.items.set(name,item);return item;
  }
}

function zipEntries(data) {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength), result=[];let offset=0;
  while(view.getUint32(offset,true)===0x04034b50) {
    const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),crc=view.getUint32(offset+14,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    const name=new TextDecoder().decode(data.subarray(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extra;
    result.push({name,flags,method,crc,bytes:data.slice(start,start+size)});offset=start+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  const end=data.length-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+8,true),result.length);assert.equal(view.getUint32(end+16,true),offset);
  return result;
}

test('import records relative metadata without reading contents',()=>{
  const file=txt('report.txt');let reads=0;file.arrayBuffer=()=>{reads++;throw new Error('unexpected');};
  Object.defineProperty(file,'webkitRelativePath',{value:'授業/report.txt'});
  const {entries,skipped}=importFiles([file]);assert.equal(reads,0);assert.equal(skipped.length,0);assert.equal(entries[0].path,'授業/report.txt');assert.equal(entries[0].source,'');assert.equal(entries[0].lastModified,1700000000000);
});
test('import rejects traversal, absolute paths, reserved names and duplicate paths',()=>{
  const list=['../secret.txt','/absolute.txt','C:\\secret.txt','a//b.txt','a/./b.txt','NUL.txt','bad?.txt','okay.txt','okay.txt'].map(name=>txt(name));
  const {entries,skipped}=importFiles(list);assert.deepEqual(entries.map(e=>e.path),['okay.txt']);assert.equal(skipped.length,8);
});
test('import caps count and size before content reading',()=>{
  const {entries,skipped}=importFiles(Array.from({length:501},(_,i)=>txt(`${i}.txt`)));assert.equal(entries.length,500);assert.equal(skipped.length,1);
  const oversized=txt('large.txt');Object.defineProperty(oversized,'size',{value:LIMITS.maxFileBytes+1});assert.equal(importFiles([oversized]).entries.length,0);
  const fake=n=>({name:`${n}.txt`,size:100*1024**2,lastModified:1,arrayBuffer(){throw new Error('must not read');}});
  const total=importFiles([fake(1),fake(2),fake(3)]);assert.equal(total.entries.length,2);assert.equal(total.skipped.length,1);
});
test('opt-in analysis returns new entries and leaves input untouched',async()=>{
  const entry=importEntry('report.txt','予算資料と青いグラフ');const result=await analyseEntries([entry]);assert.equal(result[0].text,'予算資料と青いグラフ');assert.equal(entry.text,undefined);assert.notEqual(result[0],entry);
});
test('analysis skips SVG, PDF and Office content and oversized text',async()=>{
  const entries=['picture.svg','document.pdf','book.docx'].map(name=>{const e=importEntry(name,'<script>untrusted()</script>');e.file.arrayBuffer=()=>{throw new Error('must not read');};return e;});
  const large=importEntry('large.txt','x'.repeat(LIMITS.maxTextBytes+1));const output=await analyseEntries([...entries,large]);assert.ok(output.every(e=>!e.text));assert.match(output.at(-1).analysis.note,/1 MiB/);
});
test('invalid UTF-8 and NUL content are not treated as readable text',async()=>{
  const binary=importFiles([new File([new Uint8Array([0xff,0xfe,0x80])],'bad.txt')]).entries[0];const nul=importEntry('nul-content.txt','a\0b');const result=await analyseEntries([binary,nul]);assert.ok(result.every(e=>!e.text));
});
test('malformed raster images do not invoke a decoder',async()=>{
  const entry=importEntry('bad.png','bad image');let calls=0;const old=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>{calls++;throw new Error('unexpected');};
  try {const result=await analyseEntries([entry]);assert.equal(calls,0);assert.equal(result[0].analysis.colour,undefined);} finally {if(old)globalThis.createImageBitmap=old;else delete globalThis.createImageBitmap;}
});
test('duplicate check uses content not filenames and hashes only equal-size candidates',async()=>{
  const a=importEntry('a.txt','hello'),b=importEntry('b.txt','hello'),c=importEntry('a.txt','world'),d=importEntry('unique.txt','length is unique');d.file.arrayBuffer=()=>{throw new Error('unique size need not be read');};
  assert.deepEqual(await findDuplicates([a,b,c,d]),[[a.id,b.id]]);
});
test('analysis, hashing and ZIP respect cancellation',async()=>{
  const controller=new AbortController();controller.abort();const entry=importEntry('a.txt');
  for(const operation of [()=>analyseEntries([entry],{signal:controller.signal}),()=>findDuplicates([entry],{signal:controller.signal}),()=>createZip([entry],[row(entry)],{signal:controller.signal})]) await assert.rejects(operation,error=>error.name==='AbortError');
});
test('ZIP stores exact bytes, UTF-8 paths, correct CRC32 and manifest in a single root',async()=>{
  const entry=importEntry('日本語.txt','hello'), excluded=importEntry('excluded.txt','secret');const rows=[row(entry,'授業/日本語.txt'),{...row(excluded),selected:false}];
  const blob=await createZip([entry,excluded],rows);assert.equal(blob.type,'application/zip');const items=zipEntries(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(items.length,2);assert.equal(items[0].name,'pip0-organised/授業/日本語.txt');assert.equal(new TextDecoder().decode(items[0].bytes),'hello');assert.equal(items[0].crc,0x3610a686);assert.equal(items[0].flags,0x800);assert.equal(items[0].method,0);
  const manifest=JSON.parse(new TextDecoder().decode(items[1].bytes));assert.equal(items[1].name,'pip0-organised/_pip0_manifest.json');assert.equal(manifest.mode,'copy');assert.equal(manifest.files[0].source,'日本語.txt');assert.equal(manifest.files[0].destination,'授業/日本語.txt');assert.equal(manifest.files.length,1);
});
test('ZIP refuses unsafe targets and normalised name/path conflicts',async()=>{
  const a=importEntry('a.txt'),b=importEntry('b.txt');
  for(const target of ['../evil.txt','/evil.txt','a\\b.txt','CON','a/../b','a//b','a/.','a/．/b','a/／b','COM¹.txt','LPT².log','fullwidth：colon.txt','fullwidth＼slash.txt','trail．','trail　']) await assert.rejects(()=>createZip([a],[row(a,target)]));
  await assert.rejects(()=>createZip([a,b],[row(a,'Data/A.txt'),row(b,'data/a.TXT')]),/重複/);
  await assert.rejects(()=>createZip([a,b],[row(a,'a'),row(b,'A/b')]),/重な/);
  await assert.rejects(()=>createZip([a,b],[row(a,'A/b'),row(b,'a')]),/重な/);
  await assert.rejects(()=>createZip([a],[row(a,'_pip0_manifest.json')]),/重複/);
  await assert.rejects(()=>createZip([a],[row(a,'_pip0_manifest.json/child.txt')]),/重複/);
});
test('plan refuses modified size metadata or repeated entry identifiers',()=>{
  const entry=importEntry('a.txt');assert.throws(()=>planDocument([{...entry,size:200}],[row(entry)]),/サイズ/);assert.throws(()=>planDocument([entry,entry],[row(entry)]),/識別/);
});
test('folder copy creates fresh output, checks contents, includes manifest and preserves source',async()=>{
  const parent=new Directory(),entry=importEntry('a.txt','original');const sentinel=await parent.getFileHandle('existing.txt',{create:true});sentinel.file=txt('existing.txt','existing');
  const result=await copyToDirectory(parent,[entry],[row(entry)]);assert.equal(result.count,1);assert.equal(result.bytes,8);assert.match(result.folderName,/^pip0-organised-/);
  const root=parent.items.get(result.folderName);const output=root.items.get('資料').items.get('a.txt');assert.equal(await output.file.text(),'original');assert.equal(output.writes,1);assert.ok(root.items.has('_pip0_manifest.json'));assert.equal(await entry.file.text(),'original');assert.equal(await sentinel.file.text(),'existing');assert.equal(sentinel.writes,0);
});
test('folder copy never writes a pre-existing destination file',async()=>{
  let existing;const parent=new Directory('',{onNewDirectory(directory){if(directory.name==='資料'){existing={kind:'file',name:'a.txt',writes:0,file:txt('a.txt','keep'),async getFile(){return this.file;},async createWritable(){this.writes++;throw new Error('must not overwrite');}};directory.items.set('a.txt',existing);}}});
  const entry=importEntry('a.txt');await assert.rejects(()=>copyToDirectory(parent,[entry],[row(entry)]),error=>!!error.folderName&&error.completedFiles===0&&/途中/.test(error.message));assert.equal(existing.writes,0);assert.equal(await existing.file.text(),'keep');
});
test('folder copy avoids an existing session directory',async()=>{
  const parent=new Directory();const original=parent.getDirectoryHandle.bind(parent);let first=true,existing;
  parent.getDirectoryHandle=async(name,options={})=>{if(first&&!options.create){first=false;existing=new Directory(name);parent.items.set(name,existing);return existing;}return original(name,options);};
  const entry=importEntry('a.txt');const result=await copyToDirectory(parent,[entry],[row(entry)]);assert.notEqual(result.folderName,existing.name);assert.equal(existing.items.size,0);
});
test('copy verification failure reports its partial output directory',async()=>{
  const parent=new Directory('',{readCorrupt:name=>name==='a.txt'}),entry=importEntry('a.txt');await assert.rejects(()=>copyToDirectory(parent,[entry],[row(entry)]),error=>error.partial&&error.completedFiles===0&&/一致/.test(error.message)&&/元ファイル/.test(error.message));assert.equal(await entry.file.text(),'hello');
});
test('copy cancellation after one file keeps originals and reports completed count',async()=>{
  const controller=new AbortController(), parent=new Directory(),a=importEntry('a.txt'),b=importEntry('b.txt');
  await assert.rejects(()=>copyToDirectory(parent,[a,b],[row(a),row(b)],{signal:controller.signal,onProgress(){controller.abort();}}),error=>error.name==='AbortError'&&error.completedFiles===1&&error.partial);
  assert.equal(await a.file.text(),'hello');assert.equal(await b.file.text(),'hello');
});
test('cancelling before copy creates no output directory',async()=>{
  const controller=new AbortController();controller.abort();const parent=new Directory(),entry=importEntry('a.txt');await assert.rejects(()=>copyToDirectory(parent,[entry],[row(entry)],{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(parent.items.size,0);
});
test('copy permission failure leaves a named partial output and does not fall back',async()=>{
  const parent=new Directory('',{failWrite:name=>name==='b.txt'}),a=importEntry('a.txt'),b=importEntry('b.txt');await assert.rejects(()=>copyToDirectory(parent,[a,b],[row(a),row(b)]),error=>error.partial&&error.completedFiles===1&&/書き込みできません/.test(error.message));assert.equal(await b.file.text(),'hello');
});


test('import skips overlong Unicode components and paths deeper than eight levels',()=>{
  const longCodepoints=txt('a'.repeat(121)+'.txt');
  const longBytes=txt('日'.repeat(85)+'.txt');
  const deep=txt('report.txt');Object.defineProperty(deep,'webkitRelativePath',{value:'a/b/c/d/e/f/g/h/report.txt'});
  const boundary=txt('a'.repeat(116)+'.txt');
  const result=importFiles([longCodepoints,longBytes,deep,boundary]);assert.equal(result.entries.length,1);assert.equal(result.entries[0].name,boundary.name);assert.equal(result.skipped.length,3);
});
test('manual output names exceeding UTF-8 filesystem bounds are rejected before writing',async()=>{
  const entry=importEntry('a.txt');const target='資料/'+ '日'.repeat(85)+'.txt';const parent=new Directory();
  await assert.rejects(()=>copyToDirectory(parent,[entry],[row(entry,target)]),/255バイト/);assert.equal(parent.items.size,0);
  await assert.rejects(()=>createZip([entry],[row(entry,target)]),/255バイト/);
});
test('manual output paths deeper than eight levels are rejected before writing',async()=>{
  const entry=importEntry('a.txt'),parent=new Directory();await assert.rejects(()=>copyToDirectory(parent,[entry],[row(entry,'a/b/c/d/e/f/g/h/a.txt')]),/8段/);assert.equal(parent.items.size,0);
});
