/** 定番の食事は、保存時点の料理・量・栄養を保持します。DBの更新で書き換えません。 */
import {validateFrozenItems, dateIsValid, MEAL_IDS} from './journal.js';

export const MAX_MEAL_SETS=100;
const MAX_ITEMS=100;
const STATUSES=['planned','eaten'];
const own=(value,key)=>Object.hasOwn(value??{},key);
const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

// 保存入口と同じく、アクセサー・特殊なprototype・循環・疎な配列を受け付けません。
function safe(value,active=new Set(),depth=0,budget={nodes:0}){
  if(++budget.nodes>150000||depth>16)throw Error('定番セットの構造が大きすぎます。');
  if(value===null||['string','number','boolean','undefined'].includes(typeof value))return;
  if(typeof value!=='object'||active.has(value))throw Error('定番セットの形式を確認してください。');
  const prototype=Object.getPrototypeOf(value);
  if(Array.isArray(value)?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('定番セットの形式を確認してください。');
  if(Array.isArray(value)&&(value.length>10000||Object.keys(value).length!==value.length))throw Error('定番セットの件数を確認してください。');
  active.add(value);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw Error('定番セットに使用できない項目があります。');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!own(descriptor,'value')||(key!=='length'&&!descriptor.enumerable))throw Error('定番セットの形式を確認してください。');
    if(Array.isArray(value)&&key!=='length'&&!/^(0|[1-9]\d*)$/.test(key))throw Error('定番セットの配列を確認してください。');
    safe(descriptor.value,active,depth+1,budget);
  }
  active.delete(value);
}
function record(value,keys,label){if(!isRecord(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error(`${label}の内容を確認してください。`);}
function text(value,max,label,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(`${label}を確認してください。`);return value;}
function identifier(value){text(value,120,'定番セットの識別子');if(['__proto__','constructor','prototype'].includes(value))throw Error('定番セットの識別子を確認してください。');return value;}
function checkedItems(items,data){
  if(!Array.isArray(items)||!items.length||items.length>MAX_ITEMS)throw Error('登録する料理は1品以上100品以下にしてください。');
  if(items.some(item=>item?.batchId!==undefined))throw Error('作り置きは残量画面から記録してください。');
  return validateFrozenItems(items,data,{historical:true});
}

/** journalの保存・読込でも使う厳格な検証。未指定は旧版からの空セットに移行します。 */
export function validateMealSets(raw,data){
  if(raw===undefined)return [];
  safe(raw);
  if(!Array.isArray(raw)||raw.length>MAX_MEAL_SETS)throw Error(`定番セットは${MAX_MEAL_SETS}件以下にしてください。`);
  if(!raw.length)return [];
  const seen=new Set(),headers=raw.map(set=>{
    record(set,['id','name','note','items'],'定番セット');
    const id=identifier(set.id);
    if(seen.has(id))throw Error('定番セットの識別子が重複しています。');seen.add(id);
    if(!Array.isArray(set.items)||!set.items.length||set.items.length>MAX_ITEMS)throw Error('定番セットには1品以上100品以下を登録してください。');
    return {id,name:text(set.name,200,'定番セットの名前'),note:text(set.note??'',2000,'定番セットのメモ',true),items:set.items};
  });
  return headers.map(set=>({...set,items:checkedItems(set.items,data)}));
}

/** 同じ食事枠に登録した複数記録を1セットにまとめます。元の記録は変更しません。 */
export function createMealSet(input,data){
  safe(input);record(input,['name','note','entries'],'定番セット');
  if(!Array.isArray(input.entries)||!input.entries.length||input.entries.length>100)throw Error('保存する食事の記録を選んでください。');
  const items=input.entries.flatMap(entry=>{
    record(entry,['id','date','meal','status','note','items'],'保存元の記録');
    if(!dateIsValid(entry.date)||!MEAL_IDS.includes(entry.meal)||!STATUSES.includes(entry.status)||!Array.isArray(entry.items))throw Error('保存元の食事の記録を確認してください。');
    return entry.items;
  });
  if(!items.length||items.length>MAX_ITEMS)throw Error('定番セットには1品以上100品以下を登録してください。');
  return validateMealSets([{id:uid('meal-set'),name:input.name,note:input.note??'',items:items.map(item=>({...item,id:uid('set-item')}))}],data)[0];
}

/** コピーは新しいentry/item IDを発行し、倍率だけを掛けます。材料・栄養の基準値は固定です。 */
export function createRepeatedMeal(input,data){
  safe(input);record(input,['items','date','meal','status','note','scale'],'繰り返し登録する食事');
  if(!dateIsValid(input.date)||!MEAL_IDS.includes(input.meal)||!STATUSES.includes(input.status))throw Error('登録先の日付・食事区分・記録の種類を選んでください。');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>MAX_ITEMS)throw Error('コピーする料理は1品以上100品以下にしてください。');
  const scale=input.scale??1;
  if(typeof scale!=='number'||!Number.isFinite(scale)||scale<=0||scale>1000)throw Error('量の倍率は0より大きく1000以下にしてください。');
  const items=checkedItems(input.items,data);
  return {id:uid('entry'),date:input.date,meal:input.meal,status:input.status,note:text(input.note??'',2000,'食事のメモ',true),items:checkedItems(items.map(item=>({...item,id:uid('item'),quantity:item.quantity*scale})),data)};
}

/** 手動で食べた事実も記録できるよう、除外情報は遮断せず明示します。自動献立へは渡しません。 */
export function mealSetWarnings(set,settings,data){
  const warnings=[],allergens=new Set(settings?.allergens??[]),excluded=new Set(settings?.excludedIngredients??[]);
  const foundAllergens=new Set(),foundExcluded=new Set();let unconfirmed=false,missing=false;
  const visit=(id,trail=new Set())=>{
    if(excluded.has(id))foundExcluded.add(id);
    if(trail.has(id))return;
    const ingredient=data.ingredients?.[id];if(!ingredient){missing=true;return;}
    for(const allergen of ingredient.allergens??[])if(allergens.has(allergen))foundAllergens.add(allergen);
    for(const parent of ingredient.derivedFrom??[])visit(parent,new Set([...trail,id]));
  };
  for(const item of set.items??[]){
    if(item.allergensKnown!==true||item.ingredientsKnown!==true)unconfirmed=true;
    for(const allergen of item.allergens??[])if(allergens.has(allergen))foundAllergens.add(allergen);
    for(const part of item.ingredients??[])visit(part.id);
  }
  if(foundAllergens.size)warnings.push(`避けるアレルゲンを含みます：${[...foundAllergens].map(id=>data.allergens?.find(item=>item.id===id)?.label??id).join('、')}`);
  if(foundExcluded.size)warnings.push(`除外中の食材を含みます：${[...foundExcluded].map(id=>data.ingredients?.[id]?.name??id).join('、')}`);
  if(unconfirmed)warnings.push('原材料・アレルギー情報に未確認の部分があります。');
  if(missing)warnings.push('現在の食材DBにない過去の材料を含みます。買い物量を確認してください。');
  return warnings;
}
