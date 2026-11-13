/** 麺・固形の具・スープを分け、飲んだスープだけを摂取栄養へ反映します。 */
import {NOODLE_STYLES, NOODLE_TOPPINGS} from './noodle-foods.js';
import {recipeFamily} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const NOODLE_SOUP_INTAKES=freeze([
  {id:'clinging',label:'麺に絡む程度',fraction:.1},
  {id:'little',label:'少し',fraction:.25},
  {id:'half',label:'半分',fraction:.5},
  {id:'mostly',label:'ほとんど',fraction:.8},
  {id:'full',label:'完飲',fraction:1},
]);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.hasOwn(value??{},key);
const unique=values=>[...new Set(values)];
const round=value=>Number(value.toFixed(2)).toLocaleString('ja-JP');
const zeros=()=>Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]));
const uid=()=>`custom-noodle-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function noodleComposerFor(recipeId){return NOODLE_STYLES.find(model=>model.recipeId===recipeId)??null;}

export function defaultNoodleSelection(recipeId){
  const model=noodleComposerFor(recipeId);if(!model)throw Error('麺料理の種類を選んでください。');
  return {recipeId,noodleAmount:model.noodleAmount,soupIntake:model.soup.length?'full':'none',
    toppings:(model.defaultToppings??[]).map(part=>({...part}))};
}

export function noodleToppings(recipeId,data){
  if(!noodleComposerFor(recipeId))throw Error('麺料理の種類を選んでください。');
  return NOODLE_TOPPINGS.filter(topping=>topping.ingredients.every(part=>own(data?.ingredients,part.id)));
}

function partsNutrition(parts,data){return parts.length?recipeNutrition({servings:1,ingredients:parts},data):zeros();}
function addParts(target,parts,multiplier=1){
  for(const part of parts){
    if(!record(part)||typeof part.id!=='string'||!positive(part.amount))throw Error('麺・具・スープの基準量を確認してください。');
    target.set(part.id,(target.get(part.id)??0)+part.amount*multiplier);
  }
}
const fromMap=map=>[...map].map(([id,amount])=>({id,amount}));

/** ingredientsは調理の全量、manualNutritionは摂取量。独自の保存キーは追加しません。 */
export function buildNoodleSelection(config,data){
  if(!record(config)||Object.keys(config).some(key=>!['id','recipeId','noodleAmount','soupIntake','toppings'].includes(key)))throw Error('麺料理の選択内容を確認してください。');
  const model=noodleComposerFor(config.recipeId),source=data?.recipes?.find(recipe=>recipe.id===config.recipeId);
  if(!model||!source||!positive(source.servings)||source.manualNutrition!==undefined||source.nature!=='home-cooked')throw Error('材料を分けて計算できる麺料理を選んでください。');
  const noodleAmount=own(config,'noodleAmount')?config.noodleAmount:model.noodleAmount;
  if(!positive(noodleAmount)||noodleAmount>2000)throw Error('麺の量は0より大きく2000g以下で入力してください。');
  if(data?.ingredients?.[model.noodleIngredientId]?.unit!=='g')throw Error('麺の重さの単位を確認してください。');
  const intakeId=own(config,'soupIntake')?config.soupIntake:(model.soup.length?'full':'none');
  const intake=model.soup.length?NOODLE_SOUP_INTAKES.find(item=>item.id===intakeId):null;
  if(model.soup.length?!intake:intakeId!=='none')throw Error('飲んだスープの量を選び直してください。');
  if(!Array.isArray(config.toppings)||config.toppings.length>50)throw Error('トッピングの一覧を確認してください。');
  const selected=[],seen=new Set(),solidMap=new Map(),prepMap=new Map();
  addParts(solidMap,[{id:model.noodleIngredientId,amount:noodleAmount}]);
  addParts(solidMap,model.solids??[]);
  for(const part of config.toppings){
    if(!record(part)||Object.keys(part).some(key=>!['id','amount'].includes(key))||typeof part.id!=='string'||seen.has(part.id))throw Error('トッピングに不明な値や重複があります。');
    seen.add(part.id);const topping=NOODLE_TOPPINGS.find(item=>item.id===part.id);
    if(!topping||!positive(part.amount)||part.amount>(['g','ml'].includes(topping.unit)?1000:50))throw Error('トッピングの量を確認してください。');
    addParts(solidMap,topping.ingredients,part.amount);selected.push({topping,amount:part.amount});
  }
  addParts(prepMap,fromMap(solidMap));addParts(prepMap,model.soup);
  const ingredients=fromMap(prepMap),solids=partsNutrition(fromMap(solidMap),data),broth=partsNutrition(model.soup,data);
  const fraction=intake?.fraction??0;
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,
    solids[key]===null||(model.soup.length&&broth[key]===null)?null:solids[key]+broth[key]*fraction]));
  const id=own(config,'id')?config.id:uid();
  if(typeof id!=='string'||!/^custom-[a-zA-Z0-9_-]+$/.test(id)||id.length>120)throw Error('麺料理の識別子を確認してください。');
  // 基準レシピの既定トッピングから作った配列を持ち越さず、今回使う材料から求め直します。
  const confirmed=recipeConfirmation(source),metadata=itemFromRecipe({...source,allergens:[],groups:[],proteinSources:[],ingredients,servings:1},data);
  const consumed=model.soup.length?`${intake.label}（スープの約${round(fraction*100)}%）`:'汁なし（たれは全量）';
  const toppingsLabel=selected.length?selected.map(({topping,amount})=>`${topping.label} ${round(amount)}${topping.unit}`).join('、'):'追加トッピングなし';
  const name=`${source.name}（${model.soup.length?`スープ${intake.label}`:'具材調整'}）`;
  const allMetas=ingredients.map(part=>data.ingredients[part.id]);
  const sourceNote=[
    `${model.label}の一般的な1杯のモデルです。麺は${data.ingredients[model.noodleIngredientId].name}${round(noodleAmount)}g。${consumed}として計算します。`,
    'スープの割合は申告内容を数値化するための目安で、油や塩分の残り方を実測した値ではありません。麺・固形の具・トッピングの栄養は全量、分けたスープ成分だけを割合で加算します。',
    `追加する種類と量：${toppingsLabel}。`,
    '材料欄と買い物リストは1杯を調理する全量です。スープを残しても買う材料は減らしません。汁なしのたれ・油は全量を計算します。',
    source.sourceNote??'',
  ].join(' ').slice(0,2000);
  const result={id,name:name.slice(0,200),role:source.role,genre:source.genre,minutes:source.minutes,
    servings:1,custom:true,nature:'home-cooked',family:recipeFamily(source),staple:true,mealBase:true,
    portion:{amount:1,unit:'皿'},ingredients,manualNutrition,
    steps:[...(source.steps??[]),model.soup.length?`器へ注いだスープのうち、食べた後の残量を見て「${intake.label}」を選ぶ。麺や具は表示量を食べ、残す場合は記録する料理の量も合わせて調整する。`:'たれと具を麺へよく絡める。たれを含む表示量を食べるモデルとして記録する。'].slice(0,50),
    allergens:unique(metadata.allergens),groups:unique(metadata.groups),proteinSources:unique(metadata.proteinSources),
    allergensKnown:confirmed.allergensKnown&&allMetas.every(item=>item.allergensKnown!==false),
    ingredientsKnown:confirmed.ingredientsKnown&&allMetas.every(item=>item.ingredientsKnown!==false),
    shoppingKnown:source.shoppingKnown!==false&&allMetas.every(item=>item.shoppingKnown!==false),sourceNote};
  itemFromRecipe(result,data);return result;
}

export function eligibleNoodleSelections(recipeId,settings,data){
  eligibleRecipes(settings,{...data,recipes:[]});
  const standard=defaultNoodleSelection(recipeId),configs=[standard];
  if(standard.toppings.length)configs.push({...standard,toppings:[]});
  return configs.flatMap(config=>{
    const recipe=buildNoodleSelection(config,data);
    return eligibleRecipes(settings,{...data,recipes:[recipe]}).length?[{config,recipe}]:[];
  });
}
