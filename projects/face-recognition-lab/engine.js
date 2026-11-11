import {MODEL_FILES, EXPRESSION_LABELS} from './model-config.js';

export {EXPRESSION_LABELS};
export const DETECTOR_SIZE = 640;
export const SFACE_POINTS = Object.freeze([
  [38.2946,51.6963], [73.5318,51.5014], [56.0252,71.7366],
  [41.5493,92.3655], [70.7299,92.2041],
].map(Object.freeze));

function validVector(v, expected) {
  return (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === expected && Array.from(v).every(Number.isFinite);
}

export function normalise(vector) {
  if (!vector || !vector.length || !Array.from(vector).every(Number.isFinite)) throw new Error('特徴量に不正な値があります。');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('特徴量を計算できませんでした。顔を正面から撮り直してください。');
  return Array.from(vector, x => x / norm);
}

export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length || !Array.from(a).every(Number.isFinite) || !Array.from(b).every(Number.isFinite)) throw new Error('比較する特徴量の形式が違います。');
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na <= 1e-12 || nb <= 1e-12) throw new Error('不正な特徴量は比較できません。');
  let dot = 0;
  for (let i=0;i<a.length;i++) dot += a[i]*b[i];
  const score=dot/(na*nb);
  if(!Number.isFinite(score))throw new Error('特徴量が大きすぎて比較できません。');
  return Math.max(-1, Math.min(1, score));
}

export function softmax(values) {
  if (!values?.length || !Array.from(values).every(Number.isFinite)) throw new Error('表情の出力を読み取れませんでした。');
  const max = Math.max(...values), exp = Array.from(values, x=>Math.exp(x-max));
  const sum = exp.reduce((a,b)=>a+b,0);
  return exp.map(x=>x/sum);
}

export function intersectionOverUnion(a,b) {
  const x = Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]));
  const y = Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
  const intersection = x*y;
  const union = a[2]*a[3]+b[2]*b[3]-intersection;
  return union > 0 ? intersection/union : 0;
}

export function nonMaximumSuppression(candidates, threshold=0.3, limit=5000) {
  const sorted = candidates.filter(f=>validVector(f.box,4) && f.box[2]>0 && f.box[3]>0 && Number.isFinite(f.score))
    .map((face,index)=>({face,index})).sort((a,b)=>b.face.score-a.face.score || a.index-b.index).slice(0,limit);
  const kept = [];
  for (const {face} of sorted) if (kept.every(other=>intersectionOverUnion(face.box,other.box)<=threshold)) kept.push(face);
  return kept;
}

// YuNet decoding follows OpenCV 4.11.0 face_detect.cpp. Outputs are anchor-major.
export function decodeYuNet(outputs, {size=DETECTOR_SIZE, scoreThreshold=0.8, nmsThreshold=0.3}={}) {
  if (!Number.isInteger(size) || size<32 || size%32 || !Number.isFinite(scoreThreshold) || scoreThreshold<0 || scoreThreshold>1) throw new Error('顔検出の設定が不正です。');
  const faces=[];
  for (const stride of [8,16,32]) {
    const cols = size/stride, count=cols*cols;
    const get = (key,n) => {
      const value = outputs[`${key}_${stride}`]?.data ?? outputs[`${key}_${stride}`];
      if (!value || value.length!==count*n) throw new Error(`顔検出モデルの出力形式が違います（${key}_${stride}）。`);
      return value;
    };
    const cls=get('cls',1),obj=get('obj',1),bbox=get('bbox',4),kps=get('kps',10);
    for (let i=0;i<count;i++) {
      const score=Math.sqrt(Math.max(0,Math.min(1,cls[i]))*Math.max(0,Math.min(1,obj[i])));
      if (!Number.isFinite(score) || score<scoreThreshold) continue;
      const row=Math.floor(i/cols),col=i%cols;
      const cx=(col+bbox[i*4])*stride,cy=(row+bbox[i*4+1])*stride;
      const width=Math.exp(bbox[i*4+2])*stride,height=Math.exp(bbox[i*4+3])*stride;
      const box=[cx-width/2,cy-height/2,width,height];
      const landmarks=Array.from({length:5},(_,j)=>[(kps[i*10+j*2]+col)*stride,(kps[i*10+j*2+1]+row)*stride]);
      if (validVector(box,4) && width>0 && height>0 && landmarks.every(p=>validVector(p,2))) faces.push({box,landmarks,score});
    }
  }
  return nonMaximumSuppression(faces,nmsThreshold);
}

// Least-squares similarity transform, source -> the five SFace reference points.
// Restricting the matrix to a rotation and uniform scale preserves face geometry.
export function similarityTransform(points, target=SFACE_POINTS) {
  if (!Array.isArray(points) || points.length!==5 || !points.every(p=>validVector(p,2)) || target.length!==5 || !target.every(p=>validVector(p,2))) throw new Error('顔の目印を5点読み取れませんでした。');
  const mean=ps=>ps.reduce((m,p)=>[m[0]+p[0]/5,m[1]+p[1]/5],[0,0]);
  const sm=mean(points),tm=mean(target);
  let denom=0,aa=0,bb=0;
  for (let i=0;i<5;i++) {
    const x=points[i][0]-sm[0],y=points[i][1]-sm[1],u=target[i][0]-tm[0],v=target[i][1]-tm[1];
    denom+=x*x+y*y;aa+=x*u+y*v;bb+=x*v-y*u;
  }
  if (denom<=1e-8) throw new Error('顔の目印が重なっています。撮り直してください。');
  const a=aa/denom,b=bb/denom;
  if (a*a+b*b<=1e-12) throw new Error('顔の位置合わせを計算できませんでした。');
  return [a,-b,tm[0]-a*sm[0]+b*sm[1],b,a,tm[1]-b*sm[0]-a*sm[1]];
}

function validateImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width<1 || image.height<1 || image.width*image.height>16_777_216 || image.data?.length!==image.width*image.height*4) throw new Error('画像を読み取れませんでした。');
}

function sample(image,x,y,channel,borderZero=false) {
  const {width:w,height:h,data}=image;
  if (!borderZero) { x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y)); }
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const pixel=(xx,yy)=>xx<0||xx>=w||yy<0||yy>=h ? 0 : data[(yy*w+xx)*4+channel];
  return pixel(x0,y0)*(1-fx)*(1-fy)+pixel(x0+1,y0)*fx*(1-fy)+pixel(x0,y0+1)*(1-fx)*fy+pixel(x0+1,y0+1)*fx*fy;
}

export function warpAligned(image,points,size=112) {
  validateImage(image);
  const m=similarityTransform(points),det=m[0]*m[4]-m[1]*m[3];
  const data=new Uint8ClampedArray(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const px=x-m[2],py=y-m[5];
    const sx=(m[4]*px-m[1]*py)/det,sy=(-m[3]*px+m[0]*py)/det;
    const offset=(y*size+x)*4;
    for (let c=0;c<3;c++) data[offset+c]=sample(image,sx,sy,c,true);
    data[offset+3]=255;
  }
  return {data,width:size,height:size};
}

export function rgbPlanar(image, order='rgb') {
  validateImage(image);
  if (order!=='rgb' && order!=='bgr') throw new Error('画像の色順が不正です。');
  const pixels=image.width*image.height,out=new Float32Array(pixels*3);
  const channels=order==='rgb'?[0,1,2]:[2,1,0];
  for (let c=0;c<3;c++) for (let i=0;i<pixels;i++) out[c*pixels+i]=image.data[i*4+channels[c]];
  return out;
}

export function resizedCrop(image,box,size=64,margin=0) {
  validateImage(image);
  if (!validVector(box,4) || box[2]<=0 || box[3]<=0) throw new Error('顔の範囲が不正です。');
  const mx=Math.round(box[2]*margin),my=Math.round(box[3]*margin);
  const x0=Math.max(0,Math.round(box[0])-mx),y0=Math.max(0,Math.round(box[1])-my);
  const x1=Math.min(image.width,Math.round(box[0]+box[2])+mx),y1=Math.min(image.height,Math.round(box[1]+box[3])+my);
  if (x1-x0<2||y1-y0<2) throw new Error('顔が画像の外にあります。');
  const data=new Uint8ClampedArray(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const sx=Math.max(x0,Math.min(x1-1,x0+(x+.5)*(x1-x0)/size-.5));
    const sy=Math.max(y0,Math.min(y1-1,y0+(y+.5)*(y1-y0)/size-.5));
    const i=(y*size+x)*4;
    for (let c=0;c<3;c++) data[i+c]=sample(image,sx,sy,c);
    data[i+3]=255;
  }
  return {data,width:size,height:size};
}

export function greyPlanar(image) {
  validateImage(image);
  return Float32Array.from({length:image.width*image.height},(_,i)=>Math.round(.299*image.data[i*4]+.587*image.data[i*4+1]+.114*image.data[i*4+2]));
}

// FER+ follows the Python version: greyscale first, then resize (not vice versa).
export function greyCrop(image,box,size=64,margin=0) {
  validateImage(image);
  if(!validVector(box,4)||box[2]<=0||box[3]<=0)throw new Error('顔の範囲が不正です。');
  const bx=Math.round(box[0]),by=Math.round(box[1]),bw=Math.round(box[2]),bh=Math.round(box[3]);
  const mx=Math.floor(bw*margin),my=Math.floor(bh*margin);
  const x0=Math.max(0,bx-mx),y0=Math.max(0,by-my),x1=Math.min(image.width,bx+bw+mx),y1=Math.min(image.height,by+bh+my);
  if(x1-x0<2||y1-y0<2)throw new Error('顔が画像の外にあります。');
  const w=x1-x0,h=y1-y0,grey=new Float32Array(w*h),out=new Float32Array(size*size);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {const i=((y0+y)*image.width+x0+x)*4;grey[y*w+x]=Math.round(.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2]);}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const sx=Math.max(0,Math.min(w-1,(x+.5)*w/size-.5)),sy=Math.max(0,Math.min(h-1,(y+.5)*h/size-.5));
    const xx=Math.floor(sx),yy=Math.floor(sy),dx=sx-xx,dy=sy-yy;
    const p=(a,b)=>grey[Math.min(h-1,b)*w+Math.min(w-1,a)];
    out[y*size+x]=Math.round(p(xx,yy)*(1-dx)*(1-dy)+p(xx+1,yy)*dx*(1-dy)+p(xx,yy+1)*(1-dx)*dy+p(xx+1,yy+1)*dx*dy);
  }
  return out;
}

export function assessQuality(image,face) {
  const grey=greyCrop(image,face.box,112);
  const mean=grey.reduce((a,b)=>a+b,0)/grey.length;
  const contrast=Math.sqrt(grey.reduce((sum,x)=>sum+(x-mean)**2,0)/grey.length);
  const lap=[];
  for(let y=1;y<111;y++)for(let x=1;x<111;x++) {const i=y*112+x;lap.push(grey[i-1]+grey[i+1]+grey[i-112]+grey[i+112]-4*grey[i]);}
  const lm=lap.reduce((a,b)=>a+b,0)/lap.length,sharpness=lap.reduce((s,x)=>s+(x-lm)**2,0)/lap.length;
  const [re,le,nose,rm,lmo]=face.landmarks;
  const eyeMid=[(re[0]+le[0])/2,(re[1]+le[1])/2],eyeDist=Math.hypot(le[0]-re[0],le[1]-re[1])+1e-6;
  const [left,right]=re[0]<=le[0]?[re,le]:[le,re];
  const yaw=(nose[0]-eyeMid[0])/eyeDist,roll=Math.atan2(right[1]-left[1],right[0]-left[0])*180/Math.PI;
  const pitch=(nose[1]-eyeMid[1])/(((rm[1]+lmo[1])/2-eyeMid[1])+1e-6);
  const size=Math.min(face.box[2],face.box[3]),advice=[];let score=100;
  if(mean<70){score-=25;advice.push('暗めです。顔の正面から光を当ててください。');}
  else if(mean>190){score-=20;advice.push('明るすぎます。逆光や強い光を避けてください。');}
  if(contrast<30){score-=10;advice.push('コントラストが低めです。');}
  if(sharpness<40){score-=20;advice.push('ぼやけています。少し動きを止めてください。');}
  if(size<80){score-=20;advice.push('顔が小さめです。カメラに近づいてください。');}
  if(Math.abs(yaw)>.3){score-=20;advice.push('登録するときは正面を向いてください。');}
  if(Math.abs(roll)>15){score-=10;advice.push('顔の傾きを小さくしてください。');}
  return {score:Math.max(0,Math.round(score)),brightness:mean,contrast,sharpness,face_size:size,yaw,roll,pitch,advice};
}

async function readModel(file,onProgress,done,total) {
  const url=new URL(file.path,import.meta.url);
  const response=await fetch(url,{credentials:'same-origin'});
  if(!response.ok) throw new Error(`${file.name}を読み込めません（HTTP ${response.status}）。ページを再読み込みしてお試しください。`);
  let bytes;
  if(response.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {done:finished,value}=await reader.read();if(finished)break;size+=value.length;if(size>file.bytes) {await reader.cancel();throw new Error(`${file.name}のファイルサイズが違います。`);}chunks.push(value);onProgress({stage:'download',percent:Math.floor((done+size)/total*85),message:`${file.name}を準備しています。`});}
    bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  }else bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==file.bytes)throw new Error(`${file.name}のデータが不足しています。再読み込みしてください。`);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==file.sha256)throw new Error(`${file.name}の検証に失敗しました。公開元の更新をお待ちください。`);
  return bytes;
}

function canvas(width,height) {
  const c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):document.createElement('canvas');
  c.width=width;c.height=height;return c;
}

export const MAX_FACES = 50;

export function detectionRegions(width,height,profile='fast') {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1920||!['fast','group'].includes(profile))throw new Error('検出する画像の設定が不正です。');
  const regions=[{x:0,y:0,width,height,kind:'overview'}];
  if(profile==='fast'||Math.max(width,height)<=960)return regions;
  const side=960,positions=length=>{if(length<=side)return [0];const out=[0];for(let start=720;start<length-side;start+=720)out.push(start);if(out[out.length-1]!==length-side)out.push(length-side);return out;};
  const rw=Math.min(width,side),rh=Math.min(height,side);
  for(const y of positions(height))for(const x of positions(width))regions.push({x,y,width:rw,height:rh,kind:'tile'});
  return regions;
}

export function mapDetection(face,region,scale) {
  if(!region||!Number.isFinite(scale)||scale<=0||!validVector(face.box,4)||face.landmarks?.length!==5||!face.landmarks.every(p=>validVector(p,2)))throw new Error('検出範囲を復元できませんでした。');
  return {...face,box:[face.box[0]/scale+region.x,face.box[1]/scale+region.y,face.box[2]/scale,face.box[3]/scale],landmarks:face.landmarks.map(([x,y])=>[x/scale+region.x,y/scale+region.y])};
}

export function analysisOptions(options={},maxSize=1920) {
  const {maxFaces=6,expressions=false,profile='fast'}=options;
  if(!Number.isInteger(maxFaces)||maxFaces<1||maxFaces>MAX_FACES||typeof expressions!=='boolean'||!['fast','group'].includes(profile))throw new Error('画像処理の設定が不正です。');
  return {maxFaces,expressions,profile,workingSize:Math.min(maxSize,profile==='group'?1920:640)};
}

export class FaceEngine {
  constructor({detectThreshold=0.8,maxSize=1920}={}) {
    if(!Number.isFinite(detectThreshold)||detectThreshold<0||detectThreshold>1||!Number.isInteger(maxSize)||maxSize<160||maxSize>1920)throw new Error('画像処理の設定が不正です。');
    this.detectThreshold=detectThreshold;this.maxSize=maxSize;this.sessions={};this.ready=false;this.busy=false;this.loading=null;this.expressionLoading=null;this.onProgress=()=>{};
  }
  async load(onProgress=()=>{},{expressions=false}={}) {
    if(typeof onProgress!=='function'||typeof expressions!=='boolean')throw new Error('モデル読み込みの設定が不正です。');
    this.onProgress=onProgress;
    if(!this.ready){
      if(!this.loading)this.loading=(async()=>{
        try{
          onProgress({stage:'runtime',percent:0,message:'画像処理の実行環境を準備しています。'});
          this.ort=await import('./vendor/ort.wasm.min.mjs');
          this.ort.env.wasm.numThreads=1;this.ort.env.wasm.proxy=false;
          this.ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;this.ort.env.logLevel='error';
          const files=MODEL_FILES.filter(f=>f.key!=='expression'),total=files.reduce((sum,f)=>sum+f.bytes,0);let done=0;
          for(const file of files){
            const bytes=await readModel(file,onProgress,done,total);done+=file.bytes;
            onProgress({stage:'compile',percent:Math.floor(done/total*90),message:`${file.name}を組み立てています。`});
            this.sessions[file.key]=await this.ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:3});
          }
          this.ready=true;onProgress({stage:'ready',percent:100,message:'照合の準備ができました。表情モデルは分析を使うときに追加します。'});
        }catch(error){await this.dispose();throw new Error(`画像処理の準備に失敗しました。${error.message||error}`);}
        finally{this.loading=null;}
      })();
      await this.loading;
    }
    if(expressions)await this.loadExpression(onProgress);
  }
  async loadExpression(onProgress=this.onProgress) {
    if(this.sessions.expression)return;
    if(!this.ready)throw new Error('先に照合モデルを準備してください。');
    if(!this.expressionLoading)this.expressionLoading=(async()=>{
      const file=MODEL_FILES.find(f=>f.key==='expression');
      try{
        onProgress({stage:'expression',percent:0,message:'分析用の表情モデル（約35 MB）を追加しています。'});
        const bytes=await readModel(file,onProgress,0,file.bytes);
        onProgress({stage:'compile',percent:90,message:'表情モデルを組み立てています。'});
        this.sessions.expression=await this.ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:3});
        onProgress({stage:'ready',percent:100,message:'表情の分析を始められます。'});
      }finally{this.expressionLoading=null;}
    })();
    return this.expressionLoading;
  }
  async analyze(source,options={},onProgress=this.onProgress) {
    if(!this.ready)throw new Error('先に画像処理の準備を開始してください。');
    if(this.busy)throw new Error('ひとつ前の画像を処理しています。');
    const {maxFaces,expressions,profile,workingSize}=analysisOptions(options,this.maxSize);
    this.busy=true;const start=performance.now();
    try{
      if(expressions)await this.loadExpression(onProgress);
      const originalWidth=source.videoWidth||source.naturalWidth||source.width,originalHeight=source.videoHeight||source.naturalHeight||source.height;
      if(!Number.isFinite(originalWidth)||!Number.isFinite(originalHeight)||originalWidth<1||originalHeight<1)throw new Error('カメラ映像または画像の読み込みをお待ちください。');
      const scale=Math.min(1,workingSize/Math.max(originalWidth,originalHeight));
      const width=Math.max(1,Math.round(originalWidth*scale)),height=Math.max(1,Math.round(originalHeight*scale));
      const frameCanvas=canvas(width,height),ctx=frameCanvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('この環境の画像描画に対応していません。');
      ctx.drawImage(source,0,0,width,height);const frame=ctx.getImageData(0,0,width,height);
      const detectorCanvas=canvas(DETECTOR_SIZE,DETECTOR_SIZE),dc=detectorCanvas.getContext('2d',{willReadFrequently:true});
      if(!dc)throw new Error('この環境の画像描画に対応していません。');
      const candidates=[],regions=detectionRegions(width,height,profile);
      for(const region of regions){
        const detectionScale=DETECTOR_SIZE/Math.max(region.width,region.height),dw=Math.round(region.width*detectionScale),dh=Math.round(region.height*detectionScale);
        dc.fillStyle='black';dc.fillRect(0,0,DETECTOR_SIZE,DETECTOR_SIZE);dc.drawImage(frameCanvas,region.x,region.y,region.width,region.height,0,0,dw,dh);
        const input=new this.ort.Tensor('float32',rgbPlanar(dc.getImageData(0,0,DETECTOR_SIZE,DETECTOR_SIZE),'bgr'),[1,3,DETECTOR_SIZE,DETECTOR_SIZE]);
        const result=await this.sessions.detector.run({[this.sessions.detector.inputNames[0]]:input});
        for(const face of decodeYuNet(result,{scoreThreshold:this.detectThreshold})){
          if(face.box[0]>=dw||face.box[1]>=dh||face.box[0]+face.box[2]<=0||face.box[1]+face.box[3]<=0)continue;
          candidates.push(mapDetection(face,region,detectionScale));
        }
      }
      const allFaces=nonMaximumSuppression(candidates,.3),selected=allFaces.slice(0,maxFaces),faces=[],unprocessedFaces=allFaces.slice(maxFaces).map(({box,landmarks,score})=>({box,landmarks,score}));
      for(const face of selected){
        let aligned;
        try{aligned=warpAligned(frame,face.landmarks);face.quality=assessQuality(frame,face);}
        catch{unprocessedFaces.push({box:face.box,landmarks:face.landmarks,score:face.score});continue;}
        const embedding=await this.sessions.recognizer.run({[this.sessions.recognizer.inputNames[0]]:new this.ort.Tensor('float32',rgbPlanar(aligned),[1,3,112,112])});
        const raw=embedding[this.sessions.recognizer.outputNames[0]].data;
        if(raw.length!==128)throw new Error('照合モデルの特徴量の数が違います。');
        face.embedding=normalise(raw);
        if(expressions){
          const output=await this.sessions.expression.run({[this.sessions.expression.inputNames[0]]:new this.ort.Tensor('float32',greyCrop(frame,face.box,64,.1),[1,1,64,64])});
          const logits=output[this.sessions.expression.outputNames[0]].data;
          if(logits.length!==8)throw new Error('表情モデルの分類数が違います。');
          face.expression=softmax(logits);
        }else face.expression=null;
        faces.push(face);
      }
      return {faces,width,height,originalWidth,originalHeight,elapsedMs:performance.now()-start,profile,
        detectedCount:allFaces.length,processedCount:faces.length,limitedCount:Math.max(0,allFaces.length-maxFaces),smallFaceCount:faces.filter(f=>f.quality.face_size<48).length,
        unprocessedCount:unprocessedFaces.length,failedCount:Math.max(0,unprocessedFaces.length-Math.max(0,allFaces.length-maxFaces)),unprocessedFaces,detectionPasses:regions.length,expressions};
    }finally{this.busy=false;}
  }
  async dispose() {
    this.ready=false;
    for(const session of Object.values(this.sessions))try{await session.release();}catch{/* Allow recovery after partial initialisation. */}
    this.sessions={};
  }
}
