/* The worker receives an owned bitmap, processes it locally, and closes it. */
import {FaceEngine} from './engine.js';
let engine=null;
let queue=Promise.resolve();
self.addEventListener('message',event=>{
  const request=event.data;
  queue=queue.catch(()=>{}).then(async()=>{
    const {id,type,source,options,engineOptions}=request||{};
    const progress=value=>self.postMessage({id,type:'progress',value});
    try{
      if(!Number.isInteger(id)||!['load','analyze','dispose'].includes(type))throw new Error('画像処理への要求が不正です。');
      if(type==='load'){
        if(!engine)engine=new FaceEngine(engineOptions);
        await engine.load(progress);self.postMessage({id,type:'result',value:{ready:true}});
      }else if(type==='analyze'){
        if(!source||!engine)throw new Error('画像または準備したモデルを受け取れませんでした。');
        const result=await engine.analyze(source,options,progress);
        self.postMessage({id,type:'result',value:result});
      }else{
        await engine?.dispose();self.postMessage({id,type:'result',value:{ready:false}});
      }
    }catch(error){self.postMessage({id,type:'error',message:error.message||String(error),modelFailure:true});}
    finally{source?.close?.();}
  });
});
