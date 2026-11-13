/** 1人分の材料を編集する計算。元のレシピと過去の記録は変更しません。 */
import {isCompleteMeal, recipeFamily} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';

const own=(value,key)=>Object.hasOwn(value??{},key);
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const unique=values=>[...new Set(values)];
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const newId=()=>`custom-arrangement-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const roles=new Set(['staple','main','side','soup','drink','snack']);

export const ARRANGEMENT_CATEGORIES=Object.freeze([
  ['meat','肉'],['fish','魚介'],['vegetable','野菜・いも'],['mushroom','きのこ'],
  ['egg-bean','卵・豆・豆腐'],['dairy','乳製品'],['grain','穀類・めん'],['fruit','果物'],
  ['seasoning','調味料・飲料'],['other','その他'],
].map(([id,label])=>Object.freeze({id,label})));

function ingredientCategory(ingredient){
  const name=ingredient.name??'',sources=ingredient.proteinSources??[],groups=ingredient.groups??[];
  if(/きのこ|しめじ|しいたけ|えのき|まいたけ|エリンギ|マッシュルーム|マイタケ|シイタケ/.test(name))return 'mushroom';
  if(sources.includes('meat'))return 'meat';
  if(sources.includes('fish'))return 'fish';
  if(sources.some(source=>['egg','soy'].includes(source)))return 'egg-bean';
  if(groups.includes('dairy'))return 'dairy';
  if(groups.includes('vegetable'))return 'vegetable';
  if(groups.includes('fruit'))return 'fruit';
  if(groups.includes('staple'))return 'grain';
  if(!sources.length&&!groups.length)return 'seasoning';
  return 'other';
}

/** g入力には、DB内の可食部重量・密度だけを使います。換算値がなければ元の単位です。 */
export function arrangementIngredientOptions(data){
  if(!isRecord(data?.ingredients))throw Error('追加できる食材のデータが見つかりません。');
  return Object.entries(data.ingredients).map(([id,ingredient])=>{
    const gramsPerUnit=ingredient.unit==='g'?1:ingredient.gramsPerUnit;
    const byWeight=positive(gramsPerUnit);
    return {id,name:ingredient.name,category:ingredientCategory(ingredient),unit:byWeight?'g':ingredient.unit,
      nativeUnit:ingredient.unit,gramsPerUnit:byWeight?gramsPerUnit:null,defaultAmount:byWeight?10:1};
  }).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
}

export function ingredientAmountFromInput(part,data){
  if(!isRecord(part)||Object.keys(part).some(key=>!['id','amount','unit'].includes(key))||typeof part.id!=='string'||!own(data?.ingredients,part.id))throw Error('追加する食材を選んでください。');
  if(!positive(part.amount)||part.amount>10000)throw Error('追加量は0より大きく10000以下の数値で入力してください。');
  const ingredient=data.ingredients[part.id],gramsPerUnit=ingredient.unit==='g'?1:ingredient.gramsPerUnit;
  const inputUnit=part.unit??(positive(gramsPerUnit)?'g':ingredient.unit);
  if(inputUnit!=='g'&&inputUnit!==ingredient.unit)throw Error('追加する食材の量の単位を確認してください。');
  if(inputUnit==='g'&&!positive(gramsPerUnit))throw Error('この食材はg換算が未登録です。表示されている単位で入力してください。');
  return {id:part.id,amount:inputUnit==='g'?part.amount/gramsPerUnit:part.amount,
    inputAmount:part.amount,inputUnit,nativeUnit:ingredient.unit,
    grams:inputUnit==='g'?part.amount:positive(gramsPerUnit)?part.amount*gramsPerUnit:null};
}

/** 材料編集は、原材料が確認でき、栄養が材料と対応する料理で行います。 */
export function arrangementEditAvailability(base,data){
  if(!base)return {editable:false,reason:''};
  const confirmation=recipeConfirmation(base);
  if(!confirmation.ingredientsKnown)return {editable:false,reason:'元の料理の原材料が未確認のため、材料の減量・削除・置き換えはできません。食材の追加はできます。'};
  if(base.manualNutrition!==undefined){
    const recorded=recipeNutrition(base,data),calculated=recipeNutrition({...base,manualNutrition:undefined},data);
    if(NUTRIENT_KEYS.some(key=>recorded[key]===null?calculated[key]!==null:calculated[key]===null||Math.abs(recorded[key]-calculated[key])>Math.max(1e-7,Math.abs(recorded[key])*1e-7)))return {editable:false,reason:'元の料理は商品表示やスープ摂取量などを反映した栄養値です。材料との対応が確定できないため、減量・削除・置き換えはできません。食材の追加はできます。'};
  }
  return {editable:true,reason:''};
}

/** 元の材料を1人分にまとめ、入力単位と材料・買い物用の量を返します。 */
export function arrangementBaseIngredients(base,data){
  if(!base)return [];
  if(!positive(base.servings))throw Error('元のレシピの人数を確認してください。');
  const options=arrangementIngredientOptions(data),parts=new Map();
  for(const part of base.ingredients??[]){
    if(!own(data.ingredients,part.id)||!positive(part.amount))throw Error('元のレシピの材料と分量を確認してください。');
    parts.set(part.id,(parts.get(part.id)??0)+part.amount/base.servings);
  }
  return [...parts].map(([id,amount])=>{const option=options.find(value=>value.id===id);return {...option,nativeAmount:amount,amount:option.unit==='g'?amount*option.gramsPerUnit:amount};});
}

/** additionsとingredientEditsの量は1人分。元材料の変更量0は削除を表します。 */
export function buildRecipeArrangement(config,data){
  if(!isRecord(config)||Object.keys(config).some(key=>!['id','baseRecipe','additions','ingredientEdits','name','role','steps'].includes(key)))throw Error('アレンジする料理の内容を確認してください。');
  const base=config.baseRecipe??null;
  if(base!==null&&(!isRecord(base)||!positive(base.servings)))throw Error('元のレシピの人数を確認してください。');
  if(!Array.isArray(config.additions)||config.additions.length>100)throw Error('追加する食材は100種類以下にしてください。');
  const ingredientEdits=config.ingredientEdits??[];
  if(!Array.isArray(ingredientEdits)||ingredientEdits.length>300||(!base&&ingredientEdits.length))throw Error('元の材料の変更内容を確認してください。');
  const id=config.id??newId();
  if(typeof id!=='string'||!/^custom-[a-zA-Z0-9_-]+$/.test(id)||id.length>120)throw Error('料理の識別子を確認してください。');
  const defaultName=base?`${base.name.slice(0,193)}（アレンジ）`:'';
  const name=(config.name??defaultName);
  if(typeof name!=='string'||!name.trim()||name.trim().length>200)throw Error('料理名を1文字以上200文字以内で入力してください。');
  const role=base?.role??config.role??'main';
  if(!roles.has(role))throw Error('料理の区分を選んでください。');
  const additions=config.additions.map(part=>ingredientAmountFromInput(part,data)),parts=new Map();
  function add(part,divisor=1){
    if(!isRecord(part)||typeof part.id!=='string'||!own(data?.ingredients,part.id)||!positive(part.amount))throw Error('元のレシピの材料と分量を確認してください。');
    parts.set(part.id,(parts.get(part.id)??0)+part.amount/divisor);
  }
  const originals=arrangementBaseIngredients(base,data),edits=new Map();
  for(const edit of ingredientEdits){
    if(!isRecord(edit)||Object.keys(edit).some(key=>!['id','replacementId','amount','unit'].includes(key))||!originals.some(part=>part.id===edit.id)||edits.has(edit.id)||typeof edit.amount!=='number'||!Number.isFinite(edit.amount)||edit.amount<0||edit.amount>10000)throw Error('元の材料の変更内容と量を確認してください。');
    const target=edit.replacementId??edit.id;
    if(typeof target!=='string'||!own(data.ingredients,target))throw Error('置き換える食材を選んでください。');
    if(edit.unit!==undefined&&edit.unit!=='g'&&edit.unit!==data.ingredients[target].unit)throw Error('変更する食材の量の単位を確認してください。');
    const converted=edit.amount===0?{id:target,amount:0,inputAmount:0,inputUnit:edit.unit??'g'}:ingredientAmountFromInput({id:target,amount:edit.amount,...(edit.unit?{unit:edit.unit}:{})},data);
    edits.set(edit.id,converted);
  }
  const changed=originals.some(part=>{const edit=edits.get(part.id);return edit&&(edit.id!==part.id||Math.abs(edit.amount-part.nativeAmount)>1e-10);});
  if(changed&&!arrangementEditAvailability(base,data).editable)throw Error(arrangementEditAvailability(base,data).reason);
  if(!config.additions.length&&!changed)throw Error('食材を追加するか、元の材料の量・種類を変更してください。');
  for(const part of originals){const edit=edits.get(part.id);if(edit){if(edit.amount>0)add(edit);}else add({id:part.id,amount:part.nativeAmount});}
  for(const part of additions)add({id:part.id,amount:part.amount});
  if(parts.size>300)throw Error('1つの料理の食材は300種類以下にしてください。');
  const additionRecipe={name:'追加した食材',role,servings:1,ingredients:additions.map(({id,amount})=>({id,amount})),steps:[]};
  const extraItem=itemFromRecipe(additionRecipe,data),baseItem=base?itemFromRecipe(base,data):null;
  const baseNutrition=base?recipeNutrition(base,data):Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]));
  const extraNutrition=recipeNutrition(additionRecipe,data);
  let manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,baseNutrition[key]===null||extraNutrition[key]===null?null:baseNutrition[key]+extraNutrition[key]]));
  if(changed)manualNutrition=recipeNutrition({servings:1,ingredients:[...parts].map(([id,amount])=>({id,amount}))},data);
  if(!parts.size)throw Error('材料を1つ以上残してください。');
  const finalParts=[...parts].map(([id,amount])=>({id,amount}));
  const metas=(changed?finalParts:additions).map(part=>data.ingredients[part.id]),confirmation=base?recipeConfirmation(base):{ingredientsKnown:true,allergensKnown:true};
  const labels=additions.map(part=>`${data.ingredients[part.id].name} ${rounded(part.inputAmount)}${part.inputUnit}`);
  const editLabels=changed?originals.filter(part=>edits.has(part.id)).map(part=>{const edit=edits.get(part.id);return `${part.name} → ${edit.amount===0?'削除':`${data.ingredients[edit.id].name} ${rounded(edit.inputAmount)}${edit.inputUnit}`}`;}):[];
  const explanation=`${changed?`元の材料を1人分で変更：${editLabels.join('、')}。変更後の材料全体から栄養を再計算。`:''}${labels.length?`${base?'元のレシピ1人分に追加':'この料理の1人分の材料'}：${labels.join('、')}。`:''}材料は加熱前などDBに記載された状態の可食部量です。${changed?'変更後の材料の栄養をそのまま合計する':'追加分の栄養をそのまま合算する'}概算で、加熱による損失や油の吸収、汁の残りは自動補正しません。${base&&!confirmation.ingredientsKnown?'元の料理の原材料は未確認です。買い物リスト全体は確定できません。':''}`;
  let steps;
  if(base){
    if(config.steps!==undefined)throw Error('アレンジでは元のレシピの手順を引き継ぎます。');
    steps=[...(base.steps??[])];
    if(changed&&steps.length<50)steps.push(`材料の変更（${editLabels.join('、').slice(0,1500)}）を反映する。元の手順に削除・置き換え前の食材名が残る場合は、変更後の材料に読み替え、肉や魚などは種類に適した方法で十分に加熱する。`);
    if(labels.length&&steps.length<50)steps.push(`追加した食材（${labels.join('、').slice(0,1500)}）を料理に合わせて用意し、必要な加熱を行って加える。肉や魚などは食品に適した方法で十分に加熱する。`);
  }else{
    steps=config.steps??[];
    if(!Array.isArray(steps))throw Error('作り方を1行ずつ入力してください。');
    steps=steps.map(step=>typeof step==='string'?step.trim():step).filter(step=>step!=='');
    if(!steps.length)steps=['食材を料理に合わせて用意し、肉や魚などは食品に適した方法で十分に加熱して仕上げる。'];
  }
  if(steps.length>50||steps.some(step=>typeof step!=='string'||!step.trim()||step.length>2000))throw Error('作り方は50行以内、1行2000文字以内で入力してください。');
  const recipe={id,name:name.trim(),role,genre:base?.genre??'その他',minutes:base?.minutes??1,servings:1,custom:true,
    ingredients:finalParts,steps,manualNutrition,
    nature:base?.nature??'home-cooked',portion:{amount:1,unit:'皿'},staple:base?.staple??role==='staple',
    allergensKnown:confirmation.allergensKnown&&metas.every(meta=>meta.allergensKnown!==false),
    ingredientsKnown:confirmation.ingredientsKnown&&metas.every(meta=>meta.ingredientsKnown!==false),
    shoppingKnown:(!base||confirmation.ingredientsKnown||base.shoppingKnown===true)&&metas.every(meta=>meta.shoppingKnown!==false),
    ...arrangementMetadata(base,baseItem,extraItem,finalParts,changed,data),
    ...(base?{family:recipeFamily(base),mealBase:isCompleteMeal(base)}:{}),
    sourceNote:`${explanation}${base?.sourceNote?` 元の料理の説明：${base.sourceNote}`:''}`.slice(0,2000)};
  itemFromRecipe(recipe,data);
  return recipe;
}

function arrangementMetadata(base,baseItem,extraItem,finalParts,changed,data){
  if(!changed)return {allergens:unique([...(baseItem?.allergens??[]),...extraItem.allergens]),groups:unique([...(baseItem?.groups??[]),...extraItem.groups]),proteinSources:unique([...(baseItem?.proteinSources??[]),...extraItem.proteinSources])};
  const originalMaterials=itemFromRecipe({name:'元の材料',servings:base.servings,ingredients:base.ingredients,steps:[]},data);
  const remaining=itemFromRecipe({name:'変更後の材料',servings:1,ingredients:finalParts,steps:[]},data);
  return Object.fromEntries(['allergens','groups','proteinSources'].map(key=>[key,unique([...(baseItem?.[key]??[]).filter(value=>key==='allergens'&&!recipeConfirmation(base).allergensKnown||!originalMaterials[key].includes(value)),...remaining[key]])]));
}
