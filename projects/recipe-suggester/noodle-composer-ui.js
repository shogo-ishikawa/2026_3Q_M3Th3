/** 麺の量・追加の具・スープ摂取量を選ぶ画面。登録formは呼び出し側で作ります。 */
import {NOODLE_SOUP_INTAKES, buildNoodleSelection, defaultNoodleSelection, noodleComposerFor, noodleToppings} from './noodle-composer.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {matchesJapaneseQuery} from './japanese-search.js';

let count=0;
const rounded=value=>Number(value.toFixed(2)).toLocaleString('ja-JP');
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const labelFor=(title,input)=>{const label=make('label','noodle-field-label',title);label.htmlFor=input.id;label.append(input);return label;};

export function mountNoodleComposer({recipeId,data,initial,onChange=()=>{},onError=()=>{},allowedToppingIds}={}){
  if(typeof onChange!=='function'||typeof onError!=='function')throw Error('麺の選択画面の表示処理を確認してください。');
  const model=noodleComposerFor(recipeId),selection=initial??defaultNoodleSelection(recipeId);
  if(!model||selection.recipeId!==recipeId)throw Error('麺料理の初期設定を確認してください。');
  const first=buildNoodleSelection(selection,data),stableId=first.id,prefix=`noodle-composer-${++count}`;
  const available=noodleToppings(recipeId,data);
  if(allowedToppingIds!==undefined&&(!Array.isArray(allowedToppingIds)||allowedToppingIds.some(id=>!available.some(topping=>topping.id===id))))throw Error('選べるトッピングの種類を確認してください。');
  const toppings=allowedToppingIds===undefined?available:available.filter(topping=>allowedToppingIds.includes(topping.id));
  if(selection.toppings.some(part=>!toppings.some(topping=>topping.id===part.id)))throw Error('初期値に選べないトッピングがあります。');
  const selected=new Map(selection.toppings.map(part=>[part.id,part.amount]));
  const root=make('div','food-composer noodle-composer');root.setAttribute('role','group');root.setAttribute('aria-label',`${model.label}の麺とトッピング`);
  root.append(make('h3','food-composer-heading',model.soup.length?'麺・トッピング・スープ量を選ぶ':'麺とトッピングを選ぶ'),
    make('p','food-composer-intro',model.soup.length?'麺と固形の具は食べた量、スープは飲んだ割合で計算します。材料と買い物は、残すスープも含めて1杯を用意する量です。':'麺・具材・たれ・油を全量食べる想定です。麺の量と追加するトッピングを選んでください。'));
  const basics=make('div','noodle-basic-controls'),noodles=make('input','noodle-amount');noodles.type='number';noodles.id=`${prefix}-noodles`;noodles.min='0.1';noodles.max='2000';noodles.step='any';noodles.value=String(selection.noodleAmount??model.noodleAmount);
  noodles.setAttribute('aria-label','麺の量（g）');basics.append(labelFor('麺の量（g）',noodles));
  basics.append(make('p','food-composer-note noodle-noodle-basis',`麺の状態：${data.ingredients[model.noodleIngredientId].name}。表示した状態で量ります。`));
  let soup=null;
  if(model.soup.length){
    soup=make('select','noodle-soup-intake');soup.id=`${prefix}-soup`;soup.setAttribute('aria-label','飲んだスープの量');
    for(const intake of NOODLE_SOUP_INTAKES){
      const volume=Number.isFinite(model.soupVolumeMl)?`・基準量換算 約${rounded(model.soupVolumeMl*intake.fraction)}ml`:'';
      const option=make('option','',`${intake.label}（約${intake.fraction*100}%${volume}）`);option.value=intake.id;soup.append(option);
    }
    soup.value=selection.soupIntake??'full';basics.append(labelFor('飲んだスープの量',soup));
    basics.append(make('p','food-composer-note noodle-soup-note',`調味料を加える前のだし・水の基準量は1杯約${rounded(model.soupVolumeMl)}mlです。選択肢のmlはこの基準量からの換算値で、味噌や油などを加えると出来上がりの量は変わります。「絡む程度10%・少し25%・半分50%・ほとんど80%・完飲100%」は計算用の仮定です。油や塩分の残り方によって変わります。`));
  }else basics.append(make('p','food-composer-note noodle-soup-note','汁なしの料理です。たれと油は全量を食べるモデルで計算します。'));
  root.append(basics);
  const tools=make('div','food-composer-tools'),search=make('input','food-composer-search noodle-topping-search');search.type='search';search.id=`${prefix}-search`;search.placeholder='味玉・チャーシューなど';search.setAttribute('aria-label','追加トッピングを検索');
  const reset=make('button','button-secondary noodle-reset','最初の組み合わせに戻す');reset.type='button';tools.append(labelFor('トッピングを絞り込む',search),reset);root.append(tools);
  root.append(make('p','food-composer-note','ここでは追加する具材を選びます。基本の具材は、下の「調理する1杯の材料」で確認できます。トッピングと卓上にんにくは、スープを残しても選んだ全量を加算します。'));
  const fieldset=make('fieldset','food-composer-section'),grid=make('div','food-composer-grid');fieldset.append(make('legend','food-composer-legend','追加トッピング'),grid);root.append(fieldset);
  const controls=[];
  for(const topping of toppings){
    const row=make('div','food-composer-option'),check=make('input','noodle-topping-check');check.type='checkbox';check.id=`${prefix}-${topping.id}-checked`;check.checked=selected.has(topping.id);
    const name=make('label','food-composer-choice');name.htmlFor=check.id;name.append(check,make('span','food-composer-name',topping.label));
    const amount=make('input','food-composer-amount noodle-topping-amount');amount.id=`${prefix}-${topping.id}-amount`;amount.type='number';amount.min='.1';amount.max=String(['g','ml'].includes(topping.unit)?1000:50);amount.step='any';amount.value=String(selected.get(topping.id)??topping.defaultAmount??1);amount.disabled=!check.checked;amount.setAttribute('aria-label',`${topping.label}の量（${topping.unit}）`);
    const amountLabel=make('label','food-composer-amount-label');amountLabel.htmlFor=amount.id;amountLabel.append(amount,make('span','food-composer-unit',topping.unit));row.append(name,amountLabel);
    if(topping.note)row.append(make('small','food-composer-note',topping.note));
    controls.push({topping,row,check,amount});grid.append(row);
    check.addEventListener('change',()=>{amount.disabled=!check.checked;update();});amount.addEventListener('input',update);
  }
  const error=make('p','food-composer-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const preview=make('div','food-composer-preview noodle-preview'),title=make('p','food-composer-preview-title'),nutrition=make('dl','food-composer-nutrients'),values=new Map();
  for(const key of NUTRIENT_KEYS){const row=make('div','food-composer-nutrient'),value=make('dd','food-composer-nutrient-value');row.append(make('dt','food-composer-nutrient-label',NUTRIENT_LABELS[key]),value);nutrition.append(row);values.set(key,value);}
  const allergens=make('p','food-composer-allergens'),note=make('p','food-composer-note noodle-source-note');
  const materials=make('details','food-composer-materials'),parts=make('ul','food-composer-material-list');materials.append(make('summary','','調理する1杯の材料（買い物用）'),parts);
  const cooking=make('details','food-composer-cooking'),steps=make('ol','food-composer-step-list');cooking.append(make('summary','','この内容での作り方'),steps);
  const basis=make('details','food-composer-materials');basis.append(make('summary','','栄養の計算と出典'),note);
  preview.append(title,nutrition,allergens,basis,materials,cooking);root.append(error,preview);
  const filter=()=>{for(const control of controls)control.row.hidden=!matchesJapaneseQuery([control.topping.label,control.topping.note??''],search.value);};
  search.addEventListener('input',filter);noodles.addEventListener('input',update);soup?.addEventListener('change',update);
  reset.addEventListener('click',()=>{noodles.value=String(selection.noodleAmount??model.noodleAmount);if(soup)soup.value=selection.soupIntake??'full';search.value='';for(const control of controls){control.check.checked=selected.has(control.topping.id);control.amount.value=String(selected.get(control.topping.id)??control.topping.defaultAmount??1);control.amount.disabled=!control.check.checked;control.row.hidden=false;}update();});
  function update(){
    for(const control of controls)control.row.className=`food-composer-option${control.check.checked?' is-selected':''}`;
    try{
      if(String(noodles.value).trim()==='')throw Error('麺の量を入力してください。');
      const toppings=controls.filter(control=>control.check.checked).map(control=>{
        if(String(control.amount.value).trim()==='')throw Error(`${control.topping.label}の量を入力してください。`);
        return {id:control.topping.id,amount:Number(control.amount.value)};
      });
      const recipe=buildNoodleSelection({id:stableId,recipeId,noodleAmount:Number(noodles.value),soupIntake:soup?.value??'none',toppings},data);
      title.textContent=`${recipe.name} / 1杯分`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=recipe.manualNutrition[key]===null?'未入力':`${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const names=recipe.allergens.map(id=>data.allergens?.find(item=>item.id===id)?.label??id);
      allergens.textContent=recipe.allergensKnown?`含まれる登録アレルゲン：${names.length?names.join('、'):'登録なし'}。実物の商品表示も確認してください。`:'原材料・アレルギー情報は未確認です。実物の表示を確認してください。';
      note.textContent=recipe.sourceNote;parts.replaceChildren(...recipe.ingredients.map(part=>make('li','food-composer-material',`${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));steps.replaceChildren(...recipe.steps.map(step=>make('li','food-composer-step',step)));
      error.hidden=true;error.textContent='';preview.hidden=false;onError('');onChange(recipe);
    }catch(cause){error.hidden=false;error.textContent=cause.message;preview.hidden=true;onChange(null);onError(cause.message);}
  }
  update();return root;
}
