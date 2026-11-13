/** 既存の1人分へ食材を足す計算。元のレシピと過去の記録は変更しません。 */
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

/** additionsの量は追加する1人分。返り値は保存用allowlistだけを使う1人分のマイレシピです。 */
export function buildRecipeArrangement(config,data){
  if(!isRecord(config)||Object.keys(config).some(key=>!['id','baseRecipe','additions','name','role','steps'].includes(key)))throw Error('アレンジする料理の内容を確認してください。');
  const base=config.baseRecipe??null;
  if(base!==null&&(!isRecord(base)||!positive(base.servings)))throw Error('元のレシピの人数を確認してください。');
  if(!Array.isArray(config.additions)||!config.additions.length||config.additions.length>100)throw Error('追加する食材を1つ以上選んでください。');
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
  for(const part of base?.ingredients??[])add(part,base.servings);
  for(const part of additions)add({id:part.id,amount:part.amount});
  if(parts.size>300)throw Error('1つの料理の食材は300種類以下にしてください。');
  const additionRecipe={name:'追加した食材',role,servings:1,ingredients:additions.map(({id,amount})=>({id,amount})),steps:[]};
  const extraItem=itemFromRecipe(additionRecipe,data),baseItem=base?itemFromRecipe(base,data):null;
  const baseNutrition=base?recipeNutrition(base,data):Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]));
  const extraNutrition=recipeNutrition(additionRecipe,data);
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,baseNutrition[key]===null||extraNutrition[key]===null?null:baseNutrition[key]+extraNutrition[key]]));
  const metas=additions.map(part=>data.ingredients[part.id]),confirmation=base?recipeConfirmation(base):{ingredientsKnown:true,allergensKnown:true};
  const labels=additions.map(part=>`${data.ingredients[part.id].name} ${rounded(part.inputAmount)}${part.inputUnit}`);
  const explanation=`${base?'元のレシピ1人分に追加':'この料理の1人分の材料'}：${labels.join('、')}。材料は加熱前などDBに記載された状態の可食部量です。追加分の栄養をそのまま合算する概算で、加熱による損失や油の吸収、汁の残りは自動補正しません。${base&&!confirmation.ingredientsKnown?'元の料理の原材料は未確認です。買い物リスト全体は確定できません。':''}`;
  let steps;
  if(base){
    if(config.steps!==undefined)throw Error('アレンジでは元のレシピの手順を引き継ぎます。');
    steps=[...(base.steps??[])];
    if(steps.length<50)steps.push(`追加した食材（${labels.join('、').slice(0,1500)}）を料理に合わせて用意し、必要な加熱を行って加える。肉や魚などは食品に適した方法で十分に加熱する。`);
  }else{
    steps=config.steps??[];
    if(!Array.isArray(steps))throw Error('作り方を1行ずつ入力してください。');
    steps=steps.map(step=>typeof step==='string'?step.trim():step).filter(step=>step!=='');
    if(!steps.length)steps=['食材を料理に合わせて用意し、肉や魚などは食品に適した方法で十分に加熱して仕上げる。'];
  }
  if(steps.length>50||steps.some(step=>typeof step!=='string'||!step.trim()||step.length>2000))throw Error('作り方は50行以内、1行2000文字以内で入力してください。');
  const recipe={id,name:name.trim(),role,genre:base?.genre??'その他',minutes:base?.minutes??1,servings:1,custom:true,
    ingredients:[...parts].map(([id,amount])=>({id,amount})),steps,manualNutrition,
    nature:base?.nature??'home-cooked',portion:{amount:1,unit:'皿'},staple:base?.staple??role==='staple',
    allergensKnown:confirmation.allergensKnown&&metas.every(meta=>meta.allergensKnown!==false),
    ingredientsKnown:confirmation.ingredientsKnown&&metas.every(meta=>meta.ingredientsKnown!==false),
    shoppingKnown:(!base||confirmation.ingredientsKnown||base.shoppingKnown===true)&&metas.every(meta=>meta.shoppingKnown!==false),
    allergens:unique([...(baseItem?.allergens??[]),...extraItem.allergens]),
    groups:unique([...(baseItem?.groups??[]),...extraItem.groups]),proteinSources:unique([...(baseItem?.proteinSources??[]),...extraItem.proteinSources]),
    ...(base?{family:recipeFamily(base),mealBase:isCompleteMeal(base)}:{}),
    sourceNote:`${explanation}${base?.sourceNote?` 元の料理の説明：${base.sourceNote}`:''}`.slice(0,2000)};
  itemFromRecipe(recipe,data);
  return recipe;
}
