import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_BPM, DEMO_BEATS, DEMO_CLIPS, DEMO_PACKS, getDemoClips, findDemoClip, synthClip, createDemoBuffer } from '../demo.js';

function analyse(samples) {
  let energy = 0;
  let peak = 0;
  let mean = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), 'every sample must be finite');
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    mean += sample;
  }
  return { rms: Math.sqrt(energy / samples.length), peak, mean: mean / samples.length };
}

test('16 original clip IDs are unique and arranged in four matching parts', () => {
  assert.equal(DEMO_CLIPS.length, 16);
  assert.equal(new Set(DEMO_CLIPS.map(clip => clip.id)).size, 16);
  assert.deepEqual(DEMO_CLIPS.map(clip => clip.part),
    ['drums', 'bass', 'chords', 'lead'].flatMap(part => Array(4).fill(part)));
  assert.equal(DEMO_BPM, 120);
  assert.equal(DEMO_BEATS, 8);
});

test('all loops are exactly eight beats with useful energy and conservative headroom', () => {
  for (let index = 0; index < 16; index += 1) {
    const samples = synthClip(index, 8000);
    assert.equal(samples.length, 8000 * DEMO_BEATS * 60 / DEMO_BPM);
    const { rms, peak, mean } = analyse(samples);
    assert.ok(rms > 0.012, `clip ${index} must be audible`);
    assert.ok(peak <= 0.361, `clip ${index} must leave mixing headroom`);
    assert.ok(Math.abs(mean) < 0.002, `clip ${index} must not have a DC offset`);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    assert.ok(Math.abs(samples[1]) < 0.07, 'attack taper should prevent a full-scale first step');
    assert.ok(Math.abs(samples.at(-2)) < 0.07, 'release taper should prevent a full-scale final step');
  }
});

test('same IDs reconstruct byte-identical loops and alternatives differ', () => {
  const fingerprints = [];
  for (let index = 0; index < 16; index += 1) {
    const first = synthClip(index, 8000);
    assert.deepEqual(first, synthClip(index, 8000));
    // Comparing whole buffers catches accidental duplicate patterns, including quiet ones.
    for (const previous of fingerprints) assert.notDeepEqual(first, previous);
    fingerprints.push(first);
  }
});

test('normal playback sample rates preserve tempo and finite samples', () => {
  for (const sampleRate of [22050, 44100, 48000]) {
    for (const index of [0, 5, 10, 15]) {
      const samples = synthClip(index, sampleRate);
      assert.equal(samples.length / sampleRate, 4);
      assert.ok(analyse(samples).rms > 0.012);
    }
  }
});

test('the introductory four-part mix leaves headroom without a limiter', () => {
  const layers = [0, 4, 8, 12].map(index => synthClip(index, 22050));
  const mix = new Float32Array(layers[0].length);
  for (let i = 0; i < mix.length; i += 1) {
    mix[i] = layers.reduce((sum, layer) => sum + layer[i], 0);
  }
  const { peak, rms } = analyse(mix);
  assert.ok(peak < 0.85, 'the one-click introductory mix must not depend on compression to avoid clipping');
  assert.ok(rms > 0.08, 'the introductory mix must have useful programme level');
});

test('createDemoBuffer uses the real context sample rate and copies the samples', () => {
  let channel;
  const context = {
    sampleRate: 48000,
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1);
      assert.equal(length, 192000);
      assert.equal(sampleRate, 48000);
      channel = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: index => {
        assert.equal(index, 0);
        return channel;
      } };
    },
  };
  const buffer = createDemoBuffer(context, 3);
  assert.equal(buffer.duration, 4);
  assert.deepEqual(channel, synthClip(3, 48000));
});

test('invalid demo selections and sample rates fail before allocating audio', () => {
  for (const index of [-1, 16, 0.5, NaN, '0']) assert.throws(() => synthClip(index), RangeError);
  for (const rate of [0, 7999, 192001, 44100.5, Infinity]) assert.throws(() => synthClip(0, rate), RangeError);
});


test('three distinct packs expose 48 stable clip identities and preserve saved House IDs', () => {
  assert.deepEqual(DEMO_PACKS.map(p=>[p.id,p.bpm,p.beats]),[['house',120,8],['lofi',90,8],['techno',132,8]]);
  const ids=[];
  for(const pack of DEMO_PACKS){
    const clips=getDemoClips(pack.id);assert.equal(clips.length,16);
    assert.deepEqual(clips.map(clip=>clip.part),['drums','bass','chords','lead'].flatMap(part=>Array(4).fill(part)));
    clips.forEach((clip,index)=>{ids.push(clip.id);assert.deepEqual(findDemoClip(clip.id),{packId:pack.id,index});});
  }
  assert.equal(new Set(ids).size,48);
  assert.equal(getDemoClips('house'),DEMO_CLIPS);
  assert.deepEqual(findDemoClip('neon-four'),{packId:'house',index:0});
  assert.equal(findDemoClip('not-saved'),null);assert.equal(findDemoClip(null),null);
  assert.throws(()=>getDemoClips('missing'),RangeError);assert.throws(()=>getDemoClips('__proto__'),RangeError);
  assert.throws(()=>synthClip(0,8000,'missing'),RangeError);
});

test('every new loop has eight beats, finite audible samples and mixing headroom',()=>{
  for(const pack of DEMO_PACKS.filter(p=>p.id!=='house'))for(let i=0;i<16;i++){
    const samples=synthClip(i,8000,pack.id),stats=analyse(samples);
    assert.equal(samples.length,Math.round(8*60/pack.bpm*8000));
    assert.ok(stats.rms>0.012,`${pack.id}/${i} audible`);
    assert.ok(stats.peak<=0.331,`${pack.id}/${i} headroom`);
    assert.ok(Math.abs(stats.mean)<0.002);
    assert.equal(Math.abs(samples[0]),0);assert.equal(Math.abs(samples.at(-1)),0);
    assert.deepEqual(samples,synthClip(i,8000,pack.id));
  }
});

test('new introductory mixes leave room for DJ samples without relying on limiting',()=>{
  for(const pack of DEMO_PACKS){
    const layers=[0,4,8,12].map(i=>synthClip(i,8000,pack.id));
    const mix=new Float32Array(layers[0].length);
    for(let i=0;i<mix.length;i++)mix[i]=layers.reduce((sum,layer)=>sum+layer[i],0);
    const stats=analyse(mix);assert.ok(stats.peak<0.85);assert.ok(stats.rms>0.08);
  }
});

test('Lo-fi and Techno are new arrangements rather than speed presets',()=>{
  // Compare energy over beat-aligned eighth-note windows, independent of loop length.
  const signature=(pack,index)=>{
    const data=synthClip(index,8000,pack),windows=Array(32).fill(0);
    for(let i=0;i<data.length;i++)windows[Math.min(31,Math.floor(i/data.length*32))]+=data[i]*data[i];
    const total=windows.reduce((a,b)=>a+b,0);return windows.map(n=>n/total);
  };
  for(const index of [0,4,8,12]){
    const a=signature('house',index),b=signature('lofi',index),c=signature('techno',index);
    const distance=(x,y)=>x.reduce((sum,n,i)=>sum+Math.abs(n-y[i]),0);
    assert.ok(distance(a,b)>0.08,`Lo-fi part ${index/4} must differ in rhythm/envelope`);
    assert.ok(distance(b,c)>0.08,`Techno part ${index/4} must differ in rhythm/envelope`);
  }
});

test('pack AudioBuffers use the live context rate and exact rounded eight-beat frame count',()=>{
  for(const pack of DEMO_PACKS){
    let channel;
    const context={sampleRate:44100,createBuffer(channels,length,rate){
      assert.equal(channels,1);assert.equal(rate,44100);assert.equal(length,Math.round(8*60/pack.bpm*44100));
      channel=new Float32Array(length);return{getChannelData:()=>channel};
    }};
    createDemoBuffer(context,12,pack.id);assert.deepEqual(channel,synthClip(12,44100,pack.id));
  }
});
