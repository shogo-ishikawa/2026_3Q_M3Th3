/** 種類・具材と量を選ぶ共通画面。配合・検証はfood-composer.jsが担当します。 */
import {availableFoodComponents, availableFoodPresets, buildFoodSelection, defaultFoodSelection, foodComposerDefinition, foodPresetSelection, matchingFoodPreset} from './food-composer.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

let composerCount=0;
const rounded=value=>Number(value.toFixed(2)).toLocaleString('ja-JP');
const normalise=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP');
const make=(tag,className='',text='')=>{
  const element=document.createElement(tag);element.className=className;
  if(text)element.textContent=text;
  return element;
};

/** formを作らないため、カレンダー登録のformと入れ子になりません。 */
export function mountFoodComposer({kind,data,initial,onChange=()=>{},onSelectionChange=()=>{},onError=()=>{},allowedRecipeIds}={}){
  if(typeof onChange!=='function'||typeof onSelectionChange!=='function'||typeof onError!=='function')throw Error('選択画面の表示処理を確認してください。');
  const definition=foodComposerDefinition(kind),selection=initial??defaultFoodSelection(kind);
  if(selection.kind!==kind)throw Error('選択する料理の種類を確認してください。');
  const first=buildFoodSelection(selection,data),recipeId=first.id;
  const components=availableFoodComponents(kind,data,{allowedRecipeIds});
  if(selection.components.some(part=>!components.some(component=>component.id===part.id)))throw Error('初期値に選択できない種類が含まれています。');
  const amounts=new Map(selection.components.map(part=>[part.id,part.amount]));
  const weights=new Map(selection.components.filter(part=>Object.hasOwn(part,'gramsPerUnit')).map(part=>[part.id,part.gramsPerUnit]));
  const prefix=`food-composer-${++composerCount}`,root=make('div','food-composer');
  root.setAttribute('role','group');root.setAttribute('aria-label',`${definition.label}の種類と量`);root.setAttribute('data-composer-kind',kind);
  root.append(make('h3','food-composer-heading','種類と量を選ぶ'),make('p','food-composer-intro',definition.intro));
  const presets=availableFoodPresets(kind,data,{allowedRecipeIds});let presetSelect=null;
  if(presets.length){
    const label=make('label','food-composer-preset-label','最初の組み合わせ'),select=make('select','food-composer-preset');
    select.id=`${prefix}-preset`;label.htmlFor=select.id;
    const edited=make('option','','具材・量を調整中');edited.value='';edited.disabled=true;select.append(edited);
    for(const preset of presets){const option=make('option','',preset.label);option.value=preset.id;select.append(option);}
    select.value=matchingFoodPreset(kind,selection)?.id??'';label.append(select);root.append(label,
      make('p','food-composer-preset-note','組み合わせを選ぶと具材と量が標準量に切り替わります。その後でチェックや数量を変えられます。「具材を指定する」はパンだけから始めます。'));
    presetSelect=select;
  }
  const tools=make('div','food-composer-tools'),searchLabel=make('label','food-composer-search-label','種類を絞り込む');
  const search=make('input','food-composer-search');search.id=`${prefix}-search`;search.type='search';search.placeholder='具材や種類を検索';
  search.setAttribute('aria-label','組み合わせる種類を検索');searchLabel.htmlFor=search.id;searchLabel.append(search);
  const reset=make('button','button-secondary food-composer-reset',presets.length?'選んだ組み合わせに戻す':'最初の組み合わせに戻す');reset.type='button';tools.append(searchLabel,reset);root.append(tools);
  const sections=new Map(),controls=[];
  for(const component of components){
    if(!sections.has(component.section)){
      const fieldset=make('fieldset','food-composer-section'),grid=make('div','food-composer-grid');
      fieldset.append(make('legend','food-composer-legend',component.section),grid);root.append(fieldset);sections.set(component.section,{fieldset,grid});
    }
    const row=make('div','food-composer-option'),label=make('label','food-composer-choice'),checked=make('input','food-composer-check');
    const multipleBases=components.filter(part=>part.base).length>1;
    checked.type=component.base&&multipleBases?'radio':'checkbox';if(component.base&&multipleBases)checked.name=`${prefix}-base`;
    checked.id=`${prefix}-${component.id}-checked`;checked.checked=(amounts.get(component.id)??0)>0;checked.disabled=component.base===true&&!multipleBases;
    label.htmlFor=checked.id;label.append(checked,make('span','food-composer-name',component.label));
    const amountLabel=make('label','food-composer-amount-label'),amount=make('input','food-composer-amount');
    amount.type='number';amount.id=`${prefix}-${component.id}-amount`;amount.min='0';amount.max=String(component.maxAmount??(['g','ml'].includes(component.unit)?1000:50));amount.step='any';
    amount.value=String(amounts.get(component.id)??component.defaultAmount);amount.disabled=!checked.checked||component.base===true;
    amount.setAttribute('aria-label',`${component.label}の量（${component.unit}）`);amountLabel.htmlFor=amount.id;amountLabel.append(amount,make('span','food-composer-unit',component.unit));
    row.append(label,amountLabel);
    let weight=null,weightTotal=null;
    if(component.gramsPerUnit!==undefined){
      const weightRow=make('div','food-composer-note food-composer-weight'),weightLabel=make('label','food-composer-weight-label',`1${component.unit}の重さ`);
      weight=make('input','food-composer-amount food-composer-weight-input');weight.type='number';weight.id=`${prefix}-${component.id}-weight`;
      weight.min='0';weight.max='500';weight.step='any';weight.value=String(weights.get(component.id)??component.gramsPerUnit);weight.disabled=!checked.checked;
      weight.setAttribute('aria-label',`${component.label}の1${component.unit}の重さ（g）`);weightLabel.htmlFor=weight.id;weightLabel.append(weight,make('span','','g'));
      weightTotal=make('span','food-composer-weight-total');weightRow.append(weightLabel,weightTotal);row.append(weightRow);weight.addEventListener('input',update);
    }
    if(component.note)row.append(make('small','food-composer-note',component.note));
    if(component.base)row.append(make('small','food-composer-note','ベースは1個分。複数個や半分は、登録する皿の量で調整できます。'));
    const control={component,row,checked,amount,weight,weightTotal,lastPositive:Number(amount.value)>0?amount.value:String(component.defaultAmount)};controls.push(control);sections.get(component.section).grid.append(row);
    configureQuantityInput(amount);if(weight)configureQuantityInput(weight);
    checked.addEventListener('change',()=>{
      if(component.base&&checked.checked)for(const other of controls.filter(other=>other.component.base&&other!==control)){other.checked.checked=false;other.amount.disabled=true;}
      if(checked.checked){try{if(readQuantityInput(amount)<=0)amount.value=control.lastPositive;}catch{amount.value=control.lastPositive;}}
      amount.disabled=!checked.checked||component.base===true;if(weight)weight.disabled=!checked.checked;update();
    });
    amount.addEventListener('input',()=>{
      try{
        const value=readQuantityInput(amount,{label:`${component.label}の量`});
        if(value===0&&component.base!==true){checked.checked=false;amount.disabled=true;if(weight)weight.disabled=true;}
        else if(value>0)control.lastPositive=amount.value;
      }catch{/* 空欄・不正値を0として選択解除しません。updateで登録を止めます。 */}
      update();
    });
  }
  const error=make('p','food-composer-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  const preview=make('div','food-composer-preview'),title=make('p','food-composer-preview-title'),nutrients=make('dl','food-composer-nutrients'),values=new Map();
  for(const key of NUTRIENT_KEYS){
    const metric=make('div','food-composer-nutrient'),value=make('dd','food-composer-nutrient-value');
    metric.append(make('dt','food-composer-nutrient-label',NUTRIENT_LABELS[key]),value);nutrients.append(metric);values.set(key,value);
  }
  const allergies=make('p','food-composer-allergens'),source=make('p','food-composer-note'),materials=make('details','food-composer-materials'),materialList=make('ul','food-composer-material-list');
  materials.append(make('summary','','選んだ材料と分量'),materialList);
  const cooking=make('details','food-composer-cooking'),stepList=make('ol','food-composer-step-list');cooking.append(make('summary','','この組み合わせの作り方・用意のしかた'),stepList);
  preview.append(title,nutrients,allergies,source,materials,cooking);root.append(error,preview);
  presetSelect?.addEventListener('change',()=>{
    try{
      const config=foodPresetSelection(kind,presetSelect.value,{id:recipeId});
      buildFoodSelection(config,data);
      amounts.clear();weights.clear();
      for(const part of config.components){amounts.set(part.id,part.amount);if(Object.hasOwn(part,'gramsPerUnit'))weights.set(part.id,part.gramsPerUnit);}
      restoreBaseline();update();
    }catch(cause){error.textContent=cause.message;error.hidden=false;preview.hidden=true;onSelectionChange(null);onChange(null);onError(cause.message);}
  });
  search.addEventListener('input',()=>{
    const query=normalise(search.value).trim();
    for(const control of controls)control.row.hidden=Boolean(query)&&!normalise(`${control.component.label} ${control.component.section}`).includes(query);
    for(const section of sections.values())section.fieldset.hidden=controls.filter(control=>control.component.section===section.fieldset.children[0].textContent).every(control=>control.row.hidden);
  });
  reset.addEventListener('click',()=>{
    restoreBaseline();update();
  });
  function restoreBaseline(){
    search.value='';
    for(const section of sections.values())section.fieldset.hidden=false;
    for(const control of controls){control.row.hidden=false;control.checked.checked=(amounts.get(control.component.id)??0)>0;control.amount.value=String(amounts.get(control.component.id)??control.component.defaultAmount);control.lastPositive=Number(control.amount.value)>0?control.amount.value:String(control.component.defaultAmount);control.amount.disabled=!control.checked.checked||control.component.base===true;if(control.weight){control.weight.value=String(weights.get(control.component.id)??control.component.gramsPerUnit);control.weight.disabled=!control.checked.checked;}}
  }
  function update(){
    for(const control of controls){
      control.row.className=`food-composer-option${control.checked.checked?' is-selected':''}`;
      if(control.weightTotal){
        try{
          const grams=readQuantityInput(control.amount)*readQuantityInput(control.weight);
          control.weightTotal.textContent=control.checked.checked&&grams>0?`選択量：約${rounded(grams)}g`:'';
        }catch{control.weightTotal.textContent='';}
      }
    }
    try{
      const selected=[];
      for(const control of controls.filter(control=>control.checked.checked)){
        const amount=readQuantityInput(control.amount,{label:`${control.component.label}の量`});
        selected.push({id:control.component.id,amount,...(control.weight?{gramsPerUnit:readQuantityInput(control.weight,{label:`${control.component.label}の1${control.component.unit}の重さ`})}:{})});
      }
      const config={id:recipeId,kind,components:selected},recipe=buildFoodSelection(config,data);
      if(presetSelect){
        const matched=matchingFoodPreset(kind,config),baseline=matchingFoodPreset(kind,{kind,components:[...amounts].map(([id,amount])=>({id,amount,...(weights.has(id)?{gramsPerUnit:weights.get(id)}:{})}))});
        presetSelect.value=matched&&matched.id===baseline?.id?matched.id:'';
      }
      title.textContent=`${recipe.name} / 1皿`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=recipe.manualNutrition[key]===null?'未入力':`${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels=recipe.allergens.map(id=>data.allergens?.find(allergen=>allergen.id===id)?.label??id);
      allergies.textContent=recipe.allergensKnown?`含まれる登録アレルゲン：${labels.length?labels.join('、'):'登録なし'}。商品の原材料も確認してください。`:'購入品などの原材料・アレルギー情報は未確認です。実物の商品表示を確認してください。';
      source.textContent=recipe.sourceNote;
      materialList.replaceChildren(...recipe.ingredients.map(part=>make('li','food-composer-material',`${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      stepList.replaceChildren(...recipe.steps.map(step=>make('li','food-composer-step',step)));
      error.textContent='';error.hidden=true;preview.hidden=false;onError('');onSelectionChange(structuredClone(config));onChange(recipe);
    }catch(cause){error.textContent=cause.message;error.hidden=false;preview.hidden=true;onSelectionChange(null);onChange(null);onError(cause.message);}
  }
  update();return root;
}
