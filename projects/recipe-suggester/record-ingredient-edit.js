/** 食べた量で材料を入力し、保存時に料理の基準量へ戻します。 */
import {NUTRIENT_KEYS, itemFromRecipe, recipeNutrition, recipeConfirmation} from './nutrition.js';
import {validateFrozenItems} from './journal.js';

const tags = ['allergens', 'groups', 'proteinSources'];
const sumParts = parts => {
  const total = new Map();
  for (const {id, amount} of parts) total.set(id, (total.get(id) ?? 0) + amount);
  return Array.from(total, ([id, amount]) => ({id, amount}));
};
const near = (a,b) => Math.abs(a-b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
const sameParts = (a,b) => a.length === b.length && a.every(p=>b.some(q=>q.id===p.id && near(p.amount,q.amount)));
const scaled = (parts,factor) => parts.map(({id,amount})=>({id,amount:amount*factor}));
const zero = () => Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,0]));

function baseSnapshot(item) {
  const fields = ['ingredients','nutrition',...tags,'ingredientsKnown','allergensKnown','shoppingKnown','nutritionBasis'];
  const base = Object.fromEntries(fields.filter(k=>item[k]!==undefined).map(k=>[k,structuredClone(item[k])]));
  if (item.diningMatch) base.diningMode=item.diningMatch.mode;
  return base;
}

function components(item,data) {
  if (item.batchId) throw Error('作り置きの材料は調理時の記録を使います。');
  const edit=item.ingredientEdit;
  // 廃止された追加食材を含む履歴は、当時の合計を保ったまま新しい材料を足せます。
  if (!edit || edit.additions.some(part=>!Object.hasOwn(data.ingredients,part.id))) {
    return {base:baseSnapshot(item),baseChanged:Boolean(edit),additions:[]};
  }
  return edit;
}

function baseEditable(base,item,data) {
  const reference=item.diningMatch?.referenceBasis;
  // 外食用の複写は未確認になります。参考にした料理そのものの材料も確かめます。
  const referenceRecipe=!base.ingredientsKnown && reference==='ingredients' && !item.restaurant
    ? data.recipes?.find(recipe=>recipe.id===item.recipeId) : null;
  const knownReference=Boolean(referenceRecipe && recipeConfirmation(referenceRecipe).ingredientsKnown);
  const calculatedFromIngredients=base.nutritionBasis==='ingredients' ||
    ((base.nutritionBasis===undefined || base.nutritionBasis==='unknown') && base.ingredientsKnown) ||
    knownReference;
  if (!calculatedFromIngredients || (!base.ingredientsKnown && !knownReference) || !base.ingredients.length ||
      base.ingredients.some(part=>!Object.hasOwn(data.ingredients,part.id))) return false;
  const sum=recipeNutrition({servings:1,ingredients:base.ingredients},data);
  return NUTRIENT_KEYS.every(k=>sum[k]===null || base.nutrition[k]===null ? sum[k]===base.nutrition[k] :
    Math.abs(sum[k]-base.nutrition[k])<=Math.max(1e-8,Math.abs(base.nutrition[k])*1e-8));
}

/** 編集欄の値はすべて、今回食べる量に含まれる材料のネイティブ単位です。 */
export function recordIngredientDraft(item,data) {
  const {base,additions}=components(item,data);
  const editableBase=baseEditable(base,item,data);
  const reason=editableBase ? '' : '元の料理の材料と栄養の対応が未確認です。元の値を保ち、追加した食材の量を調整できます。';
  return {editableBase,ingredients:scaled(base.ingredients,item.quantity),additions:scaled(additions,item.quantity),reason};
}

function normaliseParts(rows,quantity,allowed,limit) {
  if (!Array.isArray(rows) || rows.length>limit) throw Error('材料の件数を確認してください。');
  const seen=new Set(), parts=[];
  for (const part of rows) {
    if (!part || typeof part.id!=='string' || !allowed(part.id) || seen.has(part.id) ||
        !Number.isFinite(part.amount) || part.amount<0 || part.amount/quantity>1e7) throw Error('材料と分量を確認してください。');
    seen.add(part.id);
    if (part.amount>0) parts.push({id:part.id, amount:part.amount/quantity});
  }
  return parts;
}

function materialSnapshot(parts,data) {
  const item=itemFromRecipe({name:'材料',role:'side',servings:1,ingredients:parts},data);
  if (!parts.length) item.nutrition=zero();
  return item;
}

function replaceBaseParts(base,parts,data) {
  const next={...base,ingredients:parts};
  const before=materialSnapshot(base.ingredients,data), after=materialSnapshot(parts,data);
  next.nutrition=after.nutrition;
  // 原材料で説明できないアレルゲンや食品群は元の記録から引き継ぎます。
  for (const key of tags) {
    const keep=base[key].filter(value=> !before[key].includes(value) || (key==='allergens' && !base.allergensKnown));
    next[key]=[...new Set([...keep,...after[key]])];
  }
  return next;
}

/** 未確認のベースは凍結した栄養値を使い、食材から計算できる料理だけ元材料を変更します。 */
export function editRecordIngredients(item,changes,data) {
  const [source]=validateFrozenItems([item],data);
  const previous=components(source,data);
  const base=previous.base;
  const parts=normaliseParts(changes?.ingredients,source.quantity,id=>base.ingredients.some(part=>part.id===id),300);
  const additions=normaliseParts(changes?.additions,source.quantity,id=>Object.hasOwn(data.ingredients,id),100);
  const changed=!sameParts(parts,base.ingredients);
  if (!changed && sameParts(additions,previous.additions)) return source;
  if (changed && !baseEditable(base,source,data)) throw Error('元の料理は栄養が材料と対応していないため、追加した食材だけを変更できます。');
  if ((changed || previous.baseChanged) && !parts.length && !additions.length) throw Error('材料を1つ以上残してください。');
  const working=changed?replaceBaseParts(base,parts,data):base;
  const adjusted=changed || previous.baseChanged;
  const extra=materialSnapshot(additions,data);
  const out={...source,ingredients:sumParts([...working.ingredients,...additions])};
  out.nutrition=Object.fromEntries(NUTRIENT_KEYS.map(k=>{
    const initial=working.nutrition[k], plus=extra.nutrition[k];
    return [k,initial===null || plus===null ? null : initial+plus];
  }));
  for (const key of tags) out[key]=[...new Set([...working[key],...extra[key]])];
  const metas=[...parts,...additions].map(part=>data.ingredients[part.id]).filter(Boolean);
  out.ingredientsKnown=working.ingredientsKnown && metas.every(meta=>meta.ingredientsKnown!==false);
  out.allergensKnown=working.allergensKnown && metas.every(meta=>meta.allergensKnown!==false);
  if (working.shoppingKnown!==undefined) out.shoppingKnown=working.shoppingKnown && metas.every(meta=>meta.shoppingKnown!==false);
  const modified=adjusted || additions.length>0;
  if (modified) {
    out.ingredientEdit={base:working,baseChanged:adjusted,additions};
    const basis=working.nutritionBasis;
    const hasValue=NUTRIENT_KEYS.some(k=>out.nutrition[k]!==null);
    if (source.diningMatch) {
      out.nutritionBasis=hasValue?'estimate':'unknown';
      out.diningMatch={...source.diningMatch,mode:'similar'};
      out.shoppingKnown=false;out.ingredientsKnown=false;out.allergensKnown=false;
    } else if (!hasValue) out.nutritionBasis='unknown';
    else if (basis==='official' || basis==='mixed' || source.productLabel) out.nutritionBasis='mixed';
    else if (basis==='ingredients' || changed) out.nutritionBasis='ingredients';
    else out.nutritionBasis='estimate';
  } else {
    delete out.ingredientEdit;
    if (working.nutritionBasis===undefined) delete out.nutritionBasis;
    else out.nutritionBasis=working.nutritionBasis;
    if (out.diningMatch) {
      const sameStore=!out.restaurant || !out.diningMatch.storeName || out.restaurant.storeName===out.diningMatch.storeName;
      out.diningMatch={...out.diningMatch,mode:sameStore?(working.diningMode??out.diningMatch.mode):'similar'};
      out.shoppingKnown=false;
      if (out.diningMatch.mode==='similar') {
        out.nutritionBasis=NUTRIENT_KEYS.some(k=>out.nutrition[k]!==null)?'estimate':'unknown';
        out.ingredientsKnown=false;out.allergensKnown=false;
      }
    }
  }
  return validateFrozenItems([out],data)[0];
}
