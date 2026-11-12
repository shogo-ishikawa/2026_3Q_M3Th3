import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSession,MAX_FILE_BYTES} from '../storage.js';
const session=()=>({version:1,bpm:120,quantise:8,exclusive:true,master:{volume:0.75,filter:1,echo:0,low:0,high:0},slots:Array(16).fill(null)});
const clip=()=>({name:'local.wav',kind:'file',raw:new ArrayBuffer(12),volume:0.75,pan:0,beats:8,loop:true,sync:false,muted:false});
test('round trip preserves local bytes, silent empty pads and settings',()=>{
 const data=session();data.slots[3]=clip();data.slots[3].raw=new Uint8Array([0,1,255]).buffer;
 const clean=validateSession(structuredClone(data));
 assert.deepEqual(new Uint8Array(clean.slots[3].raw),new Uint8Array([0,1,255]));
 assert.equal(clean.slots[2],null);assert.equal(clean.slots[3].sync,false);
});
test('reject corrupt or incompatible snapshots before audio replacement',()=>{
 for(const value of [null,{}, {...session(),version:2},{...session(),slots:[]},{...session(),bpm:NaN},{...session(),bpm:201},{...session(),quantise:2}])assert.throws(()=>validateSession(value));
});
test('reject malformed audio and unbounded parameters',()=>{
 for(const change of [{raw:'data'},{raw:new ArrayBuffer(0)},{raw:new ArrayBuffer(MAX_FILE_BYTES+1)},{volume:Infinity},{pan:2},{beats:0},{loop:'true'},{kind:'remote'}]){
  const data=session();data.slots[0]={...clip(),...change};assert.throws(()=>validateSession(data));
 }
});
test('only recognised fields survive storage validation',()=>{
 const data=session();data.slots[0]={...clip(),remoteUrl:'https://invalid.example',unexpected:true};
 const clean=validateSession(data);assert.equal('remoteUrl' in clean.slots[0],false);assert.equal('unexpected' in clean.slots[0],false);
});
test('generated demos restore by stable identity without storing music files',()=>{
 const data=session();data.slots[0]={...clip(),kind:'demo',demoId:'neon-four',raw:null};
 const clean=validateSession(data);assert.equal(clean.slots[0].demoId,'neon-four');assert.equal(clean.slots[0].raw,null);
});
test('v1.0 snapshots receive neutral performance defaults without losing clips',()=>{
 const data=session();data.slots[0]={...clip(),kind:'demo',demoId:'neon-four',raw:null};
 const clean=validateSession(data);
 assert.equal(clean.demoPack,'house');assert.equal(clean.master.balance,0.5);
 assert.deepEqual(clean.sampler,{volume:0.7,quantise:0});assert.equal(clean.slots[0].demoId,'neon-four');
});
test('v1.1 pack, part fader and sampler settings survive reload validation',()=>{
 const data=session();data.demoPack='lofi';data.master.balance=0.23;data.sampler={volume:0.4,quantise:1};
 const clean=validateSession(data);assert.equal(clean.demoPack,'lofi');assert.equal(clean.master.balance,0.23);assert.deepEqual(clean.sampler,data.sampler);
 for(const invalid of [{demoPack:'unknown'},{sampler:{volume:2,quantise:0}},{sampler:{volume:0.7,quantise:8}}])assert.throws(()=>validateSession({...data,...invalid}));
});
