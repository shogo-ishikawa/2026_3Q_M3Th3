/** 作り置きは完成後に量り、1回に食べるg数で記録します。保存は呼び出し元が担当します。 */
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {createBatch,takeBatch,batchBalance} from './batch-cooking.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {NUTRIENT_KEYS,NUTRIENT_LABELS,NUTRIENT_UNITS,itemNutrition} from './nutrition.js';

const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const round=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const meals=[['breakfast','朝食'],['lunch','昼食'],['dinner','夕食'],['snack','間食']];
let mountCount=0;
function field(label,input){const wrapper=make('label','batch-field',label);wrapper.htmlFor=input.id;wrapper.append(input);if(input.type==='number')configureQuantityInput(input);return wrapper;}
function input(prefix,key,type,value){const node=make('input',`batch-${key}`);node.type=type;node.id=`${prefix}-${key}`;node.value=String(value);return node;}
function action(label,className='button-primary'){const node=make('button',className,label);node.type='submit';return node;}

export function mountBatchCooking({batches=[],entries=[],data,selectedDate,onCreate=()=>{},onRecord=()=>{},onArchive=()=>{},onError=()=>{}}={}){
  if(!data?.recipes||!Array.isArray(batches)||!Array.isArray(entries)||[onCreate,onRecord,onArchive,onError].some(callback=>typeof callback!=='function'))throw Error('作り置き画面の表示内容を確認してください。');
  const prefix=`batch-cooking-${++mountCount}`,root=make('section','batch-cooking');
  root.setAttribute('aria-label','作り置きと取り分け');
  root.append(make('h3','','作り置きと取り分け'),make('p','field-note','完成した料理の重量を量って登録すると、食べたg数に合わせて栄養を計算します。予定に入れた量も取り分け予約として残量から引きます。'));
  const error=make('p','batch-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  function problem(cause){const message=typeof cause==='string'?cause:cause.message;error.textContent=message;error.hidden=!message;if(message)onError(message);}
  const createDetails=make('details','batch-create-details');createDetails.append(make('summary','','作った料理を登録する'));
  const form=make('form','batch-create-form'),search=input(prefix,'search','search',''),recipe=make('select','batch-recipe');recipe.id=`${prefix}-recipe`;recipe.required=true;
  search.placeholder='料理名で検索';
  const quantity=input(prefix,'source-quantity','number',2);quantity.min='0.001';quantity.max='1000';quantity.step='any';quantity.required=true;
  const grams=input(prefix,'total-grams','number','');grams.min='0.001';grams.max='100000';grams.step='any';grams.required=true;
  const date=input(prefix,'prepared-date','date',selectedDate??'');date.min='2000-01-01';date.max='2100-12-31';date.required=true;
  const name=input(prefix,'name','text','');name.maxLength=200;name.required=true;
  const selectedInfo=make('p','batch-source-info field-note');
  function filterRecipes(){
    const previous=recipe.value,placeholder=make('option','','料理を選んでください');placeholder.value='';
    const visible=data.recipes.filter(candidate=>matchesJapaneseQuery([candidate.name],search.value));
    recipe.replaceChildren(placeholder,...visible.map(candidate=>{const option=make('option','',candidate.name);option.value=candidate.id;return option;}));
    recipe.value=visible.some(candidate=>candidate.id===previous)?previous:'';
    describeRecipe();
  }
  function describeRecipe(){
    const chosen=data.recipes.find(candidate=>candidate.id===recipe.value);
    selectedInfo.textContent=chosen?'人数分は元レシピの1人分を基準に入力します。完成重量は水分や油も含め、容器の重さを除いて量ってください。':'作った料理を選び、調理した人数分と完成重量を入力してください。';
  }
  let previousName='';
  recipe.addEventListener('change',()=>{const chosen=data.recipes.find(candidate=>candidate.id===recipe.value);if(chosen){if(!name.value||name.value===previousName)name.value=chosen.name;previousName=chosen.name;quantity.value=String(chosen.servings??2);}describeRecipe();});
  search.addEventListener('input',filterRecipes);
  form.append(field('料理を検索',search),field('作った料理',recipe),field('作り置きの名前',name),field('何人分作ったか',quantity),field('完成重量（g・容器を除く）',grams),field('調理日',date),selectedInfo,action('作り置きに登録'));
  form.addEventListener('submit',event=>{event.preventDefault();try{
    const chosen=data.recipes.find(candidate=>candidate.id===recipe.value);if(!chosen)throw Error('作った料理を選んでください。');
    const batch=createBatch({recipe:chosen,sourceQuantity:readQuantityInput(quantity,{label:'作った人数分'}),totalGrams:readQuantityInput(grams,{label:'完成重量'}),preparedDate:date.value,name:name.value},data);
    onCreate(batch);problem('');
  }catch(cause){problem(cause);}});
  createDetails.append(form);root.append(createDetails,error);
  const list=make('div','batch-list');
  const visible=batches.filter(batch=>!batch.archived),archived=batches.filter(batch=>batch.archived);
  if(!visible.length)list.append(make('p','field-note','登録中の作り置きはありません。「作った料理を登録する」から追加できます。'));
  function cardFor(batch,archived=false){
    const card=make('article','batch-card');let balance;
    try{balance=batchBalance(batch,entries);}catch(cause){card.append(make('h4','',batch.name),make('p','batch-error',cause.message));return card;}
    card.append(make('h4','',batch.name),make('p','batch-meta',`調理日 ${batch.preparedDate} · 全体 ${round(batch.totalGrams)}g · 元レシピ ${round(batch.sourceQuantity)}人分`),make('p','batch-balance',`取り分け可能 ${round(balance.remainingGrams)}g / 食べた量 ${round(balance.eatenGrams)}g / 予定 ${round(balance.plannedGrams)}g`));
    const materialDetails=make('details','batch-materials'),materials=make('ul','batch-material-list');
    for(const part of batch.item.ingredients){const meta=data.ingredients[part.id];materials.append(make('li','',`${meta?.name??part.id} ${round(part.amount)} ${meta?.unit??'（単位未登録）'}`));}
    if(!batch.item.ingredients.length)materials.append(make('li','','元の料理の材料は未登録です。'));
    materialDetails.append(make('summary','','調理時の材料と全体の栄養を見る'),materials);
    const values=make('dl','batch-nutrients');
    for(const key of NUTRIENT_KEYS){const metric=make('div','batch-nutrient');metric.append(make('dt','',NUTRIENT_LABELS[key]),make('dd','',batch.item.nutrition[key]===null?'不明':`${round(batch.item.nutrition[key])} ${NUTRIENT_UNITS[key]}`));values.append(metric);}
    materialDetails.append(values,make('p','field-note','調理済みの取り分け分は買い物リストへ加えません。調理前に材料を買う場合は、通常の献立予定で管理してください。'),make('p','field-note',batch.item.sourceNote??''));card.append(materialDetails);
    if(!archived&&balance.remainingGrams>1e-6){
      const id=`${prefix}-${batch.id}`,takeForm=make('form','batch-take-form'),takeGrams=input(id,'take-grams','number',Math.min(100,balance.remainingGrams));takeGrams.min='0.001';takeGrams.max=String(balance.remainingGrams);takeGrams.step='any';takeGrams.required=true;
      const takeDate=input(id,'take-date','date',selectedDate>=batch.preparedDate?selectedDate:batch.preparedDate);takeDate.min=batch.preparedDate;takeDate.max='2100-12-31';takeDate.required=true;
      const meal=make('select','batch-take-meal');meal.id=`${id}-meal`;for(const [value,label]of meals){const option=make('option','',label);option.value=value;meal.append(option);}meal.value='dinner';
      const status=make('select','batch-take-status');status.id=`${id}-status`;for(const [value,label]of [['eaten','食べた'],['planned','食べる予定']]){const option=make('option','',label);option.value=value;status.append(option);}status.value='eaten';
      const nutritionPreview=make('p','batch-portion-preview field-note');
      function updatePreview(){try{const entry=takeBatch({batchId:batch.id,grams:readQuantityInput(takeGrams,{label:'取り分ける量'}),date:takeDate.value,meal:meal.value,status:status.value},batches,entries),nutrition=itemNutrition(entry.items[0]);nutritionPreview.textContent=`この${round(Number(takeGrams.value))}g：${nutrition.kcal===null?'エネルギー不明':`${round(nutrition.kcal)} kcal`} · たんぱく質 ${nutrition.protein===null?'不明':`${round(nutrition.protein)}g`}`;}catch{nutritionPreview.textContent='取り分ける量と日付を確認してください。';}}
      takeGrams.addEventListener('input',updatePreview);takeDate.addEventListener('change',updatePreview);
      takeForm.append(field('食べる量（完成重量g）',takeGrams),field('記録する日付',takeDate),field('食事区分',meal),field('状態',status),nutritionPreview,action('この量を記録'));
      takeForm.addEventListener('submit',event=>{event.preventDefault();try{onRecord(takeBatch({batchId:batch.id,grams:readQuantityInput(takeGrams,{label:'取り分ける量'}),date:takeDate.value,meal:meal.value,status:status.value},batches,entries));problem('');}catch(cause){problem(cause);}});updatePreview();card.append(takeForm);
    }
    if(!archived){const finish=action('この作り置きを終了','button-secondary batch-archive');finish.type='button';finish.addEventListener('click',()=>{try{onArchive(batch.id);problem('');}catch(cause){problem(cause);}});card.append(finish,make('p','field-note','終了しても食事の記録と調理時のデータは残ります。'));
    }else card.append(make('p','field-note','終了済み。記録した取り分け量と栄養は保持しています。'));
    return card;
  }
  for(const batch of visible)list.append(cardFor(batch));root.append(list);
  if(archived.length){const finished=make('details','batch-archived-list');finished.append(make('summary','',`終了した作り置き（${archived.length}件）`));for(const batch of archived)finished.append(cardFor(batch,true));root.append(finished);}
  filterRecipes();return root;
}
