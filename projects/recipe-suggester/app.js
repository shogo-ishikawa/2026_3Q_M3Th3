import {ALLERGENS, INGREDIENTS, RECIPES} from './data.js';
import {generateCalendarPlan, replaceRecipe, toggleDish, activeRecipeIds, describeRecipe, eligibleRecipes} from './planner.js';
import {GENRES, rebalanceGenreRatios} from './storage.js';
import {readJournal, writeJournal, validateJournal, parseJournal, dateKey, dateIsValid, monthCells, shiftDate, entriesForDay} from './journal.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition, itemFromRecipe, itemNutrition, sumNutrition, summariseEntries} from './nutrition.js';
import {shoppingForEntries} from './shopping.js';

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
function snapshot(id,quantity=1){const recipe=describeRecipe(id,data());if(!recipe)throw Error('このメニューは見つかりませんでした。');return itemFromRecipe(recipe,data(),quantity);}

function renderSettings(){
  const s=state.settings,p=s.preferences;
  for(const [id,value]of Object.entries({'start-date':s.startDate,'plan-days':s.days,servings:s.servings,'plan-meal':s.meal,'genre-mode':p.genreMode,'single-genre':p.genre==='all'?'和食':p.genre,'meal-mood':p.mood}))$(id).value=value;
  selectOptions($('staple-choice'),[['auto','献立に合わせて選ぶ'],['none','追加しない'],...data().recipes.filter(r=>r.role==='staple').map(r=>[r.id,r.name])],s.stapleId);
  selectOptions($('drink-choice'),[['none','追加しない'],...data().recipes.filter(r=>r.role==='drink').map(r=>[r.id,r.name])],s.drinkId);
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
        const qty=node('input');qty.type='number';qty.min='0.1';qty.max='100';qty.step='0.1';qty.value=item.quantity;qty.setAttribute('aria-label',`${item.name}の量（人分）`);
        qty.addEventListener('change',guard(()=>commit(next=>{next.entries.find(e=>e.id===entry.id).items.find(i=>i.id===item.id).quantity=Number(qty.value);})));
        row.append(name,qty,node('span','unit-label','人分'),button('編集',()=>editItem(entry,item)),button('削除',()=>commit(next=>{const e=next.entries.find(e=>e.id===entry.id);e.items=e.items.filter(i=>i.id!==item.id);if(!e.items.length&&!e.note)next.entries=next.entries.filter(x=>x.id!==entry.id);})));items.append(row);
      }card.append(items);if(entry.note)card.append(node('p','entry-note',entry.note));
      const actions=node('div','entry-actions');actions.append(button('この記録を削除',()=>{if(confirm('この食事の記録を削除しますか？'))commit(next=>{next.entries=next.entries.filter(e=>e.id!==entry.id);});}));card.append(actions);section.append(card);
    }$('calendar-entry-list').append(section);
  }
  const previous=$('catalog-item').value,search=$('catalog-search')?.value.trim()??'';
  selectOptions($('catalog-item'),[['','メニューを選ぶ'],...Object.keys(ROLES).flatMap(role=>data().recipes.filter(r=>r.role===role&&(!search||r.name.includes(search)||r.ingredients.some(p=>INGREDIENTS[p.id]?.name.includes(search)))).map(r=>[r.id,`${ROLES[role]} · ${r.name}${r.custom?'（自分のメニュー）':''}`]))],previous);
}
function renderNutrition(){
  const date=$('nutrition-date').value||selectedDate,actual=summariseEntries(state.entries,{from:date,to:date}),planned=summariseEntries(state.entries,{from:date,to:date,status:'planned'});
  const box=$('nutrition-view');box.replaceChildren();
  box.append(node('p','nutrition-caption',`${dateLabel(date)} · 食べた記録 ${actual.entryCount}件 / ${actual.recordedMeals}食分${planned.entryCount?` · 予定 ${planned.entryCount}件（集計外）`:''}`));
  if(!actual.entryCount)box.append(node('p','empty-note','食べた記録がまだありません。未記録の食事は食べていないものとは判断しません。'));
  const grid=node('div','nutrition-grid');
  for(const key of NUTRIENT_KEYS){const card=node('div','nutrition-metric');card.append(node('span','',NUTRIENT_LABELS[key]));
    card.append(node('strong','',actual.entryCount?`${fmt(actual.values[key],key==='kcal'?0:1)} ${NUTRIENT_UNITS[key]}`:'—'));
    if(actual.entryCount&&!actual.complete[key])card.append(node('small','partial-note','＋不明分'));
    const track=node('div','nutrient-track'),fill=node('span','nutrient-fill');fill.style.width=`${Math.min(100,actual.values[key]/(state.targets[key]||1)*100)}%`;track.append(fill);card.append(track,node('small','',`比較値 ${amount(state.targets[key],NUTRIENT_UNITS[key])}${key==='salt'?'（上限の参考）':''}`));grid.append(card);
  }box.append(grid);if(actual.unknownItems)box.append(node('p','field-note',`${actual.unknownItems}品に未入力の栄養があります。表示は分かっている量の合計です。`));
  const from=safeShift(date,-6),week=summariseEntries(state.entries,{from,to:date});$('weekly-view').replaceChildren();
  const chart=node('div','week-chart');
  for(let i=0;i<7;i++){const d=safeShift(from,i);if(d>date)break;const daily=summariseEntries(state.entries,{from:d,to:d});const col=node('div','week-day'),bar=node('div','week-bar');bar.style.height=`${Math.max(2,Math.min(140,daily.values.kcal/(state.targets.kcal||1)*110))}px`;bar.setAttribute('aria-hidden','true');
    col.append(node('span','',daily.entryCount?`${fmt(daily.values.kcal,0)}${daily.complete.kcal?'':'＋?'}`:'—'),bar,node('span','',d.slice(5).replace('-','/')),node('small','',`${daily.recordedMeals}食`));chart.append(col);
  }$('weekly-view').append(chart,node('p','field-note',`エネルギー（kcal）の推移。${week.recordedDays}日・${week.recordedMeals}食分の記録があります。未入力がある日は「＋?」を付けています。`));
  const totals=node('p','field-note',`7日間の分かる分の合計：${NUTRIENT_KEYS.map(key=>`${NUTRIENT_LABELS[key]} ${amount(week.values[key],NUTRIENT_UNITS[key])}${week.complete[key]?'':'＋不明分'}`).join(' / ')}`);$('weekly-view').append(totals);
  for(const key of NUTRIENT_KEYS)$('target-'+key).value=state.targets[key];
}
function draftEntries(){return plan?.ok?plan.days.map(day=>({id:`draft-${day.date}`,date:day.date,meal:day.meal,status:'planned',note:'',items:activeRecipeIds(day).map(id=>snapshot(id))})):[];}
function renderPlan(){
  $('plan-save-calendar').disabled=!plan?.ok;$('plan-output').replaceChildren();
  if(!plan){$('plan-date-label').textContent='条件を選んで提案を作成';const e=node('div','empty-plan');e.append(node('span','empty-mark','◒'),node('h3','','次のごはんをここから。'),node('p','','条件を選んで「献立を作る」を押してください。食べた記録があれば、その内容も参考にします。'));$('plan-output').append(e);return;}
  if(!plan.ok){$('plan-output').append(node('p','notice error',`条件に合う献立を作れませんでした。${(plan.missingRoles??[]).map(r=>ROLES[r]??r).join('・')}の候補を確認してください。`));for(const w of plan.warnings??[])$('plan-output').append(node('p','field-note',w));return;}
  $('plan-date-label').textContent=`${dateLabel(plan.days[0].date)}から${plan.days.length}日分の${MEALS[state.settings.meal]}`;
  for(const [index,day]of plan.days.entries()){
    const card=node('article','day-card'),head=node('div','day-card-heading');head.append(node('h3','',`${dateLabel(day.date)}の${MEALS[day.meal]}`),button('料理を替える',()=>{const id=activeRecipeIds(day).find(id=>['main','snack'].includes(recipeById(id).role));if(!id)throw Error('替える料理を献立に戻してください。');plan=replaceRecipe(plan,{dayIndex:index,recipeId:id,entries:state.entries,targets:state.targets},data());renderPlan();renderShopping();}));card.append(head);
    for(const id of day.recipeIds){const r=recipeById(id),row=node('div','dish-row'),included=!day.omittedRecipeIds?.includes(id);row.classList.toggle('omitted',!included);
      row.append(check(id,ROLES[r.role],included,yes=>{plan=toggleDish(plan,{dayIndex:index,recipeId:id,included:yes},data());renderPlan();renderShopping();}),button(r.name,()=>openRecipe(id),'recipe-name'));card.append(row);
    }
    const total=sumNutrition(activeRecipeIds(day).map(id=>snapshot(id)));
    card.append(node('p','field-note',`1人分の目安：${NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${fmt(total.values[k],k==='kcal'?0:1)} ${NUTRIENT_UNITS[k]}${total.complete[k]?'':'＋不明分'}`).join(' / ')}`));
    const details=node('details','plan-reasons');details.append(node('summary','','この献立を選んだ理由'));for(const message of [...(day.reasons??[]),...(day.warnings??[])])details.append(node('p','field-note',message));card.append(details);$('plan-output').append(card);
  }
  for(const warning of plan.warnings??[])$('plan-output').append(node('p','field-note',warning));
}
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
  const candidates=eligibleRecipes(state.settings,data()).filter(r=>(roleFilter==='all'||r.role===roleFilter)&&(!query||r.name.includes(query)||r.ingredients.some(p=>INGREDIENTS[p.id]?.name.includes(query))));
  const grid=$('recipe-grid');grid.replaceChildren();
  for(const r of candidates.slice(0,recipeLimit)){const card=button('',()=>openRecipe(r.id),'recipe-card');card.append(node('span','recipe-meta',`${ROLES[r.role]} / ${r.genre}`),node('h3','',r.name),node('p','',`${r.minutes}分${r.custom?' · 自分のメニュー':''}`));const n=recipeNutrition(r,data());card.append(node('small','',n.kcal===null?'エネルギー未入力':`${amount(n.kcal,'kcal')} / 1人分`));grid.append(card);}
  if(!candidates.length)grid.append(node('p','empty-note','条件に合うメニューがありません。検索や避ける食材の設定を確認してください。'));
  $('more-recipes').hidden=candidates.length<=recipeLimit;
  $('custom-catalog-list').replaceChildren();if(!state.customRecipes.length)$('custom-catalog-list').append(node('p','field-note','手入力のときに保存を選ぶと、ここにメニューが増えます。'));
  for(const r of state.customRecipes){const row=node('div','custom-recipe-row');row.append(button(r.name,()=>openRecipe(r.id)),node('small','',r.allergensKnown?'アレルギー情報を確認済み':'アレルギー情報は未確認'),button('削除',()=>{if(!confirm(`「${r.name}」を自分のデータベースから削除しますか？記録済みの食事は残ります。`))return;commit(next=>{next.customRecipes=next.customRecipes.filter(c=>c.id!==r.id);if(next.settings.stapleId===r.id)next.settings.stapleId='auto';if(next.settings.drinkId===r.id)next.settings.drinkId='none';},{message:'メニューを削除しました。過去の記録は残しています。'});}));$('custom-catalog-list').append(row);}
}
function openRecipe(id){const r=describeRecipe(id,data());if(!r)throw Error('このレシピは見つかりませんでした。');openSnapshot(itemFromRecipe(r,data()),r.minutes);}
function openSnapshot(item,minutes){
  $('dialog-title').textContent=item.name;$('dialog-meta').textContent=`${ROLES[item.role]} / 1人分${minutes?` / 約${minutes}分`:''}`;const box=$('dialog-content');box.replaceChildren();
  const n=item.nutrition;box.append(node('p','field-note',NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${n[k]===null?'未入力':amount(n[k],NUTRIENT_UNITS[k])}`).join(' / ')));
  box.append(node('h3','','材料（1人分）'));const ul=node('ul','ingredient-list');for(const part of item.ingredients)ul.append(node('li','',`${INGREDIENTS[part.id]?.name??'未登録の食材'} ${amount(part.amount,INGREDIENTS[part.id]?.unit??'')}`));box.append(ul);
  if(!item.ingredientsKnown)box.append(node('p','field-note','材料の全体は未確認です。買い物リストに不足がある可能性があります。'));
  box.append(node('h3','','作り方'));const ol=node('ol','recipe-steps');for(const s of item.steps)ol.append(node('li','',s));box.append(ol);if(!item.steps.length)box.append(node('p','field-note','作り方は未登録です。'));
  box.append(node('p','allergy-note',item.allergensKnown?`含まれる登録アレルゲン：${item.allergens.length?item.allergens.map(id=>ALLERGENS.find(a=>a.id===id)?.label??id).join('、'):'登録なし'}。加工品や調味料は商品表示も確認してください。`:'アレルギー情報は未確認です。自動提案の対象にはしません。'));
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function ingredientRow(part){
  const row=node('div','pantry-row'),select=node('select');select.setAttribute('aria-label','手入力メニューの材料');selectOptions(select,[['','材料を選ぶ'],...Object.entries(INGREDIENTS).map(([id,i])=>[id,`${i.name}（${i.unit}）`])],part?.id??'');
  const qty=node('input');qty.type='number';qty.min='0.001';qty.max=1000000;qty.step='any';qty.value=part?.amount??'';qty.placeholder='1人分の量';qty.setAttribute('aria-label','材料の分量');row.append(select,qty,button('削除',()=>row.remove()));$('manual-ingredients').append(row);
}
function readManual(){
  const ingredients=[...$('manual-ingredients').children].map(row=>({id:row.querySelector('select').value,amount:Number(row.querySelector('input').value)}));
  if(ingredients.some(i=>!i.id||!Number.isFinite(i.amount)||i.amount<=0))throw Error('材料を選んで1人分の分量を入力してください。不要な行は削除できます。');
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,$('manual-'+k).value.trim()===''?null:Number($('manual-'+k).value)]));
  return {id:`custom-${uid()}`,name:$('manual-name').value.trim(),role:$('manual-role').value,genre:'その他',minutes:1,servings:1,staple:$('manual-role').value==='staple',ingredients,
    steps:$('manual-steps').value.split('\n').map(s=>s.trim()).filter(Boolean),manualNutrition,
    allergens:[...$('manual-allergens').querySelectorAll('input:checked')].map(i=>i.value),allergensKnown:$('manual-allergens-known').checked,ingredientsKnown:$('manual-ingredients-known').checked,
    groups:[],proteinSources:[],custom:true};
}
function resetManual(){editing=null;$('manual-form').reset();$('manual-ingredients').replaceChildren();$('manual-edit-note').hidden=true;}
function editItem(entry,item){
  resetManual();editing={entryId:entry.id,itemId:item.id};setDate(entry.date);$('calendar-meal').value=entry.meal;$('calendar-status').value=entry.status;
  $('manual-name').value=item.name;$('manual-role').value=item.role;$('manual-quantity').value=item.quantity;$('manual-note').value=entry.note;
  for(const key of NUTRIENT_KEYS)$('manual-'+key).value=item.nutrition[key]??'';
  $('manual-allergens-known').checked=item.allergensKnown;$('manual-ingredients-known').checked=item.ingredientsKnown&&!item.ingredients.some(p=>!INGREDIENTS[p.id]);if(item.ingredients.some(p=>!INGREDIENTS[p.id]))tell('現在のDBにない材料があります。編集する場合は材料を確認して登録し直してください。',true);
  for(const input of $('manual-allergens').querySelectorAll('input'))input.checked=item.allergens.includes(input.value);
  for(const p of item.ingredients)if(INGREDIENTS[p.id])ingredientRow(p);
  $('manual-steps').value=item.steps.join('\n');$('manual-edit-note').hidden=false;$('manual-form').closest('details').open=true;$('manual-name').focus();
}
function renderAll(){renderSettings();renderCalendar();renderNutrition();renderPlan();renderPantry();renderShopping();renderCatalog();}

// 材料を並べただけでは全材料が分かるとは限らないため、確認欄を別に設けます。
const catalogSearchLabel=node('label','','メニューを探す'),catalogSearch=node('input');catalogSearch.id='catalog-search';catalogSearch.type='search';catalogSearch.placeholder='料理名や材料で絞り込み';catalogSearch.autocomplete='off';catalogSearchLabel.htmlFor='catalog-search';catalogSearchLabel.append(catalogSearch);$('catalog-item').before(catalogSearchLabel);catalogSearch.addEventListener('input',renderCalendar);
const completeLabel=check('manual-ingredients-known','すべての材料と分量を登録した',false);completeLabel.querySelector('input').id='manual-ingredients-known';$('manual-ingredients').after(completeLabel);
const estimate=button('材料から栄養の概算を入力する',()=>{if(!$('manual-ingredients-known').checked)throw Error('すべての材料と分量を登録したら確認欄にチェックしてください。');const r=readManual();if(!r.ingredients.length)throw Error('材料を登録してください。');const values=recipeNutrition({servings:1,ingredients:r.ingredients},builtin);for(const key of NUTRIENT_KEYS)$('manual-'+key).value=values[key]===null?'':Math.round(values[key]*100)/100;tell('材料から栄養を概算しました。商品表示が分かる場合は修正してください。');},'button-secondary');estimate.id='manual-estimate-nutrition';$('manual-ingredients').after(estimate);
const editNote=node('div','notice','食事の記録を編集中です。保存すると選んだ日付・食事・種類に更新します。');editNote.id='manual-edit-note';editNote.hidden=true;editNote.append(button('編集をやめる',resetManual));$('manual-form').prepend(editNote);
for(const key of NUTRIENT_KEYS)$('manual-'+key).step='any';
for(const a of ALLERGENS)$('manual-allergens').append(check(a.id,a.label,false));
$('calendar-date').value=selectedDate;$('nutrition-date').value=selectedDate;if(state.entries.some(e=>e.status==='planned'))$('shopping-source').value='calendar';$('shopping-from').value=state.settings.startDate;$('shopping-days').value=state.settings.days;
for(const id of ['calendar-date','nutrition-date','start-date','shopping-from']){$(id).min='2000-01-01';$(id).max='2100-12-31';}
bind('month-prev','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()-1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-next','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()+1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-today','click',()=>setDate(dateKey()));bind('calendar-date','change',()=>setDate($('calendar-date').value));bind('nutrition-date','change',()=>{if(!dateIsValid($('nutrition-date').value))throw Error('集計する日付を確認してください。');renderNutrition();});
bind('add-catalog-item','click',()=>{const id=$('catalog-item').value;if(!id)throw Error('記録するメニューを選んでください。');const item=snapshot(id,Number($('catalog-quantity').value));commit(next=>next.entries.push(selectedEntry([item])),{message:'食事をカレンダーに追加しました。'});});
bind('manual-add-ingredient','click',()=>ingredientRow());
bind('manual-form','submit',event=>{event.preventDefault();const r=readManual(),save=$('manual-save-db').checked,quantity=Number($('manual-quantity').value),note=$('manual-note').value.trim();
  commit(next=>{if(save)next.customRecipes.push(r);const clean=validateJournal(next,builtin),full=save?clean.customRecipes.find(c=>c.id===r.id):validateJournal({...next,customRecipes:[...next.customRecipes,r]},builtin).customRecipes.at(-1);
    const item=itemFromRecipe(full,{...builtin,recipes:[...RECIPES,...clean.customRecipes]},quantity);if(!save)item.recipeId=null;
    if(editing){const old=next.entries.find(e=>e.id===editing.entryId);if(!old)throw Error('編集する記録が見つかりません。');const at=old.items.findIndex(i=>i.id===editing.itemId);if(at<0)throw Error('編集する料理が見つかりません。');old.items.splice(at,1);if(old.items.length&&note===old.note)old.note='';if(!old.items.length)next.entries=next.entries.filter(e=>e.id!==old.id);next.entries.push(selectedEntry([item],note));}else next.entries.push(selectedEntry([item],note));
  },{message:save?'食事を記録し、自分のデータベースにも保存しました。':'食事をカレンダーに記録しました。'});resetManual();
});
for(const [id,key]of [['start-date','startDate'],['plan-days','days'],['servings','servings'],['plan-meal','meal'],['staple-choice','stapleId'],['drink-choice','drinkId']])bind(id,'change',()=>commit(next=>{next.settings[key]=['days','servings'].includes(key)?Number($(id).value):$(id).value;}));
for(const id of ['genre-mode','single-genre','meal-mood'])bind(id,'change',()=>commit(next=>{next.settings.preferences.genreMode=$('genre-mode').value;next.settings.preferences.genre=$('genre-mode').value==='single'?$('single-genre').value:'all';next.settings.preferences.mood=$('meal-mood').value;}));
bind('ratio-equal','click',()=>commit(next=>next.settings.preferences.genreRatios=Object.fromEntries(GENRES.map(g=>[g,20]))));bind('ratio-japanese','click',()=>commit(next=>next.settings.preferences.genreRatios={和食:50,洋食:20,中華:20,エスニック:10,その他:0}));
bind('ingredient-search','input',()=>renderIngredientSearch(false));bind('preferred-search','input',()=>renderIngredientSearch(true));
bind('plan-form','submit',event=>{event.preventDefault();if(shiftDate(state.settings.startDate,state.settings.days-1)>'2100-12-31')throw Error('献立の期間は2100年内で指定してください。');plan=generateCalendarPlan({...state.settings,seed:Math.floor(Math.random()*2147483647)},data(),{entries:state.entries,targets:state.targets,meal:state.settings.meal,stapleId:state.settings.stapleId,drinkId:state.settings.drinkId,pantry:state.pantry});state.shoppingChecks=[];persist();$('shopping-from').value=state.settings.startDate;$('shopping-days').value=state.settings.days;$('shopping-source').value='draft';renderPlan();renderShopping();tell(plan.ok?'献立を作成しました。内容を確認して予定に登録できます。':'条件に合う候補を確認してください。',!plan.ok);});
bind('plan-save-calendar','click',()=>{const entries=draftEntries().filter(e=>e.items.length).map(e=>({...e,id:uid()}));if(!entries.length)throw Error('料理を1品以上含む献立を作成してください。');commit(next=>next.entries.push(...entries),{message:'献立を予定としてカレンダーに登録しました。食べたら記録を切り替えてください。'});$('shopping-source').value='calendar';setDate(entries[0].date);renderShopping();});
bind('targets-form','submit',event=>{event.preventDefault();commit(next=>{next.targets=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,Number($('target-'+k).value)]));},{message:'比較用の目標値を保存しました。'});});
bind('pantry-item','change',()=>{const i=INGREDIENTS[$('pantry-item').value];$('pantry-amount').setAttribute('aria-label',`手持ちの量${i?`（${i.unit}）`:''}`);});
bind('pantry-add','click',()=>{const id=$('pantry-item').value,quantity=Number($('pantry-amount').value);if(!id)throw Error('手持ちの食材を選んでください。');commit(next=>{const old=next.pantry.find(i=>i.id===id);if(old)old.amount=quantity;else next.pantry.push({id,amount:quantity});},{invalidate:false,message:'手持ちの量を登録しました。'});});
for(const id of ['shopping-from','shopping-days','shopping-source'])bind(id,'change',renderShopping);
bind('shopping-clear-checks','click',()=>commit(next=>{next.shoppingChecks=[];},{invalidate:false}));
bind('copy-shopping','click',async()=>{if(!shoppingText)return;try{await navigator.clipboard.writeText(shoppingText);tell('買い物リストをコピーしました。');}catch{const textarea=node('textarea');textarea.value=shoppingText;textarea.readOnly=true;$('shopping-list').prepend(textarea);textarea.select();tell('コピーできない場合は、表示されたテキストを選んでコピーしてください。');}});
bind('role-filters','click',event=>{const b=event.target.closest('button[data-role]');if(!b)return;roleFilter=b.dataset.role;recipeLimit=12;renderCatalog();});bind('recipe-search','input',()=>{recipeLimit=12;renderCatalog();});bind('more-recipes','click',()=>{recipeLimit+=24;renderCatalog();});
bind('close-dialog','click',()=>$('recipe-dialog').close());bind('recipe-dialog','click',event=>{if(event.target===$('recipe-dialog')){const r=$('recipe-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('recipe-dialog').close();}});
bind('export-records','click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(validateJournal(state,builtin),null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=`kondate-note_${dateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('食事の記録と設定を書き出しました。');});
bind('import-records','click',()=>$('import-file').click());bind('import-file','change',async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;if(file.size>2*1024*1024)throw Error('2 MB以下のJSONファイルを選んでください。');const imported=parseJournal(await file.text(),builtin);if(!confirm('現在の記録と設定を読み込んだデータに置き換えますか？必要なら先に書き出してください。'))return;state=imported;plan=null;resetManual();persist();$('shopping-from').value=state.settings.startDate;renderAll();tell('データを読み込みました。');});
bind('clear-history','click',()=>{if(!confirm('食事の記録をすべて削除しますか？自分のメニューや設定は残ります。'))return;commit(next=>{next.entries=[];},{message:'食事の記録を削除しました。'});resetManual();});
renderAll();if(loaded.message)tell(loaded.message,true);
