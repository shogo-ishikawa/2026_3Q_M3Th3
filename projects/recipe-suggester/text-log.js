/** 文章からDBの候補を作る入力補助。量や料理の確定は利用者が行います。 */
import {normaliseJapaneseSearch,matchesJapaneseQuery,japaneseQueryRank} from './japanese-search.js';
import {recipePortion} from './catalog.js';
import {createCatalogEntry} from './record-actions.js';
import {readQuantityInput} from './quantity-input.js';
import {foodComposerFor} from './food-composer.js';
import {variationSearchAliases} from './menu-variations.js';
import {itemFromRecipe} from './nutrition.js';
import {validateFrozenItems} from './journal.js';

export const TEXT_LOG_MAX_ROWS=30;
export const TEXT_LOG_CANDIDATE_LIMIT=24;
const makeId=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const units=['ミリリットル','どんぶり','グラム','大さじ','小さじ','パック','人分','人前','ml','cc','g','皿','本','個','貫','枚','杯','袋','食','切れ'];
const unitPattern=units.join('|');
const numeric='[+-]?(?:0[xX][0-9a-fA-F]+|(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|Infinity|NaN)';
const suffix=new RegExp(`^(.*?)\\s*(${numeric})\\s*(${unitPattern})$`,'i');
const spoonPrefix=new RegExp(`^(.*?)\\s*(小さじ|大さじ)\\s*(${numeric})$`,'i');
const canonicalUnit=unit=>({'グラム':'g','ミリリットル':'ml','cc':'ml','人前':'人分'}[unit]??unit.toLowerCase());
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
function record(value,keys,label){
  if(!plain(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))throw Error(`${label}の内容を確認してください。`);
}
function quantity(value){return readQuantityInput({value:String(value),min:'0.001',max:'100000'},{label:'食べた量'});}
const confirmedSelections=new WeakMap();
const composerAnchors={sashimi:'classic-sashimi-assorted',sushi:'classic-sushi-assorted',tempura:'familiar-tempura-assorted',oden:'palette-oden','pot-au-feu':'familiar-side-pot-au-feu'};
function searchTerms(recipe){
  const composer=foodComposerFor(recipe.id);
  return [recipe.name,recipe.variantLabel,...(recipe.searchAliases??[]),...variationSearchAliases(recipe),...(composer?[composer.label,composer.description]:[])];
}
function composerPriority(recipe,query,data){
  const composer=foodComposerFor(recipe.id);if(!composer)return 0;
  const aliases=[composer.label,...variationSearchAliases(recipe)];
  if(!aliases.some(label=>normaliseJapaneseSearch(label)===normaliseJapaneseSearch(query)))return 0;
  const anchor=composerAnchors[composer.kind]??composer.recipeIds.find(id=>data.recipes.some(recipe=>recipe.id===id));
  return recipe.id===anchor?-1:0;
}

/** 料理名と読みの一致を優先し、候補が多くても黙って料理を決めません。 */
export function textFoodCandidates(query,data,{limit=TEXT_LOG_CANDIDATE_LIMIT}={}){
  if(typeof query!=='string'||query.length>200||!Array.isArray(data?.recipes)||!Number.isInteger(limit)||limit<1||limit>100)throw Error('検索する料理名を確認してください。');
  const trimmed=query.trim();if(!trimmed)return [];
  return data.recipes.map((recipe,index)=>({recipe,index})).filter(({recipe})=>matchesJapaneseQuery(searchTerms(recipe),trimmed))
    .sort((a,b)=>composerPriority(a.recipe,trimmed,data)-composerPriority(b.recipe,trimmed,data)||japaneseQueryRank([a.recipe.name,a.recipe.variantLabel??''],trimmed)-japaneseQueryRank([b.recipe.name,b.recipe.variantLabel??''],trimmed)||a.index-b.index)
    .slice(0,limit).map(({recipe})=>({id:recipe.id,name:recipe.name,portion:recipePortion(recipe,data)}));
}

/** 詳細画面で確定した1皿の配合を、この入力中だけ保持します。JSONや任意の数値からは作れません。 */
export function createTextMealSelection(recipeId,recipe,data){
  if(typeof recipeId!=='string'||!data?.recipes?.some(source=>source.id===recipeId))throw Error('具材を指定する料理を選んでください。');
  if(!plain(recipe)||recipe.custom!==true||recipe.servings!==1)throw Error('指定した具材は1人分の料理として確認してください。');
  const portion=recipePortion(recipe,data);
  const [item]=validateFrozenItems([{...itemFromRecipe(recipe,data),portion}],data);
  const token=Object.freeze({recipeId,name:item.name,portion:Object.freeze({...portion})});
  confirmedSelections.set(token,{recipeId,item:structuredClone(item)});
  return token;
}

/** DBの基準量か、単品食材の登録済み重量だけを使います。調理前重量を完成重量にしません。 */
export function textAmountForRecipe(recipe,rawAmount,rawUnit,data){
  const portion=recipePortion(recipe,data);
  if(rawAmount===null||rawAmount===undefined)return {amount:portion.amount,unit:portion.unit,note:'量の指定がないため、DBの基準量を表示しています。'};
  const value=quantity(rawAmount),unit=canonicalUnit(rawUnit??'');
  if(unit===portion.unit)return {amount:value,unit:portion.unit,note:''};
  if(unit==='人分')return {amount:quantity(value*portion.amount),unit:portion.unit,note:`DBの1人分＝${portion.amount}${portion.unit}として換算しました。`};
  if(!unit)return {amount:null,unit:portion.unit,note:`入力に単位がありません。${portion.unit}で量を入力してください。`};
  const volume=unit==='大さじ'?value*15:unit==='小さじ'?value*5:unit==='ml'?value:null;
  if(portion.unit==='ml'&&volume!==null)return {amount:quantity(volume),unit:'ml',note:unit==='ml'?'':`${unit}1杯＝${unit==='大さじ'?15:5}mlで換算しました。`};
  const parts=recipe.ingredients??[],part=parts.length===1?parts[0]:null,food=part?data.ingredients?.[part.id]:null;
  const nativeAmount=part&&positive(recipe.servings)?part.amount/recipe.servings:null;
  const grams=food?(food.unit==='g'?1:food.gramsPerUnit):null;
  if(food&&positive(nativeAmount)&&positive(grams)){
    const servingGrams=nativeAmount*grams;
    if(unit==='g')return {amount:quantity(value/servingGrams*portion.amount),unit:portion.unit,note:`単品食品の登録重量${servingGrams}g＝${portion.amount}${portion.unit}で換算しました。`};
    if(unit===food.unit)return {amount:quantity(value/nativeAmount*portion.amount),unit:portion.unit,note:`登録済みの${food.unit}数から換算しました。`};
    if(volume!==null&&food.unit==='ml')return {amount:quantity(volume/nativeAmount*portion.amount),unit:portion.unit,note:'単品飲料の登録容量から換算しました。'};
  }
  // 商品固有の包装重量が明示されている場合だけ、パック→gを許可します。
  const pack=portion.unit==='g'&&unit==='パック'?portion.label?.match(/^1パック.*?標準(\d+(?:\.\d+)?)g$/):null;
  if(pack)return {amount:quantity(value*Number(pack[1])),unit:'g',note:`商品に登録された1パック${pack[1]}gで換算しました。`};
  return {amount:null,unit:portion.unit,note:`「${rawUnit}」から「${portion.unit}」への換算は未登録です。${portion.label}を確認し、${portion.unit}で量を入力してください。`};
}

/** 区切られた全項目を残します。曖昧・未登録・不正な量も行を消しません。 */
export function parseTextMeal(source,data){
  if(typeof source!=='string'||!source.trim()||source.length>2000)throw Error('食べたものを2000文字以内で入力してください。');
  const segments=source.normalize('NFKC').split(/[、,;；\n\r。]+/u).map(part=>part.trim()).filter(Boolean);
  if(!segments.length||segments.length>TEXT_LOG_MAX_ROWS)throw Error(`一度に入力できる料理は${TEXT_LOG_MAX_ROWS}品までです。`);
  return segments.map((source,index)=>{
    let name=source,rawAmount=null,rawUnit='',error='';
    const after=source.match(suffix),before=source.match(spoonPrefix);
    if(after){[,name,rawAmount,rawUnit]=after;}
    else if(before){name=before[1];rawAmount=before[3];rawUnit=before[2];}
    name=name.trim();
    if(rawAmount!==null){try{quantity(rawAmount);if(!name||/[.+-]$/.test(name))throw Error('料理名と数量を確認してください。');}catch(cause){error=cause.message;}}
    const candidates=name?textFoodCandidates(name,data):[],same=candidates.filter(candidate=>normaliseJapaneseSearch(candidate.name)===normaliseJapaneseSearch(name));
    const chosen=!error&&same.length===1?same[0]:null,recipe=chosen?data.recipes.find(recipe=>recipe.id===chosen.id):null;
    let converted={amount:null,unit:chosen?.portion.unit??'',note:''};
    if(recipe)try{converted=textAmountForRecipe(recipe,rawAmount,rawUnit,data);}catch(cause){error=cause.message;}
    return {id:`text-row-${index+1}`,source,name,rawAmount,rawUnit,candidates,recipeId:chosen?.id??'',amount:converted.amount,unit:converted.unit,
      note:error||converted.note||(!candidates.length?'一致する料理がありません。料理名を直して検索するか、この行を削除してください。':!chosen?'料理の種類を選んでください。':''),error};
  });
}

/** 全行を検証してから1つの記録へまとめます。ここでは保存しません。 */
export function buildTextMeal(input,data){
  record(input,['rows','date','meal','status','note'],'まとめて記録する食事');
  if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>TEXT_LOG_MAX_ROWS||Object.keys(input.rows).length!==input.rows.length)throw Error('登録する料理は1品以上30品以下にしてください。');
  const selected=input.rows.map(row=>{record(row,['recipeId','amount','selection'],'料理と量');if(typeof row.recipeId!=='string'||!row.recipeId)throw Error('すべての行で料理を選んでください。');if(typeof row.amount!=='number')throw Error('すべての行で量を入力してください。');return {recipeId:row.recipeId,amount:quantity(row.amount),selection:row.selection};});
  const entries=selected.map(row=>{
    const context={recipeId:row.recipeId,date:input.date,meal:input.meal,status:input.status,note:input.note??''};
    if(row.selection===undefined)return createCatalogEntry({...context,amount:row.amount},data);
    const selected=confirmedSelections.get(row.selection);
    if(!selected||selected.recipeId!==row.recipeId)throw Error('具材の指定を開き直して、この行の内容を確認してください。');
    const original=data.recipes.find(recipe=>recipe.id===row.recipeId);
    // 日付・区分・元のメニューを共通処理で検証し、配合は確定時の内訳を使います。
    const entry=createCatalogEntry({...context,amount:recipePortion(original,data).amount},data);
    const [item]=validateFrozenItems([selected.item],data),multiplier=row.amount/item.portion.amount;
    if(!Number.isFinite(multiplier)||multiplier<=0||multiplier>1000)throw Error('記録する量は基準量の1000倍以下にしてください。');
    entry.items=[{...item,id:makeId('text-item'),quantity:multiplier}];return entry;
  });
  return {id:makeId('text-entry'),date:entries[0].date,meal:entries[0].meal,status:entries[0].status,note:entries[0].note,items:entries.flatMap(entry=>entry.items)};
}
