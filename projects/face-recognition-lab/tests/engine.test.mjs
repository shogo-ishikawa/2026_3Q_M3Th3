import test from 'node:test';
import assert from 'node:assert/strict';
import {cosine,normalise,softmax,intersectionOverUnion,nonMaximumSuppression,decodeYuNet,similarityTransform,SFACE_POINTS,rgbPlanar,greyPlanar,greyCrop,warpAligned,assessQuality,FaceEngine} from '../engine.js';

test('cosine uses direction, handles opposite/orthogonal vectors and rejects invalid data',()=>{
  assert.equal(cosine([3,0],[7,0]),1);assert.equal(cosine([3,0],[-7,0]),-1);assert.equal(cosine([0,3],[7,0]),0);
  for(const [a,b] of [[[0],[1]],[[NaN],[1]],[[1],[1,2]],[[1e308],[1e308]]])assert.throws(()=>cosine(a,b));
  assert.deepEqual(normalise([3,4]),[.6,.8]);assert.throws(()=>normalise([0,0]));assert.throws(()=>normalise([Infinity]));
});

test('stable softmax normalises logits in documented order',()=>{
  assert.deepEqual(softmax([1000,1000]),[.5,.5]);
  const p=softmax([3,0,-2]);assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(p[0]>p[1]&&p[1]>p[2]);
  assert.throws(()=>softmax([NaN]));
});

test('NMS suppresses overlapping detections, retaining independent faces and stable ties',()=>{
  const a={box:[0,0,100,100],score:.9},b={box:[5,5,100,100],score:.8},c={box:[200,200,100,100],score:.9};
  assert.equal(intersectionOverUnion(a.box,a.box),1);assert.equal(intersectionOverUnion(a.box,c.box),0);
  assert.deepEqual(nonMaximumSuppression([a,b,c]),[a,c]);
});

function outputs(size=32) {
  const out={};
  for(const s of [8,16,32])for(const [k,n] of [['cls',1],['obj',1],['bbox',4],['kps',10]])out[`${k}_${s}`]={data:new Float32Array((size/s)**2*n)};
  return out;
}

test('YuNet decodes anchor-major bbox/keypoints using sqrt(class*object) before NMS',()=>{
  const o=outputs();const i=5;
  o.cls_8.data[i]=.81;o.obj_8.data[i]=1;
  o.bbox_8.data.set([.5,.25,Math.log(2),Math.log(3)],i*4);
  o.kps_8.data.set([0,0,1,0,.5,1,0,2,1,2],i*10);
  const [f]=decodeYuNet(o,{size:32,scoreThreshold:.8});
  assert.ok(Math.abs(f.score-.9)<1e-6);assert.ok(Math.abs(f.box[0]-4)<1e-5);assert.ok(Math.abs(f.box[1]+2)<1e-5);
  assert.ok(Math.abs(f.box[2]-16)<1e-5);assert.ok(Math.abs(f.box[3]-24)<1e-5);
  assert.deepEqual(f.landmarks,[[8,8],[16,8],[12,16],[8,24],[16,24]]);
  assert.equal(decodeYuNet(o,{size:32,scoreThreshold:.95}).length,0);
  assert.throws(()=>decodeYuNet({}, {size:32}),/形式/);
});

test('YuNet clamps probability scores and discards nonfinite geometry',()=>{
  const o=outputs();o.cls_8.data[0]=2;o.obj_8.data[0]=2;o.bbox_8.data[2]=Infinity;
  assert.equal(decodeYuNet(o,{size:32}).length,0);
});

test('alignment recovers translation, scale and rotation without reflecting the face',()=>{
  const angle=.3,scale=1.8,c=Math.cos(angle),s=Math.sin(angle);
  const points=SFACE_POINTS.map(([x,y])=>[scale*(c*x-s*y)+20,scale*(s*x+c*y)-10]);
  const m=similarityTransform(points);
  for(let i=0;i<5;i++){
    assert.ok(Math.abs(m[0]*points[i][0]+m[1]*points[i][1]+m[2]-SFACE_POINTS[i][0])<1e-9);
    assert.ok(Math.abs(m[3]*points[i][0]+m[4]*points[i][1]+m[5]-SFACE_POINTS[i][1])<1e-9);
  }
  assert.ok(m[0]*m[4]-m[1]*m[3]>0);
  assert.throws(()=>similarityTransform(Array.from({length:5},()=>[1,1])));
});

test('RGB SFace and BGR YuNet inputs use raw 0..255 channels, with no extra normalisation',()=>{
  const image={width:2,height:1,data:new Uint8ClampedArray([10,20,30,255,40,50,60,255])};
  assert.deepEqual([...rgbPlanar(image)],[10,40,20,50,30,60]);
  assert.deepEqual([...rgbPlanar(image,'bgr')],[30,60,20,50,10,40]);
  assert.deepEqual([...greyPlanar(image)],[18,48]);
});

test('identity alignment preserves pixels and zero-pads outside the image',()=>{
  const data=Uint8ClampedArray.from({length:112*112*4},(_,i)=>i%4===3?255:Math.floor(i/4)%256);
  const warped=warpAligned({width:112,height:112,data},SFACE_POINTS);
  assert.deepEqual(warped.data,data);
  const shifted=warpAligned({width:112,height:112,data},SFACE_POINTS.map(([x,y])=>[x+500,y]));
  assert.equal(shifted.data[0],0);assert.equal(shifted.data[3],255);
});

test('FER+ preprocessing converts to grey before bilinear resizing and clamps crop edges',()=>{
  const image={width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])};
  assert.deepEqual([...greyCrop(image,[0,0,2,2],2)],[76,150,29,255]);
  assert.deepEqual([...greyCrop(image,[0,0,2,2],1)],[128]);
  assert.throws(()=>greyCrop(image,[200,200,2,2]));
});

test('quality gives finite diagnostics and actionable feedback for a dark small face',()=>{
  const data=new Uint8ClampedArray(112*112*4),face={box:[0,0,50,50],landmarks:SFACE_POINTS.map(p=>p.map(v=>v*.4))};
  const q=assessQuality({width:112,height:112,data},face);
  assert.ok(q.score>=0&&q.score<70);assert.equal(q.brightness,0);assert.ok(q.advice.length>=2);assert.ok(Number.isFinite(q.yaw));
});

test('engine validates options and refuses use before model loading',async()=>{
  assert.throws(()=>new FaceEngine({detectThreshold:2}));
  const engine=new FaceEngine();await assert.rejects(engine.analyze({width:10,height:10}),/準備/);
});
