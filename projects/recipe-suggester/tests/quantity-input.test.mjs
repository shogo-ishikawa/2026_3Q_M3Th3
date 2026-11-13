import test from 'node:test';
import assert from 'node:assert/strict';
import {configureQuantityInput, readQuantityInput, stepQuantityInput, installQuantitySteppers} from '../quantity-input.js';

// EventTarget/Event are native so the visible buttons exercise the same dispatched
// input/change events as the browser. Only layout and tree insertion are faked.
class Element extends EventTarget {
  constructor(tag, document) {
    super(); this.tagName=tag.toUpperCase(); this.ownerDocument=document; this.parentNode=null;
    this.children=[]; this.attributes=new Map(); this.className=''; this.value=''; this.min=''; this.max='';
    this.step=''; this.inputMode=''; this.disabled=false; this.readOnly=false; this.required=false;
    this.validity={badInput:false}; this.validationMessage=''; this.labels=[]; this.textContent='';
    this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>{if(!this.classList.contains(name))this.className=`${this.className} ${name}`.trim();}};
  }
  append(...nodes) {for(const node of nodes){if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);node.parentNode=this;this.children.push(node);}}
  insertBefore(node,before) {const index=this.children.indexOf(before);assert.ok(index>=0);node.parentNode=this;this.children.splice(index,0,node);}
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  getAttribute(name) {return this.attributes.get(name)??null;}
  setCustomValidity(message) {this.validationMessage=message;}
  matches(selector) {return selector==='input[data-quantity-step]'&&this.tagName==='INPUT'&&this.attributes.has('data-quantity-step');}
  querySelectorAll(selector) {return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
}
class Document extends Element {
  constructor(){super('document',null);this.ownerDocument=this;}
  createElement(tag){return new Element(tag,this);}
}
function field(value='1',{min='0',max='1000',required=true}={}) {
  const document=new Document(),parent=document.createElement('label'),input=document.createElement('input');
  input.type='number'; input.value=value;input.min=min;input.max=max;input.required=required;
  input.setAttribute('aria-label','まぐろの量（切れ）'); parent.append(input);document.append(parent);
  return {document,parent,input};
}
function key(input,value) {const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value});input.dispatchEvent(event);return event;}
const buttons=input=>input.parentNode.children.find(node=>node.className==='quantity-stepper-controls').children;

test('通常の小数を受け付け、空欄・不正な数値・上限外を0へ読み替えない',()=>{
  const {input}=field();configureQuantityInput(input);
  for(const [raw,expected]of [['0',0],['.5',.5],['1.',1],['2.75',2.75],['1000',1000]]){input.value=raw;assert.equal(readQuantityInput(input),expected);}
  for(const raw of ['', '-1','-0','+1','1e2','0e2','NaN','Infinity','0x10','3,2','abc','１','.','1000.01','9'.repeat(400)]){input.value=raw;assert.throws(()=>readQuantityInput(input),undefined,raw);}
  input.value='';assert.equal(readQuantityInput(input,{allowEmpty:true}),null);
  input.validity={badInput:true};assert.throws(()=>readQuantityInput(input,{allowEmpty:true}),/数字/);
});

test('上下の実ボタンは1刻みで小数部分を保ち、フォームを送信しない',()=>{
  const {input,parent}=field('2.5');configureQuantityInput(input);
  const [up,down]=buttons(input),events=[];input.addEventListener('input',event=>events.push([event.type,event.bubbles]));input.addEventListener('change',event=>events.push([event.type,event.bubbles]));
  assert.equal(parent.children.length,1);assert.equal(input.parentNode.className,'quantity-stepper');
  assert.equal(up.type,'button');assert.equal(down.type,'button');assert.equal(up.getAttribute('aria-label'),'まぐろの量（切れ）を増やす');
  up.dispatchEvent(new Event('click'));assert.equal(input.value,'3.5');down.dispatchEvent(new Event('click'));assert.equal(input.value,'2.5');
  assert.deepEqual(events,[['input',true],['change',true],['input',true],['change',true]]);
  assert.equal(input.step,'any');assert.equal(input.inputMode,'decimal');assert.equal(input.validationMessage,'');
});

test('キーボードの上下キーも1刻みになり、別のキーは奪わない',()=>{
  const {input}=field('150.25');configureQuantityInput(input);
  assert.equal(key(input,'ArrowUp').defaultPrevented,true);assert.equal(input.value,'151.25');
  assert.equal(key(input,'ArrowDown').defaultPrevented,true);assert.equal(input.value,'150.25');
  assert.equal(key(input,'ArrowLeft').defaultPrevented,false);assert.equal(input.value,'150.25');
});

test('0を許す数量は0まで下げ、0通知は正しい0にだけ発火する',()=>{
  const {input}=field('.5');const zeros=[];configureQuantityInput(input,{onZero:()=>zeros.push(input.value)});
  buttons(input)[1].dispatchEvent(new Event('click'));assert.equal(input.value,'0');assert.deepEqual(zeros,['0']);
  assert.equal(stepQuantityInput(input,-1),false);assert.equal(input.value,'0');
  for(const raw of ['', '-1','-0','0e2','abc']){input.value=raw;input.dispatchEvent(new Event('input'));assert.equal(zeros.length,1,raw);}
  input.value='';input.validity={badInput:true};input.dispatchEvent(new Event('input'));assert.equal(zeros.length,1);
});

test('選択式の量を0へ下げた入力イベントで、選択解除と入力無効化を連動できる',()=>{
  const {input}=field('1');let selected=true;const events=[];
  input.addEventListener('input',()=>{events.push('input');if(readQuantityInput(input)===0){selected=false;input.disabled=true;}});
  configureQuantityInput(input);buttons(input)[1].dispatchEvent(new Event('click'));
  assert.equal(input.value,'0');assert.equal(selected,false);assert.equal(input.disabled,true);assert.deepEqual(events,['input']);
  buttons(input)[0].dispatchEvent(new Event('click'));assert.equal(input.value,'0');assert.deepEqual(events,['input']);
});

test('正の下限を飛び越えて微小値へ丸めず、上限を超える操作もしない',()=>{
  const {input}=field('.5',{min:'.001',max:'2.5'});configureQuantityInput(input);
  assert.equal(stepQuantityInput(input,-1),false);assert.equal(input.value,'.5');
  assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'1.5');
  assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'2.5');
  assert.equal(stepQuantityInput(input,1),false);assert.equal(input.value,'2.5');
});

test('小数手入力を整数条件で拒むのは、整数専用と明示した欄だけ',()=>{
  const {input}=field('2');configureQuantityInput(input,{integerOnly:true});
  assert.equal(input.inputMode,'numeric');input.value='2.5';assert.throws(()=>readQuantityInput(input),/整数/);
  input.value='2';assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'3');
  configureQuantityInput(input);input.value='2.5';assert.equal(readQuantityInput(input),2.5);assert.equal(input.step,'any');
});

test('例外の刻みを指定した係数欄でも浮動小数の誤差を蓄積しない',()=>{
  const {input}=field('.2');configureQuantityInput(input,{step:.1});
  assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'0.3');
  assert.equal(stepQuantityInput(input,-1),true);assert.equal(input.value,'0.2');
});

test('入力不備を上下操作で別の値へ置き換えず、正しい空欄だけ初期値を補う',()=>{
  const {input}=field('');configureQuantityInput(input);
  assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'1');
  for(const raw of ['-1','abc','0e2','1001']){input.value=raw;assert.equal(stepQuantityInput(input,1),false);assert.equal(input.value,raw);}
  input.value='';input.validity={badInput:true};assert.equal(stepQuantityInput(input,1),false);assert.equal(input.value,'');
});

test('入力欄のdisabledとreadonlyは、クリックとキーの両方で尊重する',()=>{
  const {input}=field('3');input.disabled=true;configureQuantityInput(input);
  assert.ok(buttons(input).every(button=>button.disabled));buttons(input)[0].dispatchEvent(new Event('click'));key(input,'ArrowUp');assert.equal(input.value,'3');
  input.disabled=false;input.readOnly=true;assert.equal(stepQuantityInput(input,1),false);assert.equal(input.value,'3');
  input.readOnly=false;assert.equal(stepQuantityInput(input,1),true);assert.equal(input.value,'4');
});

test('何度設定・走査してもボタンやinput/changeイベントを重複させない',()=>{
  const {document,parent,input}=field('1');let changes=0;input.addEventListener('change',()=>changes++);
  configureQuantityInput(input);configureQuantityInput(input);installQuantitySteppers(document);installQuantitySteppers(document);
  assert.equal(parent.children.length,1);assert.equal(buttons(input).length,2);
  key(input,'ArrowUp');assert.equal(input.value,'2');assert.equal(changes,1);
});

test('入力エラーの後に選択肢などから正しい量へ戻すと、古いエラーを残さない',()=>{
  const {input}=field('1');configureQuantityInput(input);
  input.value='';input.dispatchEvent(new Event('input'));assert.match(input.validationMessage,/入力/);
  input.value='150';assert.equal(readQuantityInput(input),150);assert.equal(input.validationMessage,'');
  input.value='-1';input.dispatchEvent(new Event('input'));assert.notEqual(input.validationMessage,'');
  input.value='150.5';configureQuantityInput(input);assert.equal(input.validationMessage,'');
});

test('作成直後に基準量を割り当てる欄も、最初の入力エラーを解消する',async()=>{
  const {input}=field('');configureQuantityInput(input);assert.match(input.validationMessage,/入力/);
  input.value='150';await Promise.resolve();assert.equal(input.validationMessage,'');
});

test('フォームをリセットした後は、戻った初期値で入力検証を更新する',async()=>{
  const {document,input}=field('1');configureQuantityInput(input);const stop=installQuantitySteppers(document);await Promise.resolve();
  input.value='-1';input.dispatchEvent(new Event('input'));assert.notEqual(input.validationMessage,'');
  document.dispatchEvent(new Event('reset'));input.value='1';await Promise.resolve();
  assert.equal(input.validationMessage,'');stop();
});

test('表示単位などが変わった入力欄は、上下ボタンの説明も更新する',()=>{
  const {input}=field('1');configureQuantityInput(input);input.setAttribute('aria-label','ご飯の量（g）');input.dispatchEvent(new Event('input'));
  assert.equal(buttons(input)[0].getAttribute('aria-label'),'ご飯の量（g）を増やす');assert.equal(buttons(input)[1].getAttribute('aria-label'),'ご飯の量（g）を減らす');
});

test('後から追加した欄にもボタンを付け、無効状態の変更を表示へ反映する',()=>{
  const previous=globalThis.MutationObserver,observers=[];
  globalThis.MutationObserver=class {constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}};
  try{
    const document=new Document(),input=document.createElement('input');input.value='1';input.min='0';configureQuantityInput(input);
    const stop=installQuantitySteppers(document),rootObserver=observers.find(observer=>observer.target===document);
    assert.ok(rootObserver);document.append(input);rootObserver.callback([{addedNodes:[input]}]);
    assert.equal(buttons(input).length,2);const stateObserver=observers.find(observer=>observer.target===input);assert.ok(stateObserver);
    input.disabled=true;stateObserver.callback([]);assert.ok(buttons(input).every(button=>button.disabled));
    input.disabled=false;input.readOnly=true;stateObserver.callback([]);assert.ok(buttons(input).every(button=>button.disabled));
    input.readOnly=false;stateObserver.callback([]);assert.ok(buttons(input).every(button=>!button.disabled));
    stop();assert.equal(rootObserver.disconnected,true);
  }finally{if(previous===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=previous;}
});
