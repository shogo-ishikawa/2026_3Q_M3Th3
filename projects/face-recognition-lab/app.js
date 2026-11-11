import {FaceInferenceClient} from './inference-client.js';
import {cosine} from './engine.js';
import {MultiFaceTracker, MATCH_LIMITS} from './tracking.js';
import {emptyState, loadState, saveState, removeMember, MAX_MEMBERS, MAX_TEMPLATES, exportCSV} from './browser-store.js';

const $ = id => document.getElementById(id);
const EMOTIONS = ['中立','喜び','驚き','悲しみ','怒り','嫌悪','恐れ','軽蔑'];
const EMOTION_KEYS = ['neutral','happiness','surprise','sadness','anger','disgust','fear','contempt'];
const COLOURS = ['#9aaabe','#f4d581','#7cceff','#819dff','#ff96a5','#7cbd99','#bc9cff','#90bdb8'];
const PAGES = ['home','auth','analysis','users','logs','settings'];
const LIVE_PAGES = new Set(['auth','analysis','users']);
const CSV_COLUMNS = ['timestamp','source','track_id','frame_key','profile','member_id','member_name','similarity','threshold','decision','pending_reason','expression_label','expression_score','brightness','sharpness','yaw','quality','self_report',...EMOTION_KEYS.map(k=>'expression_'+k)];
const engine = new FaceInferenceClient();
const tracker = new MultiFaceTracker();
const stored = loadState({getItem:key=>localStorage.getItem(key)});
let state=stored.state, page='home', stream=null, generation=0, timer=null, loading=null;
let lastResult=null,lastFrame=null,sourceKind='',samples=[],records=[],recording=false,currentTracks=[];
let selectedTrackId=null,challenge=null,autoEnrol=null,frameKey='',lastVideoTime=-1,lastCycleAt=0,updateRate=null;
let persistenceWarning='',inferenceQueue=Promise.resolve();
const recordTimes=new Map();
const fmt=(value,digits=1)=>Number.isFinite(value)?value.toFixed(digits):'—';
const clamp=value=>Math.max(0,Math.min(1,value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function node(tag,text='',className=''){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function tell(message,error=false){const text=persistenceWarning&&!message.includes(persistenceWarning)?`${message}\n${persistenceWarning}`:message;$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error||!!persistenceWarning);}
function persist(){const result=saveState(state,{setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)});persistenceWarning=result.ok?'':result.warning;if(!result.ok)tell(result.warning,true);return result;}
function infer(source,options){const result=inferenceQueue.catch(()=>{}).then(()=>engine.analyze(source,options));inferenceQueue=result;return result;}
function uid(){return crypto.randomUUID?crypto.randomUUID():`member-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
function backendText(){return engine.backend==='worker-wasm'?'別スレッドで画像処理':engine.backend==='main-wasm'?'この画面のスレッドで画像処理':'処理環境の準備前';}
function syncStats(){
  $('member-count').textContent=state.members.length;$('record-count').textContent=records.length;$('home-threshold').textContent=state.settings.threshold.toFixed(2);
  $('storage-mode').textContent=state.settings.persist?'この端末に保存':'このページの間';
  $('members-subtitle').textContent=`${state.members.length} / ${MAX_MEMBERS}人 · ${state.settings.persist?'この端末に保存':'ページを開いている間だけ'}`;
  $('persist-status').textContent=state.settings.persist?'現在：登録した特徴量と設定をこの端末に保存します。':'現在：ページを閉じると登録データは消えます。';
  $('backend-info').textContent=backendText()+(engine.fallbackReason?'。この環境では画面側の処理に切り替えています。':'');
}
function syncSettings(){
  for(const id of ['threshold'])$(id).value=state.settings.threshold;
  $('threshold-value').textContent=state.settings.threshold.toFixed(2);$('match-threshold').textContent=state.settings.threshold.toFixed(2);$('threshold-marker').style.left=state.settings.threshold*100+'%';
  $('vote-window').value=state.settings.voteWindow;$('blur-unknown').checked=state.settings.blurUnknown;$('persist-data').checked=state.settings.persist;
  for(const id of ['profile','live-profile'])$(id).value=state.settings.profile;
  for(const id of ['max-faces','live-max-faces'])$(id).value=state.settings.maxFaces;
  $('mirror-camera').checked=state.settings.mirror;$('camera-select').value=state.settings.cameraId||'';syncStats();
}
function progressDisplay(progress){
  const message=progress.message||'モデルを準備しています。';$('model-status').textContent=message;$('model-progress').value=Number.isFinite(progress.percent)?progress.percent:0;
  if(LIVE_PAGES.has(page))$('source-status').textContent=message;
}
async function ensureModels(){
  if(engine.ready)return;if(loading)return loading;
  $('load-models').disabled=true;$('load-models').textContent='読み込み中…';$('model-badge').textContent='モデル読込中';
  loading=engine.load(progressDisplay).then(()=>{$('model-badge').textContent='照合モデル準備完了';$('model-badge').classList.add('ready');$('model-progress').value=100;$('model-status').textContent='照合の準備ができました。表情モデルは分析モードを使うときに読み込みます。';$('load-models').textContent='モデル準備完了';syncStats();})
    .catch(error=>{$('load-models').disabled=false;$('load-models').textContent='もう一度読み込む';$('model-badge').textContent='モデル読込エラー';$('model-status').textContent=error.message;tell(error.message,true);throw error;}).finally(()=>{loading=null;});
  return loading;
}
function resetTracking(){tracker.reset();currentTracks=[];selectedTrackId=null;challenge=null;recordTimes.clear();$('self-report').value='';renderPersonSelector();renderCrowd();}
function endAutoEnrol(message='自動撮影を停止しました。'){autoEnrol=null;$('auto-enrol-status').textContent=message;updateSamples();}
function stopCamera({clear=false,message='カメラを停止しました。'}={}){
  generation++;clearTimeout(timer);timer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  $('source-video').srcObject=null;$('start-camera').disabled=false;$('stop-camera').disabled=true;$('camera-state').textContent=sourceKind==='image'&&!clear?'画像を選択中':'カメラ停止中';$('camera-state').classList.remove('live');
  resetTracking();endAutoEnrol();lastVideoTime=-1;lastCycleAt=0;updateRate=null;
  if(clear){sourceKind='';lastResult=null;lastFrame=null;frameKey='';const c=$('preview');c.getContext('2d').clearRect(0,0,c.width,c.height);$('screen-empty').hidden=false;renderEmpty();renderCrowd();updateSamples();}
  if(message)$('source-status').textContent=message;
}
function go(next,updateHash=true){
  if(!PAGES.includes(next))next='home';
  if(next!==page){stopCamera({clear:true,message:'画面を切り替えたためカメラを停止しました。'});$('enrol-consent').checked=false;if(page==='users'){samples=[];$('member-name').value='';updateSamples();}}
  page=next;document.querySelectorAll('.page').forEach(section=>{section.hidden=section.id!==`page-${page}`;});
  document.querySelectorAll('nav [data-page]').forEach(link=>{if(link.dataset.page===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  if(LIVE_PAGES.has(page)){$('viewer-slot-'+page).append($('viewer'));$('viewer-mode').textContent={users:'FACE ENROLMENT',auth:'FACE MATCH',analysis:'EXPRESSION / QUALITY'}[page];}else $('viewer-storage').append($('viewer'));
  if(updateHash&&location.hash!==`#${next}`)history.replaceState(null,'',`#${next}`);
  if(page==='users')renderMembers();if(page==='logs')renderRecords();document.title=`${{home:'ホーム',auth:'顔を照合',analysis:'分析モード',users:'顔を登録',logs:'実験の記録',settings:'設定'}[page]}｜FACEGATE 発展版`;
}
async function refreshCameras(quiet=false){
  if(!navigator.mediaDevices?.enumerateDevices){if(!quiet)tell('この環境ではカメラ一覧を取得できません。',true);return;}
  try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const select=$('camera-select');select.replaceChildren(new Option('標準のカメラ',''));
    devices.forEach((d,i)=>select.append(new Option(d.label||`カメラ${i+1}`,d.deviceId)));if(state.settings.cameraId&&!devices.some(d=>d.deviceId===state.settings.cameraId)){select.append(new Option('保存したカメラ（未接続）',state.settings.cameraId));}select.value=state.settings.cameraId||'';
    if(!quiet)tell(devices.length?`${devices.length}台のカメラが見つかりました。`:'カメラが見つかりません。画像からも試せます。');
  }catch(error){if(!quiet)tell(`カメラ一覧を取得できませんでした。${error.message}`,true);}
}
async function startCamera(){
  if(!LIVE_PAGES.has(page))return;
  if(page==='users'&&!$('enrol-consent').checked){tell('顔を登録するときは、本人の同意にチェックを入れてください。',true);$('enrol-consent').focus();return;}
  if(!navigator.mediaDevices?.getUserMedia){tell('この環境ではカメラを利用できません。手元の画像を選んで試せます。',true);return;}
  stopCamera({clear:true,message:''});const token=generation;$('start-camera').disabled=true;$('source-status').textContent='モデルとカメラを準備しています…';
  try{await ensureModels();if(token!==generation||!LIVE_PAGES.has(page)||document.hidden)return;
    const group=state.settings.profile==='group'&&page!=='users';const videoOptions={width:{ideal:group?1920:640},height:{ideal:group?1080:480}};
    if(state.settings.cameraId)videoOptions.deviceId={exact:state.settings.cameraId};else videoOptions.facingMode='user';
    const nextStream=await navigator.mediaDevices.getUserMedia({video:videoOptions,audio:false});
    if(token!==generation||document.hidden){nextStream.getTracks().forEach(t=>t.stop());return;}
    stream=nextStream;sourceKind='camera';const video=$('source-video');video.srcObject=stream;await video.play();
    if(token!==generation){nextStream.getTracks().forEach(t=>t.stop());return;}
    $('camera-state').textContent='カメラ撮影中';$('camera-state').classList.add('live');$('stop-camera').disabled=false;$('source-status').textContent=`カメラ ${video.videoWidth}×${video.videoHeight}。処理したフレームの結果を表示します。画面切り替え・非表示でも停止します。`;refreshCameras(true);updateSamples();runCamera(token);
  }catch(error){if(token!==generation)return;stopCamera({clear:true,message:''});const message=error.name==='NotAllowedError'?'カメラの使用が許可されませんでした。画像を選んで試せます。':error.name==='NotFoundError'?'カメラが見つかりません。画像を選んで試せます。':error.name==='OverconstrainedError'?'選択したカメラを使えません。設定で接続するカメラを選び直してください。':`カメラを開始できませんでした。${error.message}`;$('source-status').textContent=message;tell(message,true);
  }finally{if(!stream)$('start-camera').disabled=false;}
}
function snapshot(source){const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;if(!width||!height)throw Error('画像の大きさを読み取れませんでした。');const max=state.settings.profile==='group'&&page!=='users'?1920:640,ratio=Math.min(1,max/Math.max(width,height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(width*ratio));c.height=Math.max(1,Math.round(height*ratio));c.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,c.width,c.height);return c;}
function inferenceOptions(){return {profile:page==='users'?'fast':state.settings.profile,maxFaces:page==='users'?6:state.settings.maxFaces,expressions:page==='analysis'};}
async function runCamera(token){
  if(token!==generation||!stream||document.hidden)return;
  const video=$('source-video'),time=video.currentTime;if(!Number.isFinite(time)||time===lastVideoTime){timer=setTimeout(()=>runCamera(token),40);return;}lastVideoTime=time;
  try{const frame=snapshot(video),key=`camera:${token}:${time}`;const result=await infer(frame,inferenceOptions());if(token!==generation||!stream)return;lastFrame=frame;lastResult=result;frameKey=key;const now=performance.now();updateRate=lastCycleAt?1000/(now-lastCycleAt):null;lastCycleAt=now;processResult(result,true);renderPreview();
  }catch(error){if(token!==generation)return;stopCamera({clear:true,message:''});tell(`画像を解析できませんでした。${error.message}`,true);return;}
  if(token===generation&&stream)timer=setTimeout(()=>runCamera(token),16);
}
async function readImage(file){
  if(!file)return;if(page==='users'&&!$('enrol-consent').checked){tell('顔の登録に使う画像は、本人の同意にチェックを入れてから選んでください。',true);return;}
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15*1024*1024){tell('JPEG・PNG・WebPの15 MB以下の画像を選んでください。',true);return;}
  stopCamera({clear:true,message:''});sourceKind='image';const token=generation,url=URL.createObjectURL(file);$('source-status').textContent='画像を読み込んでいます…';
  try{const image=new Image();image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>40_000_000)throw Error('画像が大きすぎます。40メガピクセル以下へ縮小してください。');const frame=snapshot(image);await ensureModels();if(token!==generation)return;const result=await infer(frame,inferenceOptions());if(token!==generation)return;
    lastFrame=frame;lastResult=result;frameKey=`image:${token}:${uid()}`;sourceKind='image';$('camera-state').textContent='静止画を解析';$('source-status').textContent='静止画1枚の照合結果です。写真・動画の実在確認は行っていません。';processResult(result,true);renderPreview();
  }catch(error){if(token===generation){tell(`画像を解析できませんでした。${error.message}`,true);$('source-status').textContent=error.message;}}finally{URL.revokeObjectURL(url);$('image-file').value='';}
}
function processResult(result,collect=false){
  currentTracks=tracker.update(result.faces,{members:state.members,threshold:state.settings.threshold,voteWindow:state.settings.voteWindow,frameKey,nowMs:performance.now(),camera:sourceKind==='camera',generation});
  if(!currentTracks.some(t=>String(t.trackId??t.id)===String(selectedTrackId)))selectedTrackId=currentTracks[0]?(currentTracks[0].trackId??currentTracks[0].id):null;
  if(!currentTracks.length){challenge=null;renderEmpty();}else{renderPersonSelector();renderSelected();if(collect)updateChallenge();}
  renderCrowd();updateSamples();if(collect&&recording)recordCurrent();if(collect&&autoEnrol)collectAutoSample();syncStats();
}
function selectedTrack(){return currentTracks.find(t=>String(t.trackId??t.id)===String(selectedTrackId))||null;}
function selectTrack(id){if(String(id)!==String(selectedTrackId)){challenge=null;$('challenge-status').textContent='確認する顔を切り替えました。動作確認は改めて開始できます。';}selectedTrackId=id;renderPersonSelector();renderSelected();renderCrowd();renderPreview();}
function trackLabel(track){const n=track.trackId??track.id;return `顔 #${n} · ${track.candidate&&track.top?track.top.member.name:'候補未確定'}`;}
function renderPersonSelector(){const select=$('analysis-person'),ids=currentTracks.map(t=>String(t.trackId??t.id));const previous=[...select.options].map(o=>o.value);if(ids.join('|')!==previous.join('|')){select.replaceChildren();if(!currentTracks.length)select.append(new Option('顔を解析してから選べます',''));else currentTracks.forEach(t=>select.append(new Option(trackLabel(t),String(t.trackId??t.id))));}else currentTracks.forEach((t,i)=>{select.options[i].textContent=trackLabel(t);});select.value=selectedTrackId==null?'':String(selectedTrackId);}
function renderEmpty(){
  $('match-name').textContent=lastResult?'顔が映っていません':'準備ができたら、照合を。';$('match-detail').textContent='カメラを開始するか、顔がはっきり写った画像を選んでください。';$('match-score').textContent='—';$('score-fill').style.width='0';$('match-icon').textContent='◎';$('match-icon').className='result-icon';$('vote-status').textContent='異なるフレームで、顔ごとに判定を確かめます。';$('match-ranking').replaceChildren();
  $('expression-title').textContent='顔を映してみましょう';EMOTIONS.forEach((_,i)=>{$(`expr-value-${i}`).textContent='—';$(`expr-fill-${i}`).style.width='0';});for(const id of ['quality-light','quality-sharp','quality-yaw','quality-score'])$(id).textContent='—';$('analysis-fps').textContent='—';$('quality-advice').textContent='条件が不足する場合は判定を保留します。';$('self-report').value='';$('challenge-status').textContent='カメラで解析し、確認する顔を選んでから始められます。';renderPersonSelector();drawTimeline([]);
}
function decisionText(track){if(track.decision==='matched')return '一致候補';if(track.decision==='unknown')return '一致なし';return track.pendingReason||'確認中';}
function renderSelected(){
  const track=selectedTrack();if(!track){renderEmpty();return;}const {top,decision,ranking=[]}=track;
  $('match-score').textContent=top?fmt(top.score,3):'—';$('score-fill').style.width=top?clamp(top.score)*100+'%':'0';$('match-icon').className='result-icon '+decision;$('match-icon').textContent=decision==='matched'?'✓':decision==='unknown'?'×':'◎';
  $('match-name').textContent=!state.members.length?'照合する顔が未登録です':decision==='matched'?`${top.member.name}さんと一致候補`:decision==='unknown'?'一致する登録がありません':track.candidate&&top?`${top.member.name}さんの候補を確認中`:'判定を保留しています';
  $('match-detail').textContent=!state.members.length?'「顔を登録」から登録してください。':decision==='matched'?'この処理フレームで、一致条件を満たしました。生身の人物であることの確認とは別です。':track.pendingReason||'しきい値に届く候補がありません。';
  $('vote-status').textContent=sourceKind==='image'?'静止画1枚の判定です。時間方向の確認や実在確認は行いません。':`顔 #${track.trackId??track.id} · ${track.votesSeen??0} / ${track.votesRequired??state.settings.voteWindow}フレーム確認`;
  $('match-ranking').replaceChildren(...ranking.slice(0,3).map(item=>{const row=node('div');row.append(node('span',item.member.name),node('b',fmt(item.score,3)));return row;}));
  const probs=track.expressionEMA||track.expression;if(probs?.length===8){const topExpression=probs.indexOf(Math.max(...probs));$('expression-title').textContent=`表情ラベル：${EMOTIONS[topExpression]}`;probs.forEach((value,i)=>{$(`expr-value-${i}`).textContent=Math.round(clamp(value)*100)+'%';$(`expr-fill-${i}`).style.width=clamp(value)*100+'%';});}else{$('expression-title').textContent='表情分類は分析モードで計算します';EMOTIONS.forEach((_,i)=>{$(`expr-value-${i}`).textContent='—';$(`expr-fill-${i}`).style.width='0';});}
  const q=track.quality||{};$('analysis-fps').textContent=`処理 ${fmt(lastResult?.elapsedMs,0)} ms / 回`;$('quality-light').textContent=fmt(q.brightness,0);$('quality-sharp').textContent=fmt(q.sharpness,0);$('quality-yaw').textContent=fmt(q.yaw,2);$('quality-score').textContent=Number.isFinite(q.score)?`${q.score} / 100`:'—';$('quality-advice').textContent=q.advice?.length?q.advice.join(' '):'撮影条件の目安です。';$('self-report').value=track.selfReport||'';drawTimeline(track.timeline||[]);
}
function renderCrowd(){
  const matched=currentTracks.filter(t=>t.decision==='matched'),unknown=currentTracks.filter(t=>t.decision==='unknown'),pending=currentTracks.filter(t=>t.decision==='pending');const people=new Set(matched.map(t=>t.top?.member.id).filter(Boolean)).size;
  $('crowd-summary').textContent=lastResult?`検出 ${lastResult.detectedCount??lastResult.faces.length}顔 · 処理 ${currentTracks.length}顔 · 一致候補 ${matched.length}顔（登録${people}人分） · 一致なし ${unknown.length}顔 · 確認中 ${pending.length}顔`:'顔ごとの結果は、カメラや画像を解析すると表示します。';
  const parts=[];if(lastResult){parts.push(`処理 ${fmt(lastResult.elapsedMs,0)} ms / 回`);if(updateRate)parts.push(`更新 約${fmt(updateRate,1)}回 / 秒`);if(lastResult.limitedCount)parts.push(`上限により未処理 ${lastResult.limitedCount}顔`);if(lastResult.smallFaceCount)parts.push(`顔が小さめ ${lastResult.smallFaceCount}顔`);if(lastResult.failedCount)parts.push(`位置合わせを確認できず未処理 ${lastResult.failedCount}顔`);}parts.push('顔が小さい・不鮮明・候補が重なる場合は保留します。');$('crowd-advice').textContent=parts.join(' · ');
  const cards=$('face-cards');cards.replaceChildren();for(const track of currentTracks){const id=track.trackId??track.id,button=node('button','','face-card '+track.decision+(String(id)===String(selectedTrackId)?' selected':''));button.type='button';button.setAttribute('aria-label',`顔 ${id}の結果を選ぶ`);button.setAttribute('aria-pressed',String(String(id)===String(selectedTrackId)));button.append(node('span',`顔 #${id}`,'face-number'),node('strong',track.candidate&&track.top?track.top.member.name:'候補未確定'),node('span',decisionText(track),'face-decision'),node('small',`類似度 ${track.top?fmt(track.top.score,3):'—'} · ${sourceKind==='image'?'画像1枚':`${track.votesSeen??0}/${track.votesRequired??state.settings.voteWindow}フレーム`}`));button.addEventListener('click',()=>selectTrack(id));cards.append(button);}
}
function drawTimeline(values){const canvas=$('timeline'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#22364a';for(const p of [.25,.5,.75]){ctx.beginPath();ctx.moveTo(0,h*(1-p));ctx.lineTo(w,h*(1-p));ctx.stroke();}if(values.length<2)return;COLOURS.forEach((colour,index)=>{ctx.strokeStyle=colour;ctx.lineWidth=1.7;ctx.beginPath();values.forEach((point,i)=>{const probs=Array.isArray(point)?point:point.values||point.probabilities||[];const x=i/(values.length-1)*w,y=(1-clamp(probs[index]||0))*(h-10)+5;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();});}
function renderPreview(){
  if(!lastFrame||!lastResult)return;const canvas=$('preview'),{width,height}=lastResult;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');const mirror=state.settings.mirror&&sourceKind==='camera';ctx.save();if(mirror){ctx.translate(width,0);ctx.scale(-1,1);}ctx.drawImage(lastFrame,0,0,width,height);ctx.restore();
  // 人数上限や位置合わせの失敗で未処理になった顔も、未知の顔として扱う。
  for(const face of lastResult.unprocessedFaces||[]){
    const [sx,y,w,h]=face.box,x=mirror?width-sx-w:sx;
    if(state.settings.blurUnknown){const x0=Math.max(0,Math.floor(sx)),y0=Math.max(0,Math.floor(y)),cw=Math.min(width-x0,Math.ceil(w)),ch=Math.min(height-y0,Math.ceil(h));if(cw>0&&ch>0){const tile=document.createElement('canvas');tile.width=Math.max(1,Math.ceil(cw/18));tile.height=Math.max(1,Math.ceil(ch/18));tile.getContext('2d').drawImage(lastFrame,x0,y0,cw,ch,0,0,tile.width,tile.height);ctx.save();ctx.imageSmoothingEnabled=false;if(mirror){ctx.translate(width,0);ctx.scale(-1,1);}ctx.drawImage(tile,0,0,tile.width,tile.height,x0,y0,cw,ch);ctx.restore();}}
    ctx.strokeStyle='#9aacbf';ctx.lineWidth=Math.max(1,width/640);ctx.setLineDash([5,4]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillStyle='#d0dbe7';ctx.font=`${Math.max(12,Math.min(22,w*.18))}px sans-serif`;ctx.fillText('未処理',Math.max(0,x+3),Math.max(14,y-4));
  }
  for(const track of currentTracks){const known=track.decision==='matched',canEnrol=page==='users'&&$('enrol-consent').checked;const [sx,y,w,h]=track.box,x=mirror?width-sx-w:sx;
    if(state.settings.blurUnknown&&!known&&!canEnrol){const x0=Math.max(0,Math.floor(sx)),y0=Math.max(0,Math.floor(y)),cw=Math.min(width-x0,Math.ceil(w)),ch=Math.min(height-y0,Math.ceil(h));if(cw>0&&ch>0){const tile=document.createElement('canvas');tile.width=Math.max(1,Math.ceil(cw/18));tile.height=Math.max(1,Math.ceil(ch/18));tile.getContext('2d').drawImage(lastFrame,x0,y0,cw,ch,0,0,tile.width,tile.height);ctx.save();ctx.imageSmoothingEnabled=false;if(mirror){ctx.translate(width,0);ctx.scale(-1,1);}ctx.drawImage(tile,0,0,tile.width,tile.height,x0,y0,cw,ch);ctx.restore();}}
    const selected=String(track.trackId??track.id)===String(selectedTrackId),colour=known?'#77e9c0':track.decision==='unknown'?'#ff96a5':'#7cceff';ctx.strokeStyle=colour;ctx.lineWidth=Math.max(1,(selected?3:1.5)*width/640);ctx.strokeRect(x,y,w,h);ctx.fillStyle=colour;for(const [px,py] of track.landmarks||[]){ctx.beginPath();ctx.arc(mirror?width-px:px,py,Math.max(1.5,width/400),0,Math.PI*2);ctx.fill();}
    const name=known?`${track.top.member.name}候補`:track.candidate&&track.top&&track.decision==='pending'?`${track.top.member.name} 確認中`:track.decision==='unknown'?'一致なし':'判定保留';const label=currentTracks.length>12?`#${track.trackId??track.id} ${known?'✓':track.decision==='unknown'?'×':'…'}`:`#${track.trackId??track.id} ${name}`;ctx.font=`${Math.max(12,Math.min(24,w*.18))}px sans-serif`;const tw=Math.min(width,ctx.measureText(label).width+12),th=Math.max(20,width/28),tx=Math.max(0,Math.min(width-tw,x)),ty=Math.max(th,y);ctx.fillStyle='#07101de8';ctx.fillRect(tx,ty-th,tw,th);ctx.fillStyle=colour;ctx.fillText(label,tx+6,ty-5);
  }$('screen-empty').hidden=true;
}
function singleRegistrationFace(){
  if(!lastResult||lastResult.faces.length!==1||(lastResult.detectedCount??lastResult.faces.length)!==1||(lastResult.unprocessedCount||0)>0||lastResult.unprocessedFaces?.length)return null;
  return lastResult.faces[0];
}
function registrationQuality(face){return face&&Number.isFinite(face.quality?.score)&&face.quality.score>=70&&Number.isFinite(face.quality.face_size)&&Math.min(face.quality.face_size,face.box[2],face.box[3])>=MATCH_LIMITS.faceSize;}
function updateSamples(){$('sample-count').textContent=samples.length;const can=registrationQuality(singleRegistrationFace())&&$('enrol-consent').checked&&samples.length<MAX_TEMPLATES;$('capture-sample').disabled=!can||!!autoEnrol;$('save-member').disabled=!(samples.length&&$('enrol-consent').checked&&$('member-name').value.trim())||!!autoEnrol;$('auto-enrol').disabled=!stream||!$('enrol-consent').checked||samples.length>=MAX_TEMPLATES||!!autoEnrol;$('stop-enrol').disabled=!autoEnrol;
  if(page==='users'&&lastResult){const face=singleRegistrationFace();$('sample-status').textContent=!face?'顔を一つだけ映してください。未処理の顔がある場合も登録を保留します。':!registrationQuality(face)?`現在の撮影条件 ${fmt(face.quality?.score,0)}点。登録には70点以上と十分な顔の大きさが必要です。`:`${samples.length} / ${MAX_TEMPLATES}枚分。撮影条件 ${fmt(face.quality.score,0)}点で追加できます。`;}
}
function captureSample(automatic=false){
  if(!$('enrol-consent').checked||!singleRegistrationFace()){if(!automatic)tell('本人の同意を確認し、未処理の顔を含めて顔が一つだけ映るようにしてください。',true);return false;}const face=singleRegistrationFace();
  if(!registrationQuality(face)){if(!automatic)tell('登録には撮影条件70点以上と、十分な顔の大きさが必要です。近づいて明るさや顔の向きを変えてください。',true);return false;}
  if(samples.length&&Math.max(...samples.map(v=>cosine(v,face.embedding)))<.5){if(automatic)endAutoEnrol('対象の顔が変わった可能性があるため、自動撮影を停止しました。');tell('同じ人のサンプルを続けて追加してください。別の人は登録を完了してから追加できます。',true);return false;}
  if(samples.length>=MAX_TEMPLATES)return false;samples.push([...face.embedding]);updateSamples();$('sample-status').textContent=`${samples.length} / ${MAX_TEMPLATES}枚分の特徴量を追加しました。`;return true;
}
function startAutoEnrol(){if(!stream||!$('enrol-consent').checked||!singleRegistrationFace()){tell('同意を確認し、カメラに顔を一つだけ映してから始めてください。',true);return;}autoEnrol={target:Math.min(MAX_TEMPLATES,samples.length+Number($('auto-shots').value)),lastAt:0,lastKey:null};$('auto-enrol-status').textContent='同じ人のまま、少し向きや明るさを変えてください。';updateSamples();}
function collectAutoSample(){if(!autoEnrol)return;if(!singleRegistrationFace()){$('auto-enrol-status').textContent='未処理の顔も含め、顔が一つだけ映るのを待っています。';return;}const now=performance.now();if(autoEnrol.lastKey===frameKey||now-autoEnrol.lastAt<600)return;autoEnrol.lastKey=frameKey;if(!registrationQuality(singleRegistrationFace())){$('auto-enrol-status').textContent='撮影条件70点以上と、十分な顔の大きさになるのを待っています。';return;}if(captureSample(true)&&autoEnrol){autoEnrol.lastAt=now;$('auto-enrol-status').textContent=`${samples.length} / ${autoEnrol.target}枚分を収集。顔の向きを少し変えてください。`;if(samples.length>=autoEnrol.target)endAutoEnrol('必要なサンプルを集めました。名前を確認して登録してください。');}}
function saveMember(){
  if(!samples.length||!$('enrol-consent').checked)return;const name=$('member-name').value.trim();if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/.test(name)){tell('表示名は1〜40文字で入力してください。',true);return;}if(state.members.length>=MAX_MEMBERS){tell(`登録は${MAX_MEMBERS}人までです。`,true);return;}if(state.members.some(m=>m.name===name)){tell('同じ表示名があります。以前の登録を削除するか別の名前にしてください。',true);return;}
  try{const member={id:uid(),name,templates:samples.map(v=>[...v]),embedding:[...samples[0]],samples:samples.length,consentAt:new Date().toISOString()};state.members.push(member);samples=[];endAutoEnrol();$('member-name').value='';$('enrol-consent').checked=false;resetTracking();persist();syncStats();renderMembers();updateSamples();if(lastResult)processResult(lastResult,false);renderPreview();$('sample-status').textContent='登録できました。登録とは別の画像でも試してみましょう。';tell(`${name}さんの特徴量を登録しました。${state.settings.persist?'この端末に保存します。':'このページを開いている間だけ使います。'}`);}catch(error){tell(error.message,true);}
}
function renderMembers(){const list=$('member-list');list.replaceChildren();if(!state.members.length){list.append(node('p','まだ顔が登録されていません。上の画面から登録できます。','empty'));return;}for(const member of state.members){const card=node('article','','member-card'),info=node('div');info.append(node('h3',member.name),node('p',`${member.templates?.length||1}特徴量 · ${new Date(member.consentAt).toLocaleDateString('ja-JP')}`));const button=node('button','削除');button.type='button';button.setAttribute('aria-label',`${member.name}の登録と関連記録を削除`);button.addEventListener('click',()=>{if(!confirm(`${member.name}さんの登録と、このページ内の関連記録を削除しますか？`))return;const removed=removeMember(state,records,member.id);state=removed.state;records=removed.logs;tracker.removeMember(member.id);resetTracking();persist();renderMembers();renderRecords();syncStats();if(lastResult)processResult(lastResult,false);renderPreview();tell(`${member.name}さんの登録と関連記録を削除しました。`);});card.append(node('div',[...member.name][0],'member-avatar'),info,button);list.append(card);}}
function recordTrack(track,force=false){const id=track.trackId??track.id,now=Date.now();if(!force&&sourceKind==='camera'&&now-(recordTimes.get(id)||0)<1000)return;recordTimes.set(id,now);const probs=track.expressionEMA||track.expression||[],idx=probs.length?probs.indexOf(Math.max(...probs)):-1,q=track.quality||{},top=track.top;const row={timestamp:new Date().toISOString(),source:sourceKind,track_id:id,frame_key:frameKey,profile:state.settings.profile,member_id:track.decision==='matched'?(top?.member.id||''):'',member_name:track.decision==='matched'?(top?.member.name||''):'',similarity:top?Number(top.score.toFixed(6)):'',threshold:state.settings.threshold,decision:track.decision,pending_reason:track.pendingReason||'',expression_label:idx<0?'':EMOTION_KEYS[idx],expression_score:idx<0?'':Number(probs[idx].toFixed(6)),brightness:Number.isFinite(q.brightness)?Number(q.brightness.toFixed(3)):'',sharpness:Number.isFinite(q.sharpness)?Number(q.sharpness.toFixed(3)):'',yaw:Number.isFinite(q.yaw)?Number(q.yaw.toFixed(5)):'',quality:q.score??'',self_report:track.selfReport||''};EMOTION_KEYS.forEach((key,i)=>{row['expression_'+key]=Number.isFinite(probs[i])?Number(probs[i].toFixed(6)):'';});records.push(row);if(records.length>10000)records.shift();}
function recordCurrent(){currentTracks.forEach(t=>recordTrack(t));syncStats();}
function renderRecords(){const body=$('log-rows');body.replaceChildren();if(!records.length){const tr=node('tr'),td=node('td','まだ記録がありません。記録を有効にして照合・分析を試してください。');td.colSpan=8;tr.append(td);body.append(tr);}for(const r of [...records].reverse().slice(0,150)){const tr=node('tr'),idx=EMOTION_KEYS.indexOf(r.expression_label),decision=r.decision==='matched'?`${r.member_name}と一致候補`:r.decision==='unknown'?'一致なし':`確認中${r.pending_reason?'：'+r.pending_reason:''}`;for(const text of [new Date(r.timestamp).toLocaleTimeString('ja-JP'),r.source==='image'?'画像':'カメラ',`#${r.track_id}`,decision,fmt(r.similarity,3),idx>=0?EMOTIONS[idx]:'—',fmt(r.brightness,0),fmt(r.yaw,2)])tr.append(node('td',text));body.append(tr);}$('log-summary').textContent=records.length?`${records.length}件を一時記録しています。1件は1つの顔の1回の処理で、人数の集計ではありません。画面は最新150件、CSVは全件です。`:'まだ記録がありません。記録は最大10,000件です。';for(const id of ['export-csv','export-report','clear-logs'])$(id).disabled=!records.length;}
function setRecording(enabled){recording=enabled;$('record-enabled').checked=enabled;$('record-live').checked=enabled;recordTimes.clear();if(enabled&&sourceKind==='image')recordCurrent();renderRecords();tell(enabled?'顔ごとの実験記録を開始しました。画像は記録しません。':'記録を停止しました。既に取った記録は一覧で確認できます。');}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportReport(){if(!records.length)return;const byTrack=new Map();for(const r of records){const key=String(r.track_id),stat=byTrack.get(key)||{count:0,matched:0,pending:0,unknown:0};stat.count++;stat[r.decision]=(stat[r.decision]||0)+1;byTrack.set(key,stat);}const summaries=[...byTrack].map(([id,s])=>`<tr><td>${esc(id)}</td><td>${s.count}</td><td>${s.matched}</td><td>${s.pending}</td><td>${s.unknown}</td></tr>`).join('');const rows=records.slice(-500).map(r=>`<tr><td>${esc(r.timestamp)}</td><td>${esc(r.track_id)}</td><td>${esc(r.member_name)}</td><td>${esc(r.similarity)}</td><td>${esc(r.decision)}</td><td>${esc(r.expression_label)}</td><td>${esc(r.self_report)}</td></tr>`).join('');const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>FACEGATE 発展版 実験レポート</title><style>body{font:15px/1.8 sans-serif;max-width:1100px;margin:40px auto;padding:0 22px;color:#172b3c}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #ccd5df;text-align:left;padding:8px}.wrap{overflow:auto}</style><h1>FACEGATE 実験レポート</h1><p>記録${records.length}件。1件は1つの顔の1回の処理で、人数や精度そのものではありません。顔の照合と生身の人物であることの確認は別です。</p><h2>追跡番号ごとの集計</h2><p>画面切り替えや追跡終了で番号は新しくなります。同じ人の番号が複数ある場合があります。</p><table><tr><th>追跡番号</th><th>記録</th><th>一致候補</th><th>確認中</th><th>一致なし</th></tr>${summaries}</table><h2>直近${Math.min(500,records.length)}件</h2><div class="wrap"><table><tr><th>時刻</th><th>顔番号</th><th>一致候補の登録者</th><th>類似度</th><th>判定</th><th>表情分類</th><th>本人の申告</th></tr>${rows}</table></div><p>正解情報を別に用意していないため、誤判定率はこのログだけから計算できません。全数値はCSVで分析できます。</p></html>`;download(html,`facegate-report-${new Date().toISOString().slice(0,10)}.html`,'text/html;charset=utf-8');}
function startChallenge(){const t=selectedTrack();if(!stream||!t||!t.qualityAccepted){tell('カメラで解析し、条件のよい顔を一つ選んでから始めてください。',true);return;}const side=crypto.getRandomValues(new Uint8Array(1))[0]%2?1:-1;challenge={id:t.trackId??t.id,epoch:t.epoch,steps:[side,0,-side],step:0,held:0,start:Date.now(),lastKey:null,embedding:[...t.embedding]};$('challenge-status').textContent=challengeHint(challenge.steps[0]);}
function challengeHint(side){const visibleSide=state.settings.mirror?-side:side;return side===0?'選択した顔を正面へ戻してください。':`選択した顔の鼻が、映像の中で${visibleSide>0?'右':'左'}へ動くように顔を向けてください。`;}
function updateChallenge(){if(!challenge)return;const t=selectedTrack();if(!t||String(t.trackId??t.id)!==String(challenge.id)||t.epoch!==challenge.epoch||Date.now()-challenge.start>30000||!t.qualityAccepted||cosine(t.embedding,challenge.embedding)<.5){challenge=null;$('challenge-status').textContent='対象の顔が変わったか、追跡条件を満たさなくなったため終了しました。';return;}if(challenge.lastKey===frameKey)return;challenge.lastKey=frameKey;const expected=challenge.steps[challenge.step],yaw=t.quality?.yaw,ok=Number.isFinite(yaw)&&(expected===0?Math.abs(yaw)<.10:expected*yaw>.18);challenge.held=ok?challenge.held+1:0;if(challenge.held>=2){challenge.step++;challenge.held=0;if(challenge.step===3){challenge=null;$('challenge-status').textContent='3つの動作を確認しました（実験）。実深度は未測定で、写真や動画を完全に排除した証明ではありません。';}else $('challenge-status').textContent=challengeHint(challenge.steps[challenge.step]);}}

EMOTIONS.forEach((label,index)=>{const row=node('div','','expression-row'),bar=node('i'),fill=node('em');fill.id=`expr-fill-${index}`;fill.style.background=COLOURS[index];bar.append(fill);const value=node('b','—');value.id=`expr-value-${index}`;row.append(node('span',label),bar,value);$('expression-bars').append(row);$('self-report').append(new Option(label,EMOTION_KEYS[index]));});
document.addEventListener('click',event=>{const link=event.target.closest('[data-page]');if(link){event.preventDefault();go(link.dataset.page);window.scrollTo({top:0,behavior:'instant'});}});
window.addEventListener('hashchange',()=>go(location.hash.slice(1),false));
$('load-models').addEventListener('click',()=>ensureModels().catch(()=>{}));$('start-camera').addEventListener('click',startCamera);$('stop-camera').addEventListener('click',()=>stopCamera({clear:true}));$('image-file').addEventListener('change',event=>readImage(event.target.files[0]));
$('capture-sample').addEventListener('click',()=>captureSample());$('auto-enrol').addEventListener('click',startAutoEnrol);$('stop-enrol').addEventListener('click',()=>endAutoEnrol());$('save-member').addEventListener('click',saveMember);$('member-name').addEventListener('input',updateSamples);
$('enrol-consent').addEventListener('change',()=>{if(!$('enrol-consent').checked){samples=[];stopCamera({clear:true,message:'同意のチェックを外したため、カメラと登録用サンプルをリセットしました。'});}updateSamples();renderPreview();});
$('clear-samples').addEventListener('click',()=>{samples=[];endAutoEnrol('登録用サンプルを消しました。');updateSamples();$('sample-status').textContent='登録用のサンプルを消しました。もう一度追加できます。';});
$('record-enabled').addEventListener('change',()=>setRecording($('record-enabled').checked));$('record-live').addEventListener('change',()=>setRecording($('record-live').checked));
$('analysis-person').addEventListener('change',()=>selectTrack($('analysis-person').value));
$('self-report').addEventListener('change',()=>{const t=selectedTrack();if(!t||!t.qualityAccepted){$('self-report').value='';tell('条件のよい顔を解析してから選んでください。');return;}const value=$('self-report').value;tracker.setSelfReport(t.trackId??t.id,value);t.selfReport=value;if(recording&&sourceKind==='image'){recordTrack(t,true);syncStats();}else if(!recording)tell('記録に残すときは、実験の記録を有効にしてください。');});
$('threshold').addEventListener('input',()=>{state.settings.threshold=Number($('threshold').value);resetTracking();syncSettings();persist();if(lastResult)processResult(lastResult,false);renderPreview();});
$('vote-window').addEventListener('change',()=>{state.settings.voteWindow=Number($('vote-window').value);resetTracking();persist();if(lastResult)processResult(lastResult,false);renderPreview();});
function changeProfile(value){state.settings.profile=value;state.settings.maxFaces=value==='group'?30:6;stopCamera({clear:true,message:'処理モードを変更しました。カメラを開始するか画像を選び直してください。'});syncSettings();persist();}
function changeLimit(value){state.settings.maxFaces=Number(value);stopCamera({clear:true,message:'人数上限を変更しました。もう一度解析してください。'});syncSettings();persist();}
for(const id of ['profile','live-profile'])$(id).addEventListener('change',()=>changeProfile($(id).value));for(const id of ['max-faces','live-max-faces'])$(id).addEventListener('change',()=>changeLimit($(id).value));
$('camera-select').addEventListener('change',()=>{state.settings.cameraId=$('camera-select').value;stopCamera({clear:true,message:'カメラを変更しました。開始ボタンで再開できます。'});persist();});$('refresh-cameras').addEventListener('click',()=>refreshCameras());$('mirror-camera').addEventListener('change',()=>{state.settings.mirror=$('mirror-camera').checked;if(challenge){challenge=null;$('challenge-status').textContent='表示方向を変えたため、動作確認を終了しました。';}persist();renderPreview();});
$('blur-unknown').addEventListener('change',()=>{state.settings.blurUnknown=$('blur-unknown').checked;persist();renderPreview();});
$('persist-data').addEventListener('change',()=>{state.settings.persist=$('persist-data').checked;const result=persist();syncStats();if(result.ok)tell(state.settings.persist?'登録した特徴量と設定をこの端末に保存します。共有端末では利用後に削除してください。':'保存した登録データを削除し、ページを開いている間だけ使う設定にしました。');});
$('delete-all').addEventListener('click',()=>{if(!confirm('登録した特徴量・表示名・設定と、このページ内の実験記録をすべて削除しますか？'))return;stopCamera({clear:true});state=emptyState();records=[];samples=[];recording=false;persist();$('record-enabled').checked=false;$('record-live').checked=false;$('enrol-consent').checked=false;$('member-name').value='';syncSettings();renderMembers();renderRecords();updateSamples();tell('登録・設定・このページ内の記録を削除しました。ダウンロード済みファイルは端末上で別途削除してください。');});
$('export-csv').addEventListener('click',()=>{if(records.length)download(exportCSV(records,CSV_COLUMNS),`facegate-session-${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');});$('export-report').addEventListener('click',exportReport);$('clear-logs').addEventListener('click',()=>{if(!confirm('このページ内の実験記録をすべて削除しますか？'))return;records=[];renderRecords();syncStats();tell('実験記録を削除しました。登録した顔は残っています。');});$('start-challenge').addEventListener('click',startChallenge);
$('preview').addEventListener('click',event=>{if(!lastResult)return;const rect=$('preview').getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*lastResult.width,y=(event.clientY-rect.top)/rect.height*lastResult.height,ix=state.settings.mirror&&sourceKind==='camera'?lastResult.width-x:x;const track=currentTracks.find(t=>ix>=t.box[0]&&ix<=t.box[0]+t.box[2]&&y>=t.box[1]&&y<=t.box[1]+t.box[3]);if(track)selectTrack(track.trackId??track.id);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera({clear:true,message:'ページが隠れたためカメラを停止しました。再開するときは開始してください。'});});window.addEventListener('pagehide',()=>{stopCamera({clear:true,message:''});engine.dispose();});
window.addEventListener('storage',event=>{if(event.key==='facegate.browser.v1'){stopCamera({clear:true});const next=loadState({getItem:k=>localStorage.getItem(k)});state=next.state;records=[];samples=[];$('enrol-consent').checked=false;syncSettings();renderMembers();renderRecords();updateSamples();tell(next.warning||'別タブで登録が変わったため読み直しました。');}});
syncSettings();renderMembers();renderRecords();updateSamples();go(location.hash.slice(1)||'home',false);refreshCameras(true);if(stored.warning)tell(stored.warning,true);
