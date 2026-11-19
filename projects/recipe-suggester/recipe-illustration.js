/** 個別の標準レシピに対応する完成イメージだけを返します。分類画像は流用しません。 */
import {RECIPES} from './data.js';
import {RECIPE_ARTWORK} from './recipe-artwork-manifest.js?v=4.3.0';
import {foodComposerDefinition,defaultFoodSelection,buildFoodSelection} from './food-composer.js';
import {itemFromRecipe} from './nutrition.js';
import {recipePortion} from './catalog.js';

const canonicalRecipes=new Map(RECIPES.map(recipe=>[recipe.id,recipe]));
const own=(value,key)=>Object.hasOwn(value??{},key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function ingredientsKey(recipe){
  if(!Array.isArray(recipe.ingredients)||!recipe.ingredients.length)return null;
  const parts=recipe.ingredients.map(part=>[part?.id,part?.amount]);
  if(parts.some(([id,amount])=>typeof id!=='string'||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0))return null;
  return JSON.stringify(parts.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]));
}
const nutrientsKey=recipe=>recipe.manualNutrition===undefined?null:record(recipe.manualNutrition)?JSON.stringify(Object.entries(recipe.manualNutrition).sort(([a],[b])=>a.localeCompare(b))):'invalid';

/**
 * 保存済みの食事やアレンジへ、現在の標準料理の絵を後付けしません。
 * material の表示用 name/ancestorIds は比較から除き、標準の量と人数は確認します。
 */
export function recipeArtwork(recipe,{artwork=RECIPE_ARTWORK}={}){
  if(!record(recipe)||recipe.custom===true||own(recipe,'nutrition')||own(recipe,'quantity')||typeof recipe.id!=='string')return null;
  const original=canonicalRecipes.get(recipe.id);
  if(!original||!own(artwork,recipe.id)||recipe.name!==original.name||recipe.servings!==original.servings)return null;
  const key=ingredientsKey(recipe);
  if(key===null||key!==ingredientsKey(original)||nutrientsKey(recipe)!==nutrientsKey(original))return null;
  const image=artwork[recipe.id];
  if(!record(image)||image.name!==original.name||image.src!==`assets/recipe-art/${recipe.id}.webp`||image.largeSrc!==`assets/recipe-art/${recipe.id}-large.webp`||image.width!==640||image.height!==480)return null;
  return {...image,recipeId:recipe.id};
}

const sameAmount=(a,b)=>a===b||typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const sameList=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.every(value=>typeof value==='string')&&b.every(value=>typeof value==='string')&&sameList([...a].sort(),[...b].sort());
function sameMaterials(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
  const first=[...a].sort((a,b)=>String(a?.id).localeCompare(String(b?.id))),second=[...b].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)));
  return first.every((part,index)=>record(part)&&part.id===second[index]?.id&&sameAmount(part.amount,second[index]?.amount));
}
function snapshotMatchesRecipe(item,base,data){
  const expected=itemFromRecipe(base,data);
  for(const key of ['name','role','nature','sourceNote','shoppingKnown','allergensKnown','ingredientsKnown'])if(item[key]!==expected[key])return false;
  if(!sameMaterials(item.ingredients,expected.ingredients)||!sameList(item.steps,expected.steps))return false;
  for(const key of ['allergens','groups','proteinSources'])if(!sameSet(item[key],expected[key]))return false;
  if(!record(item.nutrition)||Object.keys(expected.nutrition).some(key=>!sameAmount(item.nutrition[key],expected.nutrition[key])))return false;
  if(item.portion!==undefined){
    const portion=recipePortion(base,data);
    if(!record(item.portion)||item.portion.unit!==portion.unit||!sameAmount(item.portion.amount,portion.amount))return false;
  }
  return true;
}

/**
 * 献立・お気に入りの保存内容と標準レシピが一致する場合に限り、完成イメージを表示します。
 * 食べる量は画像の対応から独立させます。保存した材料・栄養・手順は変更しません。
 * 登録済みパンの組み合わせも、保存内容全体が同じ標準プリセットに一致する場合だけ対応します。
 * 名前や分類だけの一致、変更済みレシピ、任意のマイレシピへの画像の流用は行いません。
 */
export function snapshotArtworkRecipe(item,data,{artwork=RECIPE_ARTWORK}={}){
  if(!record(item)||typeof item.recipeId!=='string'||!item.recipeId||typeof item.quantity!=='number'||!Number.isFinite(item.quantity)||item.quantity<=0||!Array.isArray(data?.recipes))return null;
  if(item.restaurant!==undefined)return null;
  try{
    // Composer-generated snapshots do not store an artwork ID. Rebuild only registered
    // bread presets and compare the full saved content, rather than guessing from ingredients.
    if(/^custom-food-[A-Za-z0-9_-]+$/.test(item.recipeId)){
      if(typeof item.name!=='string')return null;
      for(const kind of breadKinds){
        const definition=foodComposerDefinition(kind);
        if(!item.name.startsWith(`${definition.label}（`))continue;
        for(const recipeId of definition.recipeIds){
          const config=defaultFoodSelection(kind,{recipeId}),order=new Map(definition.components.map((part,index)=>[part.id,index]));
          // Direct presets and the controls use different component orders. Both were saved by the app.
          const controlOrder=[...config.components].sort((a,b)=>order.get(a.id)-order.get(b.id));
          for(const components of [config.components,controlOrder]){
            const composed=buildFoodSelection({...config,id:item.recipeId,components},data);
            if(!snapshotMatchesRecipe(item,composed,data))continue;
            const pictured=liveBreadArtworkRecipe(composed,definition,{artwork});
            if(pictured)return pictured;
          }
        }
      }
      return null;
    }
    const matches=data.recipes.filter(recipe=>recipe?.id===item.recipeId);
    if(matches.length!==1)return null;
    const base=matches[0];
    return recipeArtwork(base,{artwork})&&snapshotMatchesRecipe(item,base,data)?structuredClone(base):null;
  }catch{return null;}
}

const breadKinds=new Set(['english-muffin','sandwich','hot-sandwich','toast']);
function perServingMaterials(recipe){
  if(!record(recipe)||typeof recipe.servings!=='number'||!Number.isFinite(recipe.servings)||recipe.servings<=0||!Array.isArray(recipe.ingredients)||!recipe.ingredients.length)return null;
  const amounts=new Map();
  for(const part of recipe.ingredients){
    if(!record(part)||typeof part.id!=='string'||!part.id||typeof part.amount!=='number'||!Number.isFinite(part.amount)||part.amount<=0)return null;
    const amount=(amounts.get(part.id)??0)+part.amount/recipe.servings;
    if(!Number.isFinite(amount)||amount<=0)return null;
    amounts.set(part.id,amount);
  }
  return amounts;
}

/**
 * Live bread ingredient controls may match a pictured standard composition.
 * Call only from the active composer, passing its registered definition.
 * Stored meal snapshots remain excluded, and recipeArtwork keeps its strict ID guard.
 */
export function liveBreadArtworkRecipe(recipe,definition,{artwork=RECIPE_ARTWORK}={}){
  if(!record(recipe)||recipe.custom!==true||recipe.servings!==1||own(recipe,'nutrition')||own(recipe,'quantity')||!breadKinds.has(definition?.kind))return null;
  if(foodComposerDefinition(definition.kind)!==definition)return null;
  if(typeof recipe.name!=='string'||!recipe.name.startsWith(`${definition.label}（`))return null;
  const current=perServingMaterials(recipe);if(!current)return null;
  for(const id of definition.recipeIds){
    const original=canonicalRecipes.get(id);
    if(!original||!recipeArtwork(original,{artwork}))continue;
    const standard=perServingMaterials(original);
    if(!standard||current.size!==standard.size)continue;
    const matches=[...standard].every(([id,amount])=>{
      const actual=current.get(id);
      return actual!==undefined&&Math.abs(actual-amount)<=1e-9*Math.max(1,Math.abs(actual),Math.abs(amount));
    });
    if(matches)return structuredClone(original);
  }
  return null;
}
