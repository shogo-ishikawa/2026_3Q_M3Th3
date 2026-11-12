/** Original one-shot DJ sounds. Every sound is synthesised locally; no sampled recordings. */
export const SAMPLE_KEYS = Object.freeze(['2','4','6','8','w','r','y','i','s','f','h','k','x','v','n',',']);
export const SAMPLE_META = Object.freeze([
  ['kick','キック','低い一撃で拍を強調','drums'],
  ['clap','クラップ','手拍子風のアクセント','drums'],
  ['closed-hat','クローズハット','短いハイハット','drums'],
  ['open-hat','オープンハット','伸びるハイハット','drums'],
  ['shaker','シェイカー','細かなリズムを足す','drums'],
  ['rim','リム','乾いた打音','drums'],
  ['crash','クラッシュ','展開の頭にシンバル風の音','drums'],
  ['drum-fill','ドラムフィル','テンポに合う短い連打','drums'],
  ['riser','ライザー','上昇音で期待感を作る','effects'],
  ['downlift','ダウンリフト','下降音で展開をつなぐ','effects'],
  ['impact','インパクト','低音とノイズの一撃','effects'],
  ['laser','レーザー','鋭い電子音','effects'],
  ['vocal','ボイス風','声の響きを模した合成音','effects'],
  ['scratch','スクラッチ','レコードをこするような合成音','effects'],
  ['airhorn','エアホーン','ブラス風のファンファーレ','effects'],
  ['reverse','リバース','逆再生のような吸い込み音','effects'],
].map(([id,name,description,group])=>Object.freeze({id,name,description,group})));

const TAU = 2 * Math.PI;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const LEVELS=[0.45,0.32,0.22,0.22,0.18,0.30,0.32,0.38,0.20,0.24,0.40,0.30,0.28,0.32,0.26,0.26];

function randomSource(seed){
  let value=seed>>>0;
  return ()=>{value^=value<<13;value^=value>>>17;value^=value<<5;return(value>>>0)/2147483648-1;};
}

export function synthSample(index,sampleRate=22050,bpm=120){
  if(!Number.isInteger(index)||index<0||index>=SAMPLE_META.length)throw new RangeError('Sample index must be an integer from 0 to 15.');
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Sample rate must be an integer from 8000 to 192000 Hz.');
  if(!Number.isFinite(bpm)||bpm<40||bpm>200)throw new RangeError('BPM must be between 40 and 200.');
  const beat=60/bpm;
  const durations=[0.5,0.28,0.1,0.42,0.22,0.14,1.5,clamp(beat*2,0.6,4),clamp(beat*4,1,4),clamp(beat*2,0.8,3),1.8,0.7,0.65,0.72,0.9,clamp(beat*2,0.8,3)];
  const duration=durations[index],samples=new Float32Array(Math.round(duration*sampleRate));
  const random=randomSource(0x3d71c9a5^((index+1)*0x45d9f3b));
  function add(at,seconds,gain,synthesise){
    const start=Math.round(at*sampleRate),length=Math.round(seconds*sampleRate);
    for(let i=0;i<length&&start+i<samples.length;i+=1){if(start+i>=0)samples[start+i]+=gain*synthesise(i/sampleRate,seconds);}
  }
  function kick(at,gain=1){
    add(at,0.5,gain,t=>{
      const phase=TAU*(46*t+2.3*(1-Math.exp(-t*65)));
      return Math.sin(phase)*Math.exp(-t*10)*Math.min(1,t/0.0014)+random()*0.03*Math.exp(-t*140);
    });
  }
  function snare(at,gain=1,clap=true){
    let low=0;
    add(at,0.27,gain,t=>{
      const noise=random();low+=(noise-low)*0.2;
      const pulse=clap?[0,0.012,0.024].reduce((sum,delay)=>sum+(t>=delay?Math.exp(-(t-delay)*28):0),0)/2.2:Math.exp(-t*20);
      return((noise-low)*0.7*pulse+Math.sin(TAU*175*t)*0.2*Math.exp(-t*25))*Math.min(1,t/0.0008);
    });
  }
  if(index===0)kick(0);
  else if(index===1)snare(0);
  else if(index===2||index===3){
    let last=0;
    add(0,duration,1,t=>{const noise=random(),high=noise-last*0.85;last=noise;return high*Math.exp(-t*(index===2?58:12))*Math.min(1,t/0.0007);});
  }else if(index===4){
    let last=0;
    add(0,duration,1,t=>{const noise=random(),high=noise-last;last=noise;return high*(Math.sin(Math.PI*t/duration)**2)*Math.exp(-t*10);});
  }else if(index===5){
    add(0,duration,1,t=>(Math.sin(TAU*740*t)+Math.sin(TAU*1170*t)*0.6)*Math.exp(-t*39)*Math.min(1,t/0.001));
  }else if(index===6){
    let last=0;
    add(0,duration,1,t=>{
      const noise=random(),high=noise-last*0.7;last=noise;
      const metal=Math.sin(TAU*2231*t)*Math.sin(TAU*3127*t);
      return(high*0.7+metal*0.3)*Math.exp(-t*3.6)*Math.min(1,t/0.002);
    });
  }else if(index===7){
    for(let n=0;n<8;n+=1)snare(n*beat/4,0.45+n*0.055,false);
    kick(0,0.7);kick(beat,0.65);
  }else if(index===8||index===9){
    let low=0;
    add(0,duration,1,t=>{
      const phase=t/duration,rising=index===8;
      const alpha=0.025+(rising?phase:1-phase)*0.7;
      const noise=random();low+=alpha*(noise-low);
      const tone=Math.sin(TAU*(rising?170*t+600*t*t/duration:1100*t-500*t*t/duration));
      const rhythm=0.68+0.32*Math.sin(TAU*t/beat*2);
      const envelope=rising?phase**1.1:(1-phase)**1.6;
      return(low*0.9+tone*0.13)*envelope*rhythm;
    });
  }else if(index===10){
    let low=0;
    add(0,duration,1,t=>{
      const noise=random();low+=(noise-low)*0.11;
      return Math.sin(TAU*(42*t+1.8*(1-Math.exp(-t*18))))*Math.exp(-t*4)
        +(noise-low)*0.5*Math.exp(-t*8);
    });
  }else if(index===11){
    const top=Math.min(2400,sampleRate*0.3);
    add(0,duration,1,t=>Math.sin(TAU*(72*t+top*0.075*(1-Math.exp(-t/0.075))))*Math.exp(-t*6)*Math.min(1,t/0.002));
  }else if(index===12){
    // A pitched, changing formant cluster evokes a voice without using a recording or speech service.
    add(0,duration,1,t=>{
      const position=t/duration,fundamental=110+35*Math.sin(Math.PI*position);
      const f1=850-420*position,f2=1400+650*position;
      let value=0;
      const limit=Math.min(26,Math.floor(sampleRate/(2*fundamental)));
      for(let n=1;n<=limit;n+=1){
        const frequency=fundamental*n;
        const formant=Math.exp(-(((frequency-f1)/220)**2))+Math.exp(-(((frequency-f2)/310)**2))*0.65+Math.exp(-(((frequency-2700)/380)**2))*0.25;
        value+=Math.sin(TAU*frequency*t)*formant/(n**0.7);
      }
      return value*(Math.sin(Math.PI*position)**0.65);
    });
  }else if(index===13){
    let phase=0,low=0;
    add(0,duration,1,t=>{
      const sweep=Math.sin(TAU*t*5.5),speed=0.16+Math.abs(sweep);
      phase+=TAU*(165+speed*1150)/sampleRate;
      const noise=random();low+=(noise-low)*0.12;
      const scratch=Math.sin(phase)*0.45+Math.sin(phase*2.01)*0.12+(noise-low)*0.35;
      return scratch*(Math.abs(sweep)**0.5)*(Math.sin(Math.PI*t/duration)**0.5);
    });
  }else if(index===14){
    add(0,duration,1,t=>{
      let value=0;
      for(const fundamental of [349.23,440,523.25]){
        const count=Math.min(8,Math.floor(sampleRate/(2*fundamental)));
        for(let n=1;n<=count;n+=1)value+=Math.sin(TAU*fundamental*n*t)*(1/n**1.2)/3;
      }
      return Math.tanh(value*1.4)*Math.min(1,t/0.02,(duration-t)/0.18)*(0.92+0.08*Math.sin(TAU*t*6));
    });
  }else{
    let low=0;
    add(0,duration,1,t=>{
      const position=t/duration,n=random();low+=(n-low)*0.08;
      return((n-low)*0.75+Math.sin(TAU*(70*t+250*t*t/duration))*0.13)*position**2.2;
    });
  }
  // Smooth both boundaries and remove DC before conservative normalisation.
  let mean=0;for(const sample of samples)mean+=sample;mean/=samples.length;
  const fade=Math.max(2,Math.round(sampleRate*0.002));let peak=0;
  for(let i=0;i<samples.length;i+=1){
    samples[i]=(samples[i]-mean)*Math.min(1,i/(fade-1),(samples.length-1-i)/(fade-1));
    peak=Math.max(peak,Math.abs(samples[i]));
  }
  const gain=LEVELS[index]/Math.max(peak,0.00001);
  for(let i=0;i<samples.length;i+=1)samples[i]*=gain;
  return samples;
}

export function createSampleBuffer(context,index,bpm=120){
  const samples=synthSample(index,context.sampleRate,bpm);
  const buffer=context.createBuffer(1,samples.length,context.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
