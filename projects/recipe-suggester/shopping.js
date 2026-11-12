/** Aggregate the selected plans once before subtracting household stock. */
import {dateIsValid} from './journal.js';

export function shoppingForEntries(entries,data,{from,to,servings=2,pantry=[]}={}) {
  if(!Array.isArray(entries)||!Array.isArray(pantry)||!Number.isInteger(servings)||servings<1||servings>8)throw Error('買い物の人数と入力を確認してください。');
  if(!dateIsValid(from)||!dateIsValid(to)||from>to)throw Error('買い物の対象期間を確認してください。');
  const selected=entries.filter(e=>e.status==='planned'&&e.date>=from&&e.date<=to),items=new Map(),missingMenus=[];
  const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  for(const entry of selected){
    if(!Array.isArray(entry.items))throw Error('予定のメニューの形式を確認してください。');
    // メモだけの予定を「材料なし＝買い物不要」と解釈しません。
    if(!entry.items.length){missingMenus.push({name:entry.note?.trim().slice(0,200)||'メニュー未入力の予定',entryId:entry.id});continue;}
    for(const item of entry.items){
    if(!amount(item.quantity)||item.quantity===0)throw Error('予定の分量を確認してください。');
    if(!item.ingredientsKnown||!Array.isArray(item.ingredients)||!item.ingredients.length){missingMenus.push({name:item.name,entryId:entry.id});continue;}
    let missing=false;
    for(const part of item.ingredients){
      if(!amount(part.amount)||part.amount===0)throw Error('買い物に集計できない材料があります。');
      // 過去のスナップショットはDBから削除された材料も保持します。
      // 分かる材料は集計し、不明な部分を買い物不要と扱わずに知らせます。
      if(!Object.hasOwn(data.ingredients,part.id)){missing=true;continue;}
      const info=data.ingredients[part.id];
      if(!items.has(part.id))items.set(part.id,{id:part.id,name:info.name,unit:info.unit,required:0,stock:0,buy:0});
      items.get(part.id).required+=part.amount*item.quantity*servings;
    }
    if(missing)missingMenus.push({name:item.name,entryId:entry.id});
    }
  }
  const stock=new Map();
  for(const p of pantry){if(!Object.hasOwn(data.ingredients,p.id)||!amount(p.amount)||stock.has(p.id))throw Error('手持ち食材の量を確認してください。');stock.set(p.id,p.amount);}
  for(const item of items.values()){item.stock=stock.get(item.id)??0;item.buy=Math.max(0,item.required-item.stock);}
  return {items:[...items.values()].sort((a,b)=>a.name.localeCompare(b.name,'ja')),missingMenus,entryCount:selected.length};
}
