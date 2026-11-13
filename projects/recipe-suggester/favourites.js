/** 単品のお気に入りと最近の食事。料理・栄養は保存時点の値を保ちます。 */
import {dateIsValid, dateKey, MEAL_IDS, validateFrozenItems} from './journal.js';

export const MAX_FAVOURITES=200;
const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const own=(value,key)=>Object.hasOwn(value??{},key);
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function safe(value,active=new Set(),depth=0,budget={nodes:0}){
  if(++budget.nodes>150000||depth>16)throw Error('お気に入りのデータが大きすぎます。');
  if(value===null||['string','number','boolean','undefined'].includes(typeof value))return;
  if(typeof value!=='object'||active.has(value))throw Error('お気に入りの形式を確認してください。');
  const prototype=Object.getPrototypeOf(value);
  if(Array.isArray(value)?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('お気に入りの形式を確認してください。');
  if(Array.isArray(value)&&(value.length>10000||Object.keys(value).length!==value.length))throw Error('お気に入りの件数を確認してください。');
  active.add(value);
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!own(descriptor,'value')||(key!=='length'&&!descriptor.enumerable))throw Error('お気に入りに使用できない項目があります。');
    if(Array.isArray(value)&&key!=='length'&&!/^(0|[1-9]\d*)$/.test(key))throw Error('お気に入りの配列を確認してください。');
    safe(descriptor.value,active,depth+1,budget);
  }
  active.delete(value);
}
const canonical=value=>Array.isArray(value)?value.map(canonical):isRecord(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const checkedText=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw Error(`${label}は1文字以上200文字以内で入力してください。`);return value.trim();};

/** 量・識別子・根拠の分類を除いて比較し、配合や栄養値の異なる料理を区別します。 */
export function favouriteKey(item){
  safe(item);
  if(!isRecord(item)||typeof item.name!=='string'||!isRecord(item.nutrition)||!Array.isArray(item.ingredients))throw Error('お気に入りにする料理を確認してください。');
  const content=Object.fromEntries(Object.entries(item).filter(([key])=>!['id','recipeId','quantity','nutritionBasis'].includes(key)));
  content.ingredients=[...content.ingredients].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  for(const key of ['allergens','groups','proteinSources'])if(Array.isArray(content[key]))content[key]=[...content[key]].sort();
  return JSON.stringify(canonical(content));
}

/** 未指定の旧保存データは空へ移行します。明示nullや重複内容は受け付けません。 */
export function validateFavourites(raw,data){
  if(raw===undefined)return [];
  safe(raw);
  if(!Array.isArray(raw)||raw.length>MAX_FAVOURITES)throw Error(`お気に入りは${MAX_FAVOURITES}件以下にしてください。`);
  const ids=new Set(),keys=new Set();
  return raw.map(source=>{
    if(!isRecord(source)||Object.keys(source).some(key=>!['id','name','item'].includes(key))||typeof source.id!=='string'||!/^favourite-[a-zA-Z0-9_-]+$/.test(source.id)||source.id.length>120||ids.has(source.id))throw Error('お気に入りの識別子と内容を確認してください。');
    ids.add(source.id);
    if(source.item?.batchId!==undefined)throw Error('作り置きは残量画面から記録してください。');
    const item=validateFrozenItems([source.item],data)[0],key=favouriteKey(item);
    if(keys.has(key))throw Error('同じ内容のお気に入りが重複しています。');keys.add(key);
    return {id:source.id,name:checkedText(source.name,'お気に入りの名前'),item};
  });
}

export function createFavourite(item,data,options={}){
  safe(item);safe(options);
  if(!isRecord(options)||Object.keys(options).some(key=>key!=='name'))throw Error('お気に入りの名前を確認してください。');
  const name=own(options,'name')?options.name:item?.name;
  return validateFavourites([{id:uid('favourite'),name,item:{...item,id:uid('favourite-item')}}],data)[0];
}

/** 実食済みの単品を新しい日付・登録順から取り出し、最後に食べた量を初期値にします。 */
export function recentFoods(entries,{date=dateKey(),limit=12}={}){
  safe(entries);
  if(!Array.isArray(entries)||!dateIsValid(date)||!Number.isInteger(limit)||limit<1||limit>30)throw Error('最近の料理の対象日と件数を確認してください。');
  const ordered=[];
  entries.forEach((entry,index)=>{
    if(!isRecord(entry)||!dateIsValid(entry.date)||!MEAL_IDS.includes(entry.meal)||!['planned','eaten'].includes(entry.status)||!Array.isArray(entry.items))throw Error('最近の食事の記録を確認してください。');
    if(entry.status==='eaten'&&entry.date<=date)ordered.push({entry,index});
  });
  ordered.sort((a,b)=>b.entry.date.localeCompare(a.entry.date)||b.index-a.index);
  const result=[],seen=new Set();
  for(const {entry}of ordered)for(let index=entry.items.length-1;index>=0;index--){
    const item=entry.items[index];
    if(item?.batchId!==undefined)continue;
    const key=favouriteKey(item);
    if(seen.has(key))continue;seen.add(key);
    result.push({key,item:structuredClone(item),date:entry.date,meal:entry.meal});
    if(result.length===limit)return result;
  }
  return result;
}
