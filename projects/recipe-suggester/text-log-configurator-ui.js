/** 文章入力の1行を組み立てる画面。ここでは記録を保存しません。 */
import {foodComposerFor, defaultFoodSelection} from './food-composer.js';
import {mountFoodComposer} from './food-composer-ui.js';
import {DISH_CUSTOMISERS, defaultDishSelection} from './dish-customisation.js';
import {mountDishCustomiser} from './dish-customisation-ui.js';
import {meatChoiceFor, defaultMeatSelection} from './meat-choices.js';
import {mountMeatChoice} from './meat-choices-ui.js';
import {noodleComposerFor, defaultNoodleSelection} from './noodle-composer.js';
import {mountNoodleComposer} from './noodle-composer-ui.js';
import {curryRiceFor, defaultCurryRiceSelection} from './curry-rice.js';
import {mountCurryRice} from './curry-rice-ui.js';
import {SALAD_COMPONENTS} from './salad-builder.js';
import {mountSaladBuilder} from './salad-builder-ui.js';
import {soupIntakeFor} from './soup-intake.js';
import {mountSoupIntake} from './soup-intake-ui.js';
import {getVariationGroup, variantLabel} from './menu-variations.js';
import {recipePortion} from './catalog.js';
import {recipeNutrition, NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {deriveRecipeBasis} from './nutrition-basis.js';

let sequence=0;
const clone=value=>structuredClone(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const dishFor=id=>DISH_CUSTOMISERS.find(definition=>definition.recipeIds.includes(id));
const recipeFor=(id,data)=>data?.recipes?.find(recipe=>recipe.id===id);
const newId=()=>`custom-text-config-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function definitionFor(id,data){
  if(noodleComposerFor(id))return {kind:'noodle'};
  if(curryRiceFor(id,data))return {kind:'curry'};
  const food=foodComposerFor(id);if(food)return {kind:'food',definition:food};
  if(id==='familiar-side-raw-vegetable')return {kind:'salad'};
  const dish=dishFor(id);if(dish)return {kind:'dish',definition:dish};
  if(meatChoiceFor(id))return {kind:'meat'};
  return {kind:'plain'};
}

/** 個数・材料・肉・麺・ご飯・汁の選択や、同じ料理の種類を持つ入口だけを対象にします。 */
export function canConfigureTextRecipe(recipeId,data){
  const recipe=recipeFor(recipeId,data);if(!recipe)return false;
  try{return definitionFor(recipeId,data).kind!=='plain'||Boolean(soupIntakeFor(recipe,data))||(getVariationGroup(recipeId,data.recipes)?.recipes.length??0)>1;}
  catch{return false;}
}

function standardSelection(id,data){
  const {kind,definition}=definitionFor(id,data),source=recipeFor(id,data);
  if(kind==='food')return defaultFoodSelection(definition.kind,{recipeId:id});
  if(kind==='dish')return defaultDishSelection(definition.kind);
  if(kind==='meat')return defaultMeatSelection(id);
  if(kind==='noodle')return defaultNoodleSelection(id);
  if(kind==='curry')return defaultCurryRiceSelection(id,data);
  if(kind==='salad')return {components:source.ingredients.map(part=>({id:SALAD_COMPONENTS.find(component=>component.ingredientId===part.id)?.id,amount:part.amount/source.servings})).filter(part=>part.id),dressingId:'none',dressingAmount:0};
  return null;
}

function onePortion(recipe,data){
  if(!recipe||!Number.isFinite(recipe.servings)||recipe.servings<=0)throw Error('料理の人数と材料を確認してください。');
  const result={...clone(recipe),id:recipe.custom&&/^custom-/.test(recipe.id)?recipe.id:newId(),servings:1,custom:true,
    ingredients:recipe.ingredients.map(part=>({id:part.id,amount:part.amount/recipe.servings})),
    manualNutrition:recipeNutrition(recipe,data),portion:clone(recipePortion(recipe,data)),nutritionBasis:deriveRecipeBasis(recipe,data)};
  delete result.textConfiguration;
  return result;
}

/**
 * textConfiguration は再編集用の一時情報です。呼出元は記録用snapshotと分けて保持します。
 * 各widgetが検証した選択値だけを引き継ぎ、保存やカレンダー変更は行いません。
 */
export function mountTextRecipeConfigurator({recipeId,data,initialRecipe,onChange=()=>{},onError=()=>{}}={}){
  if(!recipeFor(recipeId,data)||typeof onChange!=='function'||typeof onError!=='function')throw Error('具材を選ぶ料理と表示処理を確認してください。');
  if(!canConfigureTextRecipe(recipeId,data))throw Error('この料理には種類や具材の選択がありません。');
  const root=make('section','text-recipe-configurator');root.setAttribute('aria-label','この行の料理の詳細');
  const original=definitionFor(recipeId,data),group=original.kind==='food'?null:getVariationGroup(recipeId,data.recipes);
  const variants=group?.recipes.length>1?group.recipes:[recipeFor(recipeId,data)];
  let selectedId=recipeId;
  const drafts=new Map(),retained=new Map();
  const saved=initialRecipe?.textConfiguration;
  if(saved!==undefined){
    if(!record(saved)||Object.keys(saved).some(key=>!['recipeId','kind','selection','soupSelection'].includes(key))||typeof saved.recipeId!=='string')throw Error('前に選んだ具材の内容を確認してください。');
    if(saved.kind==='plain'?saved.selection!==null:!record(saved.selection))throw Error('前に選んだ具材の入力内容を確認してください。');
    if(saved.soupSelection!==undefined&&(!record(saved.soupSelection)||Object.keys(saved.soupSelection).some(key=>!['brothRatio','solidRatio'].includes(key))||['brothRatio','solidRatio'].some(key=>typeof saved.soupSelection[key]!=='number'||!Number.isFinite(saved.soupSelection[key])||saved.soupSelection[key]<0||saved.soupSelection[key]>1)))throw Error('前に選んだ汁と具の割合を確認してください。');
    const target=recipeFor(saved.recipeId,data),sameFood=original.kind==='food'&&foodComposerFor(saved.recipeId)?.kind===original.definition.kind;
    if(!target||!sameFood&&!variants.some(recipe=>recipe.id===saved.recipeId)||saved.kind!==definitionFor(saved.recipeId,data).kind)throw Error('前に選んだ料理の種類が一致しません。');
    selectedId=saved.recipeId;drafts.set(selectedId,clone(saved));
  }else if(initialRecipe?.custom===true){retained.set(selectedId,clone(initialRecipe));}
  let variantSelect=null;
  if(variants.length>1){
    const label=make('label','detail-variation-label','料理の種類');variantSelect=make('select','text-config-variant');variantSelect.id=`text-config-variant-${++sequence}`;label.htmlFor=variantSelect.id;
    for(const recipe of variants){const option=make('option','',variantLabel(recipe));option.value=recipe.id;variantSelect.append(option);}
    variantSelect.value=selectedId;label.append(variantSelect);root.append(label);
    variantSelect.addEventListener('change',()=>{selectedId=variantSelect.value;render();});
  }
  const content=make('div','text-config-content'),error=make('p','text-log-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');root.append(content,error);
  const problem=message=>{error.textContent=message??'';error.hidden=!message;onError(message??'');};
  function preview(recipe){
    const box=make('div','food-composer-preview'),nutrition=recipeNutrition(recipe,data),metrics=make('dl','food-composer-nutrients');
    box.append(make('h3','',recipe.name));
    for(const key of NUTRIENT_KEYS){const metric=make('div','food-composer-nutrient');metric.append(make('dt','food-composer-nutrient-label',NUTRIENT_LABELS[key]),make('dd','food-composer-nutrient-value',nutrition[key]===null?'不明':`${Number(nutrition[key].toFixed(3)).toLocaleString('ja-JP')} ${NUTRIENT_UNITS[key]}`));metrics.append(metric);}
    const parts=make('ul');for(const part of recipe.ingredients)parts.append(make('li','',`${data.ingredients[part.id]?.name??part.id} ${Number((part.amount/recipe.servings).toFixed(3))}${data.ingredients[part.id]?.unit??''}`));
    box.append(make('p','field-note','表示は1人分です。食べる全体量は、元の行の数量欄で指定します。'),metrics,parts);return box;
  }
  function resetButton(){const reset=make('button','button-secondary text-config-reset','標準の内容から選び直す');reset.type='button';reset.addEventListener('click',()=>{drafts.delete(selectedId);retained.delete(selectedId);render();});return reset;}
  function render(){
    content.replaceChildren();problem('');onChange(null);
    const source=recipeFor(selectedId,data);if(!source){problem('料理が見つかりません。');return;}
    if(retained.has(selectedId)){
      const prior=retained.get(selectedId);content.append(make('p','field-note','前に確定した内容を保持しています。再編集情報がないため、変更する場合は標準の内容から選び直してください。'),preview(prior),resetButton());onChange(onePortion(prior,data));return;
    }
    const descriptor=definitionFor(selectedId,data),prior=drafts.get(selectedId);
    let selection=prior?clone(prior.selection):standardSelection(selectedId,data),soupSelection=prior?.soupSelection?clone(prior.soupSelection):{brothRatio:1,solidRatio:1};
    let currentBase=null,soupWidget=null,constructing=true;
    const soupSlot=make('div','text-config-soup');
    const emit=recipe=>{
      if(!recipe){onChange(null);return;}
      const result=onePortion(recipe,data),metadata={recipeId:selectedId,kind:descriptor.kind,selection:clone(selection)};
      if(soupWidget)metadata.soupSelection=clone(soupSelection);
      drafts.set(selectedId,clone(metadata));result.textConfiguration=metadata;onChange(result);
    };
    const receiveBase=recipe=>{
      currentBase=recipe;if(constructing)return;
      if(!recipe){soupSlot.hidden=true;emit(null);return;}
      if(soupIntakeFor(recipe,data)){
        soupSlot.hidden=false;
        if(soupWidget){soupWidget.setBaseRecipe(recipe);return;}
        constructing=true;let firstSoup=null;
        soupWidget=mountSoupIntake({baseRecipe:recipe,data,initial:soupSelection,onSelectionChange:config=>{if(config)soupSelection=config;},onChange:value=>{firstSoup=value;if(!constructing)emit(value);},onError:problem});
        soupSlot.replaceChildren(soupWidget);constructing=false;emit(firstSoup);return;
      }
      soupSlot.hidden=true;soupWidget=null;soupSlot.replaceChildren();emit(recipe);
    };
    const callbacks={onSelectionChange:config=>{selection=config===null?null:clone(config);},onChange:receiveBase,onError:problem};
    try{
      let builder=null;
      if(descriptor.kind==='food')builder=mountFoodComposer({kind:descriptor.definition.kind,data,initial:selection,...callbacks});
      else if(descriptor.kind==='dish')builder=mountDishCustomiser({kind:descriptor.definition.kind,data,initial:selection,...callbacks});
      else if(descriptor.kind==='meat')builder=mountMeatChoice({recipeId:selectedId,data,initial:selection,...callbacks});
      else if(descriptor.kind==='noodle')builder=mountNoodleComposer({recipeId:selectedId,data,initial:selection,...callbacks});
      else if(descriptor.kind==='curry')builder=mountCurryRice({recipeId:selectedId,data,initial:selection,...callbacks});
      else if(descriptor.kind==='salad')builder=mountSaladBuilder({data,initial:selection,...callbacks});
      else {currentBase=source;builder=preview(source);}
      content.append(builder,soupSlot);constructing=false;
      // mountSoupIntake calls onChange during construction, before its handle is assigned.
      if(currentBase&&soupIntakeFor(currentBase,data)){
        constructing=true;let firstSoup=null;
        soupWidget=mountSoupIntake({baseRecipe:currentBase,data,initial:soupSelection,onSelectionChange:config=>{if(config)soupSelection=config;},onChange:recipe=>{firstSoup=recipe;if(!constructing)emit(recipe);},onError:problem});
        soupSlot.replaceChildren(soupWidget);constructing=false;emit(firstSoup);
      }else {
        if(prior?.soupSelection!==undefined)throw Error('この料理は前に選んだ汁と具の割合に対応していません。');
        receiveBase(currentBase);
      }
    }catch(cause){constructing=false;onChange(null);problem(cause.message);content.append(resetButton());}
  }
  render();return root;
}
