/** 買い物用の状態・包装換算。栄養値やレシピ、手持ち食材の単位は変更しません。 */
const own=(value,key)=>Object.hasOwn(value??{},key);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const cleanText=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}を確認してください。`);return value.trim();};
const rounded=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
export const PURCHASE_PACK_UNITS=Object.freeze(['袋','パック','本','個','箱','束']);
export const PURCHASE_SOURCES=Object.freeze({
  rice:'https://www.maff.go.jp/j/heya/kodomo_sodan/0103/01.html',
  carrot:'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=06_06214_7',
  potato:'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=02_02017_7',
  clam:'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_10281_7',
  noodles:'https://www.city.koga.fukuoka.jp/recipe/iroha/010.php',
});

function ingredient(id,data){
  if(typeof id!=='string'||!own(data?.ingredients,id))throw Error('購入量を設定する食材を確認してください。');
  return data.ingredients[id];
}
export function purchaseGramsPerUnit(id,data){
  const food=ingredient(id,data),weight=food.unit==='g'?1:food.gramsPerUnit;
  return positive(weight)?weight:null;
}

/** factorは「購入する1gから用意できるレシピの状態のg」です。 */
export function purchaseDefaults(id,data){
  const food=ingredient(id,data),base={id,mode:'same',yieldFactor:1,purchaseName:food.name,packSize:null,packUnit:'パック'};
  if(id==='rice')return {...base,mode:'weight',yieldFactor:2.3,purchaseName:'精白米（生米）'};
  if(id==='carrot')return {...base,mode:'weight',yieldFactor:.9,purchaseName:'にんじん（皮付き・購入時）'};
  if(id==='potato')return {...base,mode:'weight',yieldFactor:.9,purchaseName:'じゃがいも（皮付き・購入時）'};
  if(['切れ','尾'].includes(food.unit)&&food.proteinSources?.includes('fish')&&purchaseGramsPerUnit(id,data))return {...base,mode:'weight',purchaseName:`${food.name}（可食部の購入重量）`};
  return base;
}

function checkRecord(value,keys){
  if(!plain(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)))throw Error('購入量の設定内容を確認してください。');
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if(!own(descriptor,'value')||!descriptor.enumerable)throw Error('購入量の設定形式を確認してください。');
}

/** 未設定の旧データは[]。同じ食材の設定は1件だけ保存します。 */
export function validatePurchaseSettings(raw,data){
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length>1000||Object.keys(raw).length!==raw.length)throw Error('購入量の設定件数を確認してください。');
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw)))if(key!=='length'&&(!/^(0|[1-9]\d*)$/.test(key)||!own(descriptor,'value')||!descriptor.enumerable))throw Error('購入量の設定形式を確認してください。');
  const seen=new Set();
  return raw.map(source=>{
    checkRecord(source,['id','mode','yieldFactor','purchaseName','packSize','packUnit']);
    const food=ingredient(source.id,data);
    if(seen.has(source.id))throw Error('購入量の食材設定が重複しています。');seen.add(source.id);
    if(!['same','weight'].includes(source.mode))throw Error('購入量の換算方法を確認してください。');
    if(!positive(source.yieldFactor)||source.yieldFactor<.001||source.yieldFactor>1000)throw Error('換算係数は0.001以上1000以下で入力してください。');
    if(source.mode==='same'&&source.yieldFactor!==1)throw Error('同じ状態・単位の購入では換算係数を1にしてください。');
    if(source.mode==='weight'&&!purchaseGramsPerUnit(source.id,data))throw Error('重量が未登録の食材は元の単位で購入量を設定してください。');
    const packSize=source.packSize??null;
    if(packSize!==null&&(!positive(packSize)||packSize<.000001||packSize>1e7))throw Error('1包装の量は0.000001以上10000000以下で入力してください。');
    if(!PURCHASE_PACK_UNITS.includes(source.packUnit))throw Error('包装の単位を選んでください。');
    return {id:source.id,mode:source.mode,yieldFactor:source.yieldFactor,
      purchaseName:cleanText(source.purchaseName,200,'購入する食材名'),packSize,packUnit:source.packUnit};
  });
}

export function purchaseSettingFor(id,settings,data){
  return validatePurchaseSettings(settings,data).find(setting=>setting.id===id)??purchaseDefaults(id,data);
}

export function purchaseBasisNote(id,data){
  const food=ingredient(id,data);
  if(id==='rice')return '生米1g→炊飯後2.3gを初期値にしています。農林水産省の目安は2.2〜2.3倍です。炊き方に合わせて変更できます。';
  if(id==='carrot'||id==='potato')return '皮なし可食部90g→皮付き購入量100g（廃棄率10%）を初期値にしています。むき方や購入形態に合わせて変更してください。';
  if(id==='clam')return 'この食材の材料量は既に砂抜き済みの殻付き重量です。殻の分を再び足しません。栄養計算には別途可食率30%を適用しています。';
  if(id==='pasta'||id==='soba')return 'この食材の材料量は既に乾麺の重量です。乾麺を買う場合は同じ状態・単位を選びます。ゆで上がりの倍率をもう一度掛けたり割ったりしません。';
  if(id==='udon')return '初期値はゆでうどんを購入する量です。乾うどんをゆでて使う場合だけ参考設定を選べます。生麺・冷凍麺・乾麺で戻り方と栄養は異なります。';
  return food.note??'材料欄と同じ状態で買う場合は換算係数1です。皮・骨・殻付きで買う場合は実物の可食率を設定してください。';
}

/** 選択したときだけ使う目安。全食材へ同じ倍率を自動適用しません。 */
export function purchasePresets(id,data){
  const food=ingredient(id,data),defaults=purchaseDefaults(id,data),same={...defaults,mode:'same',yieldFactor:1,purchaseName:food.name};
  const result=[{label:`材料と同じ状態（${food.unit}）`,setting:same},
    {label:'この食材の初期設定',setting:defaults}];
  if(id==='udon')result.push({label:'乾うどんを用意する（ゆで上がり3倍の参考値）',setting:{...defaults,mode:'weight',yieldFactor:3,purchaseName:'干しうどん（乾）'}});
  if(/(?:パスタ|スパゲティ|スパゲッティ)/.test(food.name)&&/(?:ゆで|茹で)/.test(food.name))result.push({label:'乾燥スパゲティを用意する（ゆで上がり2.5倍の参考値）',setting:{...defaults,mode:'weight',yieldFactor:2.5,purchaseName:'スパゲティ（乾）'}});
  if(purchaseGramsPerUnit(id,data))result.push({label:'gで購入量を設定する（係数を自分で入力）',setting:{...defaults,mode:'weight',yieldFactor:1,purchaseName:food.name}});
  return result;
}

/** item.buyは同一食材ID・同一状態の手持ちを差し引いた後の不足量です。 */
export function derivePurchase(item,settings,data){
  const food=ingredient(item?.id,data);
  if(item.unit!==food.unit||typeof item.buy!=='number'||!Number.isFinite(item.buy)||item.buy<0||item.buy>1e12)throw Error('購入前の不足量と単位を確認してください。');
  const setting=purchaseSettingFor(item.id,settings,data),unit=setting.mode==='weight'?'g':food.unit;
  const sourceGrams=purchaseGramsPerUnit(item.id,data);
  const amount=setting.mode==='weight'?item.buy*sourceGrams/setting.yieldFactor:item.buy;
  if(!Number.isFinite(amount)||amount>1e15)throw Error('購入量が大きすぎます。換算係数を確認してください。');
  const quotient=setting.packSize===null?null:amount/setting.packSize;
  // 丸め誤差でちょうど1袋が2袋にならないよう、整数境界の数ULPだけ吸収します。
  const nearest=quotient===null?null:Math.round(quotient);
  const packCount=quotient===null?null:nearest>0&&Math.abs(quotient-nearest)<=Number.EPSILON*8*Math.max(1,quotient)?nearest:Math.ceil(quotient);
  if(packCount!==null&&!Number.isSafeInteger(packCount))throw Error('包装の数が大きすぎます。1包装の量を確認してください。');
  const packedAmount=packCount===null?null:packCount*setting.packSize;
  const explanation=setting.mode==='weight'?`不足 ${rounded(item.buy)}${food.unit}${food.unit!=='g'?`（約${rounded(item.buy*sourceGrams)}g）`:''} ÷ ${rounded(setting.yieldFactor)} = 約${rounded(amount)}g`:`不足 ${rounded(item.buy)}${food.unit}を同じ状態で購入`;
  const text=`${setting.purchaseName} 約${rounded(amount)}${unit}${packCount===null?'':` → ${packCount}${setting.packUnit}（1${setting.packUnit} ${rounded(setting.packSize)}${unit}・計${rounded(packedAmount)}${unit}）`}`;
  return {id:item.id,name:setting.purchaseName,amount,unit,sourceAmount:item.buy,sourceUnit:food.unit,
    packCount,packedAmount,packSize:setting.packSize,packUnit:setting.packUnit,setting,explanation,text,
    converted:setting.mode==='weight'&&(food.unit!=='g'||setting.yieldFactor!==1||setting.purchaseName!==food.name)};
}
