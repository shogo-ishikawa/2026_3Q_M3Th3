/** 店の表示値を入力する画面。保存・カレンダー登録は呼び出し元が行います。 */
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';
import {buildRestaurantRecipe, restaurantConfigFromRecipe} from './restaurant-menu.js';
import {NUTRIENT_KEYS,NUTRIENT_LABELS,NUTRIENT_UNITS} from './nutrition.js';
import {recipeFamily} from './catalog.js';
import {matchesJapaneseQuery} from './japanese-search.js';

let count=0;
const make=(tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
const labelFor=(text,input)=>{const label=make('label','restaurant-label',text);label.htmlFor=input.id;label.append(input);return label;};
const addOptions=(select,rows)=>{for(const [value,text]of rows){const option=make('option','',text);option.value=value;select.append(option);}};
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');

/** initialはbuildRestaurantRecipeの入力形。既存の登録を渡す場合はrecipeを使います。 */
export function mountRestaurantMenu({baseRecipe=null,data,initial={},recipe=null,onChange=()=>{},onError=()=>{}}={}){
  if(typeof onChange!=='function'||typeof onError!=='function'||!Array.isArray(data?.recipes))throw Error('外食メニューの表示処理を確認してください。');
  if(recipe)initial=restaurantConfigFromRecipe(recipe);
  const prefix=`restaurant-menu-${++count}`,recipeId=initial.id??`custom-restaurant-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${count}`}`;
  const root=make('div','restaurant-menu');root.setAttribute('role','group');root.setAttribute('aria-label','店舗・サイズ別の外食登録');
  root.append(make('h3','food-composer-heading','店別・サイズ別に登録'),make('p','food-composer-intro','店の公式資料に載っている栄養を登録します。同じ料理でも店舗・サイズごとに保存し、次回からメニューとして選べます。'));
  const fields=make('div','restaurant-fields');let genericSelect,genericId=baseRecipe?.id??initial.genericRecipeId??'';
  if(baseRecipe){root.append(make('p','restaurant-generic-fixed',`一般的な料理：${baseRecipe.name}`));}
  else{
    const search=make('input','restaurant-generic-search');search.type='search';search.id=`${prefix}-search`;search.placeholder='一般的な料理名を検索';
    genericSelect=make('select','restaurant-generic-select');genericSelect.id=`${prefix}-generic`;
    function filter(){const before=genericId,recipes=data.recipes.filter(item=>!item.restaurant&&(item.id===before||matchesJapaneseQuery([item.name],search.value)));genericSelect.replaceChildren();addOptions(genericSelect,[['','一般的な料理を選ぶ'],...recipes.map(item=>[item.id,item.name])]);genericSelect.value=recipes.some(item=>item.id===before)?before:'';}
    genericSelect.addEventListener('change',()=>{genericId=genericSelect.value;const selected=data.recipes.find(item=>item.id===genericId);if(selected){menuName.value=selected.name.slice(0,120);rice.checked=['rice','onigiri','curry','fried-rice','donburi','omelette-rice','sushi'].includes(recipeFamily(selected));}update();});
    search.addEventListener('input',filter);root.append(labelFor('一般的な料理を検索',search),labelFor('紐づける料理',genericSelect));filter();
  }
  function input(key,label,{type='text',max=200,value=''}={}){const element=make('input',`restaurant-${key}`);element.id=`${prefix}-${key}`;element.type=type;element.value=String(value);if(type==='text'||type==='url')element.maxLength=max;fields.append(labelFor(label,element));return element;}
  const store=input('store','店舗名',{max:80,value:initial.storeName??''}),menuName=input('name','店舗での料理名',{max:120,value:initial.menuName??baseRecipe?.name.slice(0,120)??''}),size=input('size','サイズ・商品区分',{max:80,value:initial.sizeName??'普通'});
  const basis=make('select','restaurant-basis');basis.id=`${prefix}-basis`;addOptions(basis,[['portion','1食・1皿など全体の表示値'],['per100g','100g当たりの表示値']]);basis.value=initial.basis??'portion';fields.append(labelFor('栄養表示の基準',basis));
  const portion=input('portion','登録する提供量',{type:'number',value:initial.portionAmount??1});portion.min='0.001';portion.max='100000';portion.step='any';configureQuantityInput(portion);
  const unit=make('select','restaurant-unit');unit.id=`${prefix}-unit`;addOptions(unit,['食','皿','杯','個','枚','袋','貫','切れ','本','人分','g'].map(value=>[value,value]));unit.value=initial.portionUnit??'食';fields.append(labelFor('提供量の単位',unit));
  const inclusion=make('textarea','restaurant-inclusion');inclusion.id=`${prefix}-inclusion`;inclusion.rows=2;inclusion.maxLength=300;inclusion.value=initial.inclusion??'';inclusion.placeholder='例：ハンバーグ、ご飯、付け合わせの野菜。みそ汁は含まない。';fields.append(labelFor('表示値に含まれる料理・付け合わせ',inclusion));
  function checkbox(className,labelText,checked){const control=make('input',className);control.type='checkbox';control.id=`${prefix}-${className}`;control.checked=checked;const label=labelFor(labelText,control);label.className='restaurant-checkbox';return {control,label};}
  const riceControl=checkbox('restaurant-rice','表示値にご飯を含む',initial.riceIncluded??(baseRecipe?['rice','onigiri','curry','fried-rice','donburi','omelette-rice','sushi'].includes(recipeFamily(baseRecipe)):false)),rice=riceControl.control;
  const sidesControl=checkbox('restaurant-sides','表示値に付け合わせを含む',initial.sidesIncluded??false),sides=sidesControl.control;fields.append(riceControl.label,sidesControl.label);
  const url=input('url','公式資料のURL',{type:'url',max:500,value:initial.sourceUrl??''});url.placeholder='https://…';
  const checkedDate=input('date','資料を確認した日',{type:'date',value:initial.checkedDate??new Date().toISOString().slice(0,10)});checkedDate.min='2000-01-01';checkedDate.max='2100-12-31';root.append(fields);
  const nutrition=make('fieldset','restaurant-nutrition'),legend=make('legend','','公式資料の栄養成分');nutrition.append(legend);
  const nutritionFields=new Map();for(const key of NUTRIENT_KEYS){const control=make('input',`restaurant-nutrient restaurant-nutrient-${key}`);control.id=`${prefix}-${key}`;control.type='number';control.min='0';control.max='10000000';control.step='any';control.value=initial.nutrition?.[key]==null?'':String(initial.nutrition[key]);if(key==='kcal')control.required=true;control.placeholder=key==='kcal'?'必須':'未掲載なら空欄';const label=labelFor(`${NUTRIENT_LABELS[key]}（${NUTRIENT_UNITS[key]}）`,control);nutrition.append(label);nutritionFields.set(key,control);}
  root.append(nutrition,make('p','field-note restaurant-unknown-note','資料にない成分は空欄にしてください。不明のまま記録し、0にはしません。セット全体の表示値なら、ご飯や付け合わせを重ねて記録しないようにしてください。'));
  const allergies=make('details','restaurant-allergies');allergies.append(make('summary','','アレルギー情報を登録する（任意）'));
  const knownControl=checkbox('restaurant-allergens-known','店舗の資料で、この商品のアレルギー情報を確認した',initial.allergensKnown===true);allergies.append(knownControl.label);const allergenFields=[];
  for(const allergen of data.allergens??[]){const field=checkbox(`restaurant-allergen-${allergen.id}`,allergen.label,(initial.allergens??[]).includes(allergen.id));allergenFields.push({id:allergen.id,control:field.control});allergies.append(field.label);}root.append(allergies);
  const error=make('p','food-composer-error restaurant-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const preview=make('div','food-composer-preview restaurant-preview'),title=make('p','food-composer-preview-title'),metrics=make('dl','food-composer-nutrients'),values=new Map();
  for(const key of NUTRIENT_KEYS){const row=make('div','food-composer-nutrient'),dd=make('dd','food-composer-nutrient-value');row.append(make('dt','food-composer-nutrient-label',NUTRIENT_LABELS[key]),dd);metrics.append(row);values.set(key,dd);}
  const note=make('p','food-composer-note');preview.append(title,metrics,note);root.append(error,preview);
  const basisNote=make('p','restaurant-basis-note');fields.append(basisNote);
  function describeBasis(){const grams=basis.value==='per100g';unit.disabled=grams;if(grams)unit.value='g';else if(unit.value==='g')unit.value='食';basisNote.textContent=grams?'100g当たりの表示値に、提供量（g）÷100を掛けます。実際に測った重さを入力してください。':'入力する栄養は、ここに指定した提供量全体の値です。例：6貫分の表示値なら提供量を6貫にします。';}
  function update(){
    try{
      if(portion.value.trim()==='')throw Error('登録する提供量を入力してください。');
      const result=buildRestaurantRecipe({id:recipeId,genericRecipeId:genericId,storeName:store.value,menuName:menuName.value,sizeName:size.value,inclusion:inclusion.value,riceIncluded:rice.checked,sidesIncluded:sides.checked,basis:basis.value,portionAmount:readQuantityInput(portion,{label:'登録する提供量'}),portionUnit:unit.value,sourceUrl:url.value,checkedDate:checkedDate.value,
        nutrition:Object.fromEntries([...nutritionFields].map(([key,control])=>[key,readQuantityInput(control,{label:NUTRIENT_LABELS[key],allowEmpty:true})])),allergensKnown:knownControl.control.checked,allergens:allergenFields.filter(field=>field.control.checked).map(field=>field.id)},data);
      title.textContent=`${result.name} / ${result.portion.amount}${result.portion.unit}全体`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=result.manualNutrition[key]===null?'不明':`${rounded(result.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      note.textContent=result.sourceNote;preview.hidden=false;error.hidden=true;error.textContent='';onError('');onChange(result);
    }catch(cause){preview.hidden=true;error.hidden=false;error.textContent=cause.message;onError(cause.message);onChange(null);}
  }
  basis.addEventListener('change',()=>{if(basis.value==='per100g')portion.value='';describeBasis();update();});
  for(const control of [store,menuName,size,portion,unit,inclusion,rice,sides,url,checkedDate,knownControl.control,...nutritionFields.values(),...allergenFields.map(field=>field.control)]){control.addEventListener(['SELECT'].includes(control.tagName)||control.type==='checkbox'?'change':'input',update);}
  describeBasis();update();return root;
}
