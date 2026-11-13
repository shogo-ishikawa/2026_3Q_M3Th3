/** 買い物リストの1食材に添える購入状態・包装の編集画面。 */
import {PURCHASE_PACK_UNITS,PURCHASE_SOURCES,purchaseBasisNote,purchaseGramsPerUnit,purchasePresets,purchaseSettingFor,validatePurchaseSettings,derivePurchase} from './purchase-conversion.js';
let count=0;
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const field=(title,input)=>{const label=make('label','purchase-field',title);label.htmlFor=input.id;label.append(input);return label;};

/** onSaveには同じIDの設定を置き換えた配列を渡します。保存は呼び出し側で行います。 */
export function mountPurchaseEditor({item,settings=[],data,onSave=()=>{},onError=()=>{}}={}){
  if(typeof onSave!=='function'||typeof onError!=='function')throw Error('購入量設定の保存処理を確認してください。');
  const cleanSettings=validatePurchaseSettings(settings,data),initial=purchaseSettingFor(item?.id,cleanSettings,data),food=data.ingredients[item.id];
  derivePurchase(item,cleanSettings,data);
  const prefix=`purchase-${++count}`,root=make('details','purchase-editor');root.append(make('summary','purchase-editor-summary','購入する状態・包装を設定'));
  const panel=make('div','purchase-editor-panel');panel.append(make('p','purchase-basis',purchaseBasisNote(item.id,data)),make('p','purchase-note','材料と同じ状態の手持ちを差し引いてから換算します。生米の在庫と炊いたご飯の在庫など、別の状態は自動で合算しません。栄養値は変えません。'));
  const preset=make('select','purchase-preset');preset.id=`${prefix}-preset`;preset.setAttribute('aria-label',`${food.name}の購入量の参考設定`);
  const presets=purchasePresets(item.id,data),custom=make('option','','参考設定を選ぶ');custom.value='';preset.append(custom);
  presets.forEach((value,index)=>{const option=make('option','',value.label);option.value=String(index);preset.append(option);});preset.value='';panel.append(field('参考設定',preset));
  const grid=make('div','purchase-fields'),name=make('input','purchase-name');name.id=`${prefix}-name`;name.type='text';name.maxLength=200;
  const mode=make('select','purchase-mode');mode.id=`${prefix}-mode`;
  for(const [value,label] of [['same',`材料と同じ状態・単位（${food.unit}）`],['weight','購入時の重量（g）へ換算']]){const option=make('option','',label);option.value=value;option.disabled=value==='weight'&&!purchaseGramsPerUnit(item.id,data);mode.append(option);}
  const factor=make('input','purchase-factor');factor.id=`${prefix}-factor`;factor.type='number';factor.min='.001';factor.max='1000';factor.step='any';
  const factorField=field('購入する1gから用意できる材料の量（g）',factor);
  const pack=make('input','purchase-pack-size');pack.id=`${prefix}-pack`;pack.type='number';pack.min='.000001';pack.max='10000000';pack.step='any';pack.placeholder='包装でまとめない場合は空欄';
  const packField=field('1包装の量',pack),packUnit=make('select','purchase-pack-unit');packUnit.id=`${prefix}-pack-unit`;
  for(const value of PURCHASE_PACK_UNITS){const option=make('option','',value);option.value=value;packUnit.append(option);}
  grid.append(field('購入する食材名',name),field('購入量の表示',mode),factorField,packField,field('包装の単位',packUnit));panel.append(grid);
  const explanation=make('p','purchase-explanation'),preview=make('p','purchase-preview'),error=make('p','purchase-error');error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  const save=make('button','button-secondary purchase-save','この購入設定を保存');save.type='button';panel.append(explanation,preview,error,save);
  const source=PURCHASE_SOURCES[item.id]??(item.id==='udon'?PURCHASE_SOURCES.noodles:null);
  if(source){const link=make('a','purchase-source','換算の参考資料');link.href=source;link.target='_blank';link.rel='noopener noreferrer';panel.append(link);}
  root.append(panel);
  function apply(setting){name.value=setting.purchaseName;mode.value=setting.mode;factor.value=String(setting.yieldFactor);pack.value=setting.packSize===null?'':String(setting.packSize);packUnit.value=setting.packUnit;update();}
  function read(){
    if(String(factor.value).trim()==='')throw Error('換算係数を入力してください。');
    const setting={id:item.id,mode:mode.value,yieldFactor:mode.value==='same'?1:Number(factor.value),purchaseName:name.value,
      packSize:pack.value.trim()===''?null:Number(pack.value),packUnit:packUnit.value};
    return validatePurchaseSettings([...cleanSettings.filter(value=>value.id!==item.id),setting],data);
  }
  function update(){
    factor.disabled=mode.value==='same';factorField.hidden=mode.value==='same';
    pack.setAttribute('aria-label',`${food.name}の1包装の量（${mode.value==='weight'?'g':food.unit}）`);
    try{const next=read(),result=derivePurchase(item,next,data);explanation.textContent=`${result.explanation}。1包装の量の単位は${result.unit}です。`;preview.textContent=result.text;error.hidden=true;error.textContent='';save.disabled=false;onError('');}
    catch(cause){preview.textContent='';explanation.textContent='';error.textContent=cause.message;error.hidden=false;save.disabled=true;onError(cause.message);}
  }
  const displayUnit=value=>value==='weight'?'g':food.unit;
  let previousUnit=displayUnit(initial.mode);
  preset.addEventListener('change',()=>{if(preset.value!==''){const choice=presets[Number(preset.value)];if(choice){const sameUnit=previousUnit===displayUnit(choice.setting.mode);apply({...choice.setting,packSize:!sameUnit||pack.value.trim()===''?null:Number(pack.value),packUnit:packUnit.value});previousUnit=displayUnit(choice.setting.mode);}}});
  for(const control of [name,factor,pack])control.addEventListener('input',update);
  mode.addEventListener('change',()=>{if(mode.value==='same'){factor.value='1';name.value=food.name;}if(previousUnit!==displayUnit(mode.value))pack.value='';previousUnit=displayUnit(mode.value);update();});packUnit.addEventListener('change',update);
  save.addEventListener('click',()=>{try{const next=read();onSave(next);error.hidden=true;onError('');}catch(cause){error.textContent=cause.message;error.hidden=false;onError(cause.message);}});
  apply(initial);return root;
}
