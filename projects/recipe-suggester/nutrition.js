/** Estimates for a single person's recorded portions. Unknown values stay unknown. */
export const NUTRIENT_KEYS = ['kcal','protein','fat','carbs','fiber','salt'];
export const NUTRIENT_LABELS = {kcal:'エネルギー',protein:'たんぱく質',fat:'脂質',carbs:'炭水化物',fiber:'食物繊維',salt:'食塩相当量'};
export const NUTRIENT_UNITS = {kcal:'kcal',protein:'g',fat:'g',carbs:'g',fiber:'g',salt:'g'};
const empty = () => Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null]));
const validAmount = value => typeof value==='number' && Number.isFinite(value) && value>=0;
function checkNutrition(value) {
  const out=empty();
  if(value==null)return out;
  if(typeof value!=='object'||Array.isArray(value))throw Error('栄養量の形式を確認してください。');
  for(const key of NUTRIENT_KEYS){const n=value[key];if(n!=null&&!validAmount(n))throw Error(`${NUTRIENT_LABELS[key]}は0以上の数値で入力してください。`);out[key]=n??null;}
  return out;
}

function ingredientMetadata(parts, data) {
  const found=new Map(), active=new Set();
  function visit(id) {
    if(typeof id!=='string'||!data?.ingredients||!Object.hasOwn(data.ingredients,id))throw Error('材料の確認情報が見つかりません。');
    if(active.has(id))throw Error('材料の派生元が循環しています。');
    if(found.has(id))return;
    const ingredient=data.ingredients[id];
    if(!ingredient||typeof ingredient!=='object'||Array.isArray(ingredient))throw Error('材料の確認情報を確認してください。');
    const parents=ingredient.derivedFrom??[];
    if(!Array.isArray(parents)||parents.some(parent=>typeof parent!=='string'||!parent))throw Error('材料の派生元を確認してください。');
    for(const key of ['allergens','groups','proteinSources'])if(ingredient[key]!==undefined&&(!Array.isArray(ingredient[key])||ingredient[key].some(value=>typeof value!=='string')))throw Error('材料の確認情報を確認してください。');
    active.add(id);
    for(const parent of parents)visit(parent);
    active.delete(id);
    found.set(id,ingredient);
  }
  for(const part of parts)visit(part.id);
  return [...found.values()];
}

export function recipeNutrition(recipe,data) {
  if(!recipe||!validAmount(recipe.servings)||recipe.servings===0)throw Error('レシピの人数を確認してください。');
  if(recipe.manualNutrition!==undefined)return checkNutrition(recipe.manualNutrition);
  if(!Array.isArray(recipe.ingredients)||!recipe.ingredients.length)return empty();
  const values=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]));
  for(const part of recipe.ingredients){
    if(!validAmount(part.amount)||part.amount===0)throw Error('材料の分量を確認してください。');
    if(!data?.ingredients||!Object.hasOwn(data.ingredients,part.id))throw Error('材料の確認情報が見つかりません。');
    const perUnit=checkNutrition(data.ingredients[part.id].nutritionPerUnit);
    for(const key of NUTRIENT_KEYS)values[key]=values[key]===null||perUnit[key]===null?null:values[key]+perUnit[key]*part.amount/recipe.servings;
  }
  return values;
}
export function itemFromRecipe(recipe,data,quantity=1) {
  if(!validAmount(quantity)||quantity===0)throw Error('食べる量は0より大きい数値で入力してください。');
  const ingredients=Array.isArray(recipe.ingredients)?recipe.ingredients:[];
  const metas=ingredientMetadata(ingredients,data);
  // 原料の参照はアレルゲン確認に使います。しょうゆの原料が大豆でも、
  // しょうゆだけを「大豆のたんぱく源を食べた1食」とは数えません。
  const directMetas=ingredients.map(part=>data.ingredients[part.id]);
  const unique=values=>[...new Set(values)];
  return {id:globalThis.crypto?.randomUUID?.()??`item-${Date.now()}-${Math.random().toString(36).slice(2)}`,recipeId:recipe.id??null,name:recipe.name,quantity,
    nutrition:recipeNutrition(recipe,data),ingredients:ingredients.map(p=>({id:p.id,amount:p.amount/recipe.servings})),
    groups:unique([...(recipe.groups??[]),...directMetas.flatMap(p=>p?.groups??[])]),proteinSources:unique([...(recipe.proteinSources??[]),...directMetas.flatMap(p=>p?.proteinSources??[])]),
    allergens:unique([...(recipe.allergens??[]),...metas.flatMap(p=>p?.allergens??[])]),allergensKnown:recipe.custom?recipe.allergensKnown===true:true,
    ingredientsKnown:recipe.custom?recipe.ingredientsKnown===true:ingredients.length>0,steps:[...(recipe.steps??[])],role:recipe.role};
}
export function itemNutrition(item) {
  if(!validAmount(item?.quantity)||item.quantity===0)throw Error('食事の分量を確認してください。');
  const values=checkNutrition(item.nutrition);
  return Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,values[key]===null?null:values[key]*item.quantity]));
}
export function sumNutrition(items) {
  if(!Array.isArray(items))throw Error('食事の一覧を確認してください。');
  const values=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0])),complete=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,true]));
  let unknownItems=0;
  for(const item of items){const part=itemNutrition(item);if(Object.values(part).some(v=>v===null))unknownItems++;for(const key of NUTRIENT_KEYS){if(part[key]===null)complete[key]=false;else values[key]+=part[key];}}
  return {values,complete,unknownItems};
}
function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
export function summariseEntries(entries,{from,to,status='eaten'}={}) {
  if(!Array.isArray(entries)||!validDate(from)||!validDate(to)||from>to||!['eaten','planned'].includes(status))throw Error('栄養を集計する期間を確認してください。');
  const selected=entries.filter(e=>e.status===status&&e.date>=from&&e.date<=to);
  // メモだけの食事も内容が不明な記録です。空の材料・栄養を0品として数えません。
  const summary=sumNutrition(selected.flatMap(entry=>entry.items.length ? entry.items : [{quantity:1,nutrition:empty()}]));
  return {...summary,entryCount:selected.length,recordedDays:new Set(selected.map(e=>e.date)).size,recordedMeals:new Set(selected.map(e=>`${e.date}:${e.meal}`)).size};
}
