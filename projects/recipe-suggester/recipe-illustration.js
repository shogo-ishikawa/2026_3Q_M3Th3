/** 個別の標準レシピに対応する完成イメージだけを返します。分類画像は流用しません。 */
import {RECIPES} from './data.js';
import {RECIPE_ARTWORK} from './recipe-artwork-manifest.js?v=3.16.0';

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
