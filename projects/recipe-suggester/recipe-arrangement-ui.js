/** 元の材料の減量・削除・置き換えと食材追加の画面。 */
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {ARRANGEMENT_CATEGORIES, arrangementIngredientOptions, buildRecipeArrangement, ingredientAmountFromInput, arrangementBaseIngredients, arrangementEditAvailability} from './recipe-arrangement.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';

let arrangementCount=0;
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const labelFor=(text,input)=>{const label=make('label','arrangement-label',text);label.htmlFor=input.id;label.append(input);if(input.type==='number')configureQuantityInput(input);return label;};
const roles=[['staple','主食'],['main','主菜'],['side','副菜'],['soup','汁物'],['drink','飲み物'],['snack','間食']];

export function mountRecipeArrangement({baseRecipe=null,data,initial={},onChange=()=>{},onError=()=>{}}={}){
  if(typeof onChange!=='function'||typeof onError!=='function')throw Error('アレンジ画面の表示処理を確認してください。');
  const options=arrangementIngredientOptions(data),prefix=`recipe-arrangement-${++arrangementCount}`;
  const recipeId=initial.id??`custom-arrangement-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${arrangementCount}`}`;
  const selections=(initial.additions??[]).map(part=>({...part,amount:String(part.amount)}));
  const baseParts=arrangementBaseIngredients(baseRecipe,data),baseEdits=new Map((initial.ingredientEdits??[]).map(part=>[part.id,{...part,amount:String(part.amount)}])),availability=arrangementEditAvailability(baseRecipe,data);
  let replacing=null;
  const originalInputs=new Map(),additionInputs=[];
  const root=make('div','food-composer recipe-arrangement');root.setAttribute('role','group');root.setAttribute('aria-label',baseRecipe?'レシピの材料を編集・追加する':'オリジナルレシピを作る');
  root.append(make('h3','food-composer-heading',baseRecipe?'材料を編集・追加してアレンジ':'食材からオリジナルレシピを作る'),
    make('p','food-composer-intro',baseRecipe?'元の材料を減らす・削除する・別の食材へ替えることができます。入力はすべて1人分です。元のレシピと過去の記録を保ち、別の料理として記録・保存します。':'1皿（1人分）に使う食材と量を選びます。登録済みの栄養データから合計を計算します。'));
  const name=make('input','arrangement-name');name.type='text';name.id=`${prefix}-name`;name.maxLength=200;name.value=initial.name??(baseRecipe?`${baseRecipe.name.slice(0,193)}（アレンジ）`:'');name.required=true;
  root.append(labelFor('料理名',name));
  let role,steps;
  if(!baseRecipe){
    role=make('select','arrangement-role');role.id=`${prefix}-role`;
    for(const [id,label]of roles){const option=make('option','',label);option.value=id;role.append(option);}role.value=initial.role??'main';
    root.append(labelFor('料理の区分',role));
    steps=make('textarea','arrangement-steps');steps.id=`${prefix}-steps`;steps.rows=4;steps.value=(initial.steps??[]).join('\n');steps.placeholder='任意。作り方を1行に1工程ずつ入力';
    root.append(labelFor('作り方（任意）',steps));
  }
  const originalList=make('div','arrangement-original-list');
  if(baseRecipe){root.append(make('h4','arrangement-selected-title','元の材料（1人分）'));if(!availability.editable)root.append(make('p','arrangement-edit-note',availability.reason));root.append(originalList);}
  const picker=make('div','arrangement-picker'),category=make('select','arrangement-category');category.id=`${prefix}-category`;
  const all=make('option','','すべての食材');all.value='all';category.append(all);
  for(const item of ARRANGEMENT_CATEGORIES){const option=make('option','',item.label);option.value=item.id;category.append(option);}category.value='all';
  const search=make('input','arrangement-search');search.id=`${prefix}-search`;search.type='search';search.placeholder='肉・野菜・魚・調味料などを検索';search.value='';
  const choice=make('select','arrangement-choice');choice.id=`${prefix}-choice`;
  const amount=make('input','arrangement-amount');amount.id=`${prefix}-amount`;amount.type='number';amount.min='0.001';amount.max='10000';amount.step='any';amount.value='10';
  const amountLabel=labelFor('追加・置き換え量（1人分）',amount),unit=make('span','arrangement-input-unit','g');amountLabel.append(unit);
  const add=make('button','button-secondary arrangement-add','この食材を追加');add.type='button';
  picker.append(labelFor('食材カテゴリ',category),labelFor('食材を検索',search),labelFor('追加する食材',choice),amountLabel,add);
  const conversion=make('p','arrangement-conversion'),replacementNote=make('p','arrangement-replacement-note');replacementNote.hidden=true;const cancelReplacement=make('button','button-secondary arrangement-cancel-replacement','置き換えをやめる');cancelReplacement.type='button';cancelReplacement.hidden=true;cancelReplacement.addEventListener('click',()=>{replacing=null;describeReplacement();});picker.append(replacementNote,cancelReplacement,conversion);root.append(picker);
  const selected=make('div','arrangement-selected');root.append(make('h4','arrangement-selected-title','追加する食材と量'),selected);
  const error=make('p','food-composer-error arrangement-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  const preview=make('div','food-composer-preview arrangement-preview'),title=make('p','food-composer-preview-title'),nutrients=make('dl','food-composer-nutrients'),values=new Map();
  for(const key of NUTRIENT_KEYS){const metric=make('div','food-composer-nutrient'),value=make('dd','food-composer-nutrient-value');metric.append(make('dt','food-composer-nutrient-label',NUTRIENT_LABELS[key]),value);nutrients.append(metric);values.set(key,value);}
  const information=make('p','food-composer-note'),allergies=make('p','food-composer-allergens'),materials=make('details','food-composer-materials'),materialList=make('ul','food-composer-material-list');materials.append(make('summary','','この1皿の材料と買い物に使う量'),materialList);
  preview.append(title,nutrients,allergies,information,materials);root.append(error,preview);
  function problem(message){error.textContent=message;error.hidden=!message;onError(message);}
  function selectedOption(){return options.find(option=>option.id===choice.value);}
  function describeChoice(){
    const option=selectedOption();add.disabled=!option;amount.disabled=!option;
    if(!option){unit.textContent='';conversion.textContent=choice.children.length>1?'追加する食材を選んでください。選ぶと量の単位と換算の目安が表示されます。':'条件に合う食材がありません。検索やカテゴリを変えてください。';return;}
    unit.textContent=option.unit;amount.value=String(option.defaultAmount);
    conversion.textContent=option.unit==='g'?(option.nativeUnit==='g'?'食べる部分のg数を入力します。骨・皮など食べない部分は除いてください。':`gで入力し、材料と買い物の量は1${option.nativeUnit}＝約${rounded(option.gramsPerUnit)}gとして換算します。`):`この食材のg換算は未登録です。${option.nativeUnit}で入力してください。`;
  }
  function filterChoices(){
    const visible=options.filter(option=>(category.value==='all'||option.category===category.value)&&matchesJapaneseQuery([option.name],search.value));
    const placeholder=make('option','','食材を選んでください');placeholder.value='';placeholder.disabled=true;
    choice.replaceChildren(placeholder,...visible.map(item=>{const option=make('option','',item.name);option.value=item.id;return option;}));choice.value='';describeChoice();
  }
  function describeReplacement(){
    replacementNote.hidden=!replacing;cancelReplacement.hidden=!replacing;
    replacementNote.textContent=replacing?`${baseParts.find(part=>part.id===replacing).name}を、下で選ぶ食材と量に置き換えます。`:'';
    add.textContent=replacing?'この食材に置き換える':'この食材を追加';
  }
  function renderOriginals(){
    originalList.replaceChildren(...baseParts.map(part=>{
      const edit=baseEdits.get(part.id),target=edit?.replacementId??part.id,option=options.find(value=>value.id===target),quantity=edit?.amount??String(part.amount),currentUnit=edit?.unit??option.unit;
      const row=make('div','arrangement-selected-row arrangement-original-row'),input=make('input','arrangement-original-amount');input.type='number';input.min='0';input.max='10000';input.step='any';input.value=quantity;input.id=`${prefix}-original-${part.id}`;input.disabled=!availability.editable;originalInputs.set(part.id,input);
      input.setAttribute('aria-label',`${option.name}の使用量（${currentUnit}、1人分）`);
      const label=labelFor(option.name,input);label.append(make('span','arrangement-row-unit',currentUnit));
      const actions=make('div','arrangement-original-actions'),remove=make('button','button-secondary arrangement-original-remove','削除'),replace=make('button','button-secondary arrangement-original-replace','食材を替える'),restore=make('button','button-secondary arrangement-original-restore','元に戻す');
      for(const button of [remove,replace,restore]){button.type='button';button.disabled=!availability.editable;}
      restore.hidden=!edit;
      remove.setAttribute('aria-label',`元の材料の${option.name}を削除`);replace.setAttribute('aria-label',`${option.name}を別の食材に替える`);
      input.addEventListener('input',()=>{baseEdits.set(part.id,{id:part.id,...(target!==part.id?{replacementId:target}:{}),amount:input.value,unit:currentUnit});restore.hidden=false;update();});
      remove.addEventListener('click',()=>{baseEdits.set(part.id,{id:part.id,amount:'0',unit:part.unit});if(replacing===part.id){replacing=null;describeReplacement();}renderOriginals();update();});
      replace.addEventListener('click',()=>{replacing=part.id;describeReplacement();category.value='all';search.value='';filterChoices();choice.focus?.();});
      restore.addEventListener('click',()=>{baseEdits.delete(part.id);if(replacing===part.id){replacing=null;describeReplacement();}renderOriginals();update();});
      const note=make('small','arrangement-equivalent',edit?.amount==='0'?'この材料は使用しません。':`元の材料：${part.name} ${rounded(part.amount)}${part.unit}`);
      actions.append(remove,replace,restore);row.append(label,actions,note);return row;
    }));
  }
  function renderSelections(){
    if(!selections.length){selected.replaceChildren(make('p','arrangement-empty','食材を選び、量を入力して「この食材を追加」を押してください。'));return;}
    selected.replaceChildren(...selections.map((part,index)=>{
      const option=options.find(option=>option.id===part.id),row=make('div','arrangement-selected-row'),input=make('input','arrangement-added-amount');input.type='number';input.id=`${prefix}-selected-${index}`;input.min='0.001';input.max='10000';input.step='any';input.value=part.amount;additionInputs[index]=input;
      const rowUnit=part.unit??option?.unit??'g';input.setAttribute('aria-label',`${option?.name??part.id}の追加量（${rowUnit}）`);
      const amountLabel=labelFor(`${option?.name??part.id}`,input);amountLabel.append(make('span','arrangement-row-unit',rowUnit));
      const remove=make('button','button-secondary arrangement-remove','削除');remove.type='button';remove.setAttribute('aria-label',`追加した${option?.name??part.id}を削除`);
      const equivalent=make('small','arrangement-equivalent');
      function showEquivalent(){try{const value=ingredientAmountFromInput({id:part.id,amount:readQuantityInput(input,{label:'追加する食材の量'}),unit:rowUnit},data);equivalent.textContent=rowUnit!==value.nativeUnit?`材料・買い物への換算：約${rounded(value.amount)} ${value.nativeUnit}`:'';}catch{equivalent.textContent='';}}
      input.addEventListener('input',()=>{part.amount=input.value;showEquivalent();update();});
      remove.addEventListener('click',()=>{selections.splice(index,1);renderSelections();update();});row.append(amountLabel,remove,equivalent);showEquivalent();return row;
    }));
  }
  function update(){
    try{
      const additions=selections.map((part,index)=>({id:part.id,amount:readQuantityInput(additionInputs[index],{label:'追加する食材の量'}),...(part.unit?{unit:part.unit}:{})}));
      const ingredientEdits=[...baseEdits.values()].map(part=>({...part,amount:readQuantityInput(originalInputs.get(part.id),{label:'元の材料の量'})}));
      const recipe=buildRecipeArrangement({id:recipeId,baseRecipe,additions,ingredientEdits,name:name.value,...(!baseRecipe?{role:role.value,steps:steps.value.split('\n')}:{})},data);
      title.textContent=`${recipe.name} / 1皿（1人分）の合計`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=recipe.manualNutrition[key]===null?'不明':`${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels=recipe.allergens.map(id=>data.allergens?.find(item=>item.id===id)?.label??id);
      allergies.textContent=recipe.allergensKnown?`含まれる登録アレルゲン：${labels.length?labels.join('、'):'登録なし'}。`:'元の料理や追加食品の原材料・アレルギー情報には未確認の部分があります。実物の商品表示を確認してください。';
      information.textContent=recipe.sourceNote;materialList.replaceChildren(...recipe.ingredients.map(part=>make('li','food-composer-material',`${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      problem('');preview.hidden=false;onChange(recipe);
    }catch(cause){problem(cause.message);preview.hidden=true;onChange(null);}
  }
  add.addEventListener('click',()=>{
    try{
      const option=selectedOption();if(!option)throw Error('追加する食材を選んでください。');
      if(String(amount.value).trim()==='')throw Error('追加する食材の量を入力してください。');
      ingredientAmountFromInput({id:option.id,amount:readQuantityInput(amount,{label:'追加・置き換え量'}),unit:option.unit},data);
      if(replacing){baseEdits.set(replacing,{id:replacing,replacementId:option.id,amount:amount.value,unit:option.unit});replacing=null;describeReplacement();renderOriginals();update();return;}
      const existing=selections.find(part=>part.id===option.id&&(part.unit??option.unit)===option.unit);
      if(existing){if(!String(existing.amount).trim()||!Number.isFinite(Number(existing.amount)))throw Error('追加済みの食材の量を確認してください。');existing.amount=String(readQuantityInput(additionInputs[selections.indexOf(existing)],{label:'追加済みの食材の量'})+readQuantityInput(amount,{label:'追加する食材の量'}));}
      else selections.push({id:option.id,amount:amount.value,unit:option.unit});
      renderSelections();update();
    }catch(cause){problem(cause.message);preview.hidden=true;onChange(null);}
  });
  category.addEventListener('change',filterChoices);search.addEventListener('input',filterChoices);choice.addEventListener('change',describeChoice);
  name.addEventListener('input',update);role?.addEventListener('change',update);steps?.addEventListener('input',update);
  filterChoices();renderOriginals();renderSelections();update();return root;
}
