import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';
import {applyProductLabel, labelUnits} from './product-label.js';

export function productLabelForm(item, data, onApply, submitText) {
  const form = document.createElement('form');
  form.className = 'record-ingredient-editor product-label-form';
  const portion = item.portion ?? {amount:1, unit:'人分'};
  const saved = item.productLabel;
  const labels = new Map();
  function field(title, key, tag='input') {
    const label = document.createElement('label'), input = document.createElement(tag);
    const caption = document.createElement('span');
    caption.textContent = title;
    labels.set(input, {label, caption});
    input.id = 'product-label-' + key;
    label.htmlFor = input.id;
    label.className = 'record-ingredient-label';
    label.append(caption, input);
    form.append(label);
    return input;
  }
  function number(title, key, value, step=1) {
    const input = field(title,key);
    input.type = 'number';
    input.min = '0';
    input.max = '10000000';
    input.value = value ?? '';
    configureQuantityInput(input,{step});
    return input;
  }
  const name = field('商品名（任意）','name'); name.maxLength = 200; name.value = saved?.name ?? '';
  const unit = field('包装に書かれた表示単位','unit','select');
  for (const u of labelUnits(portion)) {
    const option=document.createElement('option');option.value=u;option.textContent=u;unit.append(option);
  }
  unit.value = saved?.unit ?? portion.unit;
  const amount = number('表示の基準量','amount',saved?.amount ?? portion.amount);
  const unitSize = number('', 'unit-size', saved?.unitSize);
  function sync(change) {
    const other = unit.value !== portion.unit;
    labels.get(amount).caption.textContent = `表示の基準量（${unit.value}）`;
    labels.get(unitSize).label.hidden = !other;
    unitSize.disabled = !other;
    if (other) labels.get(unitSize).caption.textContent = `1${portion.unit}の内容量（${unit.value}）`;
    if (change) {amount.value=other ? '100' : String(portion.amount); unitSize.value='';}
  }
  unit.addEventListener('change',()=>sync(true));
  sync(false);
  const tip=document.createElement('p');tip.className='field-note';tip.textContent='包装に表示のある成分だけ入力してください。';form.append(tip);
  const fields = Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,number(`${NUTRIENT_LABELS[key]}（${NUTRIENT_UNITS[key]}）`,key,saved?.nutrition[key],key==='kcal'?1:key==='salt'?.01:.1)]));
  const error=document.createElement('p');error.hidden=true;error.className='notice error';error.setAttribute('role','alert');form.append(error);
  const submit=document.createElement('button');submit.type='submit';submit.className='button-primary';submit.id='product-label-apply';submit.textContent=submitText;form.append(submit);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    try {
      const nutrition=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,readQuantityInput(fields[key],{label:NUTRIENT_LABELS[key],allowEmpty:true})]));
      const updated=applyProductLabel(item,{name:name.value,unit:unit.value,amount:readQuantityInput(amount,{label:'表示の基準量'}),unitSize:unitSize.disabled?null:readQuantityInput(unitSize,{label:'内容量'}),nutrition},data);
      onApply(updated);
    } catch(cause) {error.textContent=cause.message;error.hidden=false;}
  });
  return form;
}
