/** 調理しやすい量の目安です。保存値・栄養計算・購入量の計算は変更しません。 */
import {recipeFamily, recipePortion} from './catalog.js';

export const COOKING_GUIDE_SOURCES = Object.freeze({
  ingredients: Object.freeze({title:'味の素パーク：食材の目安量',url:'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/'}),
  spoons: Object.freeze({title:'京都市：調味料の計り方',url:'https://kyo-kenko.city.kyoto.lg.jp/food-education/trivia/seasoning/'}),
  measuring: Object.freeze({title:'貝印：計量スプーンの容量',url:'https://www.kai-group.com/faq_corporate/%E8%A8%88%E9%87%8F%E3%82%B9%E3%83%97%E3%83%BC%E3%83%B3%E3%81%AE%E3%81%9D%E3%82%8C%E3%81%9E%E3%82%8C%E3%81%AE%E5%AE%B9%E9%87%8F%E3%82%92%E6%95%99%E3%81%88%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84/'}),
  shrimp: Object.freeze({title:'CBC・キユーピー3分クッキング：えびのクリームパイ',url:'https://hicbc.com/magazine/article/?id=kewpie-recipe-2024050601'}),
});

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const format = value => Number(value.toFixed(3)).toLocaleString('ja-JP');
const close = (a,b) => Math.abs(a-b) <= Math.max(1,Math.abs(a),Math.abs(b))*1e-10;
const clean = value => Number(value.toPrecision(12));
const fraction = value => ({.125:'1/8',.25:'1/4',[1/3]:'1/3',.5:'半',[2/3]:'2/3',.75:'3/4'})[value] ?? format(value);

/** 自動提案だけに使う倍率。固定量を使う呼び出し元は、この関数より先に固定量を適用します。 */
export function plannedQuantity(recipe, settings = {}, data) {
  if (!recipe || typeof recipe !== 'object') throw Error('料理の量を確認してください。');
  const meal = settings.meal ?? 'dinner';
  const volume = settings.mealPreferences?.[meal]?.volume ?? 'normal';
  if (!['light','normal','hearty'].includes(volume)) throw Error('食事の量を確認してください。');
  const index = ['light','normal','hearty'].indexOf(volume);
  const portion = recipePortion(recipe,data), family = recipeFamily(recipe);
  if (family === 'rice' && portion.unit === 'g') return [100,150,200][index]/portion.amount;
  if (family === 'bread' && portion.unit === '枚') return [.5,1,1.5][index]/portion.amount;
  if (recipe.role === 'drink' || recipe.role === 'soup' || recipe.role === 'snack' || meal === 'snack') return 1;
  // 半人分・1人分・1.5人分から選び、0.56皿などの二重の倍率を作りません。
  return [.5,1,1.5][index];
}

function plateLabel(quantity) {
  if (close(quantity,.5)) return '少なめ（半人分）';
  if (close(quantity,1)) return 'ふつう（1人分）';
  if (close(quantity,1.5)) return '多め（1.5人分）';
  if (quantity < .875) return '少なめ';
  if (quantity <= 1.125) return 'ふつう';
  if (quantity < 1.75) return '多め';
  return `${format(quantity)}人分`;
}
function quantityLabel(portion,quantity,{family,role} = {}) {
  const actual = clean(portion.amount*quantity);
  if (family === 'rice' && portion.unit === 'g') {
    const size = [[100,'小盛り'],[150,'ふつう'],[200,'大盛り']].find(([grams])=>close(actual,grams));
    return size ? `${size[1]}（${size[0]}g）` : `${format(actual)}g`;
  }
  if (portion.unit === '枚') {
    if (close(actual,.5)) return '半枚';
    if (close(actual,1.5)) return '1枚半';
    return `${format(actual)}枚`;
  }
  if (portion.unit === '皿' || portion.unit === '人分') return plateLabel(quantity);
  if (portion.unit === '杯' && close(actual,.5)) return '半杯';
  return `${format(actual)}${portion.unit}`;
}

/** 提案カード用。倍率ではなく、盛り付ける量を短く示します。 */
export function planPortionLabel(recipe, quantity = 1, data) {
  if (!positive(quantity)) throw Error('料理の量を確認してください。');
  return quantityLabel(recipePortion(recipe,data),quantity,{family:recipeFamily(recipe),role:recipe.role});
}

/** 保存済みスナップショットの量をそのまま説明します。再計算や数量の書き換えはしません。 */
export function portionLabel(item, data) {
  if (!item || !positive(item.quantity)) throw Error('料理の量を確認してください。');
  const recipe = data?.recipes?.find(recipe=>recipe.id===item.recipeId);
  const portion = item.portion ?? (recipe ? recipePortion(recipe,data) : {amount:1,unit:'人分'});
  let family;
  if (recipe) family=recipeFamily(recipe);
  return quantityLabel(portion,item.quantity,{family,role:item.role});
}

// 個数の参照値は一般的な大きさの「丸ごと」の重量です。皮・芯などの分も含みます。
// 可食部のgをこちらへ置き換えず、個数は用意する際の大まかな見当としてだけ添えます。
const FOOD_UNITS = Object.freeze({
  lettuce:{grams:30,unit:'枚',kind:'leaf'},cabbage:{grams:50,unit:'枚',kind:'leaf'},
  onion:{grams:200,unit:'個'},carrot:{grams:150,unit:'本'},cucumber:{grams:100,unit:'本'},
  tomato:{grams:200,unit:'個'},potato:{grams:150,unit:'個'},broccoli:{grams:15,unit:'房'},
  shiitake:{grams:10,unit:'枚',state:'軸を除いたかさ'},shimeji:{grams:100,unit:'パック'},
  enoki:{grams:100,unit:'袋'},maitake:{grams:100,unit:'パック'},
  spinach:{grams:200,unit:'束'},komatsuna:{grams:300,unit:'束'},bean_sprouts:{grams:250,unit:'袋'},
  garlic:{grams:8,unit:'かけ'},ginger:{grams:12,unit:'かけ'},
});
// g/mlは混同しません。gで登録した食塩と上白糖等だけに、それぞれの重量換算を使います。
const SPOONS = Object.freeze({salt:{unit:'g',small:6},sugar:{unit:'g',small:3},miso:{unit:'g',small:6},
  oil:{unit:'ml',small:5},olive_oil:{unit:'ml',small:5},sesame_oil:{unit:'ml',small:5},
  soy_sauce:{unit:'ml',small:5},vinegar:{unit:'ml',small:5},sake:{unit:'ml',small:5},mirin:{unit:'ml',small:5}});
const fractions = [.125,.25,1/3,.5,2/3,.75,1,1.5,2,3,4,5,6,8,10];
function foodUnitNote(id,amount) {
  if (id === 'shrimp') return amount >= 15 && amount <= 100 ? '数尾・大きさで調整' : '尾数は大きさで調整';
  const guide=FOOD_UNITS[id];if(!guide)return '';
  const count=amount/guide.grams;
  if(guide.kind==='leaf') {
    if(count >=.75 && count <=1.25)return '1枚前後';
    if(count >=.35 && count <.75)return '半枚程度';
    const number=Math.round(count);return number>=2&&Math.abs(count-number)<=.3 ? `約${number}枚` : '';
  }
  const closest=fractions.reduce((best,value)=>Math.abs(value-count)<Math.abs(best-count)?value:best,fractions[0]);
  if(Math.abs(closest-count)/count>.2)return '';
  const countText=closest===.5?'半':fraction(closest);
  return `${countText}${guide.unit}程度`;
}
function spoonNote(id,amount,unit) {
  const spoon=SPOONS[id];if(!spoon||spoon.unit!==unit||amount===0)return '';
  const small=amount/spoon.small,large=small/3;
  const choices=[{unit:'小さじ',count:small},{unit:'大さじ',count:large}];
  for(const choice of choices){
    const value=Math.round(choice.count*4)/4;
    if(value<.25||value>3||Math.abs(value-choice.count)/choice.count>.15)continue;
    const whole=Math.floor(value),remainder=clean(value-whole);
    const label = remainder===0?format(whole):whole?`${whole}と${fraction(remainder)}`:fraction(remainder);
    return `${choice.unit}${label}程度`;
  }
  return '';
}

function roundedCookingAmount(id,amount,unit) {
  if (amount===0)return {value:0,text:'0'};
  if (unit!=='g'&&unit!=='ml')return {value:amount,text:format(amount)};
  if(amount<.1)return {value:amount,text:'0.1未満'};
  const fine = SPOONS[id]?.unit===unit;
  const step = fine&&amount<20?.1:amount>=100?10:amount>=20?5:amount>=5?.5:.1;
  const value=clean(Math.max(step,Math.round(amount/step)*step));
  return {value,text:format(value)};
}

/** 材料の表示と根拠を分離し、ヘルプや出典表示からも使えるようにします。 */
export function cookingIngredientGuide(id, exactAmount, data, {name,unit}={}) {
  if(!validAmount(exactAmount))throw Error('材料の量を確認してください。');
  const ingredient=data?.ingredients?.[id],selectedUnit=unit??ingredient?.unit;
  const selectedName=name??ingredient?.name??id;
  if(typeof selectedUnit!=='string'||!selectedUnit)return {id,name:selectedName,amountText:`${format(exactAmount)}（単位未登録）`,text:`${selectedName} ${format(exactAmount)}（単位未登録）`,exactAmount,unit:null,sourceIds:[]};
  const rounded=roundedCookingAmount(id,exactAmount,selectedUnit);
  const changed=!close(rounded.value,exactAmount)||exactAmount>0&&exactAmount<.1;
  const tiny=exactAmount>0&&exactAmount<.1;
  const amountText=tiny?`0.1${selectedUnit}未満（ごく少量）`:`${changed?'約':''}${rounded.text}${selectedUnit}`;
  const note=selectedUnit==='g'?foodUnitNote(id,rounded.value):'';
  const spoon=tiny?'':spoonNote(id,rounded.value,selectedUnit);
  const unitNote=note||spoon;
  const label=amountText+(unitNote?`（${unitNote}）`:'');
  return {id,name:selectedName,amountText:label,text:`${selectedName} ${label}`,exactAmount,roundedAmount:rounded.value,unit:selectedUnit,
    sourceIds:[...(FOOD_UNITS[id]?['ingredients']:[]),...(id==='shrimp'?['shrimp']:[]),...(SPOONS[id]?['spoons','measuring']:[])]};
}

export function formatCookingIngredient(id,exactAmount,data,options={}) {
  const guide=cookingIngredientGuide(id,exactAmount,data,options);
  return options.includeName===false?guide.amountText:guide.text;
}

/** 購入目安は不足しない方向へ切り上げます。包装数や合算値そのものは変更しません。 */
export function formatPurchaseAmount(value,unit) {
  if(!validAmount(value)||typeof unit!=='string'||!unit)throw Error('購入量と単位を確認してください。');
  if(value===0)return `0${unit}`;
  if(unit!=='g'&&unit!=='ml')return `${format(value)}${unit}`;
  const step=value>=20?5:value>=1?1:.1;
  const rounded=clean(Math.ceil((value-1e-10)/step)*step);
  return `${close(rounded,value)?'':'約'}${format(Math.max(step,rounded))}${unit}`;
}
