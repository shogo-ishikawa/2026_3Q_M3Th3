import test from 'node:test';
import assert from 'node:assert/strict';
import {FaceInferenceClient} from '../inference-client.js';
class MockWorker {
  constructor(handler){this.handler=handler;this.listeners={};this.requests=[];this.terminated=false;}
  addEventListener(type,callback){this.listeners[type]=callback;}
  postMessage(message,transfer){this.requests.push({message,transfer});this.handler?.(message,this);}
  result(id,value){this.listeners.message({data:{id,type:'result',value}});}
  terminate(){this.terminated=true;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('worker transport clones the frame, preserves source and reports the processing backend',async()=>{
  let sourceClosed=0,cloneClosed=0;const source={close(){sourceClosed++;}};
  const worker=new MockWorker((m,w)=>queueMicrotask(()=>{
    if(m.type==='load'){w.listeners.message({data:{id:m.id,type:'progress',value:{percent:50}}});w.result(m.id,{ready:true});}
    else{assert.notEqual(m.source,source);m.source.close();w.result(m.id,{faces:[],width:10,height:10,elapsedMs:2});}
  }));
  const progress=[];const client=new FaceInferenceClient({workerFactory:()=>worker,bitmapFactory:async()=>({close(){cloneClosed++;}})});
  await client.load(p=>progress.push(p));const result=await client.analyze(source,{maxFaces:50,profile:'group'});
  assert.equal(client.backend,'worker-wasm');assert.equal(result.backend,'worker-wasm');assert.ok(result.roundTripMs>=0);
  assert.equal(progress[0].percent,50);assert.equal(sourceClosed,0);assert.equal(cloneClosed,1);
  assert.equal(worker.requests[1].message.options.maxFaces,50);assert.equal(worker.requests[1].transfer.length,1);
  await client.dispose();assert.equal(worker.terminated,true);assert.equal(client.ready,false);
});

test('busy transport rejects overlapping work and disposal cancels its result',async()=>{
  let cloneClosed=0;
  const worker=new MockWorker((m,w)=>{if(m.type==='load')queueMicrotask(()=>w.result(m.id,{ready:true}));});
  const client=new FaceInferenceClient({workerFactory:()=>worker,bitmapFactory:async()=>({close(){cloneClosed++;}})});
  await client.load();const pending=client.analyze({});await flush();
  await assert.rejects(client.analyze({}),/ひとつ前/);
  const rejected=assert.rejects(pending,e=>e.name==='AbortError');await client.dispose();await rejected;
  assert.equal(client.busy,false);assert.equal(cloneClosed,1);
});

test('worker startup failure uses a clearly identified main-thread fallback',async()=>{
  let mainLoads=0;
  const worker=new MockWorker(()=>{throw Error('Worker unsupported');});
  const fakeEngine={load:async()=>{mainLoads++;},analyze:async()=>({faces:[],elapsedMs:1}),dispose:async()=>{}};
  const client=new FaceInferenceClient({workerFactory:()=>worker,bitmapFactory:async x=>x,engineFactory:()=>fakeEngine});
  await client.load();assert.equal(client.ready,true);assert.equal(client.backend,'main-wasm');assert.ok(client.fallbackReason);assert.equal(mainLoads,1);
  assert.equal((await client.analyze({})).backend,'main-wasm');await client.dispose();
});

test('model integrity failure does not bypass validation by retrying another backend',async()=>{
  let mainLoads=0;
  const worker=new MockWorker((m,w)=>queueMicrotask(()=>w.listeners.message({data:{id:m.id,type:'error',message:'SHA-256 mismatch',modelFailure:true}})));
  const client=new FaceInferenceClient({workerFactory:()=>worker,bitmapFactory:async x=>x,engineFactory:()=>{mainLoads++;return {};}});
  await assert.rejects(client.load(),/SHA-256/);assert.equal(mainLoads,0);assert.equal(client.ready,false);await client.dispose();
});

test('a late error from a disposed worker cannot terminate a replacement',async()=>{
  const workers=[];
  const client=new FaceInferenceClient({workerFactory:()=>{const w=new MockWorker((m,x)=>queueMicrotask(()=>x.result(m.id,{ready:true})));workers.push(w);return w;},bitmapFactory:async x=>x});
  await client.load();await client.dispose();await client.load();workers[0].listeners.error({});
  assert.equal(workers[1].terminated,false);assert.equal(client.ready,true);await client.dispose();
});


test('a worker crash after loading invalidates readiness and the next load recovers in the fallback',async()=>{
  let loaded=0;
  const worker=new MockWorker((m,w)=>queueMicrotask(()=>w.result(m.id,{ready:true})));
  const client=new FaceInferenceClient({workerFactory:()=>worker,bitmapFactory:async x=>x,engineFactory:()=>({load:async()=>{loaded++;},analyze:async()=>({faces:[]}),dispose:async()=>{}})});
  await client.load();worker.listeners.error({});assert.equal(client.ready,false);
  await assert.rejects(client.analyze({}),/準備/);await client.load();assert.equal(loaded,1);assert.equal(client.backend,'main-wasm');await client.dispose();
});

test('worker initialisation receives the same engine options as the fallback',async()=>{
  const worker=new MockWorker((m,w)=>queueMicrotask(()=>w.result(m.id,{ready:true})));
  const client=new FaceInferenceClient({engineOptions:{maxSize:1280,detectThreshold:.9},workerFactory:()=>worker,bitmapFactory:async x=>x});
  await client.load();assert.deepEqual(worker.requests[0].message.engineOptions,{maxSize:1280,detectThreshold:.9});await client.dispose();
});


test('disposing during model loading does not reuse the cancelled load on an immediate restart',async()=>{
  const workers=[];
  const client=new FaceInferenceClient({workerFactory:()=>{const worker=new MockWorker((m,w)=>{if(workers.length>1)queueMicrotask(()=>w.result(m.id,{ready:true}));});workers.push(worker);return worker;},bitmapFactory:async x=>x});
  const first=client.load();const rejected=assert.rejects(first,e=>e.name==='AbortError');await client.dispose();
  await client.load();await rejected;assert.equal(workers.length,2);assert.equal(client.ready,true);await client.dispose();
});
