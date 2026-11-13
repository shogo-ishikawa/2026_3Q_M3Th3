/** pip0 Web: pure, explainable decisions. No disk, network or DOM access. */
export const DEFAULT_RULES = [
  {id:'finance',name:'予算・会計',folder:'予算・会計',keywords:['予算','見積','請求','決算','会計','経費','budget','invoice'],extensions:['.xlsx','.xls','.csv','.pdf']},
  {id:'study',name:'授業・レポート',folder:'授業・レポート',keywords:['講義','授業','レポート','課題','シラバス','演習','lecture','report'],extensions:['.pdf','.docx','.pptx']},
  {id:'meeting',name:'会議・議事録',folder:'会議・議事録',keywords:['議事録','会議','打ち合わせ','ミーティング','minutes','agenda'],extensions:['.docx','.pdf','.txt']},
  {id:'images',name:'画像・図',folder:'画像・図',keywords:['グラフ','図','写真','chart','graph'],extensions:['.png','.jpg','.jpeg','.gif','.webp','.bmp']},
  {id:'music',name:'音楽・音声',folder:'音楽・音声',keywords:['音楽','音声','録音','楽曲','music','audio'],extensions:['.mp3','.wav','.m4a','.ogg','.flac']},
  {id:'code',name:'コード・データ',folder:'コード・データ',keywords:['コード','データ','解析','code','data'],extensions:['.py','.ipynb','.js','.json','.csv']},
];

const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const BAD_COMPONENT = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const byteEncoder = new TextEncoder();
const truncate = (text, limit) => Array.from(text).slice(0,limit).join('');
const pathKey = text => String(text).normalize('NFKC').toLowerCase();
function clipStem(stem,tail) {
  let chars=Array.from(truncate(stem,Math.max(1,120-Array.from(tail).length)));
  while(chars.length>1 && byteEncoder.encode(chars.join('')+tail).length>255)chars.pop();
  return chars.join('');
}

// NFKC matches the original Python normalisation. Kana folding also lets
// 「レポート」 and 「れぽーと」 match without requiring duplicate rule words.
export function normalise(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0)-0x60));
}

function splitExtension(name) {
  const match = String(name).match(/^(.*[^.])?(\.[\p{L}\p{N}]{1,16})$/u);
  return match && match[1] ? [match[1],match[2]] : [String(name),''];
}

/** Keep the final extension while making a name portable to Windows/macOS. */
export function sanitiseName(text) {
  // Normalise identity when comparing, but preserve safe spelling in output.
  // Only portable-invalid characters and their full-width equivalents change.
  let chars=Array.from(String(text ?? '').normalize('NFC'),char=>BAD_COMPONENT.test(char.normalize('NFKC'))?'_':char);
  while(chars.length && /[ .]$/.test(chars.at(-1).normalize('NFKC')))chars.pop();
  let clean=chars.join('').trim();
  if (!clean) clean = 'ファイル';
  if (RESERVED.test(clean.normalize('NFKC'))) clean = '_' + clean;
  const [stem, ext] = splitExtension(clean);
  return clipStem(stem,ext) + ext;
}

function validRelative(path, maxDepth=8) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.length>900) return false;
  const parts=path.split('/');
  return parts.length<=maxDepth && parts.every(part => {
    const normalised=part.normalize('NFKC');
    return part && part!=='.' && part!=='..' && normalised!=='.' && normalised!=='..'
      && !BAD_COMPONENT.test(part) && !BAD_COMPONENT.test(normalised)
      && !/[ .]$/.test(part) && !/[ .]$/.test(normalised)
      && !RESERVED.test(part) && !RESERVED.test(normalised)
      && Array.from(part).length<=120 && byteEncoder.encode(part).length<=255;
  });
}

export function validateRules(input) {
  const errors=[];
  if (!Array.isArray(input) || input.length>30) return {ok:false,errors:['ルールは30件以内の配列にしてください。'],rules:[]};
  const ids=new Set(); const rules=[];
  for (let i=0;i<input.length;i++) {
    const item=input[i]; const label=`ルール${i+1}`;
    if (!item || typeof item!=='object' || Array.isArray(item)) {errors.push(`${label}はオブジェクトにしてください。`);continue;}
    if (typeof item.id!=='string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id)) errors.push(`${label}のidは重複しない半角英数字・_・-にしてください。`);
    ids.add(item.id);
    if (typeof item.name!=='string' || !item.name.trim() || item.name.length>80) errors.push(`${label}の名前は1〜80文字にしてください。`);
    if (!validRelative(item.folder,5)) errors.push(`${label}の整理先に使えない名前やパスが含まれています。`);
    if (!Array.isArray(item.keywords) || item.keywords.length>40 || item.keywords.some(word=>typeof word!=='string'||!word.trim()||word.length>50)) errors.push(`${label}のkeywordsは1語50文字以内・40語以内の文字列配列にしてください。`);
    if (!Array.isArray(item.extensions) || item.extensions.length>30 || item.extensions.some(ext=>typeof ext!=='string'||!/^\.[a-zA-Z0-9]{1,16}$/.test(ext))) errors.push(`${label}のextensionsは「.pdf」の形で30件以内にしてください。`);
    if (errors.length===0 || (typeof item.name==='string' && Array.isArray(item.keywords) && Array.isArray(item.extensions))) {
      rules.push({id:item.id,name:item.name?.trim(),folder:item.folder,keywords:[...new Map((item.keywords||[]).filter(x=>typeof x==='string').map(x=>[normalise(x.trim()),x.trim()])).values()],extensions:[...new Set((item.extensions||[]).filter(x=>typeof x==='string').map(x=>x.toLowerCase()))]});
    }
  }
  return {ok:errors.length===0,errors,rules:errors.length?[]:rules};
}

function dateString(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp<=0) return null;
  const date=new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function rankRules(entry,rules) {
  const places=[['ファイル名',entry.name],['本文',entry.text]];
  return rules.map((rule,index)=>{
    let score=0; const reasons=[];
    for (const word of rule.keywords) {
      const found=places.filter(([,value])=>normalise(value).includes(normalise(word))).map(([label])=>label);
      if(found.length) {score+=2;reasons.push(`${found.join('・')}に「${word}」（+2）`);}
    }
    const ext=splitExtension(entry.name)[1].toLowerCase();
    if(ext && rule.extensions.includes(ext)) {score+=1;reasons.push(`拡張子が ${ext}（+1）`);}
    return {rule,score,reasons,index};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
}

/** Plan data only: neither this module nor the plan modifies original files. */
export function buildPlan(entries,rules=DEFAULT_RULES,options={}) {
  if (!Array.isArray(entries) || entries.length>500) throw new Error('ファイルは500件以内にしてください。');
  const checked=validateRules(rules);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const ids=new Set();
  const planned=entries.map(entry=>{
    if (!entry || typeof entry.id!=='string' || ids.has(entry.id) || typeof entry.name!=='string' || !validRelative(entry.path)) throw new Error('ファイルの識別子または相対パスが不正です。');
    ids.add(entry.id);
    const winner=rankRules(entry,checked.rules)[0];
    const match=winner?.score>=2 ? winner : null;
    let folder=match?.rule.folder || '未分類';
    const reasons=match?[...match.reasons]:['2点以上のルールがないため未分類です。'];
    const date=dateString(entry.lastModified);
    const newName=sanitiseName(entry.name);
    if(newName!==entry.name)reasons.push('保存先で使える名前に整えます。');
    if (options.dateFolders && date) folder += '/' + date.slice(0,7);
    if (options.dateFolders && !date) reasons.push('更新日が不明なため年月フォルダーを付けていません。');
    return {entryId:entry.id,originalPath:entry.path,folder,newName,targetPath:'',selected:true,reasons,score:match?.score||0,date};
  });
  const taken=new Set(); const directories=new Set(); const counters=new Map();
  // Reserve all destination directories before allocating any filenames.
  for(const row of planned){const parts=row.folder.split('/');for(let i=1;i<=parts.length;i++)directories.add(pathKey(parts.slice(0,i).join('/')));}
  for(const row of planned) {
    const [originalStem,ext]=splitExtension(row.newName);
    if(options.renameMode==='date' && row.date) {
      row.newName=sanitiseName(`${row.date}_${originalStem}${ext}`);
      row.reasons.push('更新日を名前の先頭に付けます。');
    } else if(options.renameMode==='date') row.reasons.push('更新日が不明なため名前を残します。');
    else if(options.renameMode==='sequence') {
      const key=pathKey(row.folder); const n=(counters.get(key)||0)+1;counters.set(key,n);
      row.newName=sanitiseName(`${row.folder.split('/').filter(Boolean)[0]}_${String(n).padStart(3,'0')}${ext}`);
      row.reasons.push('整理先ごとの連番を付けます。');
    }
    const [stem,safeExt]=splitExtension(row.newName);
    let name=row.newName, number=1;
    while(taken.has(pathKey(row.folder+'/'+name))||directories.has(pathKey(row.folder+'/'+name))) {
      number++;const suffix=` (${number})`;
      name=clipStem(stem,suffix+safeExt)+suffix+safeExt;
    }
    if(name!==row.newName) row.reasons.push('同名の整理先を避けるため連番を付けます。');
    row.newName=name; row.targetPath=row.folder+'/'+name; taken.add(pathKey(row.targetPath));delete row.date;
  }
  return planned;
}

const KIND_CUES = [
  {words:['pdf'],label:'PDF',exts:['.pdf']},
  {words:['画像','写真','イメージ'],label:'画像',exts:['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif','.heic']},
  {words:['文書','資料','ドキュメント'],label:'文書',exts:['.pdf','.doc','.docx','.txt','.md','.rtf','.odt']},
  {words:['スライド'],label:'スライド',exts:['.ppt','.pptx','.odp']},
  {words:['表','スプレッドシート'],label:'表',exts:['.xlsx','.xls','.csv','.tsv','.ods']},
  {words:['音声','音楽','録音'],label:'音声',exts:['.wav','.mp3','.m4a','.ogg','.flac','.aac']},
  {words:['動画','ビデオ'],label:'動画',exts:['.mp4','.mov','.webm','.avi','.mkv']},
];
const COLOUR_CUES = [
  {words:['水色の','水色','みずいろ'],label:'水色系',colours:['cyan']},
  {words:['青色の','青色','青い','青','あおい'],label:'青系',colours:['blue','cyan']},
  {words:['赤色の','赤色','赤い','赤','あかい'],label:'赤系',colours:['red']},
  {words:['緑色の','緑色','緑の','緑','みどり'],label:'緑系',colours:['green']},
  {words:['黄色い','黄色の','黄色','きいろ'],label:'黄系',colours:['yellow']},
  {words:['紫色の','紫色','紫の','紫','むらさき'],label:'紫系',colours:['purple']},
  {words:['ピンク色の','ピンク色','ピンクの','ピンク'],label:'ピンク系',colours:['pink']},
  {words:['オレンジ色の','オレンジ色','オレンジの','オレンジ'],label:'橙系',colours:['orange']},
];
const SOURCES=['Slack','Gmail','Outlook','Teams','LINE','Dropbox','OneDrive','Googleドライブ'];

function period(word,now) {
  const date=new Date(now); const start=new Date(date.getFullYear(),date.getMonth(),date.getDate());const end=new Date(start);
  if(word==='今日')end.setDate(end.getDate()+1);
  if(word==='昨日'){start.setDate(start.getDate()-1);}
  if(word==='今月'){start.setDate(1);end.setMonth(end.getMonth()+1,1);}
  if(word==='先週') {const mondayOffset=(start.getDay()+6)%7;start.setDate(start.getDate()-mondayOffset-7);end.setTime(start.valueOf());end.setDate(end.getDate()+7);}
  return [start.valueOf(),end.valueOf()];
}

function queryCues(query,now) {
  let rest=normalise(query);const cues=[];
  for(const word of ['先週','今月','昨日','今日'])if(rest.includes(word)) {
    const [start,end]=period(word,now);cues.push({type:'time',label:`更新日：${word}`,start,end});rest=rest.replaceAll(word,' ');
  }
  for(const source of SOURCES)if(rest.includes(normalise(source))){cues.push({type:'source',label:`入手経路：${source}`,value:normalise(source)});rest=rest.replaceAll(normalise(source),' ');}
  for(const cue of COLOUR_CUES) {
    let found=false;
    for(const word of cue.words)if(rest.includes(normalise(word))) {rest=rest.replaceAll(normalise(word),' ');found=true;}
    if(found)cues.push({type:'colour',label:`画像の色：${cue.label}`,colours:cue.colours});
  }
  // Long words first avoids matching 表 inside スプレッドシート, for example.
  const kindWords=KIND_CUES.flatMap(cue=>cue.words.map(word=>({word:normalise(word),cue}))).sort((a,b)=>b.word.length-a.word.length);
  const kindSeen=new Set();
  for(const {word,cue} of kindWords)if(rest.includes(word)){rest=rest.replaceAll(word,' ');if(!kindSeen.has(cue.label)){cues.push({type:'kind',label:`種類：${cue.label}`,exts:cue.exts});kindSeen.add(cue.label);}}
  // These are connective phrases, not a claim to full natural-language parsing.
  rest=rest.replace(/(?:更新した|更新された|もらった|貰った|受け取った|ダウンロードした|探して|探す|ファイル|ください)/g,' ');
  const words=rest.split(/[\s　、。,./「」『』"'()（）\[\]:：;；・]+/u).map(w=>w.replace(/^(?:の|から|で|を|に|は|と)+|(?:の|から|で|を|に|は|と)+$/g,'')).filter(Boolean);
  for(const word of [...new Set(words)])if(!['い','な','です','した','する','ある','いる'].includes(word))cues.push({type:'keyword',label:`名前・本文：${word}`,value:word});
  return cues;
}

export function searchEntries(entries,query,{now=Date.now()}={}) {
  const cues=queryCues(String(query??'').slice(0,300),now);
  if(!cues.length)return entries.map(entry=>({entry,reasons:[],partial:false}));
  const results=[];
  for(const entry of entries) {
    const ext=splitExtension(entry.name)[1].toLowerCase();const reasons=[];let matches=0;
    for(const cue of cues) {
      let ok=false;let failure=`一致せず：${cue.label}`;
      if(cue.type==='keyword')ok=normalise(entry.name).includes(cue.value)||normalise(entry.text).includes(cue.value);
      if(cue.type==='time') {ok=Number.isFinite(entry.lastModified)&&entry.lastModified>=cue.start&&entry.lastModified<cue.end;if(!Number.isFinite(entry.lastModified)||entry.lastModified<=0)failure='更新日が不明です。';}
      if(cue.type==='kind')ok=cue.exts.includes(ext);
      if(cue.type==='source'){ok=!!entry.source&&normalise(entry.source)===cue.value;if(!entry.source)failure='入手経路の記録がありません。';}
      if(cue.type==='colour'){ok=cue.colours.includes(entry.analysis?.colour);if(!entry.analysis?.colour)failure='未確認：画像の色';}
      if(ok){matches++;reasons.push(cue.label);}else reasons.push(failure);
    }
    if(matches)results.push({entry,reasons,partial:matches<cues.length,matches});
  }
  return results.sort((a,b)=>Number(a.partial)-Number(b.partial)||b.matches-a.matches).map(({matches,...item})=>item);
}

export function formatBytes(bytes) {
  if(!Number.isFinite(bytes)||bytes<0)return '不明';
  if(bytes<1024)return `${Math.round(bytes)} B`;
  const units=['KB','MB','GB','TB'];let amount=bytes/1024;let i=0;while(amount>=1024&&i<units.length-1){amount/=1024;i++;}
  return `${amount<10?amount.toFixed(1):Math.round(amount)} ${units[i]}`;
}
