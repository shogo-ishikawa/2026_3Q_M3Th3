import {createDemo} from './demo.js';
import {validateInput, validateSchedule} from './solver.js';
import {readFile, readPastSchedule, workbookBlob, csvBlob} from './io.js';
import {applyPlanLocks, clearPlanLocks, filterSchedule} from './plan-tools.js';
import {createAbsenceUI} from './absence-ui.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {staff:'スタッフ', slots:'シフト枠', availability:'勤務可能', history:'過去実績'};
const fields = {
  staff: [['id','ID','text'],['name','表示名','text'],['weight','勤務量の比率','number'],['minHours','今回の最低時間','number'],['maxHours','今回の上限時間','number'],['maxDays','週の上限日数','number'],['skills','担当できる役割（任意）','text']],
  slots: [['id','枠ID','text'],['date','日付','date'],['start','開始','time'],['end','終了','time'],['required','必要人数','number'],['skill','必要な役割（任意）','text'],['fixed','固定するスタッフID（任意）','text']],
  history: [['staffId','スタッフID','staff'],['date','勤務日','date'],['start','開始','time'],['end','終了','time']],
};
const hints = {
  staff:'比率は 1＝標準 / 2＝多め / 0.5＝少なめ。時間の上下限と週の上限日数は必ず守る条件です。比率は時間配分の目安です。IDは自動で付きます。名前は自由に変更できます。',
  slots:'1行に1つの勤務枠を入力します。終了には24:00も使えます。日をまたぐ勤務は「22:00–24:00」と翌日の「00:00–02:00」のように分けます。固定する人は P1,P2 のようにIDで指定します。',
  availability:'出勤できる枠を選びます。未設定は「不可」です。「希望」は条件を満たしたうえで、勤務時間の偏りが同じ案の優先順位に使います。',
  history:'確定した過去の勤務を1勤務1行で入力します。「以前の完成シフトを履歴に追加」から、このアプリで出力したCSV・Excelも使えます。今回の最初の勤務枠より前の実績を入力してください。',
};
let data = createDemo(), active = 'staff', result = null, worker = null, ticker = null, revision = 0, availabilityPage = 0;
let pendingLocks = new Map(), staffFilter = '';
let absenceUI = null;

function status(message, type = '') { $('status').className = `status ${type}`; $('status').textContent = message; }
function diagnostics(messages = [], type = '') { $('diagnostics').className=`diagnostics ${type}`; $('diagnostics').innerHTML = messages.length ? `<ul class="diagnostic-list">${messages.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>` : ''; }
function stopWorker() { if (worker) worker.terminate(); worker = null; clearInterval(ticker); $('cancel-search').hidden = true; $('generate').disabled = false; $('search-progress').textContent = ''; }
function invalidate(message) {
  absenceUI?.invalidate();
  revision++; stopWorker(); result = null;
  pendingLocks.clear(); staffFilter='';
  $('result-empty').hidden = false; $('result-content').hidden = true;
  for (const id of ['export-csv','export-excel','print-result']) $(id).disabled = true;
  diagnostics(); if (message) status(message);
}
function summary() {
  const total = data.slots.reduce((sum,s)=>sum + (Number(s.required)||0),0);
  $('input-summary').textContent = `${data.staff.length}人 / ${data.slots.length}枠 / 延べ${total}人の配置 / 過去${data.history.length}件`;
  const unlock=$('clear-fixed');if(unlock)unlock.disabled=!data.slots.some(s=>s.fixed?.trim());
}
function inputHTML(kind, row, index, [key,label,type]) {
  const attrs = `data-kind="${kind}" data-row="${index}" data-key="${key}" aria-label="${index+1}行目 ${label}"`;
  if (type === 'staff') return `<select ${attrs}><option value="">選択</option>${data.staff.map(p=>`<option value="${escape(p.id)}" ${p.id===row[key]?'selected':''}>${escape(p.name)} (${escape(p.id)})</option>`).join('')}</select>`;
  return `<input ${attrs} type="${key==='end'?'text':type}" value="${escape(row[key])}" ${key==='end'?'placeholder="例 17:00 / 24:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"':''} ${type==='number'?'step="any" min="0"':''} ${key==='id'?'class="id-input" readonly title="勤務可能設定や実績をつなぐIDです。表示名は自由に変更できます。"':''}>`;
}
function renderEditor(kind) {
  const host = $(`editor-${kind}`);
  if (kind === 'availability') {
    availabilityPage=Math.min(availabilityPage,Math.max(0,Math.ceil(data.slots.length/14)-1));
    const visibleSlots=data.slots.slice(availabilityPage*14,(availabilityPage+1)*14);
    const pairs = new Map(data.availability.map(a=>[`${a.staffId}\0${a.slotId}`,a.preference]));
    host.innerHTML = !data.staff.length || !data.slots.length ? '<p class="empty-note">スタッフとシフト枠を先に追加してください。</p>' : `${data.slots.length>14?`<div class="availability-pages"><button data-av-page="${availabilityPage-1}" ${!availabilityPage?'disabled':''}>前の14枠</button><span>${availabilityPage*14+1}–${Math.min(data.slots.length,(availabilityPage+1)*14)} / ${data.slots.length}枠</span><button data-av-page="${availabilityPage+1}" ${(availabilityPage+1)*14>=data.slots.length?'disabled':''}>次の14枠</button></div>`:''}<table class="availability-table"><thead><tr><th>勤務枠</th>${data.staff.map(p=>`<th>${escape(p.name)}<small>${escape(p.id)}</small></th>`).join('')}</tr></thead><tbody>${visibleSlots.map(s=>`<tr><th>${escape(s.date)}<small>${escape(s.start)}–${escape(s.end)} / ${escape(s.id)}</small></th>${data.staff.map(p=>{const value=pairs.get(`${p.id}\0${s.id}`)||0;return `<td><select data-staff="${escape(p.id)}" data-slot="${escape(s.id)}" class="availability-select state-${value}" aria-label="${escape(p.name)} ${escape(s.date)} ${escape(s.start)}"><option value="0" ${!value?'selected':''}>不可</option><option value="1" ${value===1?'selected':''}>可</option><option value="2" ${value===2?'selected':''}>希望</option></select></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
    return;
  }
  host.innerHTML = `<table><thead><tr><th>#</th>${fields[kind].map(f=>`<th>${f[1]}</th>`).join('')}<th>操作</th></tr></thead><tbody>${data[kind].map((row,i)=>`<tr><td class="row-number">${i+1}</td>${fields[kind].map(f=>`<td>${inputHTML(kind,row,i,f)}</td>`).join('')}<td><button class="row-delete" data-delete="${kind}" data-index="${i}" aria-label="${i+1}行目を削除">削除</button></td></tr>`).join('')}</tbody></table>${!data[kind].length?'<p class="empty-note">「行を追加」で直接入力できます。ファイルからの取り込みも可能です。</p>':''}`;
}
function renderSettings() {
  for (const key of ['includeHistory','minRestHours','maxConsecutiveDays','maxDailyHours','timeLimitMs']) {
    if (key === 'includeHistory') $(key).checked = data.settings[key]; else $(key).value = data.settings[key];
  }
}
function renderAll() { for (const kind of Object.keys(labels)) $(`editor-${kind}`).innerHTML=''; renderEditor(active); renderSettings(); summary(); selectTab(active); }
function selectTab(kind) {
  active = kind;
  document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===kind));b.tabIndex=b.dataset.tab===kind?0:-1;});
  document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==kind);
  $('tab-hint').textContent = hints[kind]; $('add-row').hidden = kind==='availability';
  $('bulk-availability').hidden = kind!=='availability'; $('repeat-slots').hidden = kind!=='slots';
  const pastControl=$('past-schedule-control');if(pastControl)pastControl.hidden=kind!=='history';
  const unlock=$('clear-fixed');if(unlock)unlock.hidden=kind!=='slots';
}
function nextID(kind,prefix) { let n=1;const ids=new Set(data[kind].map(x=>x.id));while(ids.has(prefix+n))n++;return prefix+n; }
function addRow() {
  if(data[active].length >= (active==='staff'?100:active==='slots'?500:10000)){status('この表の入力件数の上限に達しています。','error');return;}
  const date = data.slots.at(-1)?.date || '2026-11-16';
  if (active==='staff') data.staff.push({id:nextID('staff','P'),name:'',weight:1,minHours:0,maxHours:40,maxDays:5,skills:''});
  if (active==='slots') data.slots.push({id:nextID('slots','S'),date,start:'09:00',end:'13:00',required:1,skill:'',fixed:''});
  if (active==='history') data.history.push({staffId:data.staff[0]?.id||'',date:'2026-11-09',start:'09:00',end:'13:00'});
  invalidate('行を追加しました。入力後にシフトを作成してください。'); renderEditor(active); summary();
  $(`editor-${active}`).querySelector('tbody tr:last-child input, tbody tr:last-child select')?.focus();
}
function download(blob, name) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function safeResult() {
  if (absenceUI?.isPending()) throw Error('欠勤の代替案を採用するか元のシフトに戻ってください。');
  if (!result) throw Error('条件を満たすシフトを先に作成してください。');
  const errors=validateSchedule(data,result.schedule);if(errors.length){invalidate();throw Error(errors.join(' / '));}return result;
}
function renderSchedule(r) {
  const people=new Map(data.staff.map(p=>[p.id,p])); const bySlot=new Map(r.schedule.map(s=>[s.slotId,s.staffIds]));
  const visible=new Set(filterSchedule(r.schedule,staffFilter).map(s=>s.slotId));
  const days=new Map();for(const s of [...data.slots].filter(s=>visible.has(s.id)).sort((a,b)=>`${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))){if(!days.has(s.date))days.set(s.date,[]);days.get(s.date).push(s);}
  document.querySelector('.plan-panel .panel-heading h3').textContent=staffFilter?`${people.get(staffFilter)?.name||staffFilter}の勤務表`:'勤務表';
  $('schedule-view').innerHTML=[...days].map(([date,slots])=>`<section class="day-group"><h3>${escape(date)} <small>${new Date(date+'T12:00:00Z').toLocaleDateString('ja-JP',{weekday:'short',timeZone:'UTC'})}</small></h3>${slots.map(s=>{const assigned=bySlot.get(s.id),fixed=s.fixed.split(',').map(x=>x.trim()).filter(Boolean),full=fixed.length===assigned.length&&assigned.every(id=>fixed.includes(id)),mixed=fixed.length>0&&!full,checked=pendingLocks.has(s.id)?pendingLocks.get(s.id):full;return `<div class="schedule-card"><div class="slot-time">${escape(s.start)}–${escape(s.end)}<small>${escape(s.id)} · ${s.required}人${s.skill?' · '+escape(s.skill):''}</small></div><div class="assignment">${assigned.map(id=>`<span class="staff-chip">${escape(people.get(id)?.name||id)}${fixed.includes(id)?' <small>固定</small>':''}</span>`).join('')}</div><span class="fulfilled">充足</span><label class="plan-lock"><input type="checkbox" data-plan-lock="${escape(s.id)}" data-mixed="${mixed&&!pendingLocks.has(s.id)}" ${checked?'checked':''} aria-label="${escape(s.date)} ${escape(s.start)} ${escape(s.id)} この枠の担当を固定"><span>この枠の担当を固定</span></label></div>`}).join('')}</section>`).join('')||'<p class="empty-note">このスタッフの勤務枠はありません。チーム全体の配分は右のグラフで確認できます。</p>';
  document.querySelectorAll('[data-plan-lock][data-mixed="true"]').forEach(input=>{input.indeterminate=true;});
}
function updateLockTools() {
  $('apply-locks').disabled=pendingLocks.size===0;
  $('reset-locks').disabled=pendingLocks.size===0;
  $('unlock-result').disabled=!data.slots.some(s=>s.fixed?.trim());
  $('lock-status').textContent=pendingLocks.size?`${pendingLocks.size}枠の固定変更は未反映です。「固定を反映して再作成」で適用します。`:'固定したい枠にチェックを入れます。一部の担当だけが固定された枠は「−」で表示します。';
}
function renderPlanTools() {
  let tools=$('plan-tools');
  if(!tools){tools=document.createElement('div');tools.id='plan-tools';tools.className='plan-tools';tools.innerHTML='<div class="person-filter"><label for="person-filter">勤務表の表示</label><select id="person-filter"></select><p>選んだ人が入る枠を、同僚も含めて表示します。CSV・Excelは全員分。印刷は表示中の勤務表です。時間のグラフはチーム全員分です。</p></div><div class="lock-actions"><button id="apply-locks" type="button" class="button button-small button-dark" disabled>固定を反映して再作成</button><button id="reset-locks" type="button" class="button button-small" disabled>選択を戻す</button><button id="unlock-result" type="button" class="button button-small">全枠の固定を解除して再作成</button></div><p id="lock-status" class="lock-status" aria-live="polite"></p>';document.querySelector('.result-toolbar').after(tools);
    $('person-filter').addEventListener('change',event=>{staffFilter=event.target.value;renderSchedule(safeResult());});
    $('apply-locks').addEventListener('click',()=>{try{const r=safeResult();data=applyPlanLocks(data,r.schedule,pendingLocks);renderEditor('slots');summary();generate();}catch(error){status(error.message,'error');}});
    $('reset-locks').addEventListener('click',()=>{pendingLocks.clear();renderSchedule(safeResult());updateLockTools();});
    $('unlock-result').addEventListener('click',()=>{data=clearPlanLocks(data);renderEditor('slots');summary();generate();});
  }
  $('person-filter').innerHTML='<option value="">全員</option>'+data.staff.map(p=>`<option value="${escape(p.id)}" ${p.id===staffFilter?'selected':''}>${escape(p.name)}</option>`).join('');
  $('print-result').textContent='表示を印刷';updateLockTools();
}
function renderResult(r) {
  pendingLocks.clear();
  const people=new Map(data.staff.map(p=>[p.id,p]));
  renderSchedule(r);renderPlanTools();
  const max=Math.max(1,...r.stats.map(s=>s.totalHours),...r.stats.map(s=>s.targetHours));
  $('workload-view').innerHTML=r.stats.map(s=>`<div class="workload-row"><div class="workload-name">${escape(people.get(s.staffId)?.name||s.staffId)}<small>比率 ${escape(people.get(s.staffId)?.weight)}</small></div><div class="bar-track" role="img" aria-label="今回${s.hours}時間、過去${s.historyHours}時間、合計${s.totalHours}時間"><span class="bar-fill history" style="width:${s.historyHours/max*100}%"></span><span class="bar-fill" style="width:${s.hours/max*100}%"></span></div><div class="workload-value"><strong>${format(s.hours)}h</strong><small>過去 ${format(s.historyHours)}h / 合計 ${format(s.totalHours)}h<br>配分目安 ${format(s.targetHours)}h · 今回${s.days}日</small></div></div>`).join('');
  const resultLabel=r.repair?(r.status==='optimal'?'変更が最も少ない代替案':'条件を満たす代替案（変更最小は未確認）'):(r.status==='optimal'?'最も偏りが小さい案（探索完了）':'条件を満たす案（時間内で最良のもの）');
  $('result-meta').textContent=`${resultLabel} · 配分目安は${data.settings.includeHistory?'過去＋今回':'今回のみ'} · ${format(r.elapsedMs/1000)}秒 · ${r.nodes.toLocaleString()}候補を探索`;
  $('result-empty').hidden=true;$('result-content').hidden=false;
  for(const id of ['export-csv','export-excel','print-result'])$(id).disabled=false;
  diagnostics(r.diagnostics,'ok');status(r.repair?'代替案を採用しました。欠勤時間の勤務可能設定も更新しました。':r.status==='optimal'?'すべての必須条件を満たすシフトができました。':'すべての必須条件を満たしています。公平さをさらに改善できる可能性があります。','ok');
  let repairBanner=$('adopted-repair');if(repairBanner)repairBanner.remove();
  if(r.repair){repairBanner=document.createElement('p');repairBanner.id='adopted-repair';repairBanner.className='repair-banner';repairBanner.textContent=`採用した代替案: ${r.repair.changedSlots}枠を変更 / 交代${r.repair.replacements}人分`;document.querySelector('.result-toolbar').before(repairBanner);}
  absenceUI?.mount();
}
function format(n) {return Number(n).toLocaleString('ja-JP',{maximumFractionDigits:2});}
function generate() {
  invalidate();const errors=validateInput(data);if(errors.length){diagnostics(errors);status('入力内容を修正してください。シフトは作成していません。','error');return;}
  const version=revision;status('必須条件を確認しながら、勤務時間の偏りを小さくする案を探しています。','working');
  $('generate').disabled=true;$('cancel-search').hidden=false;const started=performance.now();
  ticker=setInterval(()=>$('search-progress').textContent=`探索中 ${Math.floor((performance.now()-started)/1000)}秒 / 上限 ${data.settings.timeLimitMs/1000}秒`,250);
  try {
    worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    worker.onerror=()=>{if(version!==revision)return;stopWorker();status('探索を開始できませんでした。ZIP版は付属の起動ファイルから開いてください。','error');};
    worker.onmessage=({data:message})=>{
      if(version!==revision)return;stopWorker();
      if(message.error){status(message.error,'error');return;}
      const r=message.result;
      if(['optimal','feasible'].includes(r.status)){
        const problems=validateSchedule(data,r.schedule);
        if(problems.length){diagnostics(problems);status('結果の検査で不整合が見つかりました。シフトは表示しません。','error');return;}
        result=r;renderResult(r);
      }else{diagnostics(r.diagnostics);status(r.status==='infeasible'?'この条件では作成できません。条件を修正して再実行してください。':r.status==='unknown'?'時間内に条件を満たす案を見つけられませんでした。不可能と確定したわけではありません。':'入力内容を修正してください。','error');}
    };
    worker.postMessage({input:structuredClone(data)});
  }catch(error){stopWorker();status(error.message,'error');}
}

document.addEventListener('input',event=>{
  const el=event.target;
  if(el.dataset.planLock){if(!result)return;const slot=data.slots.find(s=>s.id===el.dataset.planLock),row=result.schedule.find(s=>s.slotId===el.dataset.planLock);const fixed=slot.fixed.split(',').map(s=>s.trim()).filter(Boolean);const baseline=fixed.length===row.staffIds.length&&row.staffIds.every(id=>fixed.includes(id))?true:fixed.length?null:false;if(el.checked===baseline)pendingLocks.delete(slot.id);else pendingLocks.set(slot.id,el.checked);updateLockTools();return;}
  if(el.dataset.kind){if(el.dataset.key==='id')return;data[el.dataset.kind][el.dataset.row][el.dataset.key]=el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;
    invalidate('条件を変更しました。再作成すると新しい条件が反映されます。');summary();return;
  }
  if(el.dataset.staff){data.availability=data.availability.filter(a=>a.staffId!==el.dataset.staff||a.slotId!==el.dataset.slot);if(Number(el.value))data.availability.push({staffId:el.dataset.staff,slotId:el.dataset.slot,preference:Number(el.value)});el.className=`availability-select state-${el.value}`;invalidate('勤務可能な枠を変更しました。');return;}
  if(['includeHistory','minRestHours','maxConsecutiveDays','maxDailyHours','timeLimitMs'].includes(el.id)){data.settings[el.id]=el.type==='checkbox'?el.checked:(el.value===''?NaN:Number(el.value));if(el.id==='timeLimitMs'&&absenceUI?.isPending()){revision++;absenceUI.timeChanged();return;}invalidate('作成条件を変更しました。');}
});
document.addEventListener('click',event=>{
  const page=event.target.closest('[data-av-page]');if(page){availabilityPage=Number(page.dataset.avPage);renderEditor('availability');return;}
  const tab=event.target.closest('[data-tab]');if(tab){renderEditor(tab.dataset.tab);selectTab(tab.dataset.tab);return;}
  const remove=event.target.closest('[data-delete]');if(remove){const kind=remove.dataset.delete;const [row]=data[kind].splice(Number(remove.dataset.index),1);if(kind==='staff'){data.availability=data.availability.filter(a=>a.staffId!==row.id);data.history=data.history.filter(h=>h.staffId!==row.id);for(const s of data.slots)s.fixed=s.fixed.split(',').filter(id=>id.trim()!==row.id).join(',');}if(kind==='slots')data.availability=data.availability.filter(a=>a.slotId!==row.id);invalidate('行を削除しました。');renderEditor(kind);summary();}
});
document.querySelectorAll('[data-tab]').forEach((b,i,buttons)=>b.addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();const next=buttons[(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length];next.click();next.focus();}}));
for(const kind of ['balanced','history','impossible'])$(`demo-${kind}`).addEventListener('click',()=>{invalidate();data=createDemo(kind);renderAll();status(kind==='impossible'?'不足があるデモです。「シフトを作成」で原因を確認できます。':kind==='history'?'過去実績と多め・少なめの比率を読み込みました。':'架空のスタッフ6人・平日10枠を読み込みました。','ok');});
$('add-row').addEventListener('click',addRow);
$('bulk-availability').textContent='全員・全枠を「可」にする';
$('bulk-availability').addEventListener('click',()=>{data.availability=data.staff.flatMap(p=>data.slots.map(s=>({staffId:p.id,slotId:s.id,preference:1})));invalidate('全員を全枠で出勤可能にしました。必要に応じて「不可」に戻してください。');renderEditor('availability');});
$('repeat-slots').textContent='現在の枠を翌週にも追加';
$('repeat-slots').addEventListener('click',()=>{
  if(data.slots.length>150){status('一括追加は150枠までです。','error');return;}const original=[...data.slots];const pairs=[...data.availability];
  const dates=original.map(s=>new Date(s.date+'T12:00:00Z'));
  if(dates.some((date,i)=>!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==original[i].date)){status('日付を修正してから追加してください。','error');return;}
  for(const [i,s] of original.entries()){const date=dates[i];date.setUTCDate(date.getUTCDate()+7);const next={...s,id:nextID('slots','S'),date:date.toISOString().slice(0,10)};data.slots.push(next);for(const a of pairs.filter(a=>a.slotId===s.id))data.availability.push({...a,slotId:next.id});}
  invalidate('翌週の枠と勤務可能設定を追加しました。日付や上限時間を確認してください。');renderEditor('slots');summary();
});
const clearFixed=document.createElement('button');clearFixed.type='button';clearFixed.id='clear-fixed';clearFixed.className='text-button danger';clearFixed.textContent='固定する担当をすべて解除';clearFixed.hidden=true;clearFixed.disabled=true;$('repeat-slots').after(clearFixed);clearFixed.addEventListener('click',()=>{data=clearPlanLocks(data);invalidate('担当の固定をすべて解除しました。ほかの条件は保持しています。');renderEditor('slots');summary();});
$('generate').addEventListener('click',generate);
$('cancel-search').addEventListener('click',()=>{invalidate();status('探索を中止しました。シフトは確定していません。');});
$('save-project').addEventListener('click',()=>download(new Blob([JSON.stringify({format:'shift-studio',version:1,data},null,2)],{type:'application/json'}),'shift-studio-settings.json'));
function checkDraft(value) {
  if(!value||typeof value!=='object'||!value.settings||typeof value.settings!=='object')throw Error('設定データの形式が正しくありません。');
  const caps={staff:100,slots:500,availability:50000,history:10000};
  for(const kind of Object.keys(labels))if(!Array.isArray(value[kind])||value[kind].length>caps[kind]||value[kind].some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error(`${labels[kind]}の形式が正しくないか、入力上限（${caps[kind]}件）を超えています。`);
  for(const [kind,columns] of Object.entries(fields))for(const row of value[kind])for(const [key,,type] of columns)if(type==='number'?(typeof row[key]!=='number'&&row[key]!==null):typeof row[key]!=='string')throw Error(`${labels[kind]}の${key}の形式が正しくありません。`);
  for(const row of value.availability)if(typeof row.staffId!=='string'||typeof row.slotId!=='string'||![1,2].includes(row.preference))throw Error('勤務可能データの形式が正しくありません。');
  for(const key of ['minRestHours','maxConsecutiveDays','maxDailyHours','timeLimitMs'])if(typeof value.settings[key]!=='number'&&value.settings[key]!==null)throw Error('作成条件の形式が正しくありません。');
  if(typeof value.settings.includeHistory!=='boolean')throw Error('過去実績の設定が正しくありません。');
}
$('load-project').addEventListener('change',async event=>{const version=revision;try{const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('設定ファイルは5MB以下にしてください。');const value=JSON.parse(await file.text());if(version!==revision)throw Error('読み込み中に入力が変わりました。ファイルを選び直してください。');if(value.format!=='shift-studio'||value.version!==1)throw Error('このアプリで保存した設定JSONを選択してください。');checkDraft(value.data);invalidate();data=value.data;renderAll();status('保存した設定を読み込みました。作成前に未入力の条件を確認してください。','ok');}catch(error){status(error.message,'error');}finally{event.target.value='';}});
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;const version=revision,kind=active;
  try{const workbook=/\.xlsx?$/i.test(file.name);const parsed=await readFile(file,workbook?'workbook':kind);if(version!==revision)throw Error('読み込み中に入力が変わりました。ファイルを選び直してください。');const candidate=workbook?parsed:{...data,[kind]:parsed};
    checkDraft(candidate);
    invalidate();data=candidate;renderAll();status(`${file.name} を取り込みました。${workbook?'4種類の入力と作成条件を置き換えました。':labels[kind]+'を置き換えました。'}`,'ok');
  }catch(error){status('取り込めませんでした。元の入力は保持しています。','error');diagnostics([error.message]);}finally{event.target.value='';}
});
$('download-template').addEventListener('click',()=>download(workbookBlob(createDemo()),'shift-studio-template.xlsx'));
const csvTemplate=document.createElement('button');csvTemplate.type='button';csvTemplate.className='button button-small secondary';csvTemplate.textContent='選択中の表のCSV見本';csvTemplate.addEventListener('click',()=>download(csvBlob(active,createDemo()[active]),`shift-studio-${active}-template.csv`));$('download-template').after(csvTemplate);
const pastControl=document.createElement('label');pastControl.id='past-schedule-control';pastControl.className='button button-small secondary file-button';pastControl.htmlFor='past-schedule-file';pastControl.hidden=active!=='history';pastControl.textContent='以前の完成シフトを履歴に追加';const pastFile=document.createElement('input');pastFile.type='file';pastFile.accept='.csv,.xlsx';pastFile.id='past-schedule-file';pastFile.setAttribute('aria-label','以前の完成シフトを履歴に追加');pastFile.className='file-input';pastControl.append(pastFile);csvTemplate.after(pastControl);
pastFile.addEventListener('change',async event=>{const version=revision;try{const file=event.target.files[0];if(!file)return;const records=await readPastSchedule(file);if(version!==revision)throw Error('読み込み中に入力が変わりました。ファイルを選び直してください。');const keys=new Set(data.history.map(row=>JSON.stringify([row.staffId,row.date,row.start,row.end])));const additional=records.filter(row=>{const key=JSON.stringify([row.staffId,row.date,row.start,row.end]);if(keys.has(key))return false;keys.add(key);return true;});const candidate={...data,history:[...data.history,...additional]};checkDraft(candidate);invalidate();data=candidate;renderEditor('history');summary();status(`以前の完成シフトを${additional.length}件、過去実績に追加しました。今回の勤務枠は、実績より後の日付に設定してください。`,'ok');}catch(e){status('完成シフトを取り込めませんでした。','error');diagnostics([e.message]);}finally{event.target.value='';}});
$('export-excel').addEventListener('click',()=>{try{download(workbookBlob(data,safeResult()),'shift-studio-schedule.xlsx');}catch(e){status(e.message,'error');}});
$('export-csv').addEventListener('click',()=>{try{const r=safeResult();const slots=new Map(data.slots.map(s=>[s.id,s]));const people=new Map(data.staff.map(p=>[p.id,p]));const rows=r.schedule.flatMap(s=>s.staffIds.map(id=>({slotId:s.slotId,date:slots.get(s.slotId).date,start:slots.get(s.slotId).start,end:slots.get(s.slotId).end,staffId:id,name:people.get(id).name})));download(csvBlob('schedule',rows),'shift-studio-schedule.csv');}catch(e){status(e.message,'error');}});
$('print-result').addEventListener('click',()=>{try{safeResult();window.print();}catch(e){status(e.message,'error');}});
$('clear-data').addEventListener('click',()=>{invalidate();data={staff:[],slots:[],availability:[],history:[],settings:createDemo().settings};active='staff';renderAll();status('入力を空にしました。スタッフとシフト枠を追加してください。');});
absenceUI=createAbsenceUI({getData:()=>data,getResult:()=>result,hasPendingLocks:()=>pendingLocks.size>0,onScenarioChange:()=>{revision++;},setStatus:status,onAdopt:(next,candidate)=>{revision++;data=next;result=candidate;pendingLocks.clear();staffFilter='';renderAll();renderResult(candidate);},onRestore:()=>renderResult(result)});
renderAll();status('まずはデモで試せます。入力やファイルの内容はサーバーへ送信されません。');
