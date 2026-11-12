import { DJEngine } from './engine.js';
import { KEYS } from './core.js';
import { DEMO_CLIPS, DEMO_BPM, DEMO_BEATS, createDemoBuffer } from './demo.js';
import { saveSession, readSession, deleteSession, MAX_FILE_BYTES, MAX_PCM_BYTES, MAX_AUDIO_SECONDS } from './storage.js';

const $ = id => document.getElementById(id);
const engine = new DJEngine();
const PARTS = ['DRUMS','BASS','CHORDS','LEAD'];
const PART_JA = ['ドラム','ベース','コード','メロディ'];
const COLOURS = ['#ff917f','#eac966','#78d8c3','#bda8ff'];
let selected = 0;
let busy = false;
let recorder = null;
let recordStarted = 0;
let recordingUrl = null;
let recordPreparing = false;
let operationId = 0;
let recordLimitTimer = null;
const generations = Array(16).fill(0);
const peaks = Array.from({length:16},()=>[]);
const demoCache = new Map();
const pads = [];
let lastRender = 0;

function say(message,error=false) {
  $('status').textContent=message;
  $('status').dataset.level=error?'error':'info';
}
function action(fn) {
  return async event => {
    try { await fn(event);render(); }
    catch(error) { say(error.message || '操作を完了できませんでした。',true);refreshInspector(); }
  };
}
function formatTime(seconds) {
  const n=Math.max(0,Math.floor(seconds));
  return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;
}

// 学生版setupDiscBufferの波形集計を継承。短い音源でも空の区間を作らない。
function waveform(buffer,count=80) {
  const samples=buffer.getChannelData(0), result=[];
  for(let i=0;i<count;i++) {
    const start=Math.floor(i*samples.length/count), end=Math.max(start+1,Math.floor((i+1)*samples.length/count));
    let sum=0;
    for(let j=start;j<Math.min(end,samples.length);j++) sum+=Math.abs(samples[j]);
    result.push(sum/Math.max(1,Math.min(end,samples.length)-start));
  }
  const max=Math.max(...result,0.001);
  return result.map(v=>v/max);
}

for(let index=0;index<16;index++) {
  const part=Math.floor(index/4), card=document.createElement('article');
  card.className=`pad part-${DEMO_CLIPS[index].part}`;
  card.style.setProperty('--part-color',COLOURS[part]);
  const button=document.createElement('button');button.type='button';button.className='pad-trigger';
  button.innerHTML=`<span class="pad-top"><span class="pad-part">${PARTS[part]} ${index%4+1}</span><kbd>${KEYS[index].toUpperCase()}</kbd></span><canvas class="pad-disc" width="176" height="112" aria-hidden="true"></canvas><span class="pad-name"></span><span class="pad-status"></span>`;
  const settings=document.createElement('button');settings.type='button';settings.className='pad-select';settings.textContent='設定';settings.setAttribute('aria-label',`パッド${index+1}の設定を開く`);
  button.addEventListener('click',action(()=>trigger(index)));
  settings.addEventListener('click',()=>select(index));
  card.append(button,settings);$('pads').append(card);
  pads.push({card,button,canvas:button.querySelector('canvas'),name:button.querySelector('.pad-name'),status:button.querySelector('.pad-status'),settings});
}
for(let i=0;i<8;i++) { const dot=document.createElement('span');dot.textContent=i+1;dot.setAttribute('aria-hidden','true');$('beat-dots').append(dot); }

function select(index) { selected=index;refreshInspector();render(); }
async function trigger(index) {
  if(busy) return;
  select(index);
  if(!engine.slots[index].buffer) { say('このパッドは空です。「音源を読み込む」でファイルを選んでください。');return; }
  const operation=operationId;await engine.initialise();if(operation!==operationId)return;engine.toggle(index);
  if(!engine.running) say('再生予約を入れました。「再生」または P キーで始められます。');
}

function refreshInspector() {
  const slot=engine.slots[selected];
  $('selected-title').textContent=slot.name || `パッド ${selected+1}`;
  $('selected-description').textContent=`${PART_JA[Math.floor(selected/4)]} / キー ${KEYS[selected].toUpperCase()}${slot.buffer?` / ${slot.buffer.duration.toFixed(2)}秒`:''}`;
  $('slot-file-name').textContent=slot.buffer?(slot.kind==='demo'?'オリジナル合成デモ':slot.name):'音源はまだ読み込まれていません';
  for(const key of ['volume','pan','beats']) $(`slot-${key}`).value=slot[key];
  for(const key of ['loop','sync']) $(`slot-${key}`).checked=slot[key];
  $('slot-mute').checked=slot.muted;
  $('slot-volume-value').textContent=`${Math.round(slot.volume*100)}%`;
  $('slot-pan-value').textContent=slot.pan===0?'中央':`${slot.pan<0?'左':'右'} ${Math.round(Math.abs(slot.pan)*100)}%`;
  drawSelected();
}

function checkPcm(buffers) {
  let size=0;
  for(const buffer of buffers) if(buffer) {
    if(buffer.duration>MAX_AUDIO_SECONDS) throw new Error('音源は120秒以内の短い素材を選んでください。');
    size+=buffer.length*buffer.numberOfChannels*4;
  }
  if(size>MAX_PCM_BYTES) throw new Error('読み込む音源の合計が大きすぎます。不要なパッドを外すか、短い音源を選んでください。');
}
async function demoBuffer(index) {
  if(!demoCache.has(index)) demoCache.set(index,createDemoBuffer(engine.context,index));
  return demoCache.get(index);
}

async function loadDemo() {
  if(busy) return;
  if(engine.slots.some(s=>s.kind==='file'&&s.buffer) && !window.confirm('現在の音源をデモに置き換えます。残したい配置は、先にブラウザ保存してください。')) return;
  busy=true;const operation=++operationId;generations.forEach((_,i)=>generations[i]++);$('demo-start').disabled=true;
  try {
    say('16個のデモ音源を準備しています…');
    await engine.initialise();
    engine.stop();generations.forEach((_,i)=>generations[i]++);
    const buffers=[];
    for(let i=0;i<16;i++) {
      buffers.push(await demoBuffer(i));
      if(i%4===3) await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(operation!==operationId){say('デモの開始を取り消しました。');return;}
    checkPcm(buffers);engine.setBpm(DEMO_BPM);engine.setQuantise(8);engine.setExclusive(true);
    for(let i=0;i<16;i++) {
      engine.load(i,{buffer:buffers[i],name:DEMO_CLIPS[i].name,kind:'demo',demoId:DEMO_CLIPS[i].id,beats:DEMO_BEATS,loop:true,sync:true});
      engine.updateSlot(i,{volume:0.75,pan:0,muted:false});peaks[i]=waveform(buffers[i]);
    }
    engine.setMaster({volume:0.75,filter:1,echo:0,low:0,high:0});syncGlobalControls();select(0);
    [0,4,8,12].forEach(i=>engine.toggle(i));engine.start();
    setPerformanceMode(true);
    say('デモを再生中。別のパッドを押すと、次の8拍の頭で同じパートが切り替わります。');
  } finally { busy=false;$('demo-start').disabled=false; }
}
$('demo-start').addEventListener('click',action(loadDemo));
$('transport').addEventListener('click',action(async()=>{
  if(busy)return;
  if(engine.running){stopAll();return;}
  const operation=operationId;
  await engine.initialise();
  if(operation!==operationId)return;
  engine.start();say(engine.slots.some(s=>s.pending)?'予約した音源を再生します。':'クロックを開始しました。鳴らしたいパッドを選んでください。');
}));
$('stop-all').addEventListener('click',stopAll);
function stopAll(){operationId++;engine.stop();say('すべての音と予約を停止しました。');render();}
function setPerformanceMode(enabled){
  document.body.classList.toggle('is-performance',enabled);
  const button=$('performance-mode');
  if(button){button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'紹介も表示':'演奏モード';}
  if(enabled)$('studio').scrollIntoView({block:'start',behavior:'instant'});
}
$('performance-mode')?.addEventListener('click',()=>setPerformanceMode(!document.body.classList.contains('is-performance')));
$('bpm').addEventListener('change',action(()=>{engine.setBpm(Number($('bpm').value));syncGlobalControls();}));
$('quantise').addEventListener('change',action(()=>engine.setQuantise(Number($('quantise').value))));
$('exclusive').addEventListener('change',action(()=>engine.setExclusive($('exclusive').checked)));

for(const [id,key] of [['slot-volume','volume'],['slot-pan','pan']]) $(id).addEventListener('input',action(()=>{engine.updateSlot(selected,{[key]:Number($(id).value)});refreshInspector();}));
for(const [id,key] of [['slot-loop','loop'],['slot-sync','sync'],['slot-mute','muted']]) $(id).addEventListener('change',action(()=>{engine.updateSlot(selected,{[key]:$(id).checked});refreshInspector();}));
$('slot-beats').addEventListener('change',action(()=>engine.updateSlot(selected,{beats:Number($('slot-beats').value)})));
$('clear-slot').addEventListener('click',()=>{generations[selected]++;engine.clear(selected);peaks[selected]=[];refreshInspector();say(`パッド${selected+1}から音源を外しました。保存済みの配置には影響しません。`);});
$('derive-bpm').addEventListener('click',action(()=>{
  const slot=engine.slots[selected];if(!slot.buffer)throw new Error('先に音源を読み込んでください。');
  const bpm=Math.round(60*slot.beats/slot.buffer.duration*10)/10;
  engine.setBpm(bpm);syncGlobalControls();say(`${slot.beats}拍・${slot.buffer.duration.toFixed(2)}秒として ${bpm} BPM を設定しました。拍の自動検出ではありません。`);
}));

$('slot-file').addEventListener('change',action(async event=>{
  const file=event.target.files[0],index=selected,token=++generations[index];event.target.value='';
  if(!file)return;
  if(busy)throw new Error('音源の準備が終わるまでお待ちください。');
  if(file.size>MAX_FILE_BYTES)throw new Error('音源は1ファイル25MiB以下にしてください。');
  busy=true;
  try {
    say(`パッド${index+1}の音源を読み込んでいます…`);await engine.initialise();
    await inspectDuration(file);
    const raw=await file.arrayBuffer();let buffer;
    try {buffer=await engine.context.decodeAudioData(raw.slice(0));}
    catch {throw new Error('この音源を読み込めませんでした。MP3・WAV・OGGなど、ブラウザが対応する音声を選んでください。');}
    if(token!==generations[index])return;
    checkPcm(engine.slots.map((s,i)=>i===index?buffer:s.buffer));
    engine.load(index,{buffer,name:file.name,kind:'file',raw,beats:8,loop:true,sync:false});
    peaks[index]=waveform(buffer);if(index===selected)refreshInspector();
    say(`パッド${index+1}へ読み込みました。まずは原速で鳴らし、ループの拍数が分かる場合にBPM同期を使えます。`);
  } finally {busy=false;}
}));

// 圧縮音源を全展開する前に、ブラウザのメタデータで長さを確認する。
function inspectDuration(file){
  return new Promise((resolve,reject)=>{
    const audio=new Audio(),url=URL.createObjectURL(file);let done=false;
    const finish=(error)=>{if(done)return;done=true;audio.onloadedmetadata=audio.onerror=null;clearTimeout(timer);audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error('音源の長さを確認できませんでした。短いMP3やWAVを選んでください。')),10000);
    audio.preload='metadata';
    audio.onloadedmetadata=()=>{
      const duration=audio.duration;
      audio.onloadedmetadata=audio.onerror=null;
      finish(!Number.isFinite(duration)||duration<=0?new Error('音源の長さを確認できません。MP3やWAVなどの短い音源を選んでください。'):duration>MAX_AUDIO_SECONDS?new Error('音源は120秒以内の短い素材を選んでください。'):null);
    };
    audio.onerror=()=>{audio.onloadedmetadata=audio.onerror=null;finish(new Error('この形式の音声を読み込めませんでした。別のMP3やWAVを選んでください。'));};
    audio.src=url;
  });
}

function syncGlobalControls() {
  $('bpm').value=engine.bpm;$('quantise').value=engine.quantise;$('exclusive').checked=engine.exclusive;
  for(const [id,key] of [['master-volume','volume'],['filter','filter'],['echo','echo'],['low-eq','low'],['high-eq','high']]) $(id).value=engine.master[key];
  updateMasterLabels();
}
function updateMasterLabels() {
  $('master-volume-value').textContent=`${Math.round(engine.master.volume*100)}%`;
  $('filter-value').textContent=engine.master.filter>=0.999?'OPEN':`${Math.round(20*1000**engine.master.filter)} Hz`;
  $('echo-value').textContent=`${Math.round(engine.master.echo*100)}%`;
  $('low-eq-value').textContent=`${engine.master.low>0?'+':''}${engine.master.low} dB`;
  $('high-eq-value').textContent=`${engine.master.high>0?'+':''}${engine.master.high} dB`;
}
for(const [id,key] of [['master-volume','volume'],['filter','filter'],['echo','echo'],['low-eq','low'],['high-eq','high']]) $(id).addEventListener('input',action(()=>{engine.setMaster({[key]:Number($(id).value)});updateMasterLabels();}));

document.querySelectorAll('[data-scene]').forEach(button=>button.addEventListener('click',action(async()=>{
  if(busy)return;
  const choices={minimal:[0,4],full:[1,5,8,12],break:[9,14]},want=choices[button.dataset.scene];
  if(want.some(i=>!engine.slots[i].buffer))throw new Error('先にデモ音源を読み込んでください。');
  const operation=operationId;
  await engine.initialise();
  if(operation!==operationId)return;
  engine.setScene(want);
  if(!engine.running)engine.start();
  say(`「${button.textContent.trim()}」の組み合わせを予約しました。`);
})));

$('save-session').addEventListener('click',action(async()=>{
  if(busy)throw new Error('音源の準備が終わってから保存してください。');
  const data={version:1,bpm:engine.bpm,quantise:engine.quantise,exclusive:engine.exclusive,master:{...engine.master},slots:engine.slots.map(s=>!s.buffer?null:({name:s.name,kind:s.kind,demoId:s.demoId,raw:s.raw,volume:s.volume,pan:s.pan,beats:s.beats,loop:s.loop,sync:s.sync,muted:s.muted}))};
  await saveSession(data);say('音源と配置をこのブラウザに保存しました。前回の保存データを更新しています。');
}));
$('restore-session').addEventListener('click',action(async()=>{
  if(busy)return;
  busy=true;generations.forEach((_,i)=>generations[i]++);
  try {
    const data=await readSession();if(!data){say('保存した配置はまだありません。');return;}
    say('保存した音源を復元しています…');await engine.initialise();
    const buffers=[];
    for(const slot of data.slots) {
      if(!slot){buffers.push(null);continue;}
      if(slot.kind==='demo') {
        const index=DEMO_CLIPS.findIndex(d=>d.id===slot.demoId);
        if(index<0)throw new Error('保存したデモ音源を見つけられませんでした。');
        buffers.push(await demoBuffer(index));
      } else buffers.push(await engine.context.decodeAudioData(slot.raw.slice(0)));
      checkPcm(buffers);
    }
    checkPcm(buffers);engine.stop();generations.forEach((_,i)=>generations[i]++);
    for(let i=0;i<16;i++) {
      engine.clear(i);
      if(data.slots[i]){engine.load(i,{...data.slots[i],buffer:buffers[i]});engine.updateSlot(i,data.slots[i]);peaks[i]=waveform(buffers[i]);}
      else peaks[i]=[];
    }
    engine.setBpm(data.bpm);engine.setQuantise(data.quantise);engine.setExclusive(data.exclusive);engine.setMaster(data.master);
    syncGlobalControls();refreshInspector();say('音源と設定を復元しました。鳴らしたいパッドを選び、再生してください。');
  } finally {busy=false;}
}));
$('clear-session')?.addEventListener('click',action(async()=>{await deleteSession();say('このブラウザの保存データを削除しました。現在の音源は残っています。');}));

function recordingType() {
  for(const type of ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus']) if(MediaRecorder.isTypeSupported?.(type))return type;
  return '';
}
$('record').addEventListener('click',action(async()=>{
  if(recorder?.state==='recording'){recorder.stop();$('record').disabled=true;return;}
  if(recordPreparing||recorder)return;
  if(!globalThis.MediaRecorder)throw new Error('このブラウザは演奏の録音に対応していません。');
  recordPreparing=true;$('record').disabled=true;
  try {
  await engine.initialise();
  const chunks=[],type=recordingType();
  try {recorder=type?new MediaRecorder(engine.recordDestination.stream,{mimeType:type}):new MediaRecorder(engine.recordDestination.stream);}
  catch {recorder=new MediaRecorder(engine.recordDestination.stream);}
  const active=recorder;
  active.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  active.onerror=()=>{if(recorder===active)say('録音を続けられませんでした。もう一度お試しください。',true);};
  active.onstop=()=>{
    if(recorder!==active)return;
    clearTimeout(recordLimitTimer);
    try {
    const mime=active.mimeType||chunks[0]?.type||'audio/webm';
    const blob=new Blob(chunks,{type:mime});
    if(blob.size){
      const extension=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
      const oldUrl=recordingUrl;recordingUrl=URL.createObjectURL(blob);
      const link=$('record-download');link.href=recordingUrl;link.download=`loop-room-mix.${extension}`;link.textContent=`録音を保存 (.${extension})`;link.hidden=false;
      if(oldUrl)URL.revokeObjectURL(oldUrl);
      say('録音ができました。「録音を保存」からダウンロードできます。');
    } else say('録音データがありません。少し演奏してから録音を終了してください。',true);
    } catch {say('録音ファイルを作成できませんでした。もう一度、短い演奏を録音してみてください。',true);}
    finally {recorder=null;$('record').disabled=false;$('record').textContent='録音する';$('record').classList.remove('is-recording');}
  };
  active.start(250);recordStarted=performance.now();$('record').textContent='録音を終了';$('record').classList.add('is-recording');
  recordLimitTimer=setTimeout(()=>{if(active.state==='recording')active.stop();},10*60*1000);
  say('ミックスを録音しています。マイクの音は含まれません。');
  } catch(error){recorder=null;throw error;}
  finally {recordPreparing=false;$('record').disabled=false;}
}));

window.addEventListener('keydown',action(async event=>{
  if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
  const target=event.target;
  if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const key=event.key.toLowerCase();
  if(key==='0'){event.preventDefault();stopAll();return;}
  if(key==='p'){event.preventDefault();$('transport').click();return;}
  const index=KEYS.indexOf(key);if(index>=0){event.preventDefault();await trigger(index);}
}));

function drawDisc(pad,slot) {
  const c=pad.canvas.getContext('2d'),w=pad.canvas.width,h=pad.canvas.height,x=w/2,y=h/2,r=43;
  const colour=COLOURS[Math.floor(slot.index/4)];c.clearRect(0,0,w,h);
  c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=slot.playing?'#272b30':'#1d2025';c.fill();c.lineWidth=1;c.strokeStyle='#42464d';c.stroke();
  const values=peaks[slot.index];
  if(values.length) {
    c.beginPath();for(let i=0;i<=values.length;i++) {
      const angle=i/values.length*Math.PI*2-Math.PI/2,rad=18+values[i%values.length]*22;
      const xx=x+Math.cos(angle)*rad,yy=y+Math.sin(angle)*rad;i===0?c.moveTo(xx,yy):c.lineTo(xx,yy);
    }c.closePath();c.strokeStyle=colour;c.globalAlpha=slot.muted?0.3:0.8;c.lineWidth=1.3;c.stroke();c.globalAlpha=1;
  }
  if(slot.playing){c.beginPath();c.arc(x,y,r+4,-Math.PI/2,slot.progress*Math.PI*2-Math.PI/2);c.strokeStyle=colour;c.lineWidth=3;c.stroke();}
  c.beginPath();c.arc(x,y,8,0,Math.PI*2);c.fillStyle=colour;c.fill();
}
function drawSelected() {
  const canvas=$('selected-wave'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  c.clearRect(0,0,w,h);c.strokeStyle=COLOURS[Math.floor(selected/4)];c.lineWidth=2;
  const values=peaks[selected];
  for(let i=0;i<values.length;i++){const x=i/values.length*w,amplitude=values[i]*h*0.42;c.beginPath();c.moveTo(x,h/2-amplitude);c.lineTo(x,h/2+amplitude);c.stroke();}
  if(!values.length){c.strokeStyle='#494e56';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();}
}
const scope=$('scope'),scopeContext=scope.getContext('2d');let timeData=null,freqData=null;
function drawScope() {
  const c=scopeContext,w=scope.width,h=scope.height;c.clearRect(0,0,w,h);
  c.strokeStyle='#30343a';c.lineWidth=1;c.beginPath();c.moveTo(0,h/2);c.lineTo(w*0.68,h/2);c.stroke();
  let peak=0;
  if(engine.analyser){
    timeData??=new Float32Array(engine.analyser.fftSize);freqData??=new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getFloatTimeDomainData(timeData);engine.analyser.getByteFrequencyData(freqData);
    c.strokeStyle='#d9fa72';c.lineWidth=1.6;c.beginPath();
    for(let i=0;i<timeData.length;i++){peak=Math.max(peak,Math.abs(timeData[i]));const x=i/(timeData.length-1)*w*0.68,y=h/2-timeData[i]*h*0.42;i===0?c.moveTo(x,y):c.lineTo(x,y);}c.stroke();
    for(let i=0;i<28;i++){const at=Math.floor((i/28)**2*(freqData.length-1)),level=freqData[at]/255;c.fillStyle='#78d8c3';c.fillRect(w*0.73+i*w*0.009,h-10-level*(h-20),w*0.005,level*(h-20));}
  }
  $('peak-meter').value=Math.min(1,peak);$('peak-label').textContent=peak>0.00001?`${(20*Math.log10(peak)).toFixed(1)} dB`:'−∞ dB';
}
function render() {
  const state=engine.getSnapshot();
  $('transport').textContent=state.running?'停止':'再生';$('transport').setAttribute('aria-pressed',String(state.running));
  $('bpm').disabled=state.running||busy;$('derive-bpm').disabled=state.running||!engine.slots[selected].buffer||busy;
  $('beat-label').textContent=`${state.beat} / 8`;
  [...$('beat-dots').children].forEach((dot,i)=>dot.classList.toggle('active',state.running&&i===state.beat-1));
  const engineText=`${state.running?'PLAYING':'STOPPED'} · ${state.playingCount}音源 / ${state.queuedCount}予約`;
  if($('engine-status').textContent!==engineText)$('engine-status').textContent=engineText;
  state.slots.forEach(slot=>{
    const pad=pads[slot.index];let label=!slot.loaded?'音源を追加':slot.pending==='start'?'再生予約中':slot.pending==='stop'?'停止予約中':slot.playing?(slot.muted?'再生中・ミュート':'再生中'):'待機中';
    pad.name.textContent=slot.name||`EMPTY ${String(slot.index+1).padStart(2,'0')}`;pad.status.textContent=label;
    pad.card.classList.toggle('is-playing',slot.playing);pad.card.classList.toggle('is-queued',Boolean(slot.pending));pad.card.classList.toggle('is-selected',slot.index===selected);
    pad.button.setAttribute('aria-label',`パッド${slot.index+1} ${slot.name||'空'} ${label}。キー ${KEYS[slot.index].toUpperCase()}`);
    pad.button.setAttribute('aria-pressed',String(slot.playing||slot.pending==='start'));pad.settings.setAttribute('aria-pressed',String(slot.index===selected));
    drawDisc(pad,slot);
  });
  const editable=!state.slots[selected].playing&&!state.slots[selected].pending&&!busy;
  for(const id of ['slot-loop','slot-sync','slot-beats'])$(id).disabled=!editable;
  $('slot-file').disabled=!editable;$('restore-session').disabled=busy;$('save-session').disabled=busy;
  if(recorder?.state==='recording')$('record-time').textContent=formatTime((performance.now()-recordStarted)/1000);
  drawScope();
}
function animate(now) {if(now-lastRender>40){render();lastRender=now;}requestAnimationFrame(animate);}
window.addEventListener('pagehide',()=>{engine.stop();if(recorder?.state==='recording')recorder.stop();});
if(!globalThis.MediaRecorder){$('record').disabled=true;$('record').title='このブラウザは録音に対応していません';}
if(!globalThis.AudioContext&&!globalThis.webkitAudioContext){$('demo-start').disabled=true;$('transport').disabled=true;say('Web Audio対応のブラウザで開いてください。',true);}
syncGlobalControls();refreshInspector();render();requestAnimationFrame(animate);
