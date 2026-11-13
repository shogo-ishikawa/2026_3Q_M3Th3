/** 同じ料理の中で具材を選び、確定した1皿を既存のマイメニュー形式へ変換します。 */
import {itemFromRecipe, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';

const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};

export const DISH_CUSTOM_INGREDIENTS = freeze({
  dish_pork_belly_sliced: {name:'豚ばら肉（薄切り・脂身付き・生）',unit:'g',allergens:['pork'],groups:['protein'],proteinSources:['meat'],derivedFrom:['pork_belly'],
    note:'お好み焼きへ使う薄切りの生の可食重量です。かたまり肉を使う場合は薄く切ります。焼いた後の重量や、脂を除いた肉の値ではありません。'},
  dish_mochi: {name:'切り餅（もち米のみ・加熱前）',unit:'g',allergens:[],groups:['staple'],proteinSources:[],derivedFrom:['rice'],
    note:'もち米だけで作った無調味の餅を加熱前に計量します。あん入り・揚げ餅・味付け餅とは区別します。'},
});

const components = [
  {id:'pork-belly',ingredientId:'dish_pork_belly_sliced',label:'豚ばら肉',unit:'g',defaultAmount:50},
  {id:'squid',ingredientId:'squid',label:'イカ',unit:'g',defaultAmount:50},
  {id:'shrimp',ingredientId:'shrimp',label:'えび',unit:'g',defaultAmount:50},
  {id:'mochi',ingredientId:'dish_mochi',label:'餅',unit:'g',defaultAmount:30},
  {id:'negi',ingredientId:'negi',label:'ねぎ',unit:'g',defaultAmount:20},
  {id:'noodles',ingredientId:'yakisoba_noodles',label:'焼きそば麺',unit:'g',defaultAmount:100},
];
const presets = [
  {id:'sea-food',label:'シーフード玉',components:[{id:'squid',amount:50},{id:'shrimp',amount:50}],sauceId:'soy-vinegar',sauceAmount:10.905,mayonnaiseAmount:0},
  {id:'pork',label:'豚玉',components:[{id:'pork-belly',amount:50}],sauceId:'worcestershire',sauceAmount:15,mayonnaiseAmount:5},
  {id:'squid',label:'イカ玉',components:[{id:'squid',amount:70}],sauceId:'worcestershire',sauceAmount:15,mayonnaiseAmount:5},
  {id:'mochi-negi',label:'もちねぎ玉',components:[{id:'mochi',amount:30},{id:'negi',amount:30}],sauceId:'worcestershire',sauceAmount:15,mayonnaiseAmount:5},
  {id:'modern',label:'モダン焼き',components:[{id:'pork-belly',amount:50},{id:'noodles',amount:100}],sauceId:'worcestershire',sauceAmount:15,mayonnaiseAmount:5},
  {id:'mix',label:'ミックス玉',components:[{id:'pork-belly',amount:40},{id:'squid',amount:40},{id:'shrimp',amount:40}],sauceId:'worcestershire',sauceAmount:15,mayonnaiseAmount:5},
];

export const DISH_CUSTOMISERS = freeze([
  {kind:'nikujaga',recipeIds:['beef-potato'],label:'肉じゃが',meatOptions:[{id:'beef',label:'牛肉'},{id:'pork',label:'豚肉'}]},
  {kind:'okonomiyaki',recipeIds:['seafood-okonomiyaki'],label:'お好み焼き',components,presets,
    sauces:[{id:'soy-vinegar',label:'しょうゆと酢',defaultAmount:10.905},{id:'worcestershire',label:'ウスターソース',defaultAmount:15},{id:'none',label:'ソースなし',defaultAmount:0}]},
]);

const own = (value,key) => Object.hasOwn(value,key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const finite = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const componentById = new Map(components.map(part=>[part.id,part]));
const presetById = new Map(presets.map(preset=>[preset.id,preset]));
const unique = values => [...new Set(values)];
const newId = () => `custom-dish-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function defaultDishSelection(kind,presetId='sea-food') {
  if (kind==='nikujaga') {
    if (presetId!=='sea-food') throw Error('肉じゃがの種類は肉の選択で指定してください。');
    return {kind,meat:'beef'};
  }
  if (kind!=='okonomiyaki') throw Error('具材を選ぶ料理が見つかりません。');
  const preset=presetById.get(presetId==='custom'?'sea-food':presetId);
  if (!preset) throw Error('お好み焼きの種類を選んでください。');
  return {kind,presetId,components:preset.components.map(part=>({...part})),sauceId:preset.sauceId,sauceAmount:preset.sauceAmount,mayonnaiseAmount:preset.mayonnaiseAmount};
}

function checkObject(value,allowed,message) {
  if (!isRecord(value)||Object.keys(value).some(key=>!allowed.includes(key))) throw Error(message);
}
function checkedBase(id,data) {
  if (!Array.isArray(data?.recipes)) throw Error('料理のデータを確認してください。');
  const recipe=data.recipes.find(candidate=>candidate.id===id);
  if (!recipe||!finite(recipe.servings,0.001,1000)||!Array.isArray(recipe.ingredients)||!recipe.ingredients.length) throw Error('基準になる料理が見つかりません。');
  return recipe;
}
function checkedParts(parts,data) {
  if (!isRecord(data?.ingredients)) throw Error('材料のデータを確認してください。');
  for (const part of parts) {
    const ingredient=own(data.ingredients,part.id)?data.ingredients[part.id]:null;
    if (!isRecord(ingredient)||ingredient.unit!==({egg:'個',water:'ml',oil:'ml',soy_sauce:'ml',mirin:'ml',vinegar:'ml',worcestershire_sauce:'ml'}[part.id]??'g')||!finite(part.amount,Number.MIN_VALUE,1e6)||ingredient.allergensKnown===false||ingredient.ingredientsKnown===false) throw Error('材料の種類、量、原材料の確認状況を確認してください。');
  }
}
function finishedRecipe(config,values,data) {
  const id=own(config,'id')?config.id:newId();
  if (typeof id!=='string'||!/^custom-.+/.test(id)||id.length>120||!id.trim()) throw Error('料理の識別子を確認してください。');
  checkedParts(values.ingredients,data);
  const recipe={id,...values,genre:'和食',servings:1,custom:true,nature:'home-cooked',portion:{amount:1,unit:'皿'},
    allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,manualNutrition:recipeNutrition({servings:1,ingredients:values.ingredients},data)};
  const metadata=itemFromRecipe(recipe,data);
  return {...recipe,allergens:unique(metadata.allergens),groups:unique(metadata.groups),proteinSources:unique(metadata.proteinSources)};
}

function nikujaga(config,data) {
  checkObject(config,['id','kind','meat'],'肉じゃがの内容を確認してください。');
  if (!['beef','pork'].includes(config.meat)) throw Error('肉じゃがの肉を牛肉か豚肉から選んでください。');
  const base=checkedBase('beef-potato',data);
  if (base.ingredients.filter(part=>part.id==='beef').length!==1) throw Error('肉じゃがの基準になる肉を確認してください。');
  const meat=config.meat==='pork'?'豚肉':'牛肉';
  const ingredients=base.ingredients.map(part=>({id:part.id==='beef'?config.meat:part.id,amount:part.amount/base.servings}));
  const steps=[
    'じゃがいもは芽と緑色の部分を十分に取り除き、一口大に切って水にさらし、水気を切る。にんじんは小さめの乱切り、玉ねぎはくし切りにする。',
    `${meat}は薄切りを用意して食べやすく切る。${config.meat==='pork'?'豚肉を切った包丁とまな板は洗浄し、加熱後の料理に生肉を付けない。':'牛肉は重なった部分をほぐし、厚みのあるかたまりを作らない。'}`,
    `鍋に油を中火で熱し、玉ねぎと${meat}をほぐしながら炒める。じゃがいもとにんじんを加え、全体へ油をなじませる。`,
    '表示量の水を加え、煮立ったらあくを取る。しょうゆ、みりん、砂糖を加えて落としぶたをし、静かに煮立つ火加減へ落とす。',
    'じゃがいもが崩れないよう必要以上に混ぜず、竹串がすっと通るまで20分ほど煮る。水分が足りなければ水を少し足す。',
    `${meat}にも十分火を通す。最も厚い部分の中心が75℃に達してから1分以上加熱したことを温度計で確かめ、野菜のやわらかさも確認する。`,
    '火を止めて少し置き、煮汁をなじませて盛り付ける。表示の栄養は使用した材料を合計した概算で、鍋に残る煮汁や脂の量は差し引いていない。',
  ];
  return finishedRecipe(config,{name:`肉じゃが（${meat}）`,variantLabel:meat,role:'main',family:'meat-main',staple:false,mealBase:false,minutes:35,ingredients,steps,
    sourceNote:`肉じゃがの家庭用配合です。${meat}を選び、材料と作り方、栄養を切り替えています。肉は生の薄切りの可食重量で計量し、ご飯は含みません。煮汁を全て摂取する材料計算のため、残す量によって実際の摂取量は変わります。`},data);
}

function okonomiyaki(config,data) {
  checkObject(config,['id','kind','presetId','components','sauceId','sauceAmount','mayonnaiseAmount'],'お好み焼きの内容を確認してください。');
  if (own(config,'presetId')&&!presetById.has(config.presetId)&&config.presetId!=='custom') throw Error('お好み焼きの種類を選んでください。');
  if (!Array.isArray(config.components)||!config.components.length||config.components.length>components.length||Object.keys(config.components).length!==config.components.length) throw Error('具材を1種類以上選んでください。');
  const seen=new Set();
  const selected=config.components.map(part=>{
    checkObject(part,['id','amount'],'具材の種類と量を確認してください。');
    const component=componentById.get(part.id);
    if (!component||seen.has(part.id)) throw Error('具材の種類が不明か、重複しています。');
    if (!finite(part.amount,Number.MIN_VALUE,300)) throw Error('具材は1種類につき0より大きく300g以下で入力してください。');
    seen.add(part.id);return {...component,amount:part.amount};
  });
  if (selected.reduce((total,part)=>total+part.amount,0)>500) throw Error('具材の合計は1皿500g以下で入力してください。');
  const sauceId=config.sauceId;
  if (!['none','soy-vinegar','worcestershire'].includes(sauceId)) throw Error('ソースの種類を選んでください。');
  if (!finite(config.sauceAmount,sauceId==='none'?0:Number.MIN_VALUE,100)||(sauceId==='none'&&config.sauceAmount!==0)) throw Error('ソースなしの場合は0g、それ以外は0より大きく100g以下にしてください。');
  if (!finite(config.mayonnaiseAmount,0,100)) throw Error('マヨネーズの量は0gから100gまでで入力してください。');
  const base=checkedBase('seafood-okonomiyaki',data);
  const parts=new Map(base.ingredients.filter(part=>!['shrimp','squid','soy_sauce','vinegar'].includes(part.id)).map(part=>[part.id,part.amount/base.servings]));
  for (const component of selected) parts.set(component.ingredientId,(parts.get(component.ingredientId)??0)+component.amount);
  if (sauceId==='soy-vinegar') {
    const each=config.sauceAmount/(1.181+1);parts.set('soy_sauce',each);parts.set('vinegar',each);
  } else if (sauceId==='worcestershire') parts.set('worcestershire_sauce',config.sauceAmount/1.195);
  if (config.mayonnaiseAmount>0) parts.set('mayonnaise',config.mayonnaiseAmount);
  const ingredients=[...parts].map(([id,amount])=>({id,amount}));
  const has=id=>seen.has(id);
  const labels=selected.map(part=>part.label);
  const mixedLabels=selected.filter(part=>!['pork-belly','noodles'].includes(part.id)).map(part=>part.label).join('、');
  const reservedLabels=selected.filter(part=>['pork-belly','noodles'].includes(part.id)).map(part=>part.label).join('と');
  const steps=[
    'キャベツを粗みじん切りにし、水気を切って表示量を用意する。薄力粉、卵、水、塩も1皿分を量る。',
    ...(has('negi')?['ねぎを洗って小口切りにする。']:[]),
    ...(has('shrimp')||has('squid')?[`${has('shrimp')?'えびは殻と背わたを取り、':''}${has('squid')?'いかは下処理済みの可食部を使って、':''}小さく切る。魚介を扱った器具は洗浄し、加熱後の料理と分ける。`]:[]),
    ...(has('mochi')?['切り餅を加熱前の重さで計量し、厚みが出ないよう薄い小片に切る。かたい餅を切るときは滑らないよう注意する。']:[]),
    ...(has('pork-belly')?['豚ばら肉は薄切りを用意し、かたまり肉の場合は薄く切る。生肉用の器具と、焼き上がりを取り出す器具を分ける。']:[]),
    `ボウルで薄力粉、卵、水、塩を混ぜ、キャベツを加える。${mixedLabels?`${mixedLabels}はここで加えて混ぜる。`:''}${reservedLabels?`${reservedLabels}は後から重ねるため取り分けておく。`:''}`,
    ...(has('noodles')?['表示の油の一部をフライパンで熱し、蒸し焼きそば麺をほぐして温める。乾麺や即席麺は使わず、温まった麺をいったん取り出す。']:[]),
    `${has('noodles')?'残りの油を中火で温め':'フライパンに油を入れて中火で温め'}、生地を厚みが偏らない円形へ広げる。${has('noodles')?'温めた麺を重ね、少量取り分けた生地でなじませる。':''}${has('pork-belly')?'上へ豚ばら肉を重ならないよう並べる。':''}`,
    `底が固まって焼き色が付いたら、大きなへらで裏返す。ふたをして弱めの中火でじっくり焼き、表面だけ焦げそうなら火を弱める。${has('noodles')?'厚い場合や麺入りは':'厚い場合は'}、小さく分けて焼くか加熱時間を延ばす。`,
    `${has('pork-belly')?'豚肉、':''}${has('shrimp')||has('squid')?'魚介、':''}卵入りの生地の最も厚い部分で、中心が75℃に達してから1分以上加熱したことを温度計で確認する。${has('mochi')?'餅の小片も中までやわらかくなったことを確かめる。':''}`,
    ...(sauceId==='soy-vinegar'?['表示量のしょうゆと酢を混ぜて添える。']:sauceId==='worcestershire'?['表示量のウスターソースをかける。お好み焼き専用ソースや濃厚ソースとは栄養と原材料が異なるため、実物の表示も確認する。']:['ソースはかけずに仕上げる。']),
    ...(config.mayonnaiseAmount>0?['表示量のマヨネーズを添える。']:[]),
  ];
  return finishedRecipe(config,{name:`${has('noodles')?'モダン焼き':'お好み焼き'}（${labels.join('・')}）`,variantLabel:labels.join('・'),role:'main',family:'other-staple',staple:true,mealBase:true,minutes:has('noodles')?40:35,ingredients,steps,
    sourceNote:`薄力粉と卵、キャベツを使う家庭向けの1皿です。選んだ具材は加熱前の可食部重量で、蒸し中華麺は調理前の蒸し麺の重量です。${sauceId==='none'?'ソースなし':sauceId==='soy-vinegar'?`しょうゆと酢を合わせて${config.sauceAmount}g`:`ウスターソース${config.sauceAmount}g`}、マヨネーズ${config.mayonnaiseAmount}gを材料と栄養へ含めています。市販のお好み焼き粉や専用ソース、店の商品を再現した値ではありません。`},data);
}

export function buildCustomDish(config,data) {
  if (!isRecord(config)) throw Error('料理の内容を確認してください。');
  if (config.kind==='nikujaga') return nikujaga(config,data);
  if (config.kind==='okonomiyaki') return okonomiyaki(config,data);
  throw Error('具材を選ぶ料理が見つかりません。');
}

/** 必須の除外条件を満たす配合だけを返します。表示用の料理名では判定しません。 */
export function eligibleDishSelections(kind,settings,data) {
  // 先に共通の設定検査を通し、不正な条件を候補なしとして黙って捨てません。
  eligibleRecipes(settings,{...data,recipes:[]});
  let candidates;
  if (kind==='nikujaga') candidates=['beef','pork'].map(meat=>({kind,meat}));
  else if (kind==='okonomiyaki') candidates=presets.flatMap(preset=>{
    const config=defaultDishSelection(kind,preset.id);
    return [config,{...config,mayonnaiseAmount:0},{...config,sauceId:'none',sauceAmount:0},
      {...config,sauceId:'none',sauceAmount:0,mayonnaiseAmount:0}];
  });
  else throw Error('具材を選ぶ料理が見つかりません。');
  const seen=new Set(),result=[];
  for(const config of candidates){
    const key=JSON.stringify(config);
    if(seen.has(key))continue;
    seen.add(key);
    const recipe=buildCustomDish(config,data);
    if(eligibleRecipes(settings,{...data,recipes:[recipe]}).length)result.push({config:{...config,...(config.components?{components:config.components.map(part=>({...part}))}:{})},recipe});
  }
  return result;
}
