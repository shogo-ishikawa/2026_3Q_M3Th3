/** 文章入力の候補を全行確認し、1つの食事として登録します。 */
import {parseTextMeal,textFoodCandidates,textAmountForRecipe,buildTextMeal} from './text-log.js';
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {recipePortion} from './catalog.js';
import {sumNutrition} from './nutrition.js';
import {mealSetWarnings} from './meal-sets.js';

let mounts=0;
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const field=(title,input)=>{const label=make('label','text-log-field',title);label.htmlFor=input.id;label.append(input);return label;};
const option=(value,label)=>{const element=make('option','',label);element.value=value;return element;};
const round=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const meals=[['breakfast','朝食'],['lunch','昼食'],['dinner','夕食'],['snack','間食']];

export function mountTextLog({data,date,meal='dinner',status='eaten',settings={},onAdd=()=>{},onError=()=>{}}={}){
  if(!Array.isArray(data?.recipes)||typeof onAdd!=='function'||typeof onError!=='function')throw Error('文章から記録する画面の設定を確認してください。');
  const prefix=`text-log-${++mounts}`,root=make('section','text-log');root.setAttribute('aria-label','文章からまとめて食事を記録');
  root.append(make('h3','','文章からまとめて記録'),make('p','field-note','料理名と量を「、」や改行で区切って入力します。候補の料理と量を確認してから一括登録します。'));
  const text=make('textarea','text-log-source');text.id=`${prefix}-source`;text.rows=3;text.maxLength=2000;text.placeholder='例：ご飯150g、納豆1パック、みそ汁1杯';
  const parse=make('button','button-secondary text-log-parse','料理の候補を作る');parse.type='button';root.append(field('食べたもの',text),parse);
  const context=make('div','text-log-context'),dateField=make('input');dateField.type='date';dateField.id=`${prefix}-date`;dateField.min='2000-01-01';dateField.max='2100-12-31';dateField.value=date??'';
  const mealField=make('select');mealField.id=`${prefix}-meal`;mealField.append(...meals.map(([value,label])=>option(value,label)));mealField.value=meal;
  const statusField=make('select');statusField.id=`${prefix}-status`;statusField.append(option('eaten','食べた'),option('planned','これからの予定'));statusField.value=status;
  context.append(field('記録する日付',dateField),field('食事',mealField),field('記録の種類',statusField));root.append(context);
  const list=make('div','text-log-rows'),summary=make('div','text-log-summary'),message=make('p','text-log-status field-note'),error=make('p','text-log-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const submit=make('button','button-primary text-log-submit','内容を確認して一括登録');submit.type='button';submit.disabled=true;
  root.append(make('p','field-note','選んだ料理の登録済みの配合で計算します。パックの重さなど換算が未登録の単位は、表示された基準量を確認して量を入力してください。具材の変更や汁の飲み残しはメニューの詳細から記録できます。'),list,summary,message,error,submit);
  let controls=[],current=null;
  const problem=cause=>{const value=typeof cause==='string'?cause:cause.message;error.textContent=value;error.hidden=!value;if(value)onError(value);};
  function selectedRows(){return controls.map(control=>({recipeId:control.select.value,amount:readQuantityInput(control.amount,{label:`${control.source.source}の量`})}));}
  function update(){
    current=null;summary.replaceChildren();submit.disabled=true;
    if(!controls.length){message.textContent='入力して「料理の候補を作る」を押してください。';return;}
    try{
      if(controls.some(control=>!control.select.value))throw Error('すべての行で料理を選んでください。見つからない行は料理名を直すか、削除できます。');
      current=buildTextMeal({rows:selectedRows(),date:dateField.value,meal:mealField.value,status:statusField.value},data);
      const nutrition=sumNutrition(current.items),names=make('ul','text-log-preview-items');
      for(const item of current.items){const portion=item.portion??{amount:1,unit:'人分'};names.append(make('li','',`${item.name} ${round(item.quantity*portion.amount)}${portion.unit}`));}
      summary.append(make('h4','','登録する内容'),names,make('p','text-log-energy',`合計 ${round(nutrition.values.kcal)} kcal${nutrition.complete.kcal?'':' ＋不明分'}`));
      for(const warning of mealSetWarnings({items:current.items},settings,data))summary.append(make('p','text-log-warning',warning));
      message.textContent=`${controls.length}品の料理と量を確認して登録してください。`;submit.disabled=false;
    }catch(cause){message.textContent=cause.message;}
  }
  function fillRecipes(control,candidates,recipeId=''){
    control.select.replaceChildren(option('','料理を選んでください'),...candidates.map(candidate=>option(candidate.id,candidate.name)));
    control.select.value=candidates.some(candidate=>candidate.id===recipeId)?recipeId:'';
    control.empty.textContent=candidates.length?'':'一致する料理がありません。料理名を直して検索してください。';control.empty.hidden=Boolean(candidates.length);
  }
  function chooseRecipe(control){
    const recipe=data.recipes.find(recipe=>recipe.id===control.select.value);
    control.amount.value='';control.amount.disabled=!recipe;control.unit.textContent='';control.note.textContent=control.source.note;control.standard.replaceChildren();control.standard.hidden=!recipe;
    if(recipe){
      const portion=recipePortion(recipe,data);control.unit.textContent=portion.unit;
      control.standard.append(make('summary','','標準の登録内訳を見る'));
      const ingredients=make('ul','text-log-standard-items');
      for(const part of recipe.ingredients??[]){const food=data.ingredients?.[part.id];ingredients.append(make('li','',`${food?.name??part.id} ${round(part.amount/recipe.servings)}${food?.unit??''}`));}
      control.standard.append(make('p','field-note',`基準量（${portion.amount}${portion.unit}）の内訳です。量の変更に合わせて比例計算します。`),ingredients);
      if(recipe.ingredientsKnown===false)control.standard.append(make('p','text-log-warning','この内訳は概算用の登録例です。商品の原材料すべてを確認したものではありません。'));
      try{const converted=textAmountForRecipe(recipe,control.source.rawAmount,control.source.rawUnit,data);control.amount.value=converted.amount===null?'':String(converted.amount);control.note.textContent=[portion.label,converted.note].filter(Boolean).join('。');}
      catch(cause){control.note.textContent=`${portion.label}。${cause.message} 正しい量を${portion.unit}で入力してください。`;}
    }
    configureQuantityInput(control.amount);update();
  }
  function renderRow(source){
    const row=make('article','text-log-row'),head=make('div','text-log-row-heading'),remove=make('button','button-text text-log-remove','この行を削除');remove.type='button';
    head.append(make('h4','',source.source),remove);row.append(head);
    const search=make('input','text-log-search');search.type='search';search.id=`${prefix}-${source.id}-search`;search.value=source.name;search.maxLength=200;
    const select=make('select','text-log-recipe');select.id=`${prefix}-${source.id}-recipe`;
    const amount=make('input','text-log-amount');amount.type='number';amount.id=`${prefix}-${source.id}-amount`;amount.min='0.001';amount.max='100000';amount.required=true;
    const amountWrapper=make('span','text-log-amount-with-unit'),unit=make('span','text-log-unit');amountWrapper.append(amount,unit);
    const amountLabel=make('label','text-log-field','記録する量');amountLabel.htmlFor=amount.id;amountLabel.append(amountWrapper);configureQuantityInput(amount);
    const fields=make('div','text-log-row-fields');fields.append(field('料理名を検索',search),field('登録する料理',select),amountLabel);
    const empty=make('p','text-log-warning'),note=make('p','text-log-row-note'),standard=make('details','text-log-standard');row.append(fields,empty,note,standard);
    const control={source,row,search,select,amount,unit,empty,note,standard};controls.push(control);
    fillRecipes(control,source.candidates,source.recipeId);chooseRecipe(control);
    search.addEventListener('input',()=>{
      try{fillRecipes(control,textFoodCandidates(search.value,data));chooseRecipe(control);problem('');}
      catch(cause){fillRecipes(control,[]);chooseRecipe(control);problem(cause);}
    });
    select.addEventListener('change',()=>{chooseRecipe(control);problem('');});
    amount.addEventListener('input',()=>{if(select.value){const portion=recipePortion(data.recipes.find(recipe=>recipe.id===select.value),data);note.textContent=portion.label;}update();problem('');});
    remove.addEventListener('click',()=>{controls=controls.filter(value=>value!==control);row.remove?.();if(!row.remove)list.replaceChildren(...controls.map(value=>value.row));update();problem('');});
    list.append(row);
  }
  parse.addEventListener('click',()=>{
    try{const rows=parseTextMeal(text.value,data);controls=[];current=null;list.replaceChildren();for(const source of rows)renderRow(source);update();problem('');}
    catch(cause){controls=[];current=null;list.replaceChildren();summary.replaceChildren();submit.disabled=true;problem(cause);}
  });
  text.addEventListener('input',()=>{controls=[];current=null;list.replaceChildren();summary.replaceChildren();submit.disabled=true;message.textContent='文章を変更しました。「料理の候補を作る」を押して再確認してください。';problem('');});
  for(const control of [dateField,mealField,statusField])control.addEventListener('change',update);
  submit.addEventListener('click',()=>{
    try{update();if(!current)throw Error('すべての料理と量を確認してください。');if(onAdd(current)===false)return;text.value='';controls=[];current=null;list.replaceChildren();summary.replaceChildren();submit.disabled=true;message.textContent='食事を記録に追加しました。';problem('');}
    catch(cause){problem(cause);}
  });
  update();return root;
}
