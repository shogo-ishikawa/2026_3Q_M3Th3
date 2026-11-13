/** 定番セットと過去の食事のコピー。保存とカレンダー更新は呼出元が担当します。 */
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {createMealSet, createRepeatedMeal, mealSetWarnings, MAX_MEAL_SETS} from './meal-sets.js';
import {dateIsValid} from './journal.js';
import {sumNutrition} from './nutrition.js';

let mountCount=0;
const MEALS=[['breakfast','朝食'],['lunch','昼食'],['dinner','夕食'],['snack','間食']];
const STATUSES=[['eaten','食べた'],['planned','これからの予定']];
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const button=(label,fn,className='button-secondary')=>{const element=make('button',className,label);element.type='button';element.addEventListener('click',fn);return element;};
const field=(label,input)=>{const element=make('label','meal-sets-field',label);element.htmlFor=input.id;element.append(input);if(input.type==='number')configureQuantityInput(input,{step:.1});return element;};
const select=(id,items,value)=>{const element=make('select');element.id=id;for(const [id,label]of items){const option=make('option','',label);option.value=id;element.append(option);}element.value=value;return element;};

/**
 * state: journal。date/meal/status: 現在のカレンダーの登録先。
 * onSave(set), onDelete(id), onAdd(entry): 呼出元がcommitで保存し画面を再描画します。
 */
export function mountMealSets({state,data,date,meal='dinner',status='eaten',onSave=()=>{},onDelete=()=>{},onAdd=()=>{},onError=()=>{}}={}){
  if(!state||!Array.isArray(state.entries)||!Array.isArray(state.mealSets)||!dateIsValid(date))throw Error('定番セットと登録先の日付を確認してください。');
  for(const callback of [onSave,onDelete,onAdd,onError])if(typeof callback!=='function')throw Error('定番セット画面の保存処理を確認してください。');
  const prefix=`meal-sets-${++mountCount}`,root=make('section','meal-sets');root.setAttribute('aria-label','定番セットと食事のコピー');
  root.append(make('h3','','定番セット・過去の食事を使う'),make('p','field-note','いつもの組み合わせをまとめて登録できます。保存時点の量と栄養を使い、違う部分は登録後に各料理の量を変更してください。'));
  const error=make('p','meal-sets-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  const act=fn=>()=>{try{fn();error.hidden=true;error.textContent='';}catch(cause){error.textContent=cause.message;error.hidden=false;onError(cause.message);}};

  const destination=make('div','meal-sets-destination'),targetDate=make('input');targetDate.id=`${prefix}-target-date`;targetDate.type='date';targetDate.min='2000-01-01';targetDate.max='2100-12-31';targetDate.value=date;
  const targetMeal=select(`${prefix}-target-meal`,MEALS,meal),targetStatus=select(`${prefix}-target-status`,STATUSES,status),scale=make('input');scale.id=`${prefix}-scale`;scale.type='number';scale.min='0.001';scale.max='1000';scale.step='any';scale.value='1';
  destination.append(field('登録先の日付',targetDate),field('登録先の食事',targetMeal),field('登録する種類',targetStatus),field('量の倍率',scale));
  root.append(destination,make('p','field-note','同じ日・食事に記録がある場合は追加します。今ある記録は残ります。'));
  function addItems(items,note=''){
    if(String(scale.value).trim()==='')throw Error('量の倍率を入力してください。');
    const entry=createRepeatedMeal({items,date:targetDate.value,meal:targetMeal.value,status:targetStatus.value,note,scale:readQuantityInput(scale,{label:'量の倍率'})},data);
    onAdd(entry);
  }
  function showSummary(container,items,settings=state.settings){
    container.replaceChildren();
    if(!items.length){container.append(make('p','field-note','この条件の食事はありません。日付・食事・種類を選び直してください。'));return;}
    const list=make('ul','meal-sets-items');
    for(const item of items){const portion=item.portion??{amount:1,unit:'人分'};list.append(make('li','',`${item.name} ${rounded(item.quantity*portion.amount)}${portion.unit}`));}
    const summary=sumNutrition(items);container.append(list,make('p','meal-sets-energy',`${rounded(summary.values.kcal)} kcal${summary.complete.kcal?'':' ＋不明分'}`));
    const warnings=mealSetWarnings({items},settings,data);
    for(const warning of warnings)container.append(make('p','meal-sets-warning',warning));
    if(warnings.length)container.append(make('p','field-note','自動提案の対象とは別に、食べた事実や予定として手動で登録できます。'));
    if(items.some(item=>item.batchId!==undefined))container.append(make('p','meal-sets-warning','作り置きは残量画面から記録してください。残量の二重使用を防ぐためコピー・セット保存はできません。'));
  }

  const saved=make('div','meal-sets-saved');saved.append(make('h4','','保存した定番セット'));
  const sets=state.mealSets,selected=select(`${prefix}-saved`,sets.length?sets.map(set=>[set.id,set.name]):[['','まだ定番セットがありません']],sets[0]?.id??'');selected.disabled=!sets.length;
  const savedSummary=make('div','meal-sets-summary'),savedNote=make('p','field-note');
  const use=button('このセットを登録',act(()=>{const set=sets.find(set=>set.id===selected.value);if(!set)throw Error('定番セットを選んでください。');addItems(set.items,set.note);}),'button-primary meal-sets-use');
  const remove=button('このセットを削除',act(()=>{const set=sets.find(set=>set.id===selected.value);if(!set)throw Error('定番セットを選んでください。');onDelete(set.id);}),'button-secondary meal-sets-delete');
  const savedActions=make('div','meal-sets-actions');savedActions.append(use,remove);saved.append(field('定番セット',selected),savedSummary,savedNote,savedActions);root.append(saved);
  function updateSaved(){const set=sets.find(set=>set.id===selected.value);use.disabled=remove.disabled=!set;savedNote.textContent=set?.note??'';if(set)showSummary(savedSummary,set.items);else savedSummary.replaceChildren(make('p','field-note','下で過去の食事を選び、名前を付けて保存できます。'));}
  selected.addEventListener('change',updateSaved);updateSaved();

  const history=make('details','meal-sets-history');history.append(make('summary','','過去の食事をコピー・定番セットに保存'));
  const controls=make('div','meal-sets-source-fields'),sourceDate=make('input');sourceDate.id=`${prefix}-source-date`;sourceDate.type='date';sourceDate.min='2000-01-01';sourceDate.max='2100-12-31';
  // 初回は直近の実績を表示し、日付をさかのぼる操作を減らします。
  const latest=state.entries.filter(entry=>entry.status==='eaten'&&entry.items.length&&entry.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0]??state.entries.filter(entry=>entry.items.length).sort((a,b)=>b.date.localeCompare(a.date))[0];
  sourceDate.value=latest?.date??date;
  const sourceMeal=select(`${prefix}-source-meal`,MEALS,latest?.meal??meal),sourceStatus=select(`${prefix}-source-status`,STATUSES,latest?.status??'eaten');
  controls.append(field('コピー元の日付',sourceDate),field('コピー元の食事',sourceMeal),field('コピー元の種類',sourceStatus));
  const sourceSummary=make('div','meal-sets-summary'),name=make('input');name.id=`${prefix}-name`;name.type='text';name.maxLength=200;name.placeholder='例：いつもの朝食';
  const note=make('input');note.id=`${prefix}-note`;note.type='text';note.maxLength=2000;note.placeholder='任意';
  let sourceEntries=[];
  const copy=button('この食事をコピーして登録',act(()=>addItems(sourceEntries.flatMap(entry=>entry.items))),'button-primary meal-sets-copy');
  const save=button('定番セットに保存',act(()=>{if(sets.length>=MAX_MEAL_SETS)throw Error(`定番セットは${MAX_MEAL_SETS}件まで保存できます。`);onSave(createMealSet({name:name.value.trim(),note:note.value.trim(),entries:sourceEntries},data));}),'button-secondary meal-sets-save');
  const sourceActions=make('div','meal-sets-actions');sourceActions.append(copy,save);
  history.append(controls,sourceSummary,field('定番セットの名前',name),field('セットのメモ（任意）',note),make('p','field-note','セットにはコピー元の量を保存します。「量の倍率」は登録するときだけ掛けます。'),sourceActions);root.append(history,error);
  function updateSource(){
    sourceEntries=state.entries.filter(entry=>entry.date===sourceDate.value&&entry.meal===sourceMeal.value&&entry.status===sourceStatus.value&&entry.items.length);
    const items=sourceEntries.flatMap(entry=>entry.items),blocked=items.some(item=>item.batchId!==undefined)||!items.length||items.length>100;
    copy.disabled=blocked;save.disabled=blocked||sets.length>=MAX_MEAL_SETS;showSummary(sourceSummary,items);
    if(items.length>100)sourceSummary.append(make('p','meal-sets-warning','一度にコピー・保存できる料理は100品までです。'));
  }
  for(const input of [sourceDate,sourceMeal,sourceStatus])input.addEventListener('change',updateSource);updateSource();
  return root;
}
