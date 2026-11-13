/** 店舗・サイズごとの表示値を、一般的な料理に紐づけて登録します。 */
import {CATALOG_CATEGORIES, isCompleteMeal, recipeFamily} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe} from './nutrition.js';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value??{},key);
const allowed=new Set(['genericRecipeId','storeName','sizeName','inclusion','riceIncluded','sidesIncluded','basis','basisAmount','basisUnit','sourceUrl','checkedDate']);
const roles=new Set(['staple','main','side','soup','drink','snack']);
const units=new Set(['食','皿','杯','個','枚','袋','貫','切れ','本','人分']);
const riceFamilies=new Set(['rice','onigiri','curry','fried-rice','donburi','omelette-rice','sushi']);
const newId=()=>`custom-restaurant-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}を入力してください。`);return value.trim();}
function positive(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100000)throw Error(`${label}は0より大きい100000以下の数値で入力してください。`);return value;}
function dateValid(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}

/** 履歴はリンク先メニューが消えても保持します。原材料の確認済み扱いにはしません。 */
export function validateRestaurantMetadata(source,data,{historical=false}={}){
  if(!record(source)||Object.keys(source).some(key=>!allowed.has(key)))throw Error('外食メニューの情報を確認してください。');
  const genericRecipeId=text(source.genericRecipeId,120,'一般的な料理の識別子');
  if(['__proto__','constructor','prototype'].includes(genericRecipeId))throw Error('一般的な料理の識別子を確認してください。');
  if(!historical&&data?.recipes&&!data.recipes.some(recipe=>recipe.id===genericRecipeId))throw Error('紐づける一般的な料理を選んでください。');
  const storeName=text(source.storeName,80,'店舗名'),sizeName=text(source.sizeName,80,'サイズ・商品区分'),inclusion=text(source.inclusion,300,'表示値に含まれる料理・付け合わせ');
  if(typeof source.riceIncluded!=='boolean'||typeof source.sidesIncluded!=='boolean')throw Error('ご飯と付け合わせの範囲を選んでください。');
  if(!['portion','per100g'].includes(source.basis))throw Error('栄養表示の基準を選んでください。');
  const basisAmount=positive(source.basisAmount,'栄養表示の基準量'),basisUnit=source.basisUnit;
  if(source.basis==='per100g'?(basisAmount!==100||basisUnit!=='g'):!units.has(basisUnit))throw Error('栄養表示の基準量と単位を確認してください。');
  const sourceUrl=text(source.sourceUrl,500,'公式資料のURL');
  let url;try{url=new URL(sourceUrl);}catch{throw Error('公式資料はhttps://で始まるURLを入力してください。');}
  if(url.protocol!=='https:'||url.username||url.password)throw Error('公式資料は認証情報を含まないhttps://のURLを入力してください。');
  if(!dateValid(source.checkedDate))throw Error('資料の確認日を2000年から2100年の日付で入力してください。');
  return {genericRecipeId,storeName,sizeName,inclusion,riceIncluded:source.riceIncluded,sidesIncluded:source.sidesIncluded,basis:source.basis,basisAmount,basisUnit,sourceUrl,checkedDate:source.checkedDate};
}

/** nutritionは公式資料の表示基準当たり。per100gの場合だけ提供量で一度換算します。 */
export function buildRestaurantRecipe(config,data){
  if(!record(config)||Object.keys(config).some(key=>!['id','genericRecipeId','storeName','sizeName','menuName','inclusion','riceIncluded','sidesIncluded','basis','portionAmount','portionUnit','sourceUrl','checkedDate','nutrition','allergens','allergensKnown'].includes(key)))throw Error('外食メニューの登録内容を確認してください。');
  const base=data?.recipes?.find(recipe=>recipe.id===config.genericRecipeId);
  if(!base)throw Error('紐づける一般的な料理を選んでください。');
  if(!roles.has(base.role))throw Error('一般的な料理の区分を確認してください。');
  const id=config.id??newId();if(typeof id!=='string'||!/^custom-[a-zA-Z0-9_-]+$/.test(id)||id.length>120)throw Error('外食メニューの識別子を確認してください。');
  const portionAmount=positive(config.portionAmount??1,'提供量'),portionUnit=config.basis==='per100g'?'g':config.portionUnit??'食';
  const metadata=validateRestaurantMetadata({genericRecipeId:config.genericRecipeId,storeName:config.storeName,sizeName:config.sizeName,inclusion:config.inclusion,riceIncluded:config.riceIncluded,sidesIncluded:config.sidesIncluded,basis:config.basis,basisAmount:config.basis==='per100g'?100:portionAmount,basisUnit:config.basis==='per100g'?'g':portionUnit,sourceUrl:config.sourceUrl,checkedDate:config.checkedDate},data);
  if(!record(config.nutrition)||Object.keys(config.nutrition).some(key=>!NUTRIENT_KEYS.includes(key)))throw Error('公式資料の栄養成分を入力してください。');
  const factor=config.basis==='per100g'?portionAmount/100:1;
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>{
    const value=config.nutrition[key];if(value===null||value===undefined){if(key==='kcal')throw Error('エネルギーは公式資料の値を入力してください。');return [key,null];}
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e7||value*factor>1e7)throw Error('栄養成分は0以上の有限な数値で入力してください。');return [key,value*factor];
  }));
  const allergens=config.allergens??[];const allergenIds=new Set((data.allergens??[]).map(item=>item.id));
  if(!Array.isArray(allergens)||allergens.length>allergenIds.size||allergens.some(id=>typeof id!=='string'||!allergenIds.has(id)))throw Error('登録するアレルゲンを確認してください。');
  if(config.allergensKnown!==undefined&&typeof config.allergensKnown!=='boolean')throw Error('アレルギー情報の確認状況を確認してください。');
  const baseFamily=recipeFamily(base),hasRice=metadata.riceIncluded,removedRice=riceFamilies.has(baseFamily)&&!hasRice;
  const family=removedRice?'main':hasRice&&CATALOG_CATEGORIES.find(category=>category.id===baseFamily)?.role!=='staple'?'other-staple':baseFamily;
  const role=CATALOG_CATEGORIES.find(category=>category.id===family)?.role??base.role;
  const staple=role==='staple',mealBase=hasRice||(!removedRice&&isCompleteMeal(base));
  const dishName=text(config.menuName??base.name,120,'店舗での料理名');
  const name=`${metadata.storeName}｜${dishName}（${metadata.sizeName}）`;if(name.length>200)throw Error('店舗名・料理名・サイズ名の合計は200文字以内で入力してください。');
  const note=`外食登録：${metadata.storeName}／${metadata.sizeName}。参考分類：${base.name}。表示値に含むもの：${metadata.inclusion}。ご飯${hasRice?'を含む':'を含まない'}、付け合わせ${metadata.sidesIncluded?'を含む':'を含まない'}。入力基準：${metadata.basis==='per100g'?'100g当たりの表示値を提供量へ換算':`${metadata.basisAmount}${metadata.basisUnit}全体の表示値`}。公式資料：${metadata.sourceUrl}（確認日 ${metadata.checkedDate}）。店舗の表示値を記録量に応じて比例換算します。追加のご飯・付け合わせ・調味料は別に記録してください。原材料はこの料理の材料データから推定せず、買い物リストへ追加しません。`;
  const recipe={id,name,role,family,genre:base.genre??'その他',minutes:1,servings:1,staple,mealBase,custom:true,ingredients:[],steps:['店舗の料理を提供された状態で記録する。表示値に含まれない追加品は別に登録する。'],manualNutrition,
    portion:{amount:portionAmount,unit:portionUnit,label:`登録した提供量 ${portionAmount.toLocaleString('ja-JP')}${portionUnit}が栄養計算の基準`},nature:'unspecified',ingredientsKnown:false,shoppingKnown:false,
    allergensKnown:config.allergensKnown===true,allergens:[...new Set(allergens)],groups:[],proteinSources:[],sourceNote:note,restaurant:metadata};
  itemFromRecipe(recipe,data);return recipe;
}

export function restaurantVariantsFor(genericRecipeId,recipes){
  if(typeof genericRecipeId!=='string'||!Array.isArray(recipes))return [];
  return recipes.filter(recipe=>recipe?.restaurant?.genericRecipeId===genericRecipeId).sort((a,b)=>a.restaurant.storeName.localeCompare(b.restaurant.storeName,'ja')||a.restaurant.sizeName.localeCompare(b.restaurant.sizeName,'ja'));
}

/** 編集・複製用に、保存済みの提供量栄養を表示基準へ戻します。 */
export function restaurantConfigFromRecipe(recipe){
  const restaurant=validateRestaurantMetadata(recipe?.restaurant,undefined,{historical:true});
  const amount=positive(recipe.portion?.amount,'提供量'),factor=restaurant.basis==='per100g'?amount/100:1;
  const {basisAmount,basisUnit,...fields}=restaurant;
  return {id:recipe.id,...fields,menuName:recipe.name.slice(`${restaurant.storeName}｜`.length,recipe.name.length-`（${restaurant.sizeName}）`.length),portionAmount:amount,portionUnit:recipe.portion.unit,
    nutrition:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,recipe.manualNutrition?.[key]==null?null:recipe.manualNutrition[key]/factor])),allergens:[...(recipe.allergens??[])],allergensKnown:recipe.allergensKnown===true};
}
