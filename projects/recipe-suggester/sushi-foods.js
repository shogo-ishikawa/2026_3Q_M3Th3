/** 寿司は1貫/切った1切れを食事記録の基準にする。材料欄は基準量2つ分です。 */
export const SUSHI_INGREDIENTS={
  ikura_salted:{name:'いくら（塩蔵・しょうゆ漬けではない）',unit:'g',allergens:['salmon_roe'],groups:['protein'],proteinSources:['fish'],note:'成分表の塩蔵いくらを使用する例です。しょうゆ漬けなどの商品は原材料と栄養表示を確認してください。'},
};
const sushi=(id,name,variant,parts,steps,extra={})=>{
  const amounts=new Map();for(const [id,amount] of parts)amounts.set(id,(amounts.get(id)??0)+amount);
  return {id:`sushi-${id}`,name,role:'staple',genre:'和食',minutes:15,servings:2,
    ingredients:[...amounts].map(([id,amount])=>({id,amount})),steps,staple:true,mealBase:true,
    family:'sushi',variantLabel:variant,portion:{amount:1,unit:'貫'},nature:'home-cooked',tags:[],
    allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,...extra};
};
const riceForRoll=rice=>[['rice',rice],['vinegar',rice*0.07],['sugar',rice*0.03],['salt',rice*0.003]];
const roll=(id,name,variant,type,cuts,rice,nori,parts,prep,extra={})=>sushi(id,name,variant,
  [...riceForRoll(rice),['nori',nori],...parts].map(([id,amount])=>[id,amount*2/cuts]),[
    `ご飯に米酢、砂糖、塩を混ぜて冷ます。${prep}`,
    `巻きすに海苔を置いて酢飯を広げ、具を中央に並べて${type}に巻く。`,
    '形を整えたら清潔な包丁で切り分け、食べた切れ数で記録する。'],
  {portion:{amount:1,unit:'切れ',label:`${type}1本を${cuts}切れにしたうちの1切れ`},
    sourceNote:`${type}1本を${cuts}切れにした1切れが基準です。画面の材料と栄養は選んだ切れ数に合わせて換算しています。酢飯、海苔、具を含む家庭用の目安です。実物の大きさや配合によって変わります。`,...extra});
const HOSOMAKI=[
  roll('hosomaki-kappa','かっぱ巻き（細巻）','細巻・かっぱ','細巻',6,100,1.5,[['cucumber',40]],'きゅうりを細長く切る。'),
  roll('hosomaki-tekka','鉄火巻き（細巻）','細巻・鉄火','細巻',6,100,1.5,[['tuna_lean_sashimi',50]],'刺身用のまぐろを清潔な器具で細長く切る。'),
  roll('hosomaki-natto','納豆巻き（細巻）','細巻・納豆','細巻',6,100,1.5,[['natto',40]],'たれを加えていない納豆をよく混ぜる。'),
  roll('hosomaki-ume-shiso','梅しそ巻き（細巻）','細巻・梅しそ','細巻',6,100,1.5,[['ume',10],['shiso',2]],'梅干しの種を除いてたたき、青じそを細く切る。'),
  roll('hosomaki-tuna-mayo','ツナマヨ巻き（細巻）','細巻・ツナマヨ','細巻',6,100,1.5,[['tuna_canned',40],['mayonnaise',15]],'ツナとマヨネーズを混ぜる。ツナは水煮の液汁を含む代表値を使う。'),
];
const FUTOMAKI=[
  roll('futomaki-egg-vegetable','卵としいたけの太巻き','太巻・卵としいたけ','太巻',8,200,3,[['egg',1],['oil',2],['cucumber',40],['spinach',40],['dried_shiitake',4],['soy_sauce',4],['mirin',4],['water',30]],
    '卵を油で焼いて中まで火を通す。しいたけを戻してしょうゆとみりん、水で煮る。青菜をゆでて水気を切り、具を細く切る。',{minutes:30}),
  roll('futomaki-seafood','海鮮太巻き','太巻・海鮮','太巻',8,200,3,[['tuna_lean_sashimi',40],['salmon_sashimi',40],['cucumber',40],['shiso',2]],
    '魚は刺身用を用意して清潔な器具で切り、きゅうりと青じそも切る。',
    {sourceNote:'太巻1本を8切れにした1切れが基準です。画面の材料と栄養は選んだ切れ数に合わせて換算しています。サーモンの栄養は皮なしサーモントラウトの代表値です。刺身用の魚を使用します。'}),
  roll('futomaki-salad','サラダ太巻き','太巻・サラダ','太巻',8,200,3,[['tuna_canned',50],['mayonnaise',25],['lettuce',30],['cucumber',40],['egg',1],['oil',2]],
    '卵を油で焼いて中まで火を通し、野菜とともに細く切る。ツナにマヨネーズを混ぜる。',{minutes:25}),
];
// 軍艦も単種の握りと同じご飯22.5g/貫を基準にする。
const riceForGunkan=[['rice',45],['vinegar',3],['sugar',1.25],['salt',0.125],['nori',0.8]];
const gunkan=(id,name,variant,parts,prep,extra={})=>sushi(id,name,variant,[...riceForGunkan,...parts],[
  'ご飯に米酢、砂糖、塩を混ぜて冷ます。海苔は軍艦の側面に巻く幅へ切る。',
  prep,
  '清潔な手や器具で酢飯を小さくまとめ、海苔を側面へ巻いて具をのせる。食べた貫数で記録する。'],
  {portion:{amount:1,unit:'貫',label:'軍艦1貫（ご飯約22.5g）'},sourceNote:'軍艦1貫を基準にした家庭用の目安です。画面の材料と栄養は選んだ貫数に合わせて換算し、酢飯、海苔、具をすべて含みます。市販・外食の重量や配合とは異なります。',...extra});
const GUNKAN=[
  gunkan('gunkan-ikura','いくら軍艦','軍艦・いくら',[['ikura_salted',20]],'塩蔵のいくらを用意し、商品の保存方法と期限を確認する。',
    {sourceNote:'軍艦1貫はご飯約22.5g、塩蔵いくら約10gと海苔の目安です。画面の材料と栄養は選んだ貫数に合わせて換算しています。しょうゆ漬けいくらの商品とは原材料や栄養が異なるため、商品の表示に合わせて記録してください。'}),
  gunkan('gunkan-negitoro','ねぎとろ軍艦','軍艦・ねぎとろ',[['tuna_mediumfat_sashimi',24],['scallion_garnish',2],['soy_sauce',1]],'刺身用のまぐろ中トロを清潔な器具で細かくたたき、刻みねぎを混ぜる。しょうゆは別に添える。',
    {sourceNote:'軍艦1貫が基準で、画面の材料と栄養は選んだ貫数に合わせて換算しています。刺身用のまぐろをたたく家庭向けの例です。市販の油入りまぐろたたきや店舗商品の配合を表すものではありません。脂身の代表値を使うため脂質には幅があります。'}),
  gunkan('gunkan-tuna-mayo','ツナマヨ軍艦','軍艦・ツナマヨ',[['tuna_canned',20],['mayonnaise',10]],'水煮のツナとマヨネーズを混ぜる。'),
  gunkan('gunkan-corn-mayo','コーンマヨ軍艦','軍艦・コーンマヨ',[['corn',24],['mayonnaise',10]],'コーンは必要に応じて加熱して冷まし、マヨネーズと混ぜる。'),
  gunkan('gunkan-natto','納豆軍艦','軍艦・納豆',[['natto',24],['scallion_garnish',2],['soy_sauce',1]],'たれを加えていない納豆を混ぜ、刻みねぎを加える。しょうゆは別に添える。'),
  gunkan('gunkan-crab','かにサラダ軍艦','軍艦・かにサラダ',[['crab',20],['cucumber',10],['mayonnaise',8]],'加熱済みのかに身をほぐし、細かく切ったきゅうりとマヨネーズで和える。'),
  gunkan('gunkan-shirasu','しらす軍艦','軍艦・しらす',[['shirasu_dried',16],['scallion_garnish',2]],'しらす干しと刻みねぎを用意する。しらす干しの塩分は商品表示も確認する。'),
];
export const SUSHI_RECIPES=[...HOSOMAKI,...FUTOMAKI,...GUNKAN];
