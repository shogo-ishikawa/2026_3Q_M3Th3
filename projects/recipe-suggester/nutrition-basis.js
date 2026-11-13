/** 栄養値の求め方を表示する分類。正確さや安全性の採点ではありません。 */
import {TAKEAWAY_RECIPES} from './takeaway-foods.js';
import {CONFECTIONERY_RECIPES} from './confectionery-foods.js';
import {DESSERT_RECIPES} from './dessert-foods.js';
import {PERFORMANCE_RECIPES} from './performance-foods.js';
import {ACCOMPANIMENT_RECIPES} from './accompaniment-foods.js';

export const NUTRITION_BASIS_KINDS=Object.freeze(['ingredients','official','manual','estimate','mixed','unknown']);
const KEYS=Object.freeze(['kcal','protein','fat','carbs','fiber','salt']);
const LABELS=Object.freeze({kcal:'エネルギー',protein:'たんぱく質',fat:'脂質',carbs:'炭水化物',fiber:'食物繊維',salt:'食塩相当量'});
const own=(value,key)=>Object.hasOwn(value??{},key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const positive=value=>nonnegative(value)&&value>0;

const DETAILS=Object.freeze({
  ingredients:Object.freeze({label:'材料から概算',description:'登録した材料の代表値と使用量から求めた概算です。部位・商品・調理で栄養は変わります。'}),
  official:Object.freeze({label:'公式表示値（参考）',description:'参照商品・店舗の表示値を基準にした記録例です。実物の規格や量との対応は詳細の出典を確認してください。'}),
  manual:Object.freeze({label:'手入力',description:'利用者が入力した栄養値です。実物の表示や入力した基準量を確認してください。'}),
  estimate:Object.freeze({label:'配合・摂取量の概算',description:'参考配合や食べた割合などの条件を使った概算です。計算に使った条件は詳細の説明に残しています。'}),
  mixed:Object.freeze({label:'表示値＋概算',description:'商品などの表示値に、別の食材や参考値による概算を組み合わせています。料理全体の公式表示値ではありません。'}),
  unknown:Object.freeze({label:'根拠未記録',description:'記録時に栄養の求め方の分類を保存していません。値を現在のDBから推定し直さず、詳細に残っている説明を参照します。'}),
});

export function validateNutritionBasis(value){
  if(typeof value!=='string'||!NUTRITION_BASIS_KINDS.includes(value))throw Error('栄養値の根拠の分類を確認してください。');
  return value;
}

function nutritionValues(value){
  if(!record(value))return null;
  if(KEYS.some(key=>value[key]!==null&&value[key]!==undefined&&!nonnegative(value[key])))return null;
  return Object.fromEntries(KEYS.map(key=>[key,value[key]??null]));
}

function ingredientValues(recipe,data){
  if(!positive(recipe?.servings)||!Array.isArray(recipe?.ingredients)||!recipe.ingredients.length)return null;
  const total=Object.fromEntries(KEYS.map(key=>[key,0]));
  for(const part of recipe.ingredients){
    if(!record(part)||!positive(part.amount)||typeof part.id!=='string'||!own(data?.ingredients,part.id))return null;
    const values=nutritionValues(data.ingredients[part.id]?.nutritionPerUnit);
    if(!values)return null;
    for(const key of KEYS)total[key]=total[key]===null||values[key]===null?null:total[key]+values[key]*part.amount/recipe.servings;
  }
  return total;
}

const equivalent=(a,b)=>a===null||b===null?a===b:Math.abs(a-b)<=Math.max(1e-8,Math.abs(a)*1e-9,Math.abs(b)*1e-9);
function matchesIngredients(recipe,data){
  const supplied=nutritionValues(recipe.manualNutrition),calculated=ingredientValues(recipe,data);
  return !!supplied&&!!calculated&&KEYS.every(key=>equivalent(supplied[key],calculated[key]));
}

function profileFingerprint(recipe){
  const nutrition=nutritionValues(recipe?.manualNutrition);
  if(!nutrition||!positive(recipe?.servings)||!Array.isArray(recipe?.ingredients)||!record(recipe?.portion))return null;
  if(recipe.ingredients.some(part=>!record(part)))return null;
  const parts=recipe.ingredients.map(part=>[part.id,part.amount]);
  if(parts.some(([id,amount])=>typeof id!=='string'||!positive(amount)))return null;
  parts.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
  return JSON.stringify([recipe.servings,recipe.portion.amount,recipe.portion.unit,KEYS.map(key=>nutrition[key]),parts]);
}

// 公式表示の転記を持つ実際の登録だけを参照します。IDの接頭辞、URLや
// 「公式」という文言だけでは表示値の根拠として認定しません。
const officialProfiles=new Map();
for(const recipe of [...TAKEAWAY_RECIPES,...CONFECTIONERY_RECIPES,...DESSERT_RECIPES,
  ...ACCOMPANIMENT_RECIPES.filter(recipe=>recipe.manualNutrition!==undefined),
  ...PERFORMANCE_RECIPES.filter(recipe=>recipe.manualNutrition!==undefined)]){
  officialProfiles.set(recipe.id,{fingerprint:profileFingerprint(recipe),kind:/^performance-(?:soy|whey)_powder-milk$/.test(recipe.id)?'mixed':'official'});
}

function restaurantLabel(recipe){
  const source=recipe?.restaurant;
  if(!record(source)||['genericRecipeId','storeName','sizeName','inclusion'].some(key=>typeof source[key]!=='string'||!source[key].trim())||
    typeof source.riceIncluded!=='boolean'||typeof source.sidesIncluded!=='boolean'||!positive(source.basisAmount)||
    !['portion','per100g'].includes(source.basis)||!positive(recipe?.portion?.amount)||
    !nutritionValues(recipe.manualNutrition)||!nonnegative(recipe.manualNutrition.kcal))return false;
  if(source.basis==='per100g'?(source.basisAmount!==100||source.basisUnit!=='g'||recipe.portion.unit!=='g'):
    !['食','皿','杯','個','枚','袋','貫','切れ','本','人分'].includes(source.basisUnit)||source.basisAmount!==recipe.portion.amount||source.basisUnit!==recipe.portion.unit)return false;
  if(typeof source.sourceUrl!=='string'||typeof source.checkedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(source.checkedDate)||source.checkedDate<'2000-01-01'||source.checkedDate>'2100-12-31')return false;
  const date=new Date(`${source.checkedDate}T00:00:00Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==source.checkedDate)return false;
  try{const url=new URL(source.sourceUrl);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}

/** 新しく記録する料理の分類。過去のsnapshotの推定には使いません。 */
export function deriveRecipeBasis(recipe,data){
  if(!record(recipe))return 'unknown';
  if(own(recipe,'nutritionBasis'))return validateNutritionBasis(recipe.nutritionBasis);
  if(own(recipe,'nutrition'))return 'unknown';
  if(recipe.manualNutrition!==undefined&&!nutritionValues(recipe.manualNutrition))return 'unknown';
  if(restaurantLabel(recipe))return 'official';
  const known=officialProfiles.get(recipe.id);
  if(recipe.custom!==true&&known&&known.fingerprint!==null&&profileFingerprint(recipe)===known.fingerprint)return known.kind;
  if(recipe.manualNutrition===undefined)return ingredientValues(recipe,data)?'ingredients':'unknown';
  if(matchesIngredients(recipe,data))return 'ingredients';
  // 未分類の自作・手入力を、URLや材料の存在だけから公式値へ昇格させません。
  return recipe.custom===true?'unknown':'estimate';
}

/** 古いsnapshotはrecipeIdから現在の料理を引いて分類し直しません。 */
export function classifyNutritionBasis(value,data,{snapshot=own(value,'nutrition')}={}){
  const kind=record(value)&&own(value,'nutritionBasis')?validateNutritionBasis(value.nutritionBasis):snapshot?'unknown':deriveRecipeBasis(value,data);
  let values=record(value)?nutritionValues(snapshot?value.nutrition:value.manualNutrition):null;
  if(!snapshot&&record(value)&&value.manualNutrition===undefined)values=ingredientValues(value,data);
  const unknownKeys=KEYS.filter(key=>!values||values[key]===null);
  let description=DETAILS[kind].description;
  if(kind==='official'&&record(value?.restaurant))description='利用者が登録した公式資料の表示値を基準にしています。資料をアプリが自動照合した値ではありません。提供量・対象範囲・出典を確認してください。';
  if(kind==='ingredients'&&record(value)&&value.manualNutrition!==undefined)description='登録材料の代表値と使用量の合計に対応する概算です。表示した料理の量・材料の状態を確認してください。';
  return {kind,label:DETAILS[kind].label,description,unknownKeys,
    unknownNote:unknownKeys.length?`${unknownKeys.map(key=>LABELS[key]).join('・')}に未入力の成分があります。`:''};
}
