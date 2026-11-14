/** 日々の記録に使う短い画面。保存と画面全体の更新は呼出元が担当します。 */
import {dateIsValid,dateKey,shiftDate,MEAL_IDS} from './journal.js';
import {recentFoods,favouriteKey} from './favourites.js';
import {createRepeatedMeal,mealSetWarnings} from './meal-sets.js';
import {itemNutrition} from './nutrition.js';
import {configureQuantityInput,readQuantityInput,setQuantityPresets} from './quantity-input.js';
import {matchesJapaneseQuery,japaneseQueryRank} from './japanese-search.js';
import {groupMenuRecipes,variationSearchAliases} from './menu-variations.js';
import {createRecordSummary} from './record-summary-ui.js';

const MEALS=[['breakfast','朝食'],['lunch','昼食'],['dinner','夕食'],['snack','間食']];
const STATUSES=[['eaten','食べた'],['planned','これからの予定']];
let serial=0;
const make=(tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
const button=(text,action,className='button-secondary')=>{const node=make('button',className,text);node.type='button';node.addEventListener('click',action);return node;};
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const field=(text,control)=>{const label=make('label','quick-record-field',text);label.htmlFor=control.id;label.append(control);if(control.type==='number')configureQuantityInput(control);return label;};

/** 既存の読み・別名と種類のまとめ方を使い、具材指定画面への入口を返します。 */
export function quickRecipeChoices(data,query,{limit=6}={}){
  if(!Array.isArray(data?.recipes)||typeof query!=='string'||query.length>200||!Number.isInteger(limit)||limit<1||limit>100)throw Error('検索する料理名を確認してください。');
  if(!query.trim())return [];
  const candidates=data.recipes.filter(recipe=>matchesJapaneseQuery([
    recipe.name,...variationSearchAliases(recipe),
    ...(recipe.ingredients??[]).map(part=>data.ingredients?.[part.id]?.name).filter(Boolean),
  ],query));
  candidates.sort((a,b)=>japaneseQueryRank([a.name],query)-japaneseQueryRank([b.name],query));
  return groupMenuRecipes(candidates,{query}).slice(0,limit).map(group=>({
    recipeId:group.selectedRecipeId,label:group.label,
    selectedName:group.recipe.name,variantCount:group.variantCount,
  }));
}

export function mountQuickRecord({data,settings={},entries=[],favourites=[],date,meal='dinner',status='eaten',onContextChange=()=>{},onOpenRecipe=()=>{},onAddEntry=()=>{},onOpenItem=()=>{},onError=()=>{}}={}){
  if(!dateIsValid(date)||!MEAL_IDS.includes(meal)||!STATUSES.some(([id])=>id===status)||!Array.isArray(entries)||!Array.isArray(favourites)||!Array.isArray(data?.recipes)||[onContextChange,onOpenRecipe,onAddEntry,onOpenItem,onError].some(fn=>typeof fn!=='function'))throw Error('かんたん記録の料理と記録先を確認してください。');
  const prefix=`quick-record-${++serial}`,root=make('section','quick-record panel');root.setAttribute('aria-label','かんたん記録');
  root.append(make('h3','quick-record-heading','食べたものを手早く記録'),make('p','field-note','日付と食事を選び、いつもの料理を前回の量で追加できます。料理を検索して具材や量を調整することもできます。'));
  const error=make('p','quick-record-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const act=fn=>()=>{try{fn();error.hidden=true;error.textContent='';}catch(cause){error.hidden=false;error.textContent=cause.message;onError(cause.message);}};
  const targetDate=make('input','quick-record-date');targetDate.id=`${prefix}-date`;targetDate.type='date';targetDate.min='2000-01-01';targetDate.max='2100-12-31';targetDate.value=date;
  const dateTools=make('div','quick-record-date-tools'),shortDates=make('div','quick-record-short-dates');
  shortDates.append(button('今日',act(()=>{targetDate.value=dateKey();changeContext();}),'button-secondary quick-record-today'),button('昨日',act(()=>{targetDate.value=shiftDate(dateKey(),-1);changeContext();}),'button-secondary quick-record-yesterday'));
  dateTools.append(shortDates,field('記録する日付',targetDate));root.append(dateTools);
  const mealButtons=make('div','quick-record-meals');mealButtons.setAttribute('role','group');mealButtons.setAttribute('aria-label','記録する食事');
  for(const [id,label]of MEALS){const node=button(label,act(()=>{meal=id;changeContext();}),'button-secondary quick-record-meal');node.dataset.meal=id;mealButtons.append(node);}
  root.append(mealButtons);
  const targetStatus=make('select','quick-record-status');targetStatus.id=`${prefix}-status`;
  for(const [id,label]of STATUSES){const option=make('option','',label);option.value=id;targetStatus.append(option);}targetStatus.value=status;root.append(field('記録の種類',targetStatus));
  const targetNote=make('p','quick-record-destination');targetNote.setAttribute('role','status');root.append(targetNote);
  const saved=make('div','quick-record-saved'),recent=make('div','quick-record-recent');root.append(saved,recent);
  const searchSection=make('section','quick-record-search-section');searchSection.append(make('h4','','料理を探して追加'));
  const search=make('input','quick-record-search');search.id=`${prefix}-search`;search.type='search';search.maxLength=200;search.placeholder='例：トースト、ご飯、みそ汁';
  const choices=make('div','quick-record-choices');choices.setAttribute('aria-live','polite');searchSection.append(field('料理名・材料で検索',search),choices);root.append(searchSection);
  const recorded=make('section','quick-record-recorded');root.append(recorded,error);
  let savedLimit=3,recentLimit=3,searchLimit=6;
  const draftAmounts=new Map();
  function context(){
    if(!dateIsValid(targetDate.value))throw Error('記録する日付を確認してください。');
    if(!MEAL_IDS.includes(meal)||!STATUSES.some(([id])=>id===targetStatus.value))throw Error('食事と記録の種類を選んでください。');
    return {date:targetDate.value,meal,status:targetStatus.value};
  }
  function changeContext(){
    const selected=context();savedLimit=3;recentLimit=3;renderContext();renderFoods();renderRecords();onContextChange(selected);
  }
  function renderContext(){
    const selected=context();
    for(const node of mealButtons.children)node.setAttribute('aria-pressed',String(node.dataset.meal===selected.meal));
    targetNote.textContent=`${selected.date}の${MEALS.find(([id])=>id===selected.meal)[1]}に「${STATUSES.find(([id])=>id===selected.status)[1]}」として記録します。`;
  }
  function foodCard(item,{name=item.name,index,source='saved'}={}){
    const card=make('article','quick-record-food'),quantity=make('input','quick-record-amount'),portion=item.portion??{amount:1,unit:'人分'};
    const draftKey=`${source}:${favouriteKey(item)}`;
    const title=button(name,act(()=>onOpenItem(structuredClone(read()))),'button-text quick-record-food-name');card.append(title);
    quantity.id=`${prefix}-${source}-${index}-amount`;quantity.type='number';quantity.min='0.001';quantity.max='1000000';quantity.step='any';quantity.required=true;
    quantity.value=draftAmounts.get(draftKey)??String(Number((item.quantity*portion.amount).toFixed(9)));quantity.setAttribute('aria-label',`${name}の量（${portion.unit}）`);card.append(field(`量（${portion.unit}）`,quantity));
    if(item.recipeId==='plain-rice'&&portion.unit==='g')setQuantityPresets(quantity,[100,150,200].map(value=>({label:`${value}g`,value})));
    else if(['皿','人分'].includes(portion.unit))setQuantityPresets(quantity,[{label:'半分',value:.5},{label:`1${portion.unit}`,value:1},{label:`2${portion.unit}`,value:2}]);
    const preview=make('p','quick-record-energy');card.append(preview);
    const read=()=>({...item,quantity:readQuantityInput(quantity,{label:`${name}の量`})/portion.amount});
    const summary=createRecordSummary({getEntry:()=>({...context(),items:[read()]}),data});
    const disclosure=make('details','quick-record-summary');disclosure.open=false;
    disclosure.append(make('summary','','登録する内容を確認'),summary.element);
    const refresh=()=>{
      try{const value=itemNutrition(read()).kcal;preview.textContent=value===null?'エネルギー未入力':`この量で ${rounded(value)} kcal`;}catch{preview.textContent='量を確認してください。';}
      summary.refresh();
    };
    const remember=()=>{draftAmounts.set(draftKey,quantity.value);refresh();};
    quantity.addEventListener('input',remember);quantity.addEventListener('change',remember);refresh();
    for(const warning of mealSetWarnings({items:[item]},settings,data))card.append(make('p','quick-record-warning',warning));
    card.append(disclosure);
    card.append(button('この量で記録',act(()=>{
      const entry=createRepeatedMeal({items:[read()],...context(),note:''},data);onAddEntry(entry);
    }),'button-primary quick-record-add'));
    return card;
  }
  function renderFoods(){
    saved.replaceChildren(make('h4','','お気に入り'));
    const available=favourites.filter(favourite=>favourite.item?.batchId===undefined);
    if(!available.length)saved.append(make('p','field-note','料理の詳細でお気に入りに保存すると、ここから呼び出せます。'));
    else{
      const cards=make('div','quick-record-food-grid');available.slice(0,savedLimit).forEach((favourite,index)=>cards.append(foodCard(favourite.item,{name:favourite.name,index})));saved.append(cards);
      if(available.length>savedLimit)saved.append(button('ほかのお気に入りを見る',act(()=>{savedLimit+=3;renderFoods();}),'button-text quick-record-more-saved'));
    }
    recent.replaceChildren(make('h4','','最近使った料理'));
    const savedKeys=new Set(available.map(favourite=>favouriteKey(favourite.item)));
    const recents=recentFoods(entries,{date:context().date,limit:30}).filter(({item})=>!savedKeys.has(favouriteKey(item)));
    if(!recents.length)recent.append(make('p','field-note','この日以前の食事を記録すると、前回の量で呼び出せます。お気に入りと同じ料理は上にまとめています。'));
    else{
      const cards=make('div','quick-record-food-grid');recents.slice(0,recentLimit).forEach(({item},index)=>cards.append(foodCard(item,{index,source:'recent'})));recent.append(cards);
      if(recents.length>recentLimit)recent.append(button('ほかの最近の料理を見る',act(()=>{recentLimit+=3;renderFoods();}),'button-text quick-record-more-recent'));
    }
  }
  function renderSearch(){
    choices.replaceChildren();
    if(!search.value.trim()){choices.append(make('p','field-note','料理名や材料を入力すると候補を表示します。'));return;}
    const matches=quickRecipeChoices(data,search.value,{limit:searchLimit});
    if(!matches.length){choices.append(make('p','field-note','候補が見つかりませんでした。別の表記や短い料理名で試してください。未登録の料理は詳しい記録から入力できます。'));return;}
    for(const choice of matches){
      const node=button(choice.label,act(()=>onOpenRecipe(choice.recipeId,context())),'button-secondary quick-record-choice');
      node.append(make('small','',choice.variantCount>1?`${choice.variantCount}種類・具材や量を確認`:'材料や量を確認'));choices.append(node);
    }
    if(matches.length===searchLimit&&searchLimit<96)choices.append(button('候補をもっと見る',act(()=>{searchLimit+=6;renderSearch();}),'button-text quick-record-more-choices'));
  }
  function renderRecords(){
    const selected=context(),items=entries.filter(entry=>entry.date===selected.date&&entry.meal===selected.meal&&entry.status===selected.status).flatMap(entry=>entry.items);
    recorded.replaceChildren(make('h4','',`この食事の記録（${items.length}品）`));
    if(!items.length){recorded.append(make('p','field-note','まだ記録がありません。上の料理から追加してください。'));return;}
    const list=make('ul','quick-record-entry-list');
    for(const item of items){const row=make('li'),portion=item.portion??{amount:1,unit:'人分'};row.append(button(item.name,act(()=>onOpenItem(structuredClone(item))),'button-text quick-record-item-name'),make('span','quick-record-item-amount',`${rounded(item.quantity*portion.amount)} ${portion.unit}`));list.append(row);}recorded.append(list);
  }
  targetDate.addEventListener('change',act(changeContext));targetStatus.addEventListener('change',act(changeContext));
  search.addEventListener('input',act(()=>{searchLimit=6;renderSearch();}));
  renderContext();renderFoods();renderSearch();renderRecords();return root;
}
