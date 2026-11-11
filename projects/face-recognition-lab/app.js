import {FaceEngine, cosine, intersectionOverUnion} from './engine.js';
import {emptyState, loadState, saveState, meanTemplate, removeMember, MAX_MEMBERS, exportCSV} from './browser-store.js';

const $ = id => document.getElementById(id);
const EMOTIONS = ['中立','喜び','驚き','悲しみ','怒り','嫌悪','恐れ','軽蔑'];
const EMOTION_KEYS = ['neutral','happiness','surprise','sadness','anger','disgust','fear','contempt'];
const COLOURS = ['#9aaabe','#f4d581','#7cceff','#819dff','#ff96a5','#7cbd99','#bc9cff','#90bdb8'];
const PAGES = ['home','auth','analysis','users','logs','settings'];
const LIVE_PAGES = new Set(['auth','analysis','users']);
const CSV_COLUMNS = ['timestamp','source','member_id','member_name','similarity','threshold','decision','expression_label','expression_score','brightness','sharpness','yaw','quality','self_report',...EMOTION_KEYS.map(k => 'expression_'+k)];
const engine = new FaceEngine();
const stored = loadState({getItem: key => localStorage.getItem(key)});
let state = stored.state;
let page = 'home', stream = null, generation = 0, timer = null, loading = null;
let lastResult = null, lastFrame = null, sourceKind = '', samples = [], records = [], recording = false;
let previousFace = null, previousCandidate = undefined, votes = [], expressionEMA = null, timeline = [];
let lastRecordedAt = 0, challenge = null;
let persistenceWarning = '', inferenceQueue = Promise.resolve();
const fmt = (value, digits=1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const clamp = value => Math.max(0,Math.min(1,value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function node(tag, text='', className='') {
  const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;
}
function tell(message, error=false) {
  const text=persistenceWarning&&!message.includes(persistenceWarning)?`${message}\n${persistenceWarning}`:message;
  $('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error||!!persistenceWarning);
}
function persist() {
  const result=saveState(state,{setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)});
  persistenceWarning=result.ok?'':result.warning;
  if(!result.ok)tell(result.warning,true);
  return result;
}
function infer(source, options) {
  const result=inferenceQueue.catch(()=>{}).then(()=>engine.analyze(source,options));
  inferenceQueue=result;return result;
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `member-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function syncStats() {
  $('member-count').textContent=state.members.length;
  $('record-count').textContent=records.length;
  $('home-threshold').textContent=state.settings.threshold.toFixed(2);
  $('storage-mode').textContent=state.settings.persist?'この端末に保存':'このページの間';
  $('members-subtitle').textContent=state.settings.persist?'登録した特徴量をこの端末に保存しています。':'このページを開いている間だけ使います。';
  $('persist-status').textContent=state.settings.persist?'現在：登録した特徴量と設定をこの端末に保存します。':'現在：ページを閉じると登録データは消えます。';
}
function syncSettings() {
  $('threshold').value=state.settings.threshold;
  $('threshold-value').textContent=state.settings.threshold.toFixed(2);
  $('match-threshold').textContent=state.settings.threshold.toFixed(2);
  $('threshold-marker').style.left=state.settings.threshold*100+'%';
  $('vote-window').value=state.settings.voteWindow;
  $('blur-unknown').checked=state.settings.blurUnknown;
  $('persist-data').checked=state.settings.persist;
  syncStats();
}

async function ensureModels() {
  if(engine.ready)return;
  if(loading)return loading;
  $('load-models').disabled=true;$('load-models').textContent='読み込み中…';
  $('model-badge').textContent='モデル読込中';
  loading=engine.load(progress=>{
    $('model-status').textContent=progress.message || 'モデルを読み込んでいます。';
    $('model-progress').value=Number.isFinite(progress.percent)?progress.percent:0;
    if(LIVE_PAGES.has(page))$('source-status').textContent=progress.message || 'モデルを読み込んでいます。';
  }).then(()=>{
    $('model-badge').textContent='モデル準備完了';$('model-badge').classList.add('ready');
    $('model-progress').value=100;$('model-status').textContent='準備ができました。登録・照合・分析を始められます。';
    $('load-models').textContent='モデル準備完了';
  }).catch(error=>{
    $('load-models').disabled=false;$('load-models').textContent='もう一度読み込む';
    $('model-badge').textContent='モデル読込エラー';$('model-status').textContent=error.message;
    tell(error.message,true);throw error;
  }).finally(()=>{loading=null;});
  return loading;
}

function resetTracking() {
  previousFace=null;previousCandidate=undefined;votes=[];expressionEMA=null;challenge=null;$('self-report').value='';
}
function stopCamera({clear=false,message='カメラを停止しました。'}={}) {
  generation++;clearTimeout(timer);timer=null;
  if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
  $('source-video').srcObject=null;
  $('start-camera').disabled=false;$('stop-camera').disabled=true;
  $('camera-state').textContent=sourceKind==='image'&&!clear?'画像を選択中':'カメラ停止中';
  $('camera-state').classList.remove('live');resetTracking();
  if(clear){
    sourceKind='';lastResult=null;lastFrame=null;timeline=[];
    const c=$('preview');c.getContext('2d').clearRect(0,0,c.width,c.height);$('screen-empty').hidden=false;
    renderEmpty();
  }
  if(message)$('source-status').textContent=message;
}
function go(next, updateHash=true) {
  if(!PAGES.includes(next))next='home';
  if(next!==page){
    stopCamera({clear:true,message:'画面を切り替えたためカメラを停止しました。'});
    $('enrol-consent').checked=false;
    if(page==='users'){samples=[];$('member-name').value='';updateSamples();}
  }
  page=next;
  document.querySelectorAll('.page').forEach(section=>{section.hidden=section.id!==`page-${page}`;});
  document.querySelectorAll('nav [data-page]').forEach(link=>{
    if(link.dataset.page===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  const viewer=$('viewer');
  if(LIVE_PAGES.has(page)){
    $('viewer-slot-'+page).append(viewer);
    $('viewer-mode').textContent={users:'FACE ENROLMENT',auth:'FACE MATCH',analysis:'EXPRESSION / QUALITY'}[page];
  }else $('viewer-storage').append(viewer);
  if(updateHash && location.hash!==`#${next}`)history.replaceState(null,'',`#${next}`);
  if(page==='users')renderMembers();if(page==='logs')renderRecords();
  document.title=`${{home:'ホーム',auth:'顔を照合',analysis:'分析モード',users:'顔を登録',logs:'実験の記録',settings:'設定'}[page]}｜FACEGATE`;
}

async function startCamera() {
  if(!LIVE_PAGES.has(page))return;
  if(page==='users'&&!$('enrol-consent').checked){tell('顔を登録するときは、本人の同意にチェックを入れてください。',true);$('enrol-consent').focus();return;}
  if(!navigator.mediaDevices?.getUserMedia){tell('この環境ではカメラを利用できません。手元の画像を選んで試せます。',true);return;}
  stopCamera({clear:true,message:''});
  const token=generation;$('start-camera').disabled=true;$('source-status').textContent='モデルとカメラを準備しています…';
  try{
    await ensureModels();
    if(token!==generation||!LIVE_PAGES.has(page)||document.hidden)return;
    const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
    if(token!==generation||document.hidden){nextStream.getTracks().forEach(t=>t.stop());return;}
    stream=nextStream;sourceKind='camera';
    const video=$('source-video');video.srcObject=stream;await video.play();
    if(token!==generation){nextStream.getTracks().forEach(t=>t.stop());return;}
    $('camera-state').textContent='カメラ撮影中';$('camera-state').classList.add('live');$('stop-camera').disabled=false;
    $('source-status').textContent='映像はこのブラウザ内で処理しています。画面の切り替えでもカメラは停止します。';
    runCamera(token);
  }catch(error){
    if(token!==generation)return;
    stopCamera({clear:true,message:''});
    const reason=error.name==='NotAllowedError'?'カメラの使用が許可されませんでした。ブラウザの許可を確認するか、画像を選んでください。':error.name==='NotFoundError'?'カメラが見つかりません。画像を選んで試せます。':`カメラを開始できませんでした。${error.message}`;
    $('source-status').textContent=reason;tell(reason,true);
  }finally{if(!stream)$('start-camera').disabled=false;}
}

function snapshot(source) {
  const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
  if(!width||!height)throw Error('画像の大きさを読み取れませんでした。');
  const ratio=Math.min(1,640/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,canvas.width,canvas.height);
  return canvas;
}
async function runCamera(token) {
  if(token!==generation||!stream||document.hidden)return;
  try{
    const frame=snapshot($('source-video'));
    const result=await infer(frame,{maxFaces:3,expressions:page!=='users'});
    if(token!==generation||!stream)return;
    lastFrame=frame;lastResult=result;processResult(result,true);renderPreview();
  }catch(error){
    if(token!==generation)return;
    stopCamera({clear:true,message:''});tell(`画像を解析できませんでした。${error.message}`,true);return;
  }
  if(token===generation&&stream)timer=setTimeout(()=>runCamera(token),100);
}

async function readImage(file) {
  if(!file)return;
  if(page==='users'&&!$('enrol-consent').checked){tell('顔の登録に使う画像は、本人の同意にチェックを入れてから選んでください。',true);return;}
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15*1024*1024){tell('JPEG・PNG・WebPの15 MB以下の画像を選んでください。',true);return;}
  stopCamera({clear:true,message:''});sourceKind='image';
  const token=generation,url=URL.createObjectURL(file);$('source-status').textContent='画像を読み込んでいます…';
  try{
    const image=new Image();image.src=url;await image.decode();
    if(image.naturalWidth*image.naturalHeight>40_000_000)throw Error('画像が大きすぎます。40メガピクセル以下へ縮小してください。');
    const frame=snapshot(image);await ensureModels();
    if(token!==generation)return;
    const result=await infer(frame,{maxFaces:3,expressions:page!=='users'});
    if(token!==generation)return;
    lastFrame=frame;lastResult=result;sourceKind='image';$('camera-state').textContent='静止画を解析';
    $('source-status').textContent='静止画1枚の結果です。カメラの複数フレームによる判定とは分けて表示します。';
    processResult(result,true);renderPreview();
  }catch(error){if(token===generation){tell(`画像を解析できませんでした。${error.message}`,true);$('source-status').textContent=error.message;}}
  finally{URL.revokeObjectURL(url);$('image-file').value='';}
}

function rankingFor(face) {
  return state.members.map(member=>({member,score:cosine(face.embedding,member.embedding)})).sort((a,b)=>b.score-a.score);
}
function sameTrackedFace(face) {
  return previousFace && intersectionOverUnion(face.box,previousFace.box)>.25 && cosine(face.embedding,previousFace.embedding)>=.50;
}
function analyseMatch(face, camera=true) {
  const ranking=rankingFor(face),top=ranking[0];
  const candidate=top&&top.score>=state.settings.threshold?top.member.id:null;
  const same=sameTrackedFace(face);
  if(!same||candidate!==previousCandidate){votes=[];expressionEMA=null;timeline=[];$('self-report').value='';if(challenge){challenge=null;$('challenge-status').textContent='対象の顔または照合候補が変わったため、動きの課題を終了しました。';}}
  previousFace={box:[...face.box],embedding:[...face.embedding]};previousCandidate=candidate;
  if(camera){votes.push(candidate);votes=votes.slice(-state.settings.voteWindow);}
  const stable=!camera || (votes.length===state.settings.voteWindow&&votes.filter(v=>v===candidate).length>=Math.ceil(state.settings.voteWindow*.6));
  const decision=candidate?(stable?'matched':'pending'):(stable?'unknown':'pending');
  return {ranking,top,candidate,decision,stable};
}

function processResult(result, collect=false) {
  const face=result.faces[0];
  if(!face){resetTracking();renderEmpty();updateSamples();return;}
  const current=analyseMatch(face,sourceKind==='camera');
  // 表情の平滑化は、同じ顔・同じ照合候補の間だけ引き継ぎます。
  if(face.expression?.length===8){
    expressionEMA=expressionEMA?expressionEMA.map((value,i)=>.7*value+.3*face.expression[i]):[...face.expression];
  }
  renderMatch(face,current);renderAnalysis(face,result);
  if(collect&&expressionEMA){timeline.push([...expressionEMA]);timeline=timeline.slice(-100);drawTimeline();}
  if(collect&&recording&&(sourceKind==='image'||Date.now()-lastRecordedAt>=1000))recordFrame(face,current);
  if(collect)updateChallenge(face,current);
  updateSamples();
}

function renderEmpty() {
  $('match-name').textContent='顔が映っていません';$('match-detail').textContent=lastResult?'顔を正面から映すか、顔がはっきり写った画像を選んでください。':'カメラを開始するか、画像を選んでください。';
  $('match-score').textContent='—';$('score-fill').style.width='0';$('match-icon').textContent='◎';$('match-icon').className='result-icon';
  $('vote-status').textContent='同じ顔・同じ候補が続いたときに判定を確定します。';$('match-ranking').replaceChildren();
  $('expression-title').textContent='顔を映してみましょう';
  EMOTIONS.forEach((_,i)=>{$(`expr-value-${i}`).textContent='—';$(`expr-fill-${i}`).style.width='0';});
  for(const id of ['quality-light','quality-sharp','quality-yaw','quality-score'])$(id).textContent='—';
  $('analysis-fps').textContent='—';$('quality-advice').textContent='顔の大きさ・向き・ピントなどの目安を表示します。';
  $('challenge-status').textContent='カメラで顔が一つ映っているときに始められます。';
  drawTimeline();
}
function renderMatch(face,current) {
  const {top,decision,ranking}=current;
  $('match-score').textContent=top?fmt(top.score,3):'—';$('score-fill').style.width=top?clamp(top.score)*100+'%':'0';
  $('match-icon').className='result-icon '+decision;$('match-icon').textContent=decision==='matched'?'✓':decision==='unknown'?'×':'◎';
  $('match-name').textContent=state.members.length?(decision==='matched'?`${top.member.name}さんと一致候補`:decision==='unknown'?'一致する登録がありません':'照合を確かめています'):'照合する顔が未登録です';
  $('match-detail').textContent=state.members.length?(decision==='matched'?'登録した特徴量との類似度が、しきい値以上でした。':decision==='unknown'?'最大の類似度が、しきい値に届きませんでした。':'同じ顔・同じ候補のフレームを確認中です。'):'「顔を登録」から自分の顔を登録してから照合できます。';
  $('vote-status').textContent=sourceKind==='image'?'静止画1枚での判定です。複数フレームの確認は行っていません。':`${votes.length} / ${state.settings.voteWindow}フレーム確認。同じ候補・同じ顔が続くと確定します。`;
  $('match-ranking').replaceChildren(...ranking.slice(0,3).map(item=>{const row=node('div');row.append(node('span',item.member.name),node('b',fmt(item.score,3)));return row;}));
}
function renderAnalysis(face,result) {
  if(expressionEMA){
    const top=expressionEMA.indexOf(Math.max(...expressionEMA));
    $('expression-title').textContent=`表情ラベル：${EMOTIONS[top]}`;
    expressionEMA.forEach((value,i)=>{$(`expr-value-${i}`).textContent=Math.round(clamp(value)*100)+'%';$(`expr-fill-${i}`).style.width=clamp(value)*100+'%';});
  }
  $('analysis-fps').textContent=`処理 ${fmt(result.elapsedMs,0)} ms / 回`;
  const quality=face.quality||{};
  $('quality-light').textContent=fmt(quality.brightness,0);
  $('quality-sharp').textContent=fmt(quality.sharpness,0);
  $('quality-yaw').textContent=fmt(quality.yaw,2);
  $('quality-score').textContent=Number.isFinite(quality.score)?`${quality.score} / 100`:'—';
  $('quality-advice').textContent=Array.isArray(quality.advice)&&quality.advice.length?quality.advice.join(' '):'撮影条件の目安です。顔の向きは鼻と両目の位置関係から求めています。';
}
function drawTimeline() {
  const canvas=$('timeline'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);ctx.strokeStyle='#22364a';ctx.lineWidth=1;
  for(const p of [.25,.5,.75]){ctx.beginPath();ctx.moveTo(0,h*(1-p));ctx.lineTo(w,h*(1-p));ctx.stroke();}
  if(timeline.length<2)return;
  COLOURS.forEach((colour,index)=>{ctx.strokeStyle=colour;ctx.lineWidth=1.7;ctx.beginPath();timeline.forEach((values,i)=>{const x=i/(timeline.length-1)*w,y=(1-clamp(values[index]))*(h-10)+5;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();});
}

function renderPreview() {
  if(!lastFrame||!lastResult)return;
  const canvas=$('preview'),{width,height}=lastResult;
  canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(lastFrame,0,0,width,height);
  for(const [index,face] of lastResult.faces.entries()){
    const ranking=rankingFor(face),candidate=ranking[0]&&ranking[0].score>=state.settings.threshold;
    const confirmed=sourceKind==='image'||(index===0&&votes.length===state.settings.voteWindow&&previousCandidate===ranking[0]?.member.id);
    const known=candidate&&confirmed;
    const canEnrol=page==='users'&&$('enrol-consent').checked;
    const [x,y,w,h]=face.box;
    if(state.settings.blurUnknown&&!known&&!canEnrol){
      const x0=Math.max(0,Math.floor(x)),y0=Math.max(0,Math.floor(y)),cw=Math.min(width-x0,Math.ceil(w)),ch=Math.min(height-y0,Math.ceil(h));
      if(cw>0&&ch>0){
        const tile=document.createElement('canvas');tile.width=Math.max(1,Math.ceil(cw/18));tile.height=Math.max(1,Math.ceil(ch/18));
        tile.getContext('2d').drawImage(lastFrame,x0,y0,cw,ch,0,0,tile.width,tile.height);
        ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(tile,0,0,tile.width,tile.height,x0,y0,cw,ch);ctx.restore();
      }
    }
    const colour=known?'#77e9c0':'#7cceff';ctx.strokeStyle=colour;ctx.lineWidth=Math.max(1,width/320);ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=colour;for(const [px,py] of face.landmarks){ctx.beginPath();ctx.arc(px,py,Math.max(1.5,width/210),0,Math.PI*2);ctx.fill();}
    const label=known?`${ranking[0].member.name}候補  ${fmt(ranking[0].score,3)}`:'顔を検出';
    ctx.font=`${Math.max(12,width/46)}px sans-serif`;const labelWidth=Math.min(width,ctx.measureText(label).width+12),labelHeight=Math.max(20,width/25);
    const tx=Math.max(0,Math.min(width-labelWidth,x)),ty=Math.max(labelHeight,y);
    ctx.fillStyle='#07101de8';ctx.fillRect(tx,ty-labelHeight,labelWidth,labelHeight);ctx.fillStyle=colour;ctx.fillText(label,tx+6,ty-5);
  }
  $('screen-empty').hidden=true;
}

function updateSamples() {
  $('sample-count').textContent=samples.length;
  $('capture-sample').disabled=!(lastResult?.faces.length===1&&$('enrol-consent').checked&&samples.length<30);
  $('save-member').disabled=!(samples.length&&$('enrol-consent').checked&&$('member-name').value.trim());
}
function captureSample() {
  if(!$('enrol-consent').checked||lastResult?.faces.length!==1){tell('本人の同意を確認し、顔が一つ映るようにしてください。',true);return;}
  const face=lastResult.faces[0];
  if(face.quality?.score<40){tell('登録用の撮影条件が十分ではありません。明るさや顔の向きを変えて試してください。',true);return;}
  if(samples.length>=30)return;
  samples.push([...face.embedding]);updateSamples();$('sample-status').textContent=`${samples.length}枚分の特徴量を追加しました。顔の向きや明るさを少し変えて追加できます。`;
}
function saveMember() {
  if(!samples.length||!$('enrol-consent').checked)return;
  const name=$('member-name').value.trim();
  if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/.test(name)){tell('表示名は1〜40文字で入力してください。',true);return;}
  if(state.members.length>=MAX_MEMBERS){tell(`登録は${MAX_MEMBERS}人までです。使わない登録を削除してから追加してください。`,true);return;}
  if(state.members.some(m=>m.name===name)){tell('同じ表示名が登録されています。別の名前にするか、以前の登録を削除してください。',true);return;}
  try{
    const member={id:uid(),name,embedding:meanTemplate(samples),samples:samples.length,consentAt:new Date().toISOString()};
    state.members.push(member);samples=[];$('member-name').value='';$('enrol-consent').checked=false;
    resetTracking();persist();syncStats();renderMembers();updateSamples();renderPreview();
    $('sample-status').textContent='登録できました。照合画面で、登録に使ったものとは別の画像を試してみましょう。';
    tell(`${name}さんの特徴量を登録しました。${state.settings.persist?'この端末に保存します。':'このページを開いている間だけ使います。'}`);
  }catch(error){tell(error.message,true);}
}
function renderMembers() {
  const list=$('member-list');list.replaceChildren();
  if(!state.members.length){list.append(node('p','まだ顔が登録されていません。上の画面から登録できます。','empty'));return;}
  for(const member of state.members){
    const card=node('article','','member-card'),info=node('div'),avatar=node('div',[...member.name][0],'member-avatar');
    info.append(node('h3',member.name),node('p',`${member.samples}枚分 · ${new Date(member.consentAt).toLocaleDateString('ja-JP')}`));
    const button=node('button','削除');button.type='button';button.setAttribute('aria-label',`${member.name}の登録と関連記録を削除`);
    button.addEventListener('click',()=>{
      if(!confirm(`${member.name}さんの登録した特徴量と、このページ内の関連記録を削除しますか？`))return;
      const removed=removeMember(state,records,member.id);state=removed.state;records=removed.logs;resetTracking();persist();renderMembers();renderRecords();syncStats();
      if(lastResult)processResult(lastResult,false);renderPreview();tell(`${member.name}さんの登録と関連記録を削除しました。`);
    });
    card.append(avatar,info,button);list.append(card);
  }
}

function recordFrame(face,current) {
  const probs=expressionEMA||face.expression||[],idx=probs.length?probs.indexOf(Math.max(...probs)):-1,q=face.quality||{};
  const top=current.top,row={timestamp:new Date().toISOString(),source:sourceKind,member_id:top?.member.id||'',member_name:top?.member.name||'',similarity:top?Number(top.score.toFixed(6)):'',threshold:state.settings.threshold,decision:current.decision,expression_label:idx<0?'':EMOTION_KEYS[idx],expression_score:idx<0?'':Number(probs[idx].toFixed(6)),brightness:Number.isFinite(q.brightness)?Number(q.brightness.toFixed(3)):'',sharpness:Number.isFinite(q.sharpness)?Number(q.sharpness.toFixed(3)):'',yaw:Number.isFinite(q.yaw)?Number(q.yaw.toFixed(5)):'',quality:q.score??'',self_report:$('self-report').value};
  EMOTION_KEYS.forEach((key,i)=>{row['expression_'+key]=Number.isFinite(probs[i])?Number(probs[i].toFixed(6)):'';});
  records.push(row);if(records.length>2000)records.shift();lastRecordedAt=Date.now();syncStats();
}
function renderRecords() {
  const body=$('log-rows');body.replaceChildren();
  if(!records.length){const row=node('tr'),cell=node('td','まだ記録がありません。「実験の記録を取る」を有効にして照合・分析を試してください。');cell.colSpan=7;row.append(cell);body.append(row);}
  for(const row of [...records].reverse().slice(0,150)){
    const tr=node('tr'),labelIndex=EMOTION_KEYS.indexOf(row.expression_label);
    const result=row.decision==='matched'?`${row.member_name}と一致候補`:row.decision==='unknown'?'一致なし':'判定待ち';
    for(const text of [new Date(row.timestamp).toLocaleTimeString('ja-JP'),row.source==='image'?'画像':'カメラ',result,typeof row.similarity==='number'?fmt(row.similarity,3):'—',labelIndex>=0?EMOTIONS[labelIndex]:'—',fmt(row.brightness,0),fmt(row.yaw,2)])tr.append(node('td',text));
    body.append(tr);
  }
  $('log-summary').textContent=records.length?`${records.length}件を一時的に記録しています。画面には最新150件を表示し、CSVには全件を含めます。`:'まだ記録がありません。記録は最大2,000件です。';
  for(const id of ['export-csv','export-report','clear-logs'])$(id).disabled=!records.length;
}
function setRecording(enabled) {
  recording=enabled;$('record-enabled').checked=enabled;$('record-live').checked=enabled;lastRecordedAt=0;
  if(enabled&&lastResult&&sourceKind==='image')processResult(lastResult,true);
  renderRecords();tell(enabled?'実験の記録を開始しました。画像を含まない数値の記録を、このページ内に一時的に残します。':'実験の記録を停止しました。既に取った記録は「実験の記録」で確認できます。');
}
function download(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportReport() {
  if(!records.length)return;
  const matched=records.filter(r=>r.decision==='matched').length;
  const rows=records.slice(-300).map(r=>`<tr><td>${esc(r.timestamp)}</td><td>${esc(r.member_name)}</td><td>${esc(r.similarity)}</td><td>${esc(r.decision)}</td><td>${esc(r.expression_label)}</td><td>${esc(r.self_report)}</td></tr>`).join('');
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FACEGATE 実験レポート</title><style>body{font:15px/1.8 sans-serif;max-width:1100px;margin:40px auto;padding:0 22px;color:#172b3c}h1{font-weight:500}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #ccd5df;text-align:left;padding:8px}p{max-width:850px}.wrap{overflow:auto}</style><h1>FACEGATE 実験レポート</h1><p>記録${records.length}件、しきい値と複数フレームの条件を満たした一致候補${matched}件。画像は含みません。1件は1フレーム相当の記録で、人数・食数などの単位ではありません。</p><p>本人・別人という正解情報がないため、このレポートだけから精度や本人である確率は求められません。表情ラベルも本人の気持ちを直接測った値ではありません。全数値はCSVから分析できます。</p><h2>直近${Math.min(300,records.length)}件</h2><div class="wrap"><table><thead><tr><th>時刻</th><th>最大類似度の登録者</th><th>類似度</th><th>判定</th><th>表情ラベル</th><th>本人の申告</th></tr></thead><tbody>${rows}</tbody></table></div></html>`;
  download(html,`facegate-report-${new Date().toISOString().slice(0,10)}.html`,'text/html;charset=utf-8');
}

function startChallenge() {
  if(!stream||lastResult?.faces.length!==1){tell('動きの課題は、カメラに顔が一つ映っている状態で始めてください。',true);return;}
  const side=crypto.getRandomValues(new Uint8Array(1))[0]%2?1:-1;
  challenge={steps:[side,0,-side],step:0,held:0,start:Date.now(),embedding:[...lastResult.faces[0].embedding]};
  $('challenge-status').textContent=challengeHint(challenge.steps[0]);
}
function challengeHint(side){return side===0?'映像の中で顔を正面へ戻してください。':`映像の中で鼻が${side>0?'右':'左'}へ動くように、顔を向けてください。`;}
function updateChallenge(face) {
  if(!challenge)return;
  if(Date.now()-challenge.start>30000||lastResult.faces.length!==1||cosine(face.embedding,challenge.embedding)<.5){challenge=null;$('challenge-status').textContent='顔を追い続けられなかったか、時間を過ぎたため終了しました。もう一度始められます。';return;}
  const yaw=face.quality?.yaw,expected=challenge.steps[challenge.step];
  const success=Number.isFinite(yaw)&&(expected===0?Math.abs(yaw)<.10:expected*yaw>.18);
  challenge.held=success?challenge.held+1:0;
  if(challenge.held>=2){
    challenge.step++;challenge.held=0;
    if(challenge.step===3){challenge=null;$('challenge-status').textContent='3つの動きを確認しました。これは動きの実験結果で、なりすまし対策の性能を保証するものではありません。';return;}
    $('challenge-status').textContent=challengeHint(challenge.steps[challenge.step]);
  }
}

// 画面の組み立てとイベント。カメラはボタンが押されるまで起動しません。
EMOTIONS.forEach((label,index)=>{
  const row=node('div','','expression-row'),bar=node('i'),fill=node('em');fill.id=`expr-fill-${index}`;fill.style.background=COLOURS[index];bar.append(fill);
  const value=node('b','—');value.id=`expr-value-${index}`;row.append(node('span',label),bar,value);$('expression-bars').append(row);
  const option=node('option',label);option.value=EMOTION_KEYS[index];$('self-report').append(option);
});
document.addEventListener('click',event=>{
  const link=event.target.closest('[data-page]');if(link){event.preventDefault();go(link.dataset.page);window.scrollTo({top:0,behavior:'instant'});}
});
window.addEventListener('hashchange',()=>go(location.hash.slice(1),false));
$('load-models').addEventListener('click',()=>ensureModels().catch(()=>{}));
$('start-camera').addEventListener('click',startCamera);
$('stop-camera').addEventListener('click',()=>stopCamera({clear:true}));
$('image-file').addEventListener('change',event=>readImage(event.target.files[0]));
$('capture-sample').addEventListener('click',captureSample);
$('save-member').addEventListener('click',saveMember);
$('member-name').addEventListener('input',updateSamples);
$('enrol-consent').addEventListener('change',()=>{if(!$('enrol-consent').checked){samples=[];stopCamera({clear:true,message:'同意のチェックを外したため、カメラと登録用サンプルをリセットしました。'});}updateSamples();renderPreview();});
$('clear-samples').addEventListener('click',()=>{samples=[];updateSamples();$('sample-status').textContent='登録用のサンプルを消しました。もう一度追加できます。';});
$('record-enabled').addEventListener('change',()=>setRecording($('record-enabled').checked));
$('record-live').addEventListener('change',()=>setRecording($('record-live').checked));
$('self-report').addEventListener('change',()=>{
  if(!lastResult?.faces.length){$('self-report').value='';tell('顔を解析したあとに、その時点の気持ちを選んでください。');return;}
  if(recording&&sourceKind==='image')processResult(lastResult,true);
  else if(!recording)tell('気持ちのラベルを選びました。記録を残すときは「実験の記録を取る」を有効にしてください。');
});
$('threshold').addEventListener('input',()=>{
  state.settings.threshold=Number($('threshold').value);resetTracking();syncSettings();persist();
  if(lastResult)processResult(lastResult,false);renderPreview();
});
$('vote-window').addEventListener('change',()=>{state.settings.voteWindow=Number($('vote-window').value);resetTracking();persist();});
$('blur-unknown').addEventListener('change',()=>{state.settings.blurUnknown=$('blur-unknown').checked;persist();renderPreview();});
$('persist-data').addEventListener('change',()=>{
  state.settings.persist=$('persist-data').checked;const result=persist();syncStats();
  if(result.ok)tell(state.settings.persist?'この端末に登録した特徴量と設定を保存します。共有端末では使い終わったら削除してください。':'この端末に保存した登録データを削除し、ページを開いている間だけ使う設定にしました。');
});
$('delete-all').addEventListener('click',()=>{
  if(!confirm('登録した特徴量・表示名・設定と、このページ内の実験記録をすべて削除しますか？'))return;
  stopCamera({clear:true});state=emptyState();records=[];samples=[];recording=false;persist();
  $('record-enabled').checked=false;$('record-live').checked=false;$('enrol-consent').checked=false;$('member-name').value='';$('self-report').value='';
  syncSettings();renderMembers();renderRecords();updateSamples();tell('登録・設定・このページ内の記録を削除しました。ダウンロード済みのファイルは端末上で別途削除してください。');
});
$('export-csv').addEventListener('click',()=>{if(records.length)download(exportCSV(records,CSV_COLUMNS),`facegate-session-${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');});
$('export-report').addEventListener('click',exportReport);
$('clear-logs').addEventListener('click',()=>{if(!confirm('このページ内の実験記録をすべて削除しますか？'))return;records=[];renderRecords();syncStats();tell('実験記録を削除しました。登録した顔は残っています。');});
$('start-challenge').addEventListener('click',startChallenge);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera({clear:true,message:'ページが隠れたためカメラを停止しました。再開するときは開始ボタンを押してください。'});});
window.addEventListener('pagehide',()=>stopCamera({clear:true,message:''}));
window.addEventListener('storage',event=>{if(event.key==='facegate.browser.v1'){
  stopCamera({clear:true});const next=loadState({getItem:k=>localStorage.getItem(k)});state=next.state;records=[];samples=[];$('enrol-consent').checked=false;syncSettings();renderMembers();renderRecords();updateSamples();tell(next.warning||'別のタブで登録データが変わったため、読み直しました。');
}});
syncSettings();renderMembers();renderRecords();updateSamples();go(location.hash.slice(1)||'home',false);
if(stored.warning)tell(stored.warning,true);
