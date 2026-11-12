import {prepareAbsence, compareSchedules} from './absence.js';
import {validateSchedule} from './solver.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A scenario stays separate from the accepted data until the user adopts it. */
export function createAbsenceUI({getData, getResult, hasPendingLocks, onAdopt, onRestore, onScenarioChange, setStatus}) {
  const $ = id => document.getElementById(id);
  let rows = [], worker = null, ticker = null, serial = 0, context = null;

  function stop() {
    serial++;
    if (worker) worker.terminate();
    worker = null; clearInterval(ticker);
    if ($('absence-stop')) $('absence-stop').hidden = true;
    if ($('absence-run')) $('absence-run').disabled = !rows.length;
  }
  function invalidate() { stop(); rows = []; context = null; }
  function isPending() { return rows.length > 0; }
  function message(text, type = '') { $('absence-status').className = `absence-status ${type}`; $('absence-status').textContent = text; }
  function discardCandidate() { stop(); context = null; $('absence-preview').innerHTML = ''; }
  function toggleScenario() {
    const pending = isPending();
    document.querySelector('.result-layout').hidden = pending;
    $('plan-tools').hidden = pending;
    for (const id of ['export-csv','export-excel','print-result']) $(id).disabled = pending;
    $('generate').disabled = pending;
    $('absence-restore').hidden = !pending;
    if (pending) {
      $('diagnostics').innerHTML = '';
      $('result-meta').textContent = '元のシフトを基に欠勤時の代替案を検討しています';
      setStatus('欠勤はまだ勤務表に反映していません。代替案を確認してから採用してください。');
    }
  }
  function renderRows() {
    const data = getData(), people = new Map(data.staff.map(p => [p.id,p.name]));
    $('absence-list').innerHTML = rows.map((row,index) => {
      const slot = row.slotId ? data.slots.find(s=>s.id===row.slotId) : null;
      const scope = slot ? `${slot.date} ${slot.start}–${slot.end} (${slot.id})` : `${row.date} 終日`;
      return `<span class="absence-entry">${escape(people.get(row.staffId))} / ${escape(scope)}<button type="button" data-remove-absence="${index}" aria-label="${escape(people.get(row.staffId))} ${escape(scope)}の欠勤を削除">×</button></span>`;
    }).join('');
    $('absence-run').disabled = !rows.length;
    toggleScenario();
  }
  function restore() {
    onScenarioChange(); invalidate(); onRestore();
  }
  function renderCandidate(candidate, prepared, baseline) {
    const data = getData(), names = new Map(data.staff.map(p=>[p.id,p.name])), slots = new Map(data.slots.map(s=>[s.id,s]));
    const changes = compareSchedules(baseline.schedule,candidate.schedule);
    const replacements = changes.reduce((n,c)=>n+c.added.length,0);
    context = {candidate, prepared};
    const label = candidate.status === 'optimal' ? '変更が最も少ない代替案です' : '条件を満たす代替案です。変更が最小かは未確認です';
    message(label, candidate.status === 'optimal' ? 'ok' : 'warn');
    const peopleHTML = ids => ids.map(id=>escape(names.get(id)||id)).join('・');
    const slotHTML = id => {const s=slots.get(id);return `${escape(s.date)}<br>${escape(s.start)}–${escape(s.end)} <small>${escape(id)}</small>`;};
    $('absence-preview').innerHTML = `<div class="repair-banner"><strong>${changes.length}枠を変更 / 交代${replacements}人分</strong><p>必須条件を満たしています。${candidate.status==='optimal'?'同じ変更枠数では延べ交代人数も最も少ない案です。':'探索時間を延ばすと変更を減らせる可能性があります。'}</p>${prepared.releasedFixed.length?`<p>欠勤する本人の固定を${prepared.releasedFixed.length}件外した案です。他の担当固定は守っています。</p>`:''}</div>${changes.length?`<div class="absence-table-scroll"><table class="absence-diff"><thead><tr><th>勤務枠</th><th>外れる人</th><th>代わりに入る人</th></tr></thead><tbody>${changes.map(c=>`<tr><th>${slotHTML(c.slotId)}</th><td><span class="replacement-removed">${peopleHTML(c.removed)}</span></td><td><span class="replacement-added">${peopleHTML(c.added)}</span></td></tr>`).join('')}</tbody></table></div>`:'<p>登録した欠勤は元の担当と重ならないため交代はありません。採用すると欠勤時間の勤務可能設定を外します。</p>'}<details><summary>代替案の勤務表をすべて見る</summary><div class="absence-table-scroll"><table class="absence-diff"><thead><tr><th>勤務枠</th><th>担当者</th></tr></thead><tbody>${[...candidate.schedule].sort((a,b)=>{const x=slots.get(a.slotId),y=slots.get(b.slotId);return `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`);}).map(s=>`<tr><th>${slotHTML(s.slotId)}</th><td>${peopleHTML(s.staffIds)}</td></tr>`).join('')}</tbody></table></div></details><div class="absence-actions"><button id="absence-adopt" class="button button-primary" type="button">この案を採用</button><span>採用するまで元の入力は変わりません</span></div>`;
    $('absence-adopt').addEventListener('click',()=>{
      if (!context) return;
      const errors = validateSchedule(context.prepared.data,context.candidate.schedule);
      if (errors.length) { message(errors.join(' / '),'error'); return; }
      const chosen = context;
      invalidate(); onAdopt(chosen.prepared.data,chosen.candidate);
    });
  }
  function run() {
    discardCandidate();
    if (!rows.length) { message('欠勤する人と日時を追加してください。'); return; }
    if (hasPendingLocks()) { message('担当固定の変更を先に反映するか選択を戻してください。','error'); return; }
    const data = getData(), baseline = getResult();
    if (!baseline) return;
    let prepared;
    try { prepared = prepareAbsence(data,baseline.schedule,rows,{releaseAbsentFixed:$('absence-release-fixed').checked}); }
    catch (error) { message(error.message,'error'); return; }
    const token = serial, started = performance.now();
    message('元の担当をなるべく残す代替案を探しています。','working');
    $('absence-run').disabled = true; $('absence-stop').hidden = false;
    ticker = setInterval(()=>message(`代替案を探索中 ${Math.floor((performance.now()-started)/1000)}秒 / 上限 ${data.settings.timeLimitMs/1000}秒`,'working'),250);
    try {
      worker = new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      worker.onerror = () => { if(token!==serial)return;stop();message('代替案の探索を開始できませんでした。','error'); };
      worker.onmessage = ({data:reply}) => {
        if (token!==serial) return;
        stop();
        if (reply.error) { message(reply.error,'error'); return; }
        const candidate = reply.result;
        if (['optimal','feasible'].includes(candidate.status)) {
          const errors = validateSchedule(prepared.data,candidate.schedule);
          if (errors.length) { message('条件違反が見つかったため代替案を表示しません。','error'); return; }
          renderCandidate(candidate,prepared,baseline);
        } else {
          const lead = candidate.status==='infeasible' ? 'この条件では代替案を作れません。条件を見直してください。' : candidate.status==='unknown' ? '時間内に代替案が見つかりませんでした。不可能とは限りません。' : '欠勤の設定を確認してください。';
          message([lead,...candidate.diagnostics].join('\n'),'error');
        }
      };
      worker.postMessage({input:prepared.data,referenceSchedule:prepared.referenceSchedule});
    } catch (error) { stop();message(error.message,'error'); }
  }
  function mount() {
    let panel = $('absence-panel');
    if (!panel) {
      panel = document.createElement('section'); panel.id='absence-panel';panel.className='absence-panel';panel.setAttribute('aria-labelledby','absence-title');
      panel.innerHTML = '<h3 id="absence-title">欠勤時の代替案</h3><p>欠勤する人と日時を登録します。変更する枠数を最優先で減らします。同じ枠数なら延べ交代人数が少ない案を探します。</p><div class="absence-form"><label>欠勤する人<select id="absence-person"></select></label><label>欠勤する日・勤務枠<select id="absence-scope"></select></label><button id="absence-add" class="button button-small" type="button">欠勤を追加</button></div><div id="absence-list" class="absence-list"></div><label class="absence-option"><input id="absence-release-fixed" type="checkbox" checked>欠勤する人の固定だけ外す</label><p>他の担当固定と勤務時間の上下限は守ります。欠勤は採用するまで入力に反映されません。</p><div class="absence-actions"><button id="absence-run" class="button button-dark" type="button" disabled>代替案を探す</button><button id="absence-stop" class="button button-small" type="button" hidden>探索を中止</button><button id="absence-restore" class="button button-small" type="button" hidden>元のシフトに戻る</button></div><p id="absence-status" class="absence-status" role="status"></p><div id="absence-preview" class="absence-preview"></div>';
      $('plan-tools').after(panel);
      $('absence-add').addEventListener('click',()=>{
        if (hasPendingLocks()) { message('担当固定の変更を先に反映するか選択を戻してください。','error');return; }
        const staffId=$('absence-person').value, scope=$('absence-scope').value;
        if (!staffId || !scope) return;
        const row = scope.startsWith('day:') ? {staffId,date:scope.slice(4)} : {staffId,slotId:scope.slice(5)};
        if (rows.some(r=>JSON.stringify(r)===JSON.stringify(row))) { message('同じ欠勤が登録されています。'); return; }
        onScenarioChange(); discardCandidate(); rows.push(row); renderRows(); message('欠勤を登録しました。代替案を確認してから採用してください。');
      });
      $('absence-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-absence]');if(!button)return;onScenarioChange();discardCandidate();rows.splice(Number(button.dataset.removeAbsence),1);if(!rows.length){restore();return;}renderRows();message('欠勤の登録を変更しました。もう一度探索してください。');});
      $('absence-release-fixed').addEventListener('change',()=>{if(rows.length){onScenarioChange();discardCandidate();message('固定の扱いを変更しました。もう一度探索してください。');}});
      $('absence-run').addEventListener('click',run);
      $('absence-restore').addEventListener('click',restore);
      $('absence-stop').addEventListener('click',()=>{discardCandidate();message('探索を中止しました。代替案は採用していません。');});
    }
    const data=getData(), dates=[...new Set(data.slots.map(s=>s.date))].sort();
    $('absence-person').innerHTML=data.staff.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');
    $('absence-scope').innerHTML=`<optgroup label="日単位">${dates.map(d=>`<option value="day:${escape(d)}">${escape(d)} 終日</option>`).join('')}</optgroup><optgroup label="勤務枠単位">${data.slots.map(s=>`<option value="slot:${escape(s.id)}">${escape(s.date)} ${escape(s.start)}–${escape(s.end)} (${escape(s.id)})</option>`).join('')}</optgroup>`;
    $('absence-preview').innerHTML=''; context=null;renderRows();message('交代前後の担当を確認してから採用できます。');
  }
  function timeChanged() {discardCandidate();toggleScenario();message('探索時間を変更しました。もう一度代替案を探してください。');}
  return {mount,invalidate,isPending,timeChanged};
}
