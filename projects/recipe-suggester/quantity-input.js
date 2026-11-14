/** 増減は1刻み、手入力は小数も使える共通数量欄。 */
const configurations=new WeakMap();
const decorations=new WeakMap();
const presetChoices=new WeakMap();
const presetVersions=new WeakMap();
const decimal=/^(?:\d+(?:\.\d*)?|\.\d+)$/;
const bound=value=>value!==undefined&&value!==null&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;

/** 空欄とブラウザーの不正入力を区別し、通常の十進数だけを読みます。 */
export function readQuantityInput(input,{label='数量',allowEmpty=false}={}){
  const raw=String(input?.value??'').trim();
  if(input?.validity?.badInput)throw Error(`${label}は数字で入力してください。`);
  if(raw===''){if(allowEmpty){input.setCustomValidity?.('');return null;}throw Error(`${label}を入力してください。`);}
  if(!decimal.test(raw))throw Error(`${label}は0以上の数値で入力してください。`);
  const value=Number(raw),min=bound(input?.min),max=bound(input?.max);
  if(!Number.isFinite(value)||value<0)throw Error(`${label}は0以上の有限な数値で入力してください。`);
  if(min!==null&&value<min)throw Error(`${label}は${min}以上で入力してください。`);
  if(max!==null&&value>max)throw Error(`${label}は${max}以下で入力してください。`);
  if(configurations.get(input)?.integerOnly&&!Number.isInteger(value))throw Error(`${label}は整数で入力してください。`);
  input.setCustomValidity?.('');return value;
}

function describe(input){
  const explicit=input.getAttribute?.('aria-label');
  if(explicit)return explicit;
  const label=input.labels?.[0];
  if(label){const text=[...label.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim();if(text)return text;}
  return '数量';
}
function canOperate(input){return !input.disabled&&!input.readOnly;}
function presetAllowed(input,value){
  const min=bound(input.min),max=bound(input.max);
  return configurations.has(input)&&canOperate(input)&&(min===null||value>=min)&&(max===null||value<=max)
    &&(!configurations.get(input).integerOnly||Number.isInteger(value));
}
function syncDecoration(input){
  const decoration=decorations.get(input);if(!decoration)return;
  for(const {button,direction}of decoration.buttons){
    const action=direction===1?'増やす':'減らす';
    button.setAttribute('aria-label',`${describe(input)}を${action}`);
    button.title=`${configurations.get(input).step}ずつ${action}`;
    button.disabled=!canOperate(input);
  }
  const raw=String(input.value??'').trim(),valid=decimal.test(raw)&&!input.validity?.badInput;
  decoration.presetRow?.setAttribute('aria-label',`${describe(input)}のよく使う量`);
  for(const {button,value,label}of decoration.presetButtons){
    button.disabled=!presetAllowed(input,value);
    button.setAttribute('aria-label',`${describe(input)}を${label}にする`);
    button.setAttribute('aria-pressed',String(valid&&Number(raw)===value));
  }
}
function validate(input){
  let message='';
  try{readQuantityInput(input,{label:describe(input),allowEmpty:!input.required});}catch(error){message=error.message;}
  input.setCustomValidity?.(message);syncDecoration(input);
}
function dispatchQuantity(input){
  input.dispatchEvent?.(new Event('input',{bubbles:true}));
  input.dispatchEvent?.(new Event('change',{bubbles:true}));
  validate(input);
}

/** キーボードと表示ボタンの共通処理。小数部分を丸めて整数にはしません。 */
export function stepQuantityInput(input,direction){
  const config=configurations.get(input);
  if(!config||![-1,1].includes(direction)||!canOperate(input))return false;
  const min=bound(input.min)??0,max=bound(input.max),raw=String(input.value??'').trim();
  let current;
  try{current=readQuantityInput(input,{allowEmpty:true});}catch{validate(input);return false;}
  let next;
  if(current===null){next=direction>0?Math.max(config.step,Math.ceil(min/config.step)*config.step):Math.ceil(min/config.step)*config.step;}
  else{
    const decimals=Math.min(12,Math.max((raw.split('.')[1]??'').length,(String(config.step).split('.')[1]??'').length));
    next=Number((current+direction*config.step).toFixed(decimals));
    if(next<min){if(min===0)next=0;else return false;}
  }
  if(max!==null&&next>max||next<min||config.integerOnly&&!Number.isInteger(next)||!Number.isFinite(next)||next===current)return false;
  input.value=String(next);dispatchQuantity(input);return true;
}

function renderPresets(input){
  const decoration=decorations.get(input);if(!decoration)return;
  if(decoration.presetRow)decoration.presetRow.remove();
  decoration.presetRow=null;decoration.presetButtons=[];
  const choices=presetChoices.get(input)??[];if(!choices.length)return;
  const document=input.ownerDocument??globalThis.document,row=document.createElement('span');
  row.className='quantity-presets';row.setAttribute('role','group');row.setAttribute('aria-label',`${describe(input)}のよく使う量`);
  const version=presetVersions.get(input);
  for(const {label,value}of choices){
    const button=document.createElement('button');button.type='button';button.className='quantity-preset-button';button.textContent=label;
    button.addEventListener('click',()=>{
      // 外した古いボタンが、単位変更後の欄へ値を戻さないようにします。
      if(version!==presetVersions.get(input)||!presetAllowed(input,value))return;
      const raw=String(input.value??'').trim();
      if(!input.validity?.badInput&&decimal.test(raw)&&Number(raw)===value)return;
      input.value=String(value);dispatchQuantity(input);
    });
    decoration.presetButtons.push({button,value,label});row.append(button);
  }
  decoration.presetRow=row;decoration.wrapper.append(row);syncDecoration(input);
}

/** 呼び出し元が単位と意味を確かめた量だけを表示します。空配列で消せます。 */
export function setQuantityPresets(input,presets=[]){
  if(!input||!Array.isArray(presets)||presets.length>8||presets.some(p=>!p||typeof p.label!=='string'||!p.label.trim()||p.label.length>40||typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<0))throw Error('数量の候補を確認してください。');
  presetChoices.set(input,presets.map(({label,value})=>({label:label.trim(),value})));
  presetVersions.set(input,(presetVersions.get(input)??0)+1);
  wrap(input);renderPresets(input);return input;
}

function wrap(input){
  if(!configurations.has(input))return;
  const existing=decorations.get(input);
  if(existing&&input.parentNode===existing.main&&existing.main.parentNode===existing.wrapper)return;
  const parent=input.parentNode;if(!parent?.insertBefore)return;
  const document=input.ownerDocument??globalThis.document;if(!document?.createElement)return;
  const wrapper=document.createElement('span');wrapper.className='quantity-stepper';
  if(parent.tagName==='LABEL'&&[...(parent.childNodes??[])].some(node=>node.nodeType===3&&node.textContent.trim()))wrapper.className+=' quantity-stepper-labelled';
  const main=document.createElement('span');main.className='quantity-stepper-main';
  const buttons=[];
  for(const [direction,symbol]of [[-1,'−'],[1,'＋']]){
    const button=document.createElement('button');button.type='button';button.className=`quantity-stepper-button quantity-stepper-${direction===1?'increase':'decrease'}`;button.textContent=symbol;
    button.addEventListener('click',()=>{stepQuantityInput(input,direction);});buttons.push({button,direction});
  }
  parent.insertBefore(wrapper,input);wrapper.append(main);main.append(buttons[0].button,input,buttons[1].button);
  decorations.set(input,{wrapper,main,buttons,presetRow:null,presetButtons:[]});
  input.classList?.add('quantity-stepper-input');syncDecoration(input);renderPresets(input);
  if(typeof MutationObserver!=='undefined')new MutationObserver(()=>syncDecoration(input)).observe(input,{attributes:true,attributeFilter:['disabled','readonly','min','max','aria-label']});
}

/** 何度呼んでもイベントを重複登録しません。栄養値・係数には別のstepを指定できます。 */
export function configureQuantityInput(input,{step=1,integerOnly=false,onZero}={}){
  if(!input||typeof step!=='number'||!Number.isFinite(step)||step<=0||typeof integerOnly!=='boolean')throw Error('数量欄の設定を確認してください。');
  const configured=configurations.has(input);
  configurations.set(input,{step,integerOnly,onZero});
  input.step='any';input.inputMode=integerOnly?'numeric':'decimal';
  input.setAttribute?.('data-quantity-step',String(step));
  if(!configured){
    input.addEventListener('keydown',event=>{
      if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
      event.preventDefault?.();stepQuantityInput(input,event.key==='ArrowUp'?1:-1);
    });
    input.addEventListener('input',()=>{
      validate(input);
      const callback=configurations.get(input).onZero;
      if(callback){try{if(readQuantityInput(input)===0)callback();}catch{}}
    });
    input.addEventListener('change',()=>validate(input));
  }
  validate(input);wrap(input);queueMicrotask(()=>validate(input));return input;
}

/** 後から表示されるダイアログや記録欄にも同じ増減ボタンを付けます。 */
export function installQuantitySteppers(root=globalThis.document){
  const scan=node=>{
    if(node?.matches?.('input[data-quantity-step]'))wrap(node);
    for(const input of node?.querySelectorAll?.('input[data-quantity-step]')??[])wrap(input);
  };
  scan(root);
  const afterReset=event=>queueMicrotask(()=>{for(const input of event.target?.querySelectorAll?.('input[data-quantity-step]')??[])validate(input);});
  root?.addEventListener?.('reset',afterReset,true);
  if(typeof MutationObserver==='undefined')return ()=>root?.removeEventListener?.('reset',afterReset,true);
  const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);});
  observer.observe(root,{childList:true,subtree:true});return ()=>{observer.disconnect();root?.removeEventListener?.('reset',afterReset,true);};
}
