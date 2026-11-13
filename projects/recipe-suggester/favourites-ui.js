/** 単品を量つきで呼び出す画面。保存・重複確認・カレンダー更新は呼出元が担当します。 */
import {createFavourite,favouriteKey,recentFoods,MAX_FAVOURITES} from './favourites.js';
import {createRepeatedMeal,mealSetWarnings} from './meal-sets.js';
import {dateIsValid} from './journal.js';
import {itemNutrition} from './nutrition.js';
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {matchesJapaneseQuery} from './japanese-search.js';

let count=0;
const MEALS=[['breakfast','朝食'],['lunch','昼食'],['dinner','夕食'],['snack','間食']];
const STATUSES=[['eaten','食べた'],['planned','これからの予定']];
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const field=(name,input)=>{const label=make('label','favourites-field',name);label.htmlFor=input.id;label.append(input);if(input.type==='number')configureQuantityInput(input);return label;};
const select=(id,values,current)=>{const control=make('select');control.id=id;for(const [value,label]of values){const option=make('option','',label);option.value=value;control.append(option);}control.value=current;return control;};
const button=(label,fn,className='button-secondary')=>{const control=make('button',className,label);control.type='button';control.addEventListener('click',fn);return control;};

export function mountFavourites({favourites=[],entries=[],data,date,meal='dinner',status='eaten',settings={},onAdd=()=>{},onSave=()=>{},onDelete=()=>{},onError=()=>{}}={}){
  if(!Array.isArray(favourites)||!Array.isArray(entries)||!dateIsValid(date)||[onAdd,onSave,onDelete,onError].some(fn=>typeof fn!=='function'))throw Error('お気に入りと記録先を確認してください。');
  const prefix=`favourites-${++count}`,root=make('section','favourites');root.setAttribute('aria-label','お気に入りと最近使った料理');
  root.append(make('h3','','お気に入り・最近使った料理'),make('p','field-note','単品を前回の量で呼び出せます。量を変更して追加でき、栄養と材料は保存した内容を使います。'));
  const error=make('p','favourites-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const act=fn=>()=>{try{fn();error.hidden=true;error.textContent='';}catch(cause){error.textContent=cause.message;error.hidden=false;onError(cause.message);}};
  const controls=make('div','favourites-destination'),targetDate=make('input');targetDate.id=`${prefix}-date`;targetDate.type='date';targetDate.min='2000-01-01';targetDate.max='2100-12-31';targetDate.value=date;
  const targetMeal=select(`${prefix}-meal`,MEALS,meal),targetStatus=select(`${prefix}-status`,STATUSES,status);
  controls.append(field('記録する日付',targetDate),field('食事区分',targetMeal),field('記録の種類',targetStatus));root.append(controls);
  const search=make('input','favourites-search');search.id=`${prefix}-search`;search.type='search';search.placeholder='お気に入り・最近の料理を検索';root.append(field('料理を絞り込む',search));
  const saved=make('div','favourites-saved'),recent=make('div','favourites-recent'),favouriteKeys=new Set(favourites.map(favourite=>favouriteKey(favourite.item)));
  root.append(saved,recent,error);
  function card(item,{favourite=null,date:sourceDate=null,meal:sourceMeal=null,index=0}={}){
    const article=make('article','favourites-card'),name=make('h5','favourites-name',favourite?.name??item.name),quantity=make('input','favourites-amount');
    const portion=item.portion??{amount:1,unit:'人分'};
    quantity.id=`${prefix}-${favourite?'saved':'recent'}-${index}-amount`;quantity.type='number';quantity.min='0.001';quantity.max='1000000';quantity.step='any';quantity.required=true;quantity.value=String(Number((item.quantity*portion.amount).toFixed(9)));quantity.setAttribute('aria-label',`${item.name}の量（${portion.unit}）`);
    article.append(name);
    if(favourite&&favourite.name!==item.name)article.append(make('p','favourites-meta',item.name));
    if(sourceDate)article.append(make('p','favourites-meta',`${sourceDate} ${MEALS.find(([id])=>id===sourceMeal)?.[1]??''}の記録`));
    article.append(field(`量（${portion.unit}）`,quantity));
    const summary=make('p','favourites-energy');article.append(summary);
    const read=()=>({...item,quantity:readQuantityInput(quantity,{label:`${item.name}の量`})/portion.amount});
    const describe=()=>{try{const n=itemNutrition(read());summary.textContent=n.kcal===null?'エネルギー未入力':`${rounded(n.kcal)} kcal`;}catch{summary.textContent='量を確認してください。';}};
    quantity.addEventListener('input',describe);describe();
    for(const warning of mealSetWarnings({items:[item]},settings,data))article.append(make('p','favourites-warning',warning));
    const actions=make('div','favourites-actions');
    actions.append(button('この量で記録',act(()=>{
      const entry=createRepeatedMeal({items:[read()],date:targetDate.value,meal:targetMeal.value,status:targetStatus.value,note:''},data);onAdd(entry);
    }),'button-primary favourites-add'));
    if(favourite)actions.append(button('お気に入りから外す',act(()=>onDelete(favourite.id)),'button-text favourites-remove'));
    else{
      const exists=favouriteKeys.has(favouriteKey(item));
      const save=button(exists?'お気に入り登録済み':'お気に入りに追加',act(()=>{if(favourites.length>=MAX_FAVOURITES)throw Error(`お気に入りは${MAX_FAVOURITES}件まで保存できます。`);onSave(createFavourite(read(),data));}),'button-secondary favourites-save');save.disabled=exists||favourites.length>=MAX_FAVOURITES;actions.append(save);
    }
    article.append(actions);return article;
  }
  const recents=recentFoods(entries,{date,limit:12});
  function render(){
    const query=search.value??'',selected=favourites.filter(favourite=>matchesJapaneseQuery([favourite.name,favourite.item.name],query));
    saved.replaceChildren(make('h4','','お気に入り'));
    if(!selected.length)saved.append(make('p','field-note',favourites.length?'一致するお気に入りがありません。':'料理の詳細や最近使った料理から、お気に入りに追加できます。'));
    else{const grid=make('div','favourites-grid');selected.forEach((favourite,index)=>grid.append(card(favourite.item,{favourite,index})));saved.append(grid);}
    const matching=recents.filter(({item})=>matchesJapaneseQuery([item.name],query));recent.replaceChildren(make('h4','','最近使った料理'));
    if(!matching.length)recent.append(make('p','field-note','この日以前の実食記録に一致する料理がありません。作り置きは残量画面から記録してください。'));
    else{const grid=make('div','favourites-grid');matching.forEach((source,index)=>grid.append(card(source.item,{date:source.date,meal:source.meal,index})));recent.append(grid);}
  }
  search.addEventListener('input',render);render();return root;
}
