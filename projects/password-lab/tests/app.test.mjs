import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
  constructor(id = '', value = '') { Object.assign(this,{id,value,checked:false,disabled:false,textContent:'',children:[],dataset:{},type:'text',listeners:{}}); }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
}
test('UI validates inputs, invalidates results, ignores stale jobs and recovers from RNG errors', async () => {
  const ids = ['password','length','use-digits','use-lower','use-upper','use-symbols','show-password','generate','run','stop','hash-mode','budget','use-gpu','gpu-status','assumptions','results','sensitivity','verdict','result-summary','space-value','average-time','worst-time','cpu-rate','status','error','progress-area','progress-text','search-progress'];
  const elements = Object.fromEntries(ids.map(id => [id,new Element(id)]));
  elements.password.type='password'; elements.length.value='12'; elements['hash-mode'].value='sha256'; elements.budget.value='1000';
  elements['use-digits'].checked=true; elements['use-lower'].checked=true;
  const controls=ids.filter(id => /^(password|length|use-|show-|generate|run|stop|hash-mode|budget)/.test(id)).map(id => elements[id]);
  const previous = {document:globalThis.document, Worker:globalThis.Worker, crypto:Object.getOwnPropertyDescriptor(globalThis,'crypto')};
  globalThis.document={getElementById:id => elements[id], querySelectorAll:selector => selector === '[data-demo]' ? [] : controls, createElement:() => new Element()};
  class FakeWorker {
    static instances=[];
    constructor() { FakeWorker.instances.push(this); }
    postMessage(message) { this.message=message; }
    terminate() { this.terminated=true; }
  }
  globalThis.Worker=FakeWorker;
  try {
    const app=await import('../app.js');
    const click=id => elements[id].listeners.click();
    const input=value => { elements.password.value=value; elements.password.listeners.input(); };
    input(''); await click('run'); assert.match(elements.error.textContent,/入力するか/);
    input('日本語'); await click('run'); assert.match(elements.error.textContent,/半角/);
    input('a'.repeat(33)); await click('run'); assert.equal(elements.password.value.length,33); assert.match(elements.error.textContent,/1〜32/);
    input('99'); await click('run');
    const first=FakeWorker.instances.at(-1);
    assert.equal(elements.run.disabled,true);
    assert.equal(first.message.options.length,2);
    assert.equal(Object.hasOwn(first.message.options,'password'),false);
    assert.equal(first.message.options.targetHash.length,64);
    first.onmessage({data:{jobId:first.message.jobId,type:'calibration',result:{rate:100}}});
    assert.equal(elements['space-value'].textContent,'100通り');
    assert.ok(elements.sensitivity.children.some(row => row.children[0].textContent==='3文字'));
    await click('stop'); assert.equal(first.terminated,true); assert.equal(elements.run.disabled,false);
    input('01'); await click('run');
    const second=FakeWorker.instances.at(-1);
    first.onmessage({data:{jobId:first.message.jobId,type:'result',result:{method:'brute',status:'found',attempts:100,elapsedMs:10}}});
    assert.equal(elements.results.children.length,0);
    second.onmessage({data:{jobId:second.message.jobId,type:'result',result:{method:'brute',status:'found',attempts:2,elapsedMs:10}}});
    second.onmessage({data:{jobId:second.message.jobId,type:'done'}});
    assert.match(elements.verdict.textContent,/見つかりました/);
    input('12'); assert.equal(elements.results.children.length,0); assert.equal(elements['average-time'].textContent,'—');
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(){throw new Error('RNG unavailable');}}});
    await click('run'); assert.equal(elements.run.disabled,false); assert.match(elements.error.textContent,/RNG unavailable/);
    assert.equal(app.formatCount(94n**32n).includes('10^'),true);
    assert.equal(app.formatTime(0),'0.001秒未満');
  } finally {
    if(previous.document===undefined) delete globalThis.document; else globalThis.document=previous.document;
    if(previous.Worker===undefined) delete globalThis.Worker; else globalThis.Worker=previous.Worker;
    if(previous.crypto) Object.defineProperty(globalThis,'crypto',previous.crypto);
  }
});
