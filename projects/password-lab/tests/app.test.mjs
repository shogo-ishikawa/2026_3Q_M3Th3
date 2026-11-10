import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class Element {
  constructor(id = '', value = '') { Object.assign(this,{id,value,checked:false,disabled:false,hidden:false,textContent:'',children:[],dataset:{},type:'text',listeners:{}}); }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
}
test('UI keeps attacker knowledge separate, previews hints and ignores stale jobs', async () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const controlIds=[...html.matchAll(/<(?:input|select|button)\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const defaults={length:'12','hash-mode':'sha256',budget:'1000','attack-knowledge':'none','attack-length':'6','search-max-length':'6','first-group':'lower','first-count':'4','second-group':'digits','second-count':'4'};
  for(const [id,value]of Object.entries(defaults))elements[id].value=value;
  elements.password.type='password';
  for(const id of ['use-digits','use-lower','attack-digits'])elements[id].checked=true;
  const controls=controlIds.map(id=>elements[id]);
  const demos=['digits','word','random'].map(demo=>{const el=new Element();el.dataset.demo=demo;return el;});
  const previous={document:globalThis.document,Worker:globalThis.Worker,crypto:Object.getOwnPropertyDescriptor(globalThis,'crypto')};
  globalThis.document={getElementById:id=>elements[id],querySelectorAll:selector=>selector==='[data-demo]'?demos:controls,createElement:()=>new Element()};
  class FakeWorker {
    static instances=[];
    constructor(){FakeWorker.instances.push(this);}
    postMessage(message){this.message=message;}
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker;
  try {
    const app=await import('../app.js');
    const click=id=>elements[id].listeners.click();
    const change=(id,value)=>{elements[id].value=value;elements[id].listeners.change();};
    const input=value=>{elements.password.value=value;elements.password.listeners.input();};
    input('');await click('run');assert.match(elements.error.textContent,/入力するか/);
    input('日本語');await click('run');assert.match(elements.error.textContent,/半角/);
    input('a'.repeat(33));await click('run');assert.equal(elements.password.value.length,33);
    input('99');await click('run');
    const first=FakeWorker.instances.at(-1);
    assert.equal(elements.run.disabled,true);
    assert.equal(first.message.options.plan.minLength,1);
    assert.equal(first.message.options.plan.maxLength,6);
    assert.equal(first.message.options.plan.alphabet.length,94);
    assert.equal(Object.hasOwn(first.message.options,'length'),false);
    assert.equal(Object.hasOwn(first.message.options,'password'),false);
    assert.equal(first.message.options.targetHash.length,64);
    first.onmessage({data:{jobId:first.message.jobId,type:'calibration',result:{rate:100}}});
    assert.equal(elements['space-value'].textContent,app.formatCount(first.message.options.plan.candidateCount)+'通り');
    await click('stop');assert.equal(first.terminated,true);assert.equal(elements.run.disabled,false);

    // Guessing digits and a length is an explicit condition, even for a letter target.
    input('letter');change('attack-knowledge','charset');
    elements['length-known'].checked=true;elements['length-known'].listeners.change();
    change('attack-length','2');
    assert.equal(elements['charset-fields'].hidden,false);
    assert.equal(elements['unknown-length-fields'].hidden,true);
    await click('run');
    const second=FakeWorker.instances.at(-1);
    assert.equal(second.message.options.plan.alphabet,'0123456789');
    assert.equal(second.message.options.plan.minLength,2);
    assert.equal(second.message.options.plan.maxLength,2);
    first.onmessage({data:{jobId:first.message.jobId,type:'result',result:{method:'brute',status:'found',attempts:100,elapsedMs:10}}});
    assert.equal(elements.results.children.length,0);
    second.onmessage({data:{jobId:second.message.jobId,type:'result',result:{method:'brute',status:'exhausted',attempts:100,elapsedMs:10}}});
    second.onmessage({data:{jobId:second.message.jobId,type:'done'}});
    assert.match(elements.results.children[0].children[3].textContent,/指定範囲では未発見/);

    // Hints are assembled with selectors; a preset changes no secret input.
    elements['use-gpu'].checked=true;
    change('attack-knowledge','structure');await click('hint-prefix');
    assert.equal(elements['use-gpu'].disabled,true);
    assert.equal(elements.password.value,'letter');
    assert.match(elements['attack-preview'].textContent,/sakura/);
    assert.match(elements['attack-preview'].textContent,/数字/);
    assert.equal(app.readAttackPlan().candidateCount,10000n);
    assert.equal(elements['structure-fields'].hidden,false);
    assert.equal(elements['unknown-length-fields'].hidden,true);
    assert.equal(elements['sensitivity-panel'].hidden,true);
    input('sakura2026');await click('run');
    const third=FakeWorker.instances.at(-1);
    assert.equal(third.message.options.plan.kind,'structure');
    third.onmessage({data:{jobId:third.message.jobId,type:'result',result:{method:'structure',status:'found',attempts:2027,elapsedMs:10}}});
    third.onmessage({data:{jobId:third.message.jobId,type:'done'}});
    await Promise.resolve();
    assert.equal(elements.results.children.length,1);
    assert.match(elements.verdict.textContent,/見つかりました/);
    input('12');assert.equal(elements.results.children.length,0);assert.equal(elements['average-time'].textContent,'—');
    change('attack-knowledge','none');
    assert.equal(app.readAttackPlan().alphabet.length,94);
    assert.equal(app.readAttackPlan().positions,null);
    assert.equal(elements['structure-fields'].hidden,true);
    assert.equal(elements['sensitivity-panel'].hidden,false);
    assert.equal(elements['use-gpu'].disabled,false);
    elements['use-gpu'].checked=false;
    // Generation settings and demos also do not change the attacker plan.
    const before=app.readAttackPlan();await click('generate');
    assert.deepEqual(app.readAttackPlan(),before);
    demos[1].listeners.click();assert.deepEqual(app.readAttackPlan(),before);
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(){throw new Error('RNG unavailable');}}});
    await click('run');assert.equal(elements.run.disabled,false);assert.match(elements.error.textContent,/RNG unavailable/);
    assert.equal(app.formatCount(94n**32n).includes('10^'),true);
    assert.equal(app.formatTime(0),'0.001秒未満');
  } finally {
    if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;
    if(previous.Worker===undefined)delete globalThis.Worker;else globalThis.Worker=previous.Worker;
    if(previous.crypto)Object.defineProperty(globalThis,'crypto',previous.crypto);
  }
});
