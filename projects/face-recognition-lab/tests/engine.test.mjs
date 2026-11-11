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

test('group regions cover every edge, retain overview and use a bounded number of overlapping passes',async()=>{
  const {detectionRegions}=await import('../engine.js');
  assert.deepEqual(detectionRegions(640,480),[{x:0,y:0,width:640,height:480,kind:'overview'}]);
  assert.equal(detectionRegions(800,800,'group').length,1);
  for(const [width,height] of [[1920,1080],[1920,1920],[1280,300],[300,1280]]){
    const regions=detectionRegions(width,height,'group');
    assert.ok(regions.length>1&&regions.length<=10);
    const tiles=regions.filter(r=>r.kind==='tile');
    for(const x of [0,width-1])for(const y of [0,height-1])assert.ok(tiles.some(r=>r.x<=x&&x<r.x+r.width&&r.y<=y&&y<r.y+r.height));
    assert.ok(regions.every(r=>r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height));
  }
  assert.throws(()=>detectionRegions(1921,1080,'group'));
});

test('tile detections restore box and all landmarks before global duplicate suppression',async()=>{
  const {mapDetection}=await import('../engine.js');
  const face={box:[20,40,60,80],score:.9,landmarks:[[25,45],[45,45],[35,55],[25,65],[45,65]]};
  const mapped=mapDetection(face,{x:100,y:200},.5);
  assert.deepEqual(mapped.box,[140,280,120,160]);assert.deepEqual(mapped.landmarks[0],[150,290]);
  const duplicate={...mapped,score:.8};assert.deepEqual(nonMaximumSuppression([mapped,duplicate]),[mapped]);
  assert.throws(()=>mapDetection(face,{x:0,y:0},0));
});

test('fast and group options permit 50 fresh face computations without weakening detector confidence',async()=>{
  const {analysisOptions,MAX_FACES}=await import('../engine.js');
  assert.equal(MAX_FACES,50);assert.deepEqual(analysisOptions(),{maxFaces:6,expressions:false,profile:'fast',workingSize:640});
  assert.equal(analysisOptions({maxFaces:50,profile:'group'}).workingSize,1920);
  assert.equal(analysisOptions({profile:'group'},1280).workingSize,1280);
  for(const options of [{maxFaces:51},{maxFaces:0},{maxFaces:2.2},{expressions:'false'},{profile:'unbounded'}])assert.throws(()=>analysisOptions(options));
});

test('all selected faces receive fresh embeddings, and fast matching never executes the expression network',async()=>{
  const oldCanvas=globalThis.OffscreenCanvas;
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;}
    getContext(){return {fillRect(){},drawImage(){},getImageData:()=>({width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4).fill(128)})};}
  }
  globalThis.OffscreenCanvas=Canvas;
  try{
    const out=outputs(640);
    for(let n=0;n<8;n++){
      const col=5+n*9,row=12,i=row*80+col;
      out.cls_8.data[i]=1;out.obj_8.data[i]=1;out.bbox_8.data.set([0,0,Math.log(50/8),Math.log(60/8)],i*4);
      const points=[[-2,-1],[2,-1],[0,0],[-1.5,2],[1.5,2]];out.kps_8.data.set(points.flat(),i*10);
    }
    const engine=new FaceEngine();let embeddings=0;
    engine.ready=true;engine.ort={Tensor:class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}};
    engine.sessions={detector:{inputNames:['x'],run:async()=>out},recognizer:{inputNames:['x'],outputNames:['embedding'],run:async()=>{embeddings++;return {embedding:{data:Float32Array.from({length:128},(_,i)=>i===embeddings%128?1:0)}};}},expression:{run:async()=>{throw Error('FER+ should not run in fast matching');}}};
    const result=await engine.analyze({width:640,height:480},{maxFaces:6,expressions:false});
    assert.equal(result.detectedCount,8);assert.equal(result.processedCount,6);assert.equal(result.limitedCount,2);assert.equal(result.unprocessedCount,2);assert.equal(result.unprocessedFaces.length,2);assert.ok(result.unprocessedFaces.every(f=>f.embedding===undefined));assert.equal(embeddings,6);
    assert.ok(result.faces.every(f=>f.embedding.length===128&&f.expression===null));
    await engine.analyze({width:640,height:480},{maxFaces:50});assert.equal(embeddings,14);
  }finally{if(oldCanvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=oldCanvas;}
});
