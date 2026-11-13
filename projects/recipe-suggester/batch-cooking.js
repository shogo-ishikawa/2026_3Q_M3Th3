/** 完成重量で取り分ける作り置き。材料と栄養は調理時の値を凍結します。 */
import {NUTRIENT_KEYS, itemFromRecipe} from './nutrition.js';

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value??{},key);
const newId=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const positive=(value,max)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
const mealIds=new Set(['breakfast','lunch','dinner','snack']);
const itemKeys=new Set(['id','recipeId','name','quantity','nutrition','ingredients','groups','proteinSources','allergens','allergensKnown','ingredientsKnown','steps','role','portion','nature','sourceNote','shoppingKnown','restaurant']);
const batchKeys=new Set(['id','name','preparedDate','totalGrams','sourceQuantity','item','archived']);
const round=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const clone=value=>JSON.parse(JSON.stringify(value));
const equalNumber=(actual,expected)=>typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-9);
const equalData=(left,right)=>{
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  const leftKeys=Object.keys(left).sort(),rightKeys=Object.keys(right).sort();
  return leftKeys.length===rightKeys.length&&leftKeys.every((key,index)=>key===rightKeys[index]&&equalData(left[key],right[key]));
};

function record(value,keys,message){
  if(!isRecord(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.has(key)||!own(Object.getOwnPropertyDescriptor(value,key),'value')))throw Error(message);
}
function validDate(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
}
function validId(value){return typeof value==='string'&&/^batch-[a-zA-Z0-9_-]+$/.test(value)&&value.length<=120;}
function text(value,max){return typeof value==='string'&&value.trim().length>0&&value.length<=max;}

/** sourceQuantityは元レシピの「1人分」を何人分作ったか。totalGramsは容器を除いた完成重量です。 */
export function createBatch(input,data){
  record(input,new Set(['id','recipe','sourceQuantity','totalGrams','preparedDate','name']),'作り置きの登録内容を確認してください。');
  const {recipe,sourceQuantity,totalGrams,preparedDate}=input;
  if(!isRecord(recipe)||!positive(sourceQuantity,1000)||!positive(totalGrams,100000))throw Error('作った人数分は0より大きく1000以下、完成重量は0より大きく100000g以下で入力してください。');
  if(!validDate(preparedDate))throw Error('調理日を2000年から2100年までの日付で指定してください。');
  const id=input.id??newId('batch'),name=(input.name??recipe.name)?.trim();
  if(!validId(id)||!text(name,200))throw Error('作り置きの名前と識別子を確認してください。');
  const source=itemFromRecipe(recipe,data),item={...source,quantity:1,
    nutrition:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,source.nutrition[key]===null?null:source.nutrition[key]*sourceQuantity])),
    ingredients:source.ingredients.map(part=>({id:part.id,amount:part.amount*sourceQuantity})),
    portion:{amount:totalGrams,unit:'g',label:'作り置き全体の完成重量'}};
  item.name=name;
  item.sourceNote=`${source.sourceNote??''} 元レシピの${round(sourceQuantity)}人分を調理し、容器を除いた完成重量${round(totalGrams)}gで取り分けます。材料と栄養は調理時の値です。水分の蒸発は重量へ反映し、栄養成分の損失や残した油・煮汁は自動補正しません。`.slice(0,2000);
  return {id,name,preparedDate,totalGrams,sourceQuantity,item,archived:false};
}

/** journalのsnapshot検証をcallbackで共用し、保存データの参照循環を避けます。 */
export function validateBatches(raw,data,{validateItem}={}){
  if(!Array.isArray(raw)||raw.length>200||Object.keys(raw).length!==raw.length)throw Error('作り置きは200件以下で登録してください。');
  if(typeof validateItem!=='function')throw Error('作り置きの材料と栄養を検証する処理が必要です。');
  const ids=new Set();
  return raw.map(source=>{
    record(source,batchKeys,'作り置きに、このアプリで扱えない項目があります。');
    if(!validId(source.id)||ids.has(source.id))throw Error('作り置きの識別子が不正か重複しています。');
    ids.add(source.id);
    if(!text(source.name,200)||!validDate(source.preparedDate)||!positive(source.totalGrams,100000)||!positive(source.sourceQuantity,1000)||typeof source.archived!=='boolean')throw Error('作り置きの名前・調理日・完成重量・人数分・保存状態を確認してください。');
    record(source.item,itemKeys,'作り置き全体の材料と栄養を確認してください。');
    const item=validateItem(source.item,data);
    if(!isRecord(item)||item.quantity!==1||item.portion?.unit!=='g'||item.portion.amount!==source.totalGrams||item.name!==source.name||own(item,'batchId'))throw Error('作り置き全体の名前・完成重量と栄養の基準量が一致しません。');
    return {id:source.id,name:source.name,preparedDate:source.preparedDate,totalGrams:source.totalGrams,sourceQuantity:source.sourceQuantity,item,archived:source.archived};
  });
}

/** 予定は取り分け予約として残量から引き、実績は食べた量として別表示します。 */
export function batchBalance(batch,entries,{excludeEntryId=null}={}){
  if(!isRecord(batch)||!validId(batch.id)||!positive(batch.totalGrams,100000)||!Array.isArray(entries))throw Error('作り置きと食事の記録を確認してください。');
  let eatenGrams=0,plannedGrams=0;
  for(const entry of entries){
    if(entry.id===excludeEntryId)continue;
    if(!Array.isArray(entry.items))throw Error('取り分けの記録を確認してください。');
    for(const item of entry.items){
      if(item.batchId!==batch.id)continue;
      if(!['planned','eaten'].includes(entry.status)||!validDate(entry.date)||entry.date<batch.preparedDate||item.portion?.unit!=='g'||item.portion.amount!==100||!positive(item.quantity,1000))throw Error('作り置きは調理日以降に100gを基準として記録してください。');
      if(entry.status==='eaten')eatenGrams+=item.quantity*100;
      else plannedGrams+=item.quantity*100;
    }
  }
  const reservedGrams=eatenGrams+plannedGrams;
  if(reservedGrams>batch.totalGrams+Math.max(1e-6,batch.totalGrams*1e-9))throw Error(`「${batch.name}」の取り分け量が完成重量を超えています。量や重複した予定を確認してください。`);
  return {eatenGrams,plannedGrams,reservedGrams,remainingGrams:Math.max(0,batch.totalGrams-reservedGrams)};
}

/** 全参照を検証。削除・編集で量が戻り、予定→実績への変更でも二重に消費しません。 */
export function assertBatchUsage(batches,entries){
  if(!Array.isArray(batches)||!Array.isArray(entries))throw Error('作り置きと食事の記録を確認してください。');
  const byId=new Map(batches.map(batch=>[batch.id,batch]));
  for(const entry of entries)for(const item of entry.items??[]){
    if(!own(item,'batchId'))continue;
    if(!validId(item.batchId)||!byId.has(item.batchId))throw Error('取り分け元の作り置きが見つかりません。記録がある作り置きは削除せず終了してください。');
    const batch=byId.get(item.batchId),source=batch.item,factor=100/batch.totalGrams;
    for(const key of NUTRIENT_KEYS){
      const expected=source.nutrition[key]===null?null:source.nutrition[key]*factor;
      if(expected===null?item.nutrition?.[key]!==null:!equalNumber(item.nutrition?.[key],expected))throw Error('作り置きの取り分けの栄養が、調理時に保存した100g当たりの値と一致しません。');
    }
    const expectedParts=new Map(source.ingredients.map(part=>[part.id,part.amount*factor]));
    if(!Array.isArray(item.ingredients)||item.ingredients.length!==expectedParts.size||item.ingredients.some(part=>!expectedParts.has(part.id)||!equalNumber(part.amount,expectedParts.get(part.id))))throw Error('作り置きの取り分けの材料が、調理時に保存した100g当たりの量と一致しません。');
    for(const key of ['recipeId','name','role','allergensKnown','ingredientsKnown','nature','shoppingKnown','steps','restaurant'])if(!equalData(item[key],source[key]))throw Error('作り置きの取り分けの情報が、調理時の保存内容と一致しません。');
    for(const key of ['allergens','groups','proteinSources'])if(!equalData([...(item[key]??[])].sort(),[...(source[key]??[])].sort()))throw Error('作り置きの取り分けの食材・アレルギー情報が、調理時の保存内容と一致しません。');
  }
  for(const batch of batches)batchBalance(batch,entries);
  return true;
}

/** g数を100g単位の凍結スナップショットへ変換。買い物ではbatchId付きの材料を再集計しません。 */
export function takeBatch(input,batches,entries){
  record(input,new Set(['batchId','grams','date','meal','status','note']),'取り分ける食事の内容を確認してください。');
  const {batchId,grams,date,meal,status,note=''}=input;
  const batch=batches.find(candidate=>candidate.id===batchId);
  if(!batch||batch.archived)throw Error('取り分ける作り置きを選んでください。終了した作り置きは追加できません。');
  if(!positive(grams,100000)||!validDate(date)||date<batch.preparedDate||!mealIds.has(meal)||!['planned','eaten'].includes(status)||typeof note!=='string'||note.length>2000)throw Error('取り分けるg数・日付・食事区分・状態・メモを確認してください。');
  const remaining=batchBalance(batch,entries).remainingGrams;
  if(grams>remaining+Math.max(1e-6,batch.totalGrams*1e-9))throw Error(`取り分け可能な量は${round(remaining)}gです。予定に入れた分も残量から除いています。`);
  const item=clone(batch.item),factor=100/batch.totalGrams;
  item.id=newId('batch-item');item.batchId=batch.id;item.quantity=grams/100;
  item.portion={amount:100,unit:'g',label:'完成した作り置き100g'};
  item.nutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,item.nutrition[key]===null?null:item.nutrition[key]*factor]));
  item.ingredients=item.ingredients.map(part=>({id:part.id,amount:part.amount*factor}));
  item.sourceNote=`作り置き「${batch.name}」から完成重量で取り分けます。調理日は${batch.preparedDate}、全体${round(batch.totalGrams)}g。調理済みのため、この取り分け分は買い物リストへ加えません。 ${batch.item.sourceNote??''}`.slice(0,2000);
  return {id:newId('batch-entry'),date,meal,status,note,items:[item]};
}
