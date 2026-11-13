/** 種類・具材と量を選ぶ共通画面。配合・検証はfood-composer.jsが担当します。 */
import {availableFoodComponents, buildFoodSelection, defaultFoodSelection, foodComposerDefinition} from './food-composer.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';

let composerCount=0;
const rounded=value=>Number(value.toFixed(2)).toLocaleString('ja-JP');
const normalise=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP');
const make=(tag,className='',text='')=>{
  const element=document.createElement(tag);element.className=className;
  if(text)element.textContent=text;
  return element;
};

/** formを作らないため、カレンダー登録のformと入れ子になりません。 */
export function mountFoodComposer({kind,data,initial,onChange=()=>{},onError=()=>{},allowedRecipeIds}={}){
  if(typeof onChange!=='function'||typeof onError!=='function')throw Error('選択画面の表示処理を確認してください。');
  const definition=foodComposerDefinition(kind),selection=initial??defaultFoodSelection(kind);
  if(selection.kind!==kind)throw Error('選択する料理の種類を確認してください。');
  const first=buildFoodSelection(selection,data),recipeId=first.id;
  const components=availableFoodComponents(kind,data,{allowedRecipeIds});
  if(selection.components.some(part=>!components.some(component=>component.id===part.id)))throw Error('初期値に選択できない種類が含まれています。');
  const amounts=new Map(selection.components.map(part=>[part.id,part.amount]));
  const prefix=`food-composer-${++composerCount}`,root=make('div','food-composer');
  root.setAttribute('role','group');root.setAttribute('aria-label',`${definition.label}の種類と量`);root.setAttribute('data-composer-kind',kind);
  root.append(make('h3','food-composer-heading','種類と量を選ぶ'),make('p','food-composer-intro',definition.intro));
  const tools=make('div','food-composer-tools'),searchLabel=make('label','food-composer-search-label','種類を絞り込む');
  const search=make('input','food-composer-search');search.id=`${prefix}-search`;search.type='search';search.placeholder='具材や種類を検索';
  search.setAttribute('aria-label','組み合わせる種類を検索');searchLabel.htmlFor=search.id;searchLabel.append(search);
  const reset=make('button','button-secondary food-composer-reset','最初の組み合わせに戻す');reset.type='button';tools.append(searchLabel,reset);root.append(tools);
  const sections=new Map(),controls=[];
  for(const component of components){
    if(!sections.has(component.section)){
      const fieldset=make('fieldset','food-composer-section'),grid=make('div','food-composer-grid');
      fieldset.append(make('legend','food-composer-legend',component.section),grid);root.append(fieldset);sections.set(component.section,{fieldset,grid});
    }
    const row=make('div','food-composer-option'),label=make('label','food-composer-choice'),checked=make('input','food-composer-check');
    checked.type='checkbox';checked.id=`${prefix}-${component.id}-checked`;checked.checked=amounts.has(component.id);checked.disabled=component.base===true;
    label.htmlFor=checked.id;label.append(checked,make('span','food-composer-name',component.label));
    const amountLabel=make('label','food-composer-amount-label'),amount=make('input','food-composer-amount');
    amount.type='number';amount.id=`${prefix}-${component.id}-amount`;amount.min=component.food===false?'0':'0.1';amount.max=String(component.maxAmount??(['g','ml'].includes(component.unit)?1000:50));amount.step=['g','ml'].includes(component.unit)?'any':'0.5';
    amount.value=String(amounts.get(component.id)??component.defaultAmount);amount.disabled=!checked.checked||component.base===true;
    amount.setAttribute('aria-label',`${component.label}の量（${component.unit}）`);amountLabel.htmlFor=amount.id;amountLabel.append(amount,make('span','food-composer-unit',component.unit));
    row.append(label,amountLabel);if(component.note)row.append(make('small','food-composer-note',component.note));
    if(component.base)row.append(make('small','food-composer-note','ベースは1個分。複数個や半分は、登録する皿の量で調整できます。'));
    controls.push({component,row,checked,amount});sections.get(component.section).grid.append(row);
    checked.addEventListener('change',()=>{amount.disabled=!checked.checked||component.base===true;update();});amount.addEventListener('input',update);
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
  search.addEventListener('input',()=>{
    const query=normalise(search.value).trim();
    for(const control of controls)control.row.hidden=Boolean(query)&&!normalise(`${control.component.label} ${control.component.section}`).includes(query);
    for(const section of sections.values())section.fieldset.hidden=controls.filter(control=>control.component.section===section.fieldset.children[0].textContent).every(control=>control.row.hidden);
  });
  reset.addEventListener('click',()=>{
    search.value='';
    for(const section of sections.values())section.fieldset.hidden=false;
    for(const control of controls){control.row.hidden=false;control.checked.checked=amounts.has(control.component.id);control.amount.value=String(amounts.get(control.component.id)??control.component.defaultAmount);control.amount.disabled=!control.checked.checked||control.component.base===true;}
    update();
  });
  function update(){
    for(const control of controls)control.row.className=`food-composer-option${control.checked.checked?' is-selected':''}`;
    try{
      const selected=[];
      for(const control of controls.filter(control=>control.checked.checked)){
        if(String(control.amount.value).trim()==='')throw Error(`${control.component.label}の量を入力してください。`);
        const amount=Number(control.amount.value);
        // 飲まない汁・使わないソースは0も指定できます。空欄とは区別します。
        if(amount===0&&control.component.food===false)continue;
        selected.push({id:control.component.id,amount});
      }
      const recipe=buildFoodSelection({id:recipeId,kind,components:selected},data);
      title.textContent=`${recipe.name} / 1皿`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=recipe.manualNutrition[key]===null?'未入力':`${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels=recipe.allergens.map(id=>data.allergens?.find(allergen=>allergen.id===id)?.label??id);
      allergies.textContent=recipe.allergensKnown?`含まれる登録アレルゲン：${labels.length?labels.join('、'):'登録なし'}。商品の原材料も確認してください。`:'購入品などの原材料・アレルギー情報は未確認です。実物の商品表示を確認してください。';
      source.textContent=recipe.sourceNote;
      materialList.replaceChildren(...recipe.ingredients.map(part=>make('li','food-composer-material',`${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      stepList.replaceChildren(...recipe.steps.map(step=>make('li','food-composer-step',step)));
      error.textContent='';error.hidden=true;preview.hidden=false;onError('');onChange(recipe);
    }catch(cause){error.textContent=cause.message;error.hidden=false;preview.hidden=true;onChange(null);onError(cause.message);}
  }
  update();return root;
}
