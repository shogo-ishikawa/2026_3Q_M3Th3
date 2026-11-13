/** 同じ食事内の重複を知らせる確認用の判定。記録を削除・修正しません。 */
const MEALS=new Set(['breakfast','lunch','dinner','snack']);
const STATUSES=new Set(['planned','eaten']);
const ROLES=new Set(['staple','main','side','soup','drink','snack']);
const RICE=new Set(['rice','brown_rice','cooked_barley','uncooked_rice']);
const SIMPLE_RICE_ADDITIONS=new Set(['water','salt']);
const NUTRIENTS=['kcal','protein','fat','carbs','fiber','salt'];
const MAX_WARNINGS=20;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const normalise=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja-JP');
const rounded=value=>Number(value.toPrecision(12));

function validDate(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
}
function checkEntry(entry){
  if(!record(entry)||typeof entry.id!=='string'||!entry.id||!validDate(entry.date)||!MEALS.has(entry.meal)||!STATUSES.has(entry.status)||!Array.isArray(entry.items)||entry.items.length>100)throw Error('重複を確認する食事の日付・区分・内容を確認してください。');
}
function checkItem(item){
  if(!record(item)||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name.trim()||!positive(item.quantity)||!ROLES.has(item.role)||!Array.isArray(item.ingredients)||item.ingredients.length>300)throw Error('重複を確認する料理と数量を確認してください。');
  const ids=new Set();
  for(const part of item.ingredients){if(!record(part)||typeof part.id!=='string'||!positive(part.amount)||ids.has(part.id))throw Error('重複を確認する材料の分量を確認してください。');ids.add(part.id);}
  if(!record(item.nutrition)||NUTRIENTS.some(key=>item.nutrition[key]!==null&&(typeof item.nutrition[key]!=='number'||!Number.isFinite(item.nutrition[key])||item.nutrition[key]<0)))throw Error('重複を確認する料理の栄養を確認してください。');
  if(item.portion!==undefined&&(!record(item.portion)||!positive(item.portion.amount)||typeof item.portion.unit!=='string'||!item.portion.unit))throw Error('重複を確認する料理の基準量を確認してください。');
}

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return typeof value==='number'?rounded(value):value;
}

/** 名前だけが同じ未入力メニューを「同じ料理」と断定しません。 */
function dishKey(item){
  const knownValue=NUTRIENTS.some(key=>item.nutrition[key]!==null);
  if(!item.recipeId&&!item.ingredients.length&&!knownValue)return null;
  const value={name:normalise(item.name),role:item.role,portion:item.portion?{amount:item.portion.amount,unit:item.portion.unit}:{amount:1,unit:'人分'},
    nutrition:Object.fromEntries(NUTRIENTS.map(key=>[key,item.nutrition[key]])),
    ingredients:item.ingredients.map(part=>({id:part.id,amount:part.amount})).sort((a,b)=>a.id.localeCompare(b.id)),
    restaurant:item.restaurant??null};
  // 全く材料・栄養が不明なときだけ、登録元の識別子も必要です。
  if(!item.ingredients.length&&!knownValue)value.recipeId=item.recipeId;
  return JSON.stringify(canonical(value));
}

function riceKind(item,data,recipes){
  if(item.restaurant?.riceIncluded===true)return 'included';
  const riceParts=item.ingredients.filter(part=>RICE.has(part.id));
  if(!riceParts.length)return null;
  const recipe=typeof item.recipeId==='string'?recipes.get(item.recipeId):null;
  // 市販品の全原材料が未確認でも、登録元にご飯が明示されており、
  // 記録時点の材料にも同じご飯が残る場合だけ、その存在を使います。
  const supportedByRecipe=recipe&&Array.isArray(recipe.ingredients)&&riceParts.some(part=>recipe.ingredients.some(source=>source.id===part.id&&positive(source.amount)));
  if(item.ingredientsKnown!==true&&!supportedByRecipe)return null;
  const other=item.ingredients.filter(part=>!RICE.has(part.id));
  if(!other.length||other.every(part=>SIMPLE_RICE_ADDITIONS.has(part.id)))return 'single';
  const mainFood=other.some(part=>{
    const food=data.ingredients[part.id];
    return food&&(food.groups??[]).some(group=>['protein','vegetable','fruit'].includes(group))||food&&(food.proteinSources??[]).length>0;
  });
  return mainFood?'included':null;
}

/**
 * 同じ日付・食事区分・予定/実績だけを比較します。quantityは摂取量なので、
 * 同じ料理を別の量でもう一度登録する場合には確認を出します。
 * 呼び出し元は確認後に、追加のご飯やおかわりとしてそのまま登録できます。
 */
export function mealOverlapWarnings(incomingEntry,existingEntries,data,{excludeEntryId=null,focusItemIds=null}={}){
  checkEntry(incomingEntry);
  if(!Array.isArray(existingEntries)||!record(data?.ingredients)||!Array.isArray(data?.recipes)||excludeEntryId!==null&&typeof excludeEntryId!=='string')throw Error('重複を確認する食事とメニューのデータを確認してください。');
  if(focusItemIds!==null&&(!Array.isArray(focusItemIds)||focusItemIds.length>100||Object.keys(focusItemIds).length!==focusItemIds.length||focusItemIds.some(id=>typeof id!=='string'||!id||id.length>120)))throw Error('新しく追加する料理の識別子を確認してください。');
  const focus=focusItemIds===null?null:new Set(focusItemIds);
  const recipes=new Map(data.recipes.map(recipe=>[recipe.id,recipe]));
  const incoming=incomingEntry.items.map(item=>{checkItem(item);return {item,entryId:incomingEntry.id,incoming:true};});
  const prior=[];
  for(const entry of existingEntries){
    if(!record(entry))throw Error('重複を確認する食事の形式を確認してください。');
    if(entry.id===excludeEntryId||entry.id===incomingEntry.id||entry.date!==incomingEntry.date||entry.meal!==incomingEntry.meal||entry.status!==incomingEntry.status)continue;
    checkEntry(entry);
    for(const item of entry.items){checkItem(item);prior.push({item,entryId:entry.id,incoming:false});}
  }
  const warnings=[],seen=new Set();
  const decorate=part=>({...part,key:dishKey(part.item),rice:riceKind(part.item,data,recipes)});
  const earlier=prior.map(decorate);
  function compare(a,b){
    // 更新後の食事全体を渡す場合も、以前からある料理同士の確認で
    // 新しい料理の警告が重複排除・件数上限の陰に隠れないよう先に絞ります。
    if(focus!==null&&!((a.incoming&&focus.has(a.item.id))||(b.incoming&&focus.has(b.item.id))))return;
    let code,message,actionLabel;
    if(a.key!==null&&a.key===b.key){
      code='duplicate-dish';actionLabel='追加分として登録';
      message=`「${a.item.name}」が同じ食事に複数含まれます。おかわりなどの追加分として記録するか確認してください。`;
    }else if(a.rice==='single'&&b.rice==='included'||a.rice==='included'&&b.rice==='single'){
      const bundle=a.rice==='included'?a:b,rice=a.rice==='single'?a:b;
      code='rice-included';actionLabel='追加のご飯として登録';
      message=`「${bundle.item.name}」にはご飯が含まれています。「${rice.item.name}」を追加のご飯として記録するか確認してください。`;
    }else return;
    const pair=[a.key??a.item.id,b.key??b.item.id].sort(),key=JSON.stringify([code,...pair]);
    if(seen.has(key))return;seen.add(key);
    warnings.push({code,message,actionLabel,itemIds:[a.item.id,b.item.id],entryIds:[a.entryId,b.entryId],names:[a.item.name,b.item.name]});
  }
  for(const raw of incoming){
    const part=decorate(raw);
    for(const other of earlier){compare(part,other);if(warnings.length>=MAX_WARNINGS)return warnings;}
    earlier.push(part);
  }
  return warnings;
}
