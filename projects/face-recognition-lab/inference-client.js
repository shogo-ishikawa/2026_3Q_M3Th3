import {FaceEngine,analysisOptions} from './engine.js';

function cancelled() {
  const error=new Error('画像処理を停止しました。');error.name='AbortError';return error;
}

/* Dependency arguments allow transport tests without camera or model files. */
export class FaceInferenceClient {
  constructor({useWorker=true,engineOptions={},workerFactory=null,bitmapFactory=null,engineFactory=null}={}) {
    this.ready=false;this._busy=false;this.backend='uninitialised';this.fallbackReason='';
    this._engineOptions={...engineOptions};this._workerFactory=workerFactory;
    this._bitmapFactory=bitmapFactory||(typeof createImageBitmap==='function'?source=>createImageBitmap(source):null);
    this._canWorker=useWorker&&!!this._bitmapFactory&&(!!workerFactory||(typeof Worker==='function'&&typeof OffscreenCanvas==='function'));
    this._engineFactory=engineFactory||(()=>new FaceEngine(engineOptions));
    this._worker=null;this._main=null;this._pending=new Map();this._nextId=0;this._generation=0;this._loading=null;this._analysis=null;this._progress=()=>{};
  }
  get busy(){return this._busy;}
  get backendLabel(){return this.backend==='worker-wasm'?'別スレッドで処理':this.backend==='main-wasm'?'この画面で処理':'準備前';}
  _openWorker() {
    const worker=this._workerFactory?this._workerFactory():new Worker(new URL('./inference-worker.js',import.meta.url),{type:'module',name:'facegate-inference'});
    this._worker=worker;
    worker.addEventListener('message',event=>{
      const data=event.data,job=this._pending.get(data?.id);if(!job)return;
      if(data.type==='progress'){job.progress(data.value);return;}
      this._pending.delete(data.id);
      if(data.type==='result')job.resolve(data.value);
      else{const error=new Error(data.message||'画像処理に失敗しました。');error.modelFailure=!!data.modelFailure;job.reject(error);}
    });
    const failed=()=>{
      if(this._worker!==worker)return;
      this.ready=false;this._canWorker=false;this.fallbackReason='別スレッドが停止したため、次の準備ではこの画面で処理します。';
      const error=new Error('別スレッドの画像処理を開始できませんでした。');error.transportFailure=true;
      for(const job of this._pending.values())job.reject(error);
      this._pending.clear();worker.terminate();this._worker=null;
    };
    worker.addEventListener('error',failed);worker.addEventListener('messageerror',failed);
    this.backend='worker-wasm';
  }
  _request(type,payload={},transfer=[],progress=this._progress) {
    const id=++this._nextId;
    return new Promise((resolve,reject)=>{
      this._pending.set(id,{resolve,reject,progress});
      try{if(!this._worker)throw new Error('画像処理が停止しています。');this._worker.postMessage({id,type,...payload},transfer);}
      catch(error){this._pending.delete(id);reject(error);}
    });
  }
  async load(onProgress=()=>{}) {
    if(typeof onProgress!=='function')throw new Error('読み込み通知の設定が不正です。');
    this._progress=onProgress;
    if(this.ready)return;
    if(this._loading)return this._loading;
    const generation=this._generation;
    const run=(async()=>{
      if(this._canWorker){
        try{
          if(!this._worker)this._openWorker();
          await this._request('load',{engineOptions:this._engineOptions},[],onProgress);
          if(generation!==this._generation)throw cancelled();
          this.ready=true;return;
        }catch(error){
          if(generation!==this._generation||error.modelFailure)throw error;
          this._worker?.terminate();this._worker=null;
          this._canWorker=false;this.fallbackReason='別スレッドを使えないため、この画面で処理します。';
          onProgress({stage:'fallback',percent:0,message:this.fallbackReason});
        }
      }
      this.backend='main-wasm';this._main=this._engineFactory();
      await this._main.load(onProgress);
      if(generation!==this._generation)throw cancelled();
      this.ready=true;
    })();
    this._loading=run;
    try{return await run;}finally{if(this._loading===run)this._loading=null;}
  }
  async analyze(source,options={}) {
    if(!this.ready)throw new Error('先に画像処理の準備を開始してください。');
    if(this._busy)throw new Error('ひとつ前の画像を処理しています。');
    const normal=analysisOptions(options,this._engineOptions.maxSize||1920);
    const inputOptions={maxFaces:normal.maxFaces,expressions:normal.expressions,profile:normal.profile};
    const generation=this._generation,start=performance.now();this._busy=true;
    const run=(async()=>{
      let result;
      if(this._worker){
        const bitmap=await this._bitmapFactory(source);
        if(generation!==this._generation){bitmap.close?.();throw cancelled();}
        try{result=await this._request('analyze',{source:bitmap,options:inputOptions},[bitmap]);}
        catch(error){bitmap.close?.();throw error;}
      }else result=await this._main.analyze(source,inputOptions,this._progress);
      if(generation!==this._generation)throw cancelled();
      return {...result,backend:this.backend,roundTripMs:performance.now()-start};
    })();
    this._analysis=run;
    try{return await run;}finally{if(generation===this._generation)this._busy=false;if(this._analysis===run)this._analysis=null;}
  }
  async dispose() {
    this._generation++;this.ready=false;this._busy=false;
    const active=[this._loading,this._analysis].filter(Boolean),main=this._main;
    this._loading=null;this._analysis=null;
    this._main=null;this._worker?.terminate();this._worker=null;
    for(const job of this._pending.values())job.reject(cancelled());this._pending.clear();
    if(main){await Promise.allSettled(active);await main.dispose();}
  }
}
