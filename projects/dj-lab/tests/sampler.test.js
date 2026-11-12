import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE_META,SAMPLE_KEYS,synthSample,createSampleBuffer} from '../sampler.js';

function statistics(data){
  let energy=0,peak=0,mean=0;
  for(const sample of data){assert.ok(Number.isFinite(sample));energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));mean+=sample;}
  return{peak,rms:Math.sqrt(energy/data.length),mean:mean/data.length};
}

test('16 sampler sounds have unique keys and identities without replacing the original pad keys',()=>{
  assert.equal(SAMPLE_META.length,16);assert.equal(new Set(SAMPLE_META.map(s=>s.id)).size,16);
  assert.deepEqual(SAMPLE_KEYS,['2','4','6','8','w','r','y','i','s','f','h','k','x','v','n',',']);
  assert.equal(SAMPLE_META[12].name,'ボイス風');
  assert.equal(SAMPLE_META.filter(s=>s.group==='drums').length,8);
  assert.equal(SAMPLE_META.filter(s=>s.group==='effects').length,8);
});

test('every sample is finite, audible, short and conservatively bounded at supported tempos',()=>{
  for(const bpm of [40,90,120,132,200])for(let i=0;i<16;i++){
    const data=synthSample(i,8000,bpm),stats=statistics(data);
    assert.ok(data.length>=800&&data.length<=32000,`${i} must last 0.1–4 seconds`);
    assert.ok(stats.rms>0.008,`${i} must have an audible signal`);
    assert.ok(stats.peak<=0.451,`${i} must leave headroom`);
    assert.ok(Math.abs(stats.mean)<0.003);
    assert.equal(Math.abs(data[0]),0);assert.equal(Math.abs(data.at(-1)),0);
  }
});

test('one-shots reconstruct deterministically and every sound has a different waveform',()=>{
  const sounds=Array.from({length:16},(_,i)=>synthSample(i,8000));
  sounds.forEach((data,i)=>{assert.deepEqual(data,synthSample(i,8000));for(let j=0;j<i;j++)assert.notDeepEqual(data,sounds[j]);});
});

test('fills and transitions follow tempo while percussive hits retain their duration',()=>{
  for(const index of [7,8,9,15])assert.ok(synthSample(index,8000,90).length>synthSample(index,8000,132).length);
  for(const index of [0,1,2,3,4,5,6,10,11,12,13,14])assert.equal(synthSample(index,8000,90).length,synthSample(index,8000,132).length);
});

test('AudioBuffers contain mono samples at the actual audio context rate',()=>{
  let channel;
  const context={sampleRate:48000,createBuffer(channels,length,rate){
    assert.equal(channels,1);assert.equal(rate,48000);channel=new Float32Array(length);return{getChannelData:()=>channel};
  }};
  createSampleBuffer(context,8,132);assert.deepEqual(channel,synthSample(8,48000,132));
  assert.ok(statistics(channel).rms>0.008);
});

test('invalid sound, tempo and sample-rate requests are rejected before allocating PCM',()=>{
  for(const i of [-1,16,0.5,NaN,'1'])assert.throws(()=>synthSample(i),RangeError);
  for(const rate of [0,7999,192001,44100.5,Infinity])assert.throws(()=>synthSample(0,rate),RangeError);
  for(const bpm of [0,39,201,NaN,Infinity,'120'])assert.throws(()=>synthSample(0,8000,bpm),RangeError);
});
