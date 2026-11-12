import {ALLERGENS, INGREDIENTS, RECIPES} from './data.js';
import {generateCalendarPlan, replaceRecipe, toggleDish, activeRecipeIds, describeRecipe, eligibleRecipes} from './planner.js';
import {GENRES, rebalanceGenreRatios} from './storage.js';
import {readJournal, writeJournal, validateJournal, parseJournal, dateKey, dateIsValid, monthCells, shiftDate, entriesForDay} from './journal.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition, itemFromRecipe, itemNutrition, sumNutrition, summariseEntries} from './nutrition.js';
import {shoppingForEntries} from './shopping.js';
import {catalogFamilies,catalogVariants,recipeFamily,recipePortion,quantityFromAmount,CATALOG_CATEGORIES} from './catalog.js';
import {deriveReference} from './dietary-reference.js';
import {analyseIntake,compareIntake} from './intake.js';
import {setupTabs} from './tabs.js';

const builtin = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const MEALS = {breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'};
const ROLES = {main:'主菜',side:'副菜',soup:'汁物',staple:'主食',drink:'飲み物',snack:'間食'};
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const node = (tag, className='', text) => { const e=document.createElement(tag); if(className)e.className=className; if(text!==undefined)e.textContent=text; return e; };
const button = (text, action, className='button-text') => { const e=node('button',className,text); e.type='button'; e.addEventListener('click',guard(action)); return e; };
const fmt = (value, digits=1) => Number(value).toLocaleString('ja-JP',{maximumFractionDigits:digits});
const amount = (n,unit='') => `${fmt(n,2)}${unit ? ` ${unit}`:''}`;
const dateLabel = date => new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date(`${date}T12:00:00`));
let storage;
try {storage=window.localStorage;} catch {storage={getItem(){throw Error();},setItem(){throw Error();}};}
const loaded=readJournal(storage,builtin);
let state=loaded.state, selectedDate=dateKey(), month=selectedDate.slice(0,7), plan=null;
let recordSelectionId='', activeFamily='rice';
let roleFilter='all',recipeLimit=12,shoppingText='',storageWarning='',editing=null,toastTimer;
const data=()=>({...builtin,recipes:[...RECIPES,...state.customRecipes]});
const recipeById=id=>data().recipes.find(r=>r.id===id);
const toast=node('div','toast'); toast.hidden=true; toast.setAttribute('aria-hidden','true'); document.body.append(toast);

function tell(message,error=false){
  const text=[message,storageWarning].filter(Boolean).join(' ');
  $('app-message').textContent=text; $('app-message').hidden=!text; $('app-message').className=`notice${error||storageWarning?' error':''}`;
  if(!text)return; toast.textContent=text; toast.hidden=false; toast.classList.toggle('error',error||!!storageWarning);
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.hidden=true,6500);
}
function guard(fn){return (...args)=>{try{const result=fn(...args); if(result?.catch)result.catch(e=>tell(e.message,true));}catch(e){tell(e.message,true);}};}
function persist(){storageWarning=writeJournal(storage,state,builtin)?'':'このブラウザーに保存できません。画面を閉じる前にデータを書き出してください。';}
function commit(change,{invalidate=true,message=''}={}){
  const next=structuredClone(state); change(next); const clean=validateJournal(next,builtin);
  state=clean; if(invalidate)plan=null; persist(); renderAll(); if(message||storageWarning)tell(message);
}
function bind(id,event,fn){$(id).addEventListener(event,guard(fn));}
function selectOptions(element,options,value){
  element.replaceChildren(...options.map(([id,label])=>{const option=node('option','',label); option.value=id; return option;}));
  if(options.some(([id])=>id===value))element.value=value;
}
function check(id,label,checked,fn){const e=node('label','choice-label'),input=node('input');input.type='checkbox';input.value=id;input.checked=checked;if(fn)input.addEventListener('change',guard(()=>fn(input.checked)));e.append(input,node('span','',label));return e;}
function safeShift(date,n){try{return shiftDate(date,n);}catch{return n<0?'2000-01-01':'2100-12-31';}}
function setDate(date){if(!dateIsValid(date))throw Error('日付は2000年から2100年までで指定してください。');selectedDate=date;month=date.slice(0,7);$('nutrition-date').value=date;renderCalendar();renderNutrition();}
function selectedEntry(items,note=''){return {id:uid(),date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,note,items};}
function snapshot(id,quantity=1){const recipe=describeRecipe(id,data());if(!recipe)throw Error('このメニューは見つかりませんでした。');const item=itemFromRecipe(recipe,data(),quantity);item.portion=recipePortion(recipe,data());return item;}

function renderSettings(){
  const s=state.settings,p=s.preferences;
  for(const [id,value]of Object.entries({'start-date':s.startDate,'plan-days':s.days,servings:s.servings,'plan-meal':s.meal,'genre-mode':p.genreMode,'single-genre':p.genre==='all'?'和食':p.genre,'meal-mood':p.mood}))$(id).value=value;
  renderMealChoices('staple');renderMealChoices('drink');
  $('required-allergens').replaceChildren();$('other-allergens').replaceChildren();
  for(const a of ALLERGENS)(a.category==='required'?$('required-allergens'):$('other-allergens')).append(check(a.id,a.label,s.allergens.includes(a.id),yes=>commit(next=>{next.settings.allergens=yes?[...next.settings.allergens,a.id]:next.settings.allergens.filter(id=>id!==a.id);},{message:'避ける食材を更新しました。'})));
  $('allergen-count').textContent=`${s.allergens.length}件`;
  $('single-genre-field').hidden=p.genreMode!=='single';$('genre-ratio-field').hidden=p.genreMode!=='ratio';
  $('genre-ratios').replaceChildren();
  for(const genre of GENRES){const label=node('label','ratio-input-label',genre),input=node('input');input.type='number';input.min=0;input.max=100;input.step=1;input.value=p.genreRatios[genre];input.setAttribute('aria-label',`${genre}の割合`);input.addEventListener('change',guard(()=>commit(next=>{next.settings.preferences.genreRatios=rebalanceGenreRatios(next.settings.preferences.genreRatios,genre,Number(input.value));})));label.append(input,node('span','','%'));$('genre-ratios').append(label);}
  $('ratio-total').textContent=`${Object.values(p.genreRatios).reduce((a,b)=>a+b,0)}%`;
  renderIngredientSearch(false);renderIngredientSearch(true);
}
function renderIngredientSearch(preferred){
  const prefix=preferred?'preferred':'ingredient',values=preferred?state.settings.preferences.preferredIngredients:state.settings.excludedIngredients;
  $(prefix+'-selections').replaceChildren(...values.map(id=>button(`${INGREDIENTS[id].name} ×`,()=>commit(next=>{if(preferred)next.settings.preferences.preferredIngredients=next.settings.preferences.preferredIngredients.filter(x=>x!==id);else next.settings.excludedIngredients=next.settings.excludedIngredients.filter(x=>x!==id);}))));
  const query=$(prefix+'-search').value.trim(),box=$(prefix+'-options');box.replaceChildren();if(!query)return;
  const matches=Object.entries(INGREDIENTS).filter(([id,i])=>i.name.includes(query)&&!values.includes(id)).slice(0,20);
  for(const [id,i]of matches)box.append(button(`＋ ${i.name}`,()=>{
    if(preferred&&state.settings.excludedIngredients.includes(id))throw Error('この食材は除外中です。先に除外を取り消してください。');
    commit(next=>{if(preferred)next.settings.preferences.preferredIngredients.push(id);else{next.settings.excludedIngredients.push(id);next.settings.preferences.preferredIngredients=next.settings.preferences.preferredIngredients.filter(x=>x!==id);}});
    $(prefix+'-search').value='';renderIngredientSearch(preferred);
  }));
  if(!matches.length)box.append(node('p','field-note','一致する食材がありません。別の名前で探してください。'));
}
function renderCalendar(){
  $('month-label').textContent=`${Number(month.slice(0,4))}年${Number(month.slice(5))}月`;
  $('calendar-date').value=selectedDate;$('selected-date').textContent=dateLabel(selectedDate);
  $('calendar-grid').replaceChildren();
  for(const cell of monthCells(month)){
    const records=entriesForDay(state.entries,cell.date),e=button('',()=>setDate(cell.date),`calendar-day${cell.inMonth?'':' outside'}${cell.date===selectedDate?' selected':''}${cell.date===dateKey()?' today':''}`);
    e.disabled=!dateIsValid(cell.date);e.setAttribute('aria-pressed',String(cell.date===selectedDate));
    e.setAttribute('aria-label',`${cell.date} ${records.length?records.map(r=>`${MEALS[r.meal]} ${r.status==='eaten'?'食べた':'予定'}`).join('、'):'記録なし'}`);
    e.append(node('span','day-number',String(Number(cell.date.slice(8)))));
    const badges=node('span','day-meals');
    for(const [meal,label]of Object.entries(MEALS)){
      const meals=records.filter(r=>r.meal===meal);if(!meals.length)continue;
      const b=node('span',`meal-count ${meals.some(r=>r.status==='eaten')?'eaten':'planned'}`,`${label.slice(0,1)}${meals.some(r=>r.status==='planned')?' ◇':''}`);badges.append(b);
    }e.append(badges);$('calendar-grid').append(e);
  }
  $('calendar-entry-list').replaceChildren();
  for(const [meal,label]of Object.entries(MEALS)){
    const section=node('section','meal-entry-group');section.append(node('h4','',label));
    const entries=entriesForDay(state.entries,selectedDate).filter(e=>e.meal===meal);
    if(!entries.length)section.append(node('p','field-note','まだ記録がありません。'));
    for(const entry of entries){
      const card=node('div','entry-card'),heading=node('div','entry-heading');
      heading.append(node('span',`status-badge ${entry.status}`,entry.status==='eaten'?'食べた':'これからの予定'),button(entry.status==='eaten'?'予定に戻す':'食べたにする',()=>commit(next=>{next.entries.find(e=>e.id===entry.id).status=entry.status==='eaten'?'planned':'eaten';},{message:'記録の種類を更新しました。'})));
      card.append(heading);const items=node('div','entry-items');
      for(const item of entry.items){const row=node('div','entry-item'),name=button(item.name,()=>openSnapshot(item),'recipe-name');
        const portion=item.portion??{amount:1,unit:'人分'};const qty=node('input');qty.type='number';qty.min='0.001';qty.max='1000000';qty.step='any';qty.value=Number((item.quantity*portion.amount).toFixed(4));qty.setAttribute('aria-label',`${item.name}の量（${portion.unit}）`);
        qty.addEventListener('change',guard(()=>commit(next=>{next.entries.find(e=>e.id===entry.id).items.find(i=>i.id===item.id).quantity=Number(qty.value)/portion.amount;})));
        row.append(name,qty,node('span','unit-label',portion.unit),button('編集',()=>editItem(entry,item)),button('削除',()=>commit(next=>{const e=next.entries.find(e=>e.id===entry.id);e.items=e.items.filter(i=>i.id!==item.id);if(!e.items.length&&!e.note)next.entries=next.entries.filter(x=>x.id!==entry.id);})));items.append(row);
      }card.append(items);if(entry.note)card.append(node('p','entry-note',entry.note));
      const actions=node('div','entry-actions');actions.append(button('この記録を削除',()=>{if(confirm('この食事の記録を削除しますか？'))commit(next=>{next.entries=next.entries.filter(e=>e.id!==entry.id);});}));card.append(actions);section.append(card);
    }$('calendar-entry-list').append(section);
  }
  $('day-complete').checked=state.completedDays.includes(selectedDate);
  renderRecordPicker();
}

function renderNutrition(){
  const date=$('nutrition-date').value||selectedDate,days=Number($('nutrition-period').value||1);
  const actual=summariseEntries(state.entries,{from:date,to:date}),planned=summariseEntries(state.entries,{from:date,to:date,status:'planned'});
  const period=analyseIntake(state.entries,{to:date,days,completedDays:state.completedDays});
  const reference=state.profile.mode==='reference'?deriveReference(state.profile):null;
  const dayCompleted=state.completedDays.includes(date),hasDay=actual.entryCount>0||dayCompleted;
  const box=$('nutrition-view');box.replaceChildren();
  box.append(node('p','nutrition-caption',days===1?`${dateLabel(date)} · 食べた記録 ${actual.entryCount}件 / ${actual.recordedMeals}食分${planned.entryCount?` · 予定 ${planned.entryCount}件（集計外）`:''}`:`${period.from}〜${period.to} · 記録がそろった日の1日平均`));
  if(days===1&&!hasDay)box.append(node('p','empty-note','食べた記録がまだありません。未記録を食べていないものとは判断しません。'));
  const grid=node('div','nutrition-grid');
  for(const key of NUTRIENT_KEYS){
    const value=days===1?(hasDay?actual.values[key]:null):period.mean[key];
    const known=days===1?actual.complete[key]:period.knownDays[key]===period.completedCount;
    const card=node('div','nutrition-metric');card.append(node('span','',NUTRIENT_LABELS[key]),node('strong','',value===null?'—':`${fmt(value,key==='kcal'?0:1)} ${NUTRIENT_UNITS[key]}`));
    if(days===1&&hasDay&&!known)card.append(node('small','partial-note','＋不明分'));
    if(days>1)card.append(node('small','partial-note',`${period.knownDays[key]}/${period.completedCount}日分${known?'':'（不明の日を除外）'}`));
    const track=node('div','nutrient-track'),fill=node('span','nutrient-fill');fill.style.width=`${Math.min(100,(value??0)/(state.targets[key]||1)*100)}%`;track.append(fill);card.append(track,node('small','',goalLabel(key,reference)));
    if(value!==null){
      const comparison=days===1&&!dayCompleted?{kind:'pending',label:'記録の途中です'}:compareIntake(key,value,{target:state.targets[key],reference,complete:days===1?known:true});
      card.append(node('small',`comparison ${comparison.kind}`,comparison.label));
    }
    grid.append(card);
  }
  box.append(grid);
  if(days===1&&actual.unknownItems)box.append(node('p','field-note',`${actual.unknownItems}品に未入力の栄養があります。表示は分かっている量の合計です。`));
  $('period-summary').replaceChildren(node('p','',`${days}日間で${period.totals.recordedDays}日の記録があります。うち${period.completedCount}日を記録完了として登録しています。`),node('p','field-note',days===1?(dayCompleted?'この日の飲食は記録済みとして比較します。未入力の栄養は比較しません。':'飲食の記録がそろったら「記録」タブで完了にチェックできます。'):period.completedCount?'平均には記録がそろった日だけを使います。栄養が不明の日は成分ごとに除き、対象の日数を表示します。':'記録がそろった日がないため平均は表示していません。空白の日を0として計算しません。'));
  const refBox=$('nutrition-reference-note');refBox.replaceChildren();
  if(reference){refBox.append(node('strong','',`2025年版の目安 · ${reference.label}`),node('p','field-note','参照体位の一般成人に対する比較用です。体格、妊娠・授乳、治療用の調整は行いません。1日だけの数字で健康状態を判定するものではありません。'));
    const detail=node('details');detail.append(node('summary','','目安の種類と出典を見る'));
    detail.append(node('p','field-note',`たんぱく質は推奨量${reference.targets.protein}gを表示しています。目標エネルギー比率${reference.energyPercentRanges.protein.min}〜${reference.energyPercentRanges.protein.max}%（${fmt(reference.ranges.protein.min)}〜${fmt(reference.ranges.protein.max)}g）とは別の指標です。脂質と炭水化物のバーは公式範囲の中央を比較の便宜値にしています。`));
    for(const source of reference.references.slice(0,2)){const link=node('a','text-link',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);}refBox.append(detail);
  }else{refBox.append(node('strong','','手動で設定した比較値'),node('p','field-note','年代・基準表の性別・活動量に合わせた目安は「設定」タブで選べます。初期値は表示を試すための参考値です。'));}
  const chartDays=days===30?30:7,from=safeShift(date,1-chartDays),chart=node('div','week-chart');
  $('weekly-view').replaceChildren();
  for(let i=0;i<chartDays;i++){
    const d=safeShift(from,i);if(d>date)break;const daily=summariseEntries(state.entries,{from:d,to:d}),col=node('div','week-day'),bar=node('div','week-bar');
    bar.style.height=`${Math.max(2,Math.min(140,daily.values.kcal/(state.targets.kcal||1)*110))}px`;bar.setAttribute('aria-hidden','true');
    col.append(node('span','',daily.entryCount?`${fmt(daily.values.kcal,0)}${daily.complete.kcal?'':'＋?'}`:'—'),bar,node('span','',d.slice(5).replace('-','/')),node('small','',`${daily.recordedMeals}食${state.completedDays.includes(d)?' ✓':''}`));chart.append(col);
  }
  $('weekly-view').append(chart,node('p','field-note',`直近${chartDays}日間のエネルギー（kcal）。✓は記録完了、＋?は不明分を含む日です。未完了の日も分かっている量を表示します。`));
  for(const key of NUTRIENT_KEYS){$('target-'+key).value=Number(state.targets[key].toFixed(3));$('target-'+key).step='any';}
}
function goalLabel(key,reference){
  const value=state.targets[key],unit=NUTRIENT_UNITS[key];
  if(!reference)return `比較値 ${amount(value,unit)}`;
  if(['fat','carbs'].includes(key)){const r=reference.ranges[key];return `目標範囲 ${fmt(r.min)}〜${fmt(r.max)} g`;}
  if(key==='salt')return `目標量 ${amount(value,unit)}未満`;
  if(key==='fiber')return `目標量 ${amount(value,unit)}以上`;
  if(key==='protein')return `推奨量 ${amount(value,unit)}`;
  return `参照体位の推定値 ${amount(value,unit)}`;
}
function renderProfile(){
  for(const [id,key]of [['profile-age','ageBand'],['profile-sex','sex'],['profile-activity','activity'],['profile-mode','mode']])$(id).value=state.profile[key];
  const reference=state.profile.mode==='reference'?deriveReference(state.profile):null;
  $('profile-summary').textContent=reference?`${reference.label}の比較値を使用しています。`:'手動の比較値を使用しています。プロフィールの入力は任意です。';
}
function familyLabel(recipe){return CATALOG_CATEGORIES.find(f=>f.id===recipeFamily(recipe))?.label??ROLES[recipe.role];}
function renderRecordPicker(){
  const search=$('catalog-search')?.value.trim()??'',all=data().recipes.map(r=>({...r,ingredients:r.ingredients.map(p=>({...p,name:INGREDIENTS[p.id]?.name??p.id}))}));
  const families=catalogFamilies(all,{query:search});
  const previousFamily=$('catalog-family').value||activeFamily;
  if(!families.some(f=>f.id===previousFamily))activeFamily=families[0]?.id??'';else activeFamily=previousFamily;
  selectOptions($('catalog-family'),families.map(f=>[f.id,`${f.label}（${f.count}）`]),activeFamily);
  const previous=$('catalog-item').value,variants=catalogVariants(all,activeFamily,{query:search});
  selectOptions($('catalog-item'),variants.map(r=>[r.id,r.variantLabel??r.name]),previous);
  const id=$('catalog-item').value,r=recipeById(id);$('add-catalog-item').disabled=!r;
  if(!r){$('catalog-unit').textContent='';$('catalog-serving-label').textContent='一致するメニューがありません。別の名前で探してください。';return;}
  const portion=recipePortion(r,data());$('catalog-unit').textContent=portion.unit;$('catalog-serving-label').textContent=portion.label;
  $('catalog-amount').min='0.001';$('catalog-amount').max='1000000';$('catalog-amount').step='any';
  if(recordSelectionId!==id){$('catalog-amount').value=portion.amount;recordSelectionId=id;}
}
function renderMealChoices(kind){
  const s=state.settings,current=s[kind+'Id'],role=kind==='staple'?'staple':'drink';
  const families=catalogFamilies(data().recipes,{role});
  const family=['auto','none'].includes(current)?current:recipeFamily(recipeById(current));
  const specials=kind==='staple'?[['auto','献立に合わせる'],['none','追加しない']]:[['none','追加しない']];
  selectOptions($(kind+'-family'),[...specials,...families.map(f=>[f.id,f.label])],family);
  if(['auto','none'].includes(current)){
    selectOptions($(kind+'-choice'),[[current,current==='auto'?'献立に合わせて選ぶ':'追加しない']],current);$(kind+'-amount').value='';$(kind+'-amount').disabled=true;$(kind+'-unit').textContent='';return;
  }
  const variants=catalogVariants(data().recipes,family).filter(r=>kind==='drink'?r.role==='drink':r.staple||r.role==='staple');
  selectOptions($(kind+'-choice'),variants.map(r=>[r.id,r.variantLabel??r.name]),current);
  const r=recipeById(current),portion=recipePortion(r,data());
  $(kind+'-amount').disabled=false;$(kind+'-amount').required=true;$(kind+'-amount').min='0.001';$(kind+'-amount').step='any';$(kind+'-amount').value=s[kind+'Amount']??portion.amount;$(kind+'-unit').textContent=portion.unit;
}

function draftEntries(){return plan?.ok?plan.days.map(day=>({id:`draft-${day.date}`,date:day.date,meal:day.meal,status:'planned',note:'',items:activeRecipeIds(day).map(id=>snapshot(id,day.quantities?.[id]??1))})).filter(entry=>entry.items.length):[];}
function renderPlan(){
  $('plan-save-calendar').disabled=!plan?.ok;$('plan-output').replaceChildren();
  if(!plan){$('plan-date-label').textContent='条件を選んで提案を作成';const e=node('div','empty-plan');e.append(node('span','empty-mark','◒'),node('h3','','次のごはんをここから。'),node('p','','条件を選んで「献立を作る」を押してください。食べた記録があれば、その内容も参考にします。'));$('plan-output').append(e);return;}
  if(!plan.ok){$('plan-output').append(node('p','notice error',`条件に合う献立を作れませんでした。${(plan.missingRoles??[]).map(r=>ROLES[r]??r).join('・')}の候補を確認してください。`));for(const w of plan.warnings??[])$('plan-output').append(node('p','field-note',w));return;}
  $('plan-date-label').textContent=`${dateLabel(plan.days[0].date)}から${plan.days.length}日分の${MEALS[state.settings.meal]}`;
  for(const [index,day]of plan.days.entries()){
    const card=node('article','day-card'),head=node('div','day-card-heading');head.append(node('h3','',`${dateLabel(day.date)}の${MEALS[day.meal]}`),button('料理を替える',()=>{const id=activeRecipeIds(day).find(id=>['main','snack','side'].includes(recipeById(id).role)&&id!==state.settings.stapleId&&id!==state.settings.drinkId);if(!id)throw Error('替える料理を献立に戻してください。');plan=replaceRecipe(plan,{dayIndex:index,recipeId:id,entries:state.entries,targets:state.targets,completedDays:state.completedDays},data());renderPlan();renderShopping();}));card.append(head);
    for(const id of day.recipeIds){const r=recipeById(id),row=node('div','dish-row'),included=!day.omittedRecipeIds?.includes(id);row.classList.toggle('omitted',!included);
      row.append(check(id,CATALOG_CATEGORIES.find(f=>f.id===recipeFamily(r))?.role==='staple'?'主食':ROLES[r.role],included,yes=>{plan=toggleDish(plan,{dayIndex:index,recipeId:id,included:yes},data());renderPlan();renderShopping();}),button(r.name,()=>openSnapshot(snapshot(id,day.quantities?.[id]??1),r.custom?undefined:r.minutes),'recipe-name'),node('span','dish-amount',planAmountText(day,id)));card.append(row);
    }
    const total=sumNutrition(activeRecipeIds(day).map(id=>snapshot(id,day.quantities?.[id]??1)));
    card.append(node('p','field-note',`1人分の目安：${NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${fmt(total.values[k],k==='kcal'?0:1)} ${NUTRIENT_UNITS[k]}${total.complete[k]?'':'＋不明分'}`).join(' / ')}`));
    const details=node('details','plan-reasons');details.append(node('summary','','この献立を選んだ理由'));for(const message of [...(day.reasons??[]),...(day.warnings??[])])details.append(node('p','field-note',message));card.append(details);$('plan-output').append(card);
  }
  for(const warning of plan.warnings??[])$('plan-output').append(node('p','field-note',warning));
}
function planAmountText(day,id){const r=recipeById(id),portion=recipePortion(r,data());return amount(portion.amount*(day.quantities?.[id]??1),portion.unit);}
function renderPantry(){
  const id=$('pantry-item').value;selectOptions($('pantry-item'),[['','選んでください'],...Object.entries(INGREDIENTS).map(([key,i])=>[key,`${i.name}（${i.unit}）`])],id);
  $('pantry-list').replaceChildren();if(!state.pantry.length)$('pantry-list').append(node('p','field-note','食材と調味料を選んで手持ちの量を登録できます。'));
  for(const part of state.pantry){const i=INGREDIENTS[part.id],row=node('div','pantry-row'),input=node('input');input.type='number';input.min=0;input.max=1000000;input.step='0.1';input.value=part.amount;input.setAttribute('aria-label',`${i.name}の手持ち量`);input.addEventListener('change',guard(()=>commit(next=>{next.pantry.find(p=>p.id===part.id).amount=Number(input.value);},{invalidate:false})));row.append(node('span','',i.name),input,node('span','',i.unit),button('削除',()=>commit(next=>{next.pantry=next.pantry.filter(p=>p.id!==part.id);},{invalidate:false})));$('pantry-list').append(row);}
}
function renderShopping(){
  const list=$('shopping-list');list.replaceChildren();shoppingText='';
  const source=$('shopping-source').value,entries=source==='draft'?draftEntries():state.entries;
  const from=$('shopping-from').value||state.settings.startDate,to=safeShift(from,Number($('shopping-days').value)-1);
  const result=shoppingForEntries(entries,data(),{from,to,servings:state.settings.servings,pantry:state.pantry});
  $('shopping-status').textContent=result.entryCount?`${dateLabel(from)}から${Number($('shopping-days').value)}日間 · 予定${result.entryCount}件 · ${state.settings.servings}人分`:(source==='draft'?'献立を作成すると必要な材料を自動でまとめます。':'この期間には予定の献立がありません。');
  const buying=result.items.filter(i=>i.buy>0),lines=[];
  for(const i of result.items){const row=node('label',`shopping-item${i.buy===0?' in-stock':''}`),input=node('input');input.type='checkbox';input.checked=state.shoppingChecks.includes(i.id);input.disabled=i.buy===0;input.setAttribute('aria-label',`${i.name}を購入済みにする`);input.addEventListener('change',guard(()=>commit(next=>{next.shoppingChecks=input.checked?[...new Set([...next.shoppingChecks,i.id])]:next.shoppingChecks.filter(id=>id!==i.id);},{invalidate:false})));
    const detail=node('span','');detail.append(node('strong','',i.name),node('small','',`必要 ${amount(i.required,i.unit)} / 手持ち ${amount(i.stock,i.unit)}`));row.append(input,detail,node('span','shopping-amount',i.buy>0?amount(i.buy,i.unit):'手持ちで足ります'));list.append(row);if(i.buy>0)lines.push(`${input.checked?'✓':'□'} ${i.name} ${amount(i.buy,i.unit)}`);
  }
  if(result.entryCount&&!buying.length&&!result.missingMenus.length)list.prepend(node('p','field-note','登録された材料は手持ちで足ります。'));
  if(result.missingMenus.length){list.append(node('p','notice error',`材料が未登録、またはDBにない材料があるメニュー：${[...new Set(result.missingMenus.map(m=>m.name))].join('、')}。必要なものを別途確認してください。`));lines.push('材料未確認：'+result.missingMenus.map(m=>m.name).join('、'));}
  shoppingText=lines.length?`${from}〜${to} / ${state.settings.servings}人分\n${lines.join('\n')}`:'';$('copy-shopping').disabled=!shoppingText;
}
function renderCatalog(){
  $('catalog-count').textContent=String(data().recipes.length);
  for(const b of $('role-filters').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.role===roleFilter));
  const query=$('recipe-search').value.trim();
  const all=eligibleRecipes(state.settings,data()),families=catalogFamilies(all,{role:roleFilter,query});
  const family=$('recipe-family').value||'all';selectOptions($('recipe-family'),[['all','すべての種類'],...families.map(f=>[f.id,`${f.label}（${f.count}）`])],family);
  const candidates=(family!=='all'&&families.some(f=>f.id===family)?catalogVariants(all,family,{query}):all.filter(r=>catalogFamilies([r],{role:roleFilter,query}).length)).filter(r=>catalogFamilies([r],{role:roleFilter}).length);
  const grid=$('recipe-grid');grid.replaceChildren();
  for(const r of candidates.slice(0,recipeLimit)){const card=button('',()=>openRecipe(r.id),'recipe-card');card.append(node('span','recipe-meta',`${familyLabel(r)} / ${r.genre}`),node('h3','',r.name),node('p','',r.custom?'自分のメニュー':`${r.minutes}分`));const n=recipeNutrition(r,data());card.append(node('small','',n.kcal===null?'エネルギー未入力':`${fmt(n.kcal,0)} kcal / ${amount(recipePortion(r,data()).amount,recipePortion(r,data()).unit)}`));grid.append(card);}
  if(!candidates.length)grid.append(node('p','empty-note','条件に合うメニューがありません。検索や避ける食材の設定を確認してください。'));
  $('more-recipes').hidden=candidates.length<=recipeLimit;
  $('custom-catalog-list').replaceChildren();if(!state.customRecipes.length)$('custom-catalog-list').append(node('p','field-note','手入力のときに保存を選ぶと、ここにメニューが増えます。'));
  for(const r of state.customRecipes){const row=node('div','custom-recipe-row');row.append(button(r.name,()=>openRecipe(r.id)),node('small','',r.allergensKnown?'アレルギー情報を確認済み':'アレルギー情報は未確認'),button('削除',()=>{if(!confirm(`「${r.name}」を自分のデータベースから削除しますか？記録済みの食事は残ります。`))return;commit(next=>{next.customRecipes=next.customRecipes.filter(c=>c.id!==r.id);if(next.settings.stapleId===r.id)next.settings.stapleId='auto';if(next.settings.drinkId===r.id)next.settings.drinkId='none';},{message:'メニューを削除しました。過去の記録は残しています。'});}));$('custom-catalog-list').append(row);}
}
function openRecipe(id){const r=describeRecipe(id,data());if(!r)throw Error('このレシピは見つかりませんでした。');openSnapshot(snapshot(id),r.custom?undefined:r.minutes);}
function openSnapshot(item,minutes){
  $('dialog-title').textContent=item.name;$('dialog-meta').textContent=`${item.recipeId&&recipeById(item.recipeId)?familyLabel(recipeById(item.recipeId)):ROLES[item.role]} / ${item.portion?amount(item.portion.amount*item.quantity,item.portion.unit):amount(item.quantity,'人分')}${minutes?` / 約${minutes}分`:''}`;const box=$('dialog-content');box.replaceChildren();
  const n=itemNutrition(item);box.append(node('p','field-note',NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${n[k]===null?'未入力':amount(n[k],NUTRIENT_UNITS[k])}`).join(' / ')));
  box.append(node('h3','',`材料（${item.portion?amount(item.portion.amount*item.quantity,item.portion.unit):amount(item.quantity,'人分')}）`));const ul=node('ul','ingredient-list');for(const part of item.ingredients)ul.append(node('li','',`${INGREDIENTS[part.id]?.name??'未登録の食材'} ${amount(part.amount*item.quantity,INGREDIENTS[part.id]?.unit??'')}`));box.append(ul);
  if(!item.ingredientsKnown)box.append(node('p','field-note','材料の全体は未確認です。買い物リストに不足がある可能性があります。'));
  box.append(node('h3','','作り方'));const ol=node('ol','recipe-steps');for(const s of item.steps)ol.append(node('li','',s));box.append(ol);if(!item.steps.length)box.append(node('p','field-note','作り方は未登録です。'));
  box.append(node('p','allergy-note',item.allergensKnown?`含まれる登録アレルゲン：${item.allergens.length?item.allergens.map(id=>ALLERGENS.find(a=>a.id===id)?.label??id).join('、'):'登録なし'}。加工品や調味料は商品表示も確認してください。`:'アレルギー情報は未確認です。自動提案の対象にはしません。'));
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function ingredientRow(part){
  const row=node('div','pantry-row'),select=node('select');select.setAttribute('aria-label','手入力メニューの材料');selectOptions(select,[['','材料を選ぶ'],...Object.entries(INGREDIENTS).map(([id,i])=>[id,`${i.name}（${i.unit}）`])],part?.id??'');
  const qty=node('input');qty.type='number';qty.min='0.001';qty.max=1000000;qty.step='any';qty.value=part?.amount??'';qty.placeholder='基準量に含まれる分量';qty.setAttribute('aria-label','基準量に含まれる材料の分量');row.append(select,qty,button('削除',()=>row.remove()));$('manual-ingredients').append(row);
}
function readManual(){
  const ingredients=[...$('manual-ingredients').children].map(row=>({id:row.querySelector('select').value,amount:Number(row.querySelector('input').value)}));
  if(ingredients.some(i=>!i.id||!Number.isFinite(i.amount)||i.amount<=0))throw Error('材料を選んで基準量に含まれる分量を入力してください。不要な行は削除できます。');
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,$('manual-'+k).value.trim()===''?null:Number($('manual-'+k).value)]));
  return {id:`custom-${uid()}`,name:$('manual-name').value.trim(),role:$('manual-role').value,genre:'その他',minutes:1,servings:1,staple:$('manual-role').value==='staple',ingredients,
    steps:$('manual-steps').value.split('\n').map(s=>s.trim()).filter(Boolean),manualNutrition,
    allergens:[...$('manual-allergens').querySelectorAll('input:checked')].map(i=>i.value),allergensKnown:$('manual-allergens-known').checked,ingredientsKnown:$('manual-ingredients-known').checked,
    groups:[],proteinSources:[],custom:true,portion:{amount:Number($('manual-base-amount').value),unit:$('manual-base-unit').value}};
}
function resetManual(){editing=null;$('manual-form').reset();$('manual-ingredients').replaceChildren();$('manual-edit-note').hidden=true;}
function editItem(entry,item){
  resetManual();editing={entryId:entry.id,itemId:item.id};setDate(entry.date);$('calendar-meal').value=entry.meal;$('calendar-status').value=entry.status;
  $('manual-base-amount').value=item.portion?.amount??1;$('manual-base-unit').value=item.portion?.unit??'人分';
  $('manual-name').value=item.name;$('manual-role').value=item.role;$('manual-quantity').value=item.quantity;$('manual-note').value=entry.note;
  for(const key of NUTRIENT_KEYS)$('manual-'+key).value=item.nutrition[key]??'';
  $('manual-allergens-known').checked=item.allergensKnown;$('manual-ingredients-known').checked=item.ingredientsKnown&&!item.ingredients.some(p=>!INGREDIENTS[p.id]);if(item.ingredients.some(p=>!INGREDIENTS[p.id]))tell('現在のDBにない材料があります。編集する場合は材料を確認して登録し直してください。',true);
  for(const input of $('manual-allergens').querySelectorAll('input'))input.checked=item.allergens.includes(input.value);
  for(const p of item.ingredients)if(INGREDIENTS[p.id])ingredientRow(p);
  $('manual-steps').value=item.steps.join('\n');$('manual-edit-note').hidden=false;$('manual-form').closest('details').open=true;$('manual-name').focus();
}
function renderAll(){renderProfile();renderSettings();renderCalendar();renderNutrition();renderPlan();renderPantry();renderShopping();renderCatalog();}

// 材料を並べただけでは全材料が分かるとは限らないため、確認欄を別に設けます。
const catalogSearchLabel=node('label','','メニューを探す'),catalogSearch=node('input');catalogSearch.id='catalog-search';catalogSearch.type='search';catalogSearch.placeholder='料理名や材料で絞り込み';catalogSearch.autocomplete='off';catalogSearchLabel.htmlFor='catalog-search';catalogSearchLabel.append(catalogSearch);$('catalog-item').closest('label').before(catalogSearchLabel);catalogSearch.addEventListener('input',renderRecordPicker);
const completeLabel=check('manual-ingredients-known','すべての材料と分量を登録した',false);completeLabel.querySelector('input').id='manual-ingredients-known';$('manual-ingredients').after(completeLabel);
const estimate=button('材料から栄養の概算を入力する',()=>{if(!$('manual-ingredients-known').checked)throw Error('すべての材料と分量を登録したら確認欄にチェックしてください。');const r=readManual();if(!r.ingredients.length)throw Error('材料を登録してください。');const values=recipeNutrition({servings:1,ingredients:r.ingredients},builtin);for(const key of NUTRIENT_KEYS)$('manual-'+key).value=values[key]===null?'':Math.round(values[key]*100)/100;tell('材料から栄養を概算しました。商品表示が分かる場合は修正してください。');},'button-secondary');estimate.id='manual-estimate-nutrition';$('manual-ingredients').after(estimate);
const editNote=node('div','notice','食事の記録を編集中です。保存すると選んだ日付・食事・種類に更新します。');editNote.id='manual-edit-note';editNote.hidden=true;editNote.append(button('編集をやめる',resetManual));$('manual-form').prepend(editNote);
for(const key of NUTRIENT_KEYS)$('manual-'+key).step='any';
$('manual-quantity').step='any';$('manual-quantity').min='0.001';$('manual-quantity').max='1000';
for(const a of ALLERGENS)$('manual-allergens').append(check(a.id,a.label,false));
$('calendar-date').value=selectedDate;$('nutrition-date').value=selectedDate;if(state.entries.some(e=>e.status==='planned'))$('shopping-source').value='calendar';$('shopping-from').value=state.settings.startDate;$('shopping-days').value=state.settings.days;
for(const id of ['calendar-date','nutrition-date','start-date','shopping-from']){$(id).min='2000-01-01';$(id).max='2100-12-31';}
bind('month-prev','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()-1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-next','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()+1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-today','click',()=>setDate(dateKey()));bind('calendar-date','change',()=>setDate($('calendar-date').value));bind('nutrition-date','change',()=>{if(!dateIsValid($('nutrition-date').value))throw Error('集計する日付を確認してください。');renderNutrition();});
bind('add-catalog-item','click',()=>{const id=$('catalog-item').value;if(!id)throw Error('記録するメニューを選んでください。');const item=snapshot(id,quantityFromAmount(recipeById(id),data(),Number($('catalog-amount').value)));commit(next=>next.entries.push(selectedEntry([item])),{message:'食事をカレンダーに追加しました。'});});
bind('manual-add-ingredient','click',()=>ingredientRow());
bind('manual-form','submit',event=>{event.preventDefault();const r=readManual(),save=$('manual-save-db').checked,quantity=Number($('manual-quantity').value),note=$('manual-note').value.trim();
  commit(next=>{if(save)next.customRecipes.push(r);const clean=validateJournal(next,builtin),full=save?clean.customRecipes.find(c=>c.id===r.id):validateJournal({...next,customRecipes:[...next.customRecipes,r]},builtin).customRecipes.at(-1);
    const item=itemFromRecipe(full,{...builtin,recipes:[...RECIPES,...clean.customRecipes]},quantity);item.portion=recipePortion(full,builtin);if(!save)item.recipeId=null;
    if(editing){const old=next.entries.find(e=>e.id===editing.entryId);if(!old)throw Error('編集する記録が見つかりません。');const at=old.items.findIndex(i=>i.id===editing.itemId);if(at<0)throw Error('編集する料理が見つかりません。');old.items.splice(at,1);if(old.items.length&&note===old.note)old.note='';if(!old.items.length)next.entries=next.entries.filter(e=>e.id!==old.id);next.entries.push(selectedEntry([item],note));}else next.entries.push(selectedEntry([item],note));
  },{message:save?'食事を記録し、自分のデータベースにも保存しました。':'食事をカレンダーに記録しました。'});resetManual();
});
for(const [id,key]of [['start-date','startDate'],['plan-days','days'],['servings','servings'],['plan-meal','meal']])bind(id,'change',()=>commit(next=>{next.settings[key]=['days','servings'].includes(key)?Number($(id).value):$(id).value;}));
for(const id of ['genre-mode','single-genre','meal-mood'])bind(id,'change',()=>commit(next=>{next.settings.preferences.genreMode=$('genre-mode').value;next.settings.preferences.genre=$('genre-mode').value==='single'?$('single-genre').value:'all';next.settings.preferences.mood=$('meal-mood').value;}));
bind('ratio-equal','click',()=>commit(next=>next.settings.preferences.genreRatios=Object.fromEntries(GENRES.map(g=>[g,20]))));bind('ratio-japanese','click',()=>commit(next=>next.settings.preferences.genreRatios={和食:50,洋食:20,中華:20,エスニック:10,その他:0}));
bind('ingredient-search','input',()=>renderIngredientSearch(false));bind('preferred-search','input',()=>renderIngredientSearch(true));
bind('plan-form','submit',event=>{event.preventDefault();state=validateJournal({...state,settings:{...state.settings,stapleAmount:$('staple-amount').disabled?null:Number($('staple-amount').value),drinkAmount:$('drink-amount').disabled?null:Number($('drink-amount').value)}},builtin);persist();if(shiftDate(state.settings.startDate,state.settings.days-1)>'2100-12-31')throw Error('献立の期間は2100年内で指定してください。');plan=generateCalendarPlan({...state.settings,seed:Math.floor(Math.random()*2147483647)},data(),{entries:state.entries,targets:state.targets,meal:state.settings.meal,stapleId:state.settings.stapleId,drinkId:state.settings.drinkId,pantry:state.pantry,completedDays:state.completedDays});state.shoppingChecks=[];persist();$('shopping-from').value=state.settings.startDate;$('shopping-days').value=state.settings.days;$('shopping-source').value='draft';renderPlan();renderShopping();tell(plan.ok?'献立を作成しました。内容を確認して予定に登録できます。':'条件に合う候補を確認してください。',!plan.ok);});
bind('plan-save-calendar','click',()=>{const entries=draftEntries().filter(e=>e.items.length).map(e=>({...e,id:uid()}));if(!entries.length)throw Error('料理を1品以上含む献立を作成してください。');commit(next=>next.entries.push(...entries),{message:'献立を予定としてカレンダーに登録しました。食べたら記録を切り替えてください。'});$('shopping-source').value='calendar';setDate(entries[0].date);renderShopping();activateTab('record');});
bind('targets-form','submit',event=>{event.preventDefault();commit(next=>{next.targets=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,Number($('target-'+k).value)]));next.profile.mode='manual';},{message:'比較用の目標値を保存しました。'});});
bind('pantry-item','change',()=>{const i=INGREDIENTS[$('pantry-item').value];$('pantry-amount').setAttribute('aria-label',`手持ちの量${i?`（${i.unit}）`:''}`);});
bind('pantry-add','click',()=>{const id=$('pantry-item').value,quantity=Number($('pantry-amount').value);if(!id)throw Error('手持ちの食材を選んでください。');commit(next=>{const old=next.pantry.find(i=>i.id===id);if(old)old.amount=quantity;else next.pantry.push({id,amount:quantity});},{invalidate:false,message:'手持ちの量を登録しました。'});});
for(const id of ['shopping-from','shopping-days','shopping-source'])bind(id,'change',renderShopping);
bind('shopping-clear-checks','click',()=>commit(next=>{next.shoppingChecks=[];},{invalidate:false}));
bind('copy-shopping','click',async()=>{if(!shoppingText)return;try{await navigator.clipboard.writeText(shoppingText);tell('買い物リストをコピーしました。');}catch{const textarea=node('textarea');textarea.value=shoppingText;textarea.readOnly=true;$('shopping-list').prepend(textarea);textarea.select();tell('コピーできない場合は、表示されたテキストを選んでコピーしてください。');}});
bind('role-filters','click',event=>{const b=event.target.closest('button[data-role]');if(!b)return;roleFilter=b.dataset.role;recipeLimit=12;renderCatalog();});bind('recipe-search','input',()=>{recipeLimit=12;renderCatalog();});bind('more-recipes','click',()=>{recipeLimit+=24;renderCatalog();});
bind('close-dialog','click',()=>$('recipe-dialog').close());bind('recipe-dialog','click',event=>{if(event.target===$('recipe-dialog')){const r=$('recipe-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('recipe-dialog').close();}});
bind('export-records','click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(validateJournal(state,builtin),null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=`meal-palette_${dateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('食事の記録と設定を書き出しました。');});
bind('import-records','click',()=>$('import-file').click());bind('import-file','change',async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;if(file.size>2*1024*1024)throw Error('2 MB以下のJSONファイルを選んでください。');const imported=parseJournal(await file.text(),builtin);if(!confirm('現在の記録と設定を読み込んだデータに置き換えますか？必要なら先に書き出してください。'))return;state=imported;plan=null;resetManual();persist();$('shopping-from').value=state.settings.startDate;renderAll();tell('データを読み込みました。');});
bind('clear-history','click',()=>{if(!confirm('食事の記録をすべて削除しますか？自分のメニューや設定は残ります。'))return;commit(next=>{next.entries=[];next.completedDays=[];},{message:'食事の記録を削除しました。'});resetManual();});
bind('catalog-family','change',()=>{activeFamily=$('catalog-family').value;recordSelectionId='';renderRecordPicker();});
bind('catalog-item','change',renderRecordPicker);
bind('day-complete','change',()=>commit(next=>{next.completedDays=$('day-complete').checked?[...new Set([...next.completedDays,selectedDate])]:next.completedDays.filter(date=>date!==selectedDate);},{message:'記録の完了状態を更新しました。'}));
bind('nutrition-period','change',renderNutrition);
bind('recipe-family','change',()=>{recipeLimit=12;renderCatalog();});
for(const kind of ['staple','drink']){
  bind(kind+'-family','change',()=>{const family=$(kind+'-family').value;const id=['auto','none'].includes(family)?family:catalogVariants(data().recipes,family).find(r=>kind==='drink'?r.role==='drink':r.staple||r.role==='staple')?.id;if(!id)throw Error('この種類のメニューがありません。');commit(next=>{next.settings[kind+'Id']=id;next.settings[kind+'Amount']=null;});});
  bind(kind+'-choice','change',()=>commit(next=>{next.settings[kind+'Id']=$(kind+'-choice').value;next.settings[kind+'Amount']=null;}));
  bind(kind+'-amount','change',()=>commit(next=>{next.settings[kind+'Amount']=Number($(kind+'-amount').value);}));
}
bind('profile-form','submit',event=>{event.preventDefault();const profile={ageBand:$('profile-age').value,sex:$('profile-sex').value,activity:$('profile-activity').value,mode:$('profile-mode').value};const reference=deriveReference(profile);if(profile.mode==='reference'&&!reference)throw Error('年代・基準表の性別・活動量を選んでください。75歳以上の「高い」活動量は参照値がないため手動で設定できます。');commit(next=>{next.profile=profile;if(profile.mode==='reference')next.targets={...reference.targets};},{message:'栄養の比較方法を保存しました。'});});
const activateTab=setupTabs();
renderAll();if(loaded.message)tell(loaded.message,/読み込めません|元の保存データ/.test(loaded.message));
