import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RULES,normalise,sanitiseName,validateRules,buildPlan,searchEntries,formatBytes} from '../core.js';
import {makeDemoEntries} from '../demo.js';

const entry=(id,name,extra={})=>({id,name,path:name,size:12,lastModified:new Date(2026,10,13,12).valueOf(),...extra});
const rule=(id,folder,keywords=[],extensions=[])=>({id,name:folder,folder,keywords,extensions});

test('original score is +2 per distinct keyword and +1 per extension',()=>{
  const [row]=buildPlan([entry('x','予算見積.pdf',{text:'予算見積の本文'})]);
  assert.equal(row.folder,'予算・会計');assert.equal(row.score,5);
  assert.deepEqual(row.reasons,['ファイル名・本文に「予算」（+2）','ファイル名・本文に「見積」（+2）','拡張子が .pdf（+1）']);
});
test('extension alone is below threshold and tie uses stable rule order',()=>{
  const e=entry('a','abc.pdf');assert.equal(buildPlan([e])[0].folder,'未分類');
  assert.equal(buildPlan([entry('a','match.pdf')],[rule('a','先',['match']),rule('b','後',['match'])])[0].folder,'先');
});
test('full-width Latin, decomposed characters and kana match',()=>{
  assert.equal(normalise('ＲＥＰＯＲＴ'),'report');assert.equal(normalise('レポート'),normalise('れぽーと'));
  assert.equal(normalise('カ\u3099'),normalise('ガ'));
  assert.equal(buildPlan([entry('a','ＲＥＰＯＲＴ.pdf')])[0].folder,'授業・レポート');
});
test('same-named distinct files retain separate deconflicted destinations',()=>{
  const rows=buildPlan([entry('a','レポート.txt',{path:'a/レポート.txt'}),entry('b','レポート.txt',{path:'b/レポート.txt'})]);
  assert.equal(rows[0].newName,'レポート.txt');assert.equal(rows[1].newName,'レポート (2).txt');assert.equal(rows.length,2);
});
test('case and Unicode-normalised destination collisions use suffixes',()=>{
  const rows=buildPlan([entry('a','Report.PDF'),entry('b','report.pdf'),entry('c','Ｒｅｐｏｒｔ.pdf')]);
  assert.deepEqual(rows.map(row=>row.newName),['Report.PDF','report (2).pdf','Ｒｅｐｏｒｔ (3).pdf']);
});
test('a file cannot shadow a directory needed by another row',()=>{
  const rules=[rule('a','root',['alpha']),rule('b','root/alpha',['beta'])];
  const rows=buildPlan([entry('a','alpha'),entry('b','beta')],rules);
  assert.equal(rows[0].targetPath,'root/alpha (2)');assert.equal(rows[1].targetPath,'root/alpha/beta');
});
test('file safety covers Windows devices, control characters and extension preservation',()=>{
  assert.equal(sanitiseName('CON.txt'),'_CON.txt');assert.equal(sanitiseName('x\u0000y?.txt'),'x_y_.txt');
  assert.equal(sanitiseName('../'),'.._');assert.equal(sanitiseName(' . '),'ファイル');
  const long=sanitiseName('a'.repeat(200)+'.PDF');assert.equal(long.length,120);assert.ok(long.endsWith('.PDF'));
});
test('rules reject traversal, absolute paths, DOS names, controls and duplicate IDs',()=>{
  for(const folder of ['../out','/tmp','C:/tmp','a\\b','a//b','a/./b','a/..','CON','a/NUL.txt','x.','x\u0000','．．/out','a／b','a＼b','a：b','ＣＯＮ.txt','com¹','LPT².txt','x．','x　']){
    assert.equal(validateRules([rule('a',folder)]).ok,false,folder);
  }
  assert.equal(validateRules([rule('a','a'),rule('a','b')]).ok,false);
  assert.equal(validateRules([{...rule('a','a'),extensions:['pdf']}]).ok,false);
  assert.equal(validateRules([{...rule('a','a'),keywords:['']}]).ok,false);
  assert.equal(validateRules(DEFAULT_RULES).ok,true);
});
test('normalised unsafe source paths are rejected before creating a plan',()=>{
  for(const path of ['a／b.txt','a＼b.txt','．．/a.txt','a：b.txt','a/ＣＯＮ.txt','a/x．','a/x　']) {
    assert.throws(()=>buildPlan([entry('a',path.split('/').at(-1),{path})]),/不正/,path);
  }
});
test('sanitised filenames preserve safe Unicode and replace full-width forbidden punctuation',()=>{
  assert.equal(sanitiseName('ｒｅｐｏｒｔ：１２／３.txt'),'ｒｅｐｏｒｔ_１２_３.txt');
  assert.equal(sanitiseName('ＣＯＮ.txt'),'_ＣＯＮ.txt');
  assert.equal(sanitiseName('com¹.txt'),'_com¹.txt');
  assert.equal(sanitiseName('Ｒｅｐｏｒｔ１２.pdf'),'Ｒｅｐｏｒｔ１２.pdf');
  assert.equal(sanitiseName('資料．　'),'資料');
  assert.equal(sanitiseName('．．'),'ファイル');
  assert.equal(buildPlan([entry('safe','Ｒｅｐｏｒｔ１２.pdf')])[0].newName,'Ｒｅｐｏｒｔ１２.pdf');
});
test('validation does not mutate rules and folds duplicate words',()=>{
  const input=[rule('a','a',['Budget','ＢＵＤＧＥＴ'],['.PDF','.pdf'])];const before=JSON.stringify(input);
  const checked=validateRules(input);assert.equal(JSON.stringify(input),before);assert.equal(checked.rules[0].keywords.length,1);assert.deepEqual(checked.rules[0].extensions,['.pdf']);
});
test('plan rejects duplicate IDs and unsafe original relative paths',()=>{
  assert.throws(()=>buildPlan([entry('a','ok',{path:'../bad'})]),/不正/);
  assert.throws(()=>buildPlan([entry('a','a'),entry('a','b')]),/不正/);
});
test('date renaming explicitly uses local updated date and missing dates remain unknown',()=>{
  const rows=buildPlan([entry('a','講義.txt'),entry('b','議事録.txt',{lastModified:0})],DEFAULT_RULES,{renameMode:'date',dateFolders:true});
  assert.equal(rows[0].targetPath,'授業・レポート/2026-11/2026-11-13_講義.txt');
  assert.equal(rows[1].targetPath,'会議・議事録/議事録.txt');assert.ok(rows[1].reasons.some(x=>x.includes('更新日が不明')));
});
test('sequence names keep extensions and per-folder counters',()=>{
  const rows=buildPlan([entry('a','講義.PDF'),entry('b','授業.pdf'),entry('c','会議.txt')],DEFAULT_RULES,{renameMode:'sequence'});
  assert.deepEqual(rows.map(r=>r.newName),['授業・レポート_001.PDF','授業・レポート_002.pdf','会議・議事録_001.txt']);
});
test('long multibyte filenames remain below portable UTF-8 component limits after renaming',()=>{
  const name='日'.repeat(83)+'.pdf';
  const e=[entry('a',name,{path:'a/'+name}),entry('b',name,{path:'b/'+name})];
  const rows=buildPlan(e,DEFAULT_RULES,{renameMode:'date'});
  assert.notEqual(rows[0].newName,rows[1].newName);
  for(const row of rows){assert.ok(new TextEncoder().encode(row.newName).length<=255);assert.ok(row.newName.endsWith('.pdf'));}
  assert.ok(rows[1].newName.includes(' (2)'));
});
test('time query last week uses Monday inclusive to next Monday exclusive',()=>{
  const now=new Date(2026,10,13,12).valueOf();
  const entries=[entry('before','before.pdf',{lastModified:new Date(2026,10,1,23,59,59).valueOf()}),entry('start','start.pdf',{lastModified:new Date(2026,10,2).valueOf()}),entry('end','end.pdf',{lastModified:new Date(2026,10,9).valueOf()})];
  assert.deepEqual(searchEntries(entries,'先週',{now}).map(r=>r.entry.id),['start']);
});
test('yesterday and month queries do not approximate months as 30 days',()=>{
  const now=new Date(2026,2,1,12).valueOf();const e=[entry('y','memo.txt',{lastModified:new Date(2026,1,28,23).valueOf()}),entry('t','new.txt',{lastModified:new Date(2026,2,1).valueOf()})];
  assert.deepEqual(searchEntries(e,'昨日',{now}).map(r=>r.entry.id),['y']);assert.deepEqual(searchEntries(e,'今月',{now}).map(r=>r.entry.id),['t']);
});
test('unknown colour and unknown source never become affirmative matches',()=>{
  const e=[entry('a','blue.png'),entry('b','slack.pdf')];
  assert.deepEqual(searchEntries(e,'青い'),[]);assert.deepEqual(searchEntries(e,'Slack'),[]);
  const partial=searchEntries(e,'Slack PDF');assert.equal(partial[0].partial,true);assert.ok(partial[0].reasons.includes('入手経路の記録がありません。'));
});
test('full matches precede explicitly labelled partial matches',()=>{
  const entries=[entry('a','report.txt'),entry('b','report.pdf'),entry('c','nothing.pdf')];const results=searchEntries(entries,'report PDF');
  assert.equal(results[0].entry.id,'b');assert.equal(results[0].partial,false);assert.ok(results.slice(1).every(x=>x.partial));
});
test('image colour searches use analysed colour, not filename guesses',()=>{
  const e=[entry('a','赤い画像.png',{analysis:{colour:'blue'}}),entry('b','青い画像.png',{analysis:{colour:'red'}})];
  assert.deepEqual(searchEntries(e,'青い').map(r=>r.entry.id),['a']);
});
test('text search covers opt-in extracted text and empty search preserves order',()=>{
  const e=[entry('a','download.txt',{text:'予算の確認'}),entry('b','other.txt')];
  assert.deepEqual(searchEntries(e,'予算').map(r=>r.entry.id),['a']);assert.deepEqual(searchEntries(e,'').map(r=>r.entry.id),['a','b']);
});
test('byte display handles zero, large values and missing data',()=>{
  assert.equal(formatBytes(0),'0 B');assert.equal(formatBytes(1024),'1.0 KB');assert.equal(formatBytes(1024**3),'1.0 GB');assert.equal(formatBytes(NaN),'不明');
});
test('demo files are genuine bytes with one exact duplicate and two different same-name files',async()=>{
  const demo=makeDemoEntries(new Date(2026,10,13,12).valueOf());assert.equal(demo.length,15);
  for(const item of demo)assert.equal(item.size,(await item.file.arrayBuffer()).byteLength);
  const images=demo.filter(e=>e.name.endsWith('.png'));assert.equal(images.length,3);
  assert.deepEqual(new Uint8Array(await images[0].file.arrayBuffer()),new Uint8Array(await images[1].file.arrayBuffer()));
  const pdfFile=demo.find(e=>e.name==='report.pdf');assert.ok((await pdfFile.file.text()).startsWith('%PDF-1.4'));
  const same=demo.filter(e=>e.name==='レポート.txt');assert.equal(same.length,2);assert.notEqual(await same[0].file.text(),await same[1].file.text());
  const blue=searchEntries(demo,'青い画像');assert.equal(blue.filter(r=>!r.partial).length,2);
});
