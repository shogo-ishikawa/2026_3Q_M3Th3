/**
 * 市販食品を料理の種類から記録するための一般例。
 * 特定商品・店舗の栄養値や全原材料を保証するDBではありません。
 * 材料は2人分、portionは1食・1個の基準量です。
 * 商品原材料の確認状況と、買う食品の構成が分かることを分けています。
 */
import {INGREDIENT_NUTRITION} from './ingredient-nutrients.js';

const productNote='原材料や栄養は商品で異なります。記載したアレルゲンは代表例で、すべてを網羅するものではありません。商品表示を優先してください。';
const ingredient=(name,unit,allergens,groups=[],proteinSources=[],extra={})=>({name,unit,allergens,groups,proteinSources,note:productNote,...extra});
export const PREPARED_INGREDIENTS={
  cup_ramen_soy_dry:ingredient('カップ中華麺・しょうゆ味（乾燥製品・添付調味料込み）','g',['wheat','egg','milk','soy','pork','chicken'],['staple'],[],{derivedFrom:['flour','oil','soy_sauce']}),
  cup_ramen_salt_dry:ingredient('カップ中華麺・塩味（乾燥製品・添付調味料込み）','g',['wheat','egg','milk','soy','pork','chicken'],['staple'],[],{derivedFrom:['flour','oil']}),
  cup_ramen_nonfried_dry:ingredient('ノンフライカップ中華麺（乾燥製品・添付調味料込み）','g',['wheat','egg','milk','soy','pork','chicken'],['staple'],[],{derivedFrom:['flour','soy_sauce']}),
  cup_udon_dry:ingredient('カップうどん（乾燥製品・添付調味料込み）','g',['wheat','egg','milk','soy'],['staple'],[],{derivedFrom:['flour','oil','soy_sauce']}),
  cup_soba_dry:ingredient('カップそば（乾燥製品・添付調味料込み）','g',['buckwheat','wheat','egg','milk','soy','shrimp'],['staple'],[],{derivedFrom:['soba','oil','soy_sauce']}),
  cup_yakisoba_dry:ingredient('カップ焼きそば（乾燥製品・添付調味料込み）','g',['wheat','egg','milk','soy','pork','apple'],['staple'],[],{derivedFrom:['flour','oil','worcestershire_sauce']}),
  bag_fried_noodles_dry:ingredient('袋入り即席中華麺・油揚げ（乾・添付調味料込み）','g',['wheat','egg','milk','soy','pork','chicken'],['staple'],[],{derivedFrom:['flour','oil','soy_sauce']}),
  bag_nonfried_noodles_dry:ingredient('袋入り即席中華麺・非油揚げ（乾・添付調味料込み）','g',['wheat','egg','milk','soy','pork','chicken'],['staple'],[],{derivedFrom:['flour','soy_sauce']}),
  retort_beef_curry:ingredient('レトルトビーフカレーの具（ご飯を含まない）','g',['beef','wheat','milk','soy','apple'],['protein'],['meat'],{derivedFrom:['beef','flour']}),
  retort_pork_curry:ingredient('レトルトポークカレーの具（ご飯を含まない）','g',['pork','wheat','milk','soy','apple'],['protein'],['meat'],{derivedFrom:['pork','flour']}),
  retort_chicken_curry:ingredient('レトルトチキンカレーの具（ご飯を含まない）','g',['chicken','wheat','milk','soy','apple'],['protein'],['meat'],{derivedFrom:['chicken','flour']}),
  retort_oyakodon_topping:ingredient('レトルト親子丼の具（ご飯を含まない）','g',['chicken','egg','wheat','soy'],['protein'],['meat','egg'],{derivedFrom:['chicken','egg','soy_sauce']}),
  retort_mapo_topping:ingredient('レトルト麻婆丼の具（豆腐入り・ご飯を含まない）','g',['soy','pork','wheat','sesame'],['protein'],['soy','meat'],{derivedFrom:['tofu','pork_minced','soy_sauce','sesame_oil']}),
  hamburger_bun:ingredient('ハンバーガーバンズ（パンの代表値）','g',['wheat','egg','milk','soy'],['staple'],[],{derivedFrom:['flour','egg','milk','soybeans']}),
  burger_meat_patty:ingredient('バーガー用合いびき肉パティ（調理済み代表）','g',['beef','pork','egg','milk','wheat','soy'],['protein'],['meat'],{derivedFrom:['beef_minced','pork_minced','egg','milk','breadcrumbs']}),
  burger_chicken_patty:ingredient('バーガー用チキンカツ（調理済み代表）','g',['chicken','wheat','egg','milk','soy'],['protein'],['meat'],{derivedFrom:['chicken_breast','flour','egg','breadcrumbs','oil']}),
  ready_breaded_fish:ingredient('フィッシュバーガー用白身フライ（調理済み代表）','g',['wheat','egg','milk','soy'],['protein'],['fish'],{derivedFrom:['cod','flour','egg','breadcrumbs','oil']}),
  ready_sliced_ham:ingredient('サンドイッチ用ロースハム（調理済み代表）','g',['pork','egg','milk','soy'],['protein'],['meat'],{derivedFrom:['pork']}),
};

const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
/** 材料1食分の明示的な配合モデル。商品固有の数値を新たに作りません。 */
function modelNutrition(parts){
  return Object.fromEntries(KEYS.map(key=>{
    let sum=0;
    for(const [id,amount]of parts){if(!Object.hasOwn(INGREDIENT_NUTRITION,id))throw Error(`参考配合の食材IDを確認してください: ${id}`);const value=INGREDIENT_NUTRITION[id].nutritionPerUnit?.[key];if(typeof value!=='number'||!Number.isFinite(value))return [key,null];sum+=amount*value;}
    return [key,Number(sum.toFixed(8))];
  }));
}
const parts=items=>items.map(([id,amount])=>({id,amount}));
function dish(slug,name,family,variantLabel,items,{nature='instant',genre='その他',minutes=5,unit='食',label,sourceNote,manualNutrition}={}){
  return {id:`prepared-${slug}`,name,role:'staple',genre,minutes,servings:2,ingredients:parts(items),staple:true,
    family,variantLabel,portion:{amount:1,unit,...(label?{label}:{})},mealBase:true,nature,processed:true,
    allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,tags:[],sourceNote:`${sourceNote??''} ${productNote}`.trim(),
    steps:[
      '商品の内容量、原材料、アレルゲンと栄養表示を確認する。この登録は商品を特定しない一般例として使う。',
      nature==='fast-food'||nature==='ready-to-eat'?'調理済みの商品を用意する。温める場合や保存方法は商品・店舗の案内に従う。':'湯の量や加熱方法、加熱時間は商品の表示に従う。添付の具材や調味料も含めて用意する。',
      '食べた量で記録する。実物の栄養表示が分かる場合や食べ残した場合は、手入力で表示値に合わせて記録できる。',
    ],...(manualNutrition?{manualNutrition}:{})};
}
const dryCup=(slug,name,family,variant,id,grams,water,note='')=>dish(slug,name,family,variant,[[id,grams*2],...(water>0?[['water',water*2]]:[])],{
  genre:family==='ramen'?'中華':family==='yakisoba'?'その他':'和食',
  label:water>0?`1食＝乾燥製品・添付調味料${grams}gに湯${water}mlを加えた全量`:`1食＝乾燥製品・添付調味料${grams}gを表示どおり調理した全量`,
  sourceNote:`乾燥製品と添付調味料の重量を基準にした概算です。${water>0?'スープも飲む場合の全量で、スープを残した割合を自動で補正しません。':''}${note}`,
});
const INSTANT=[
  dryCup('cup-ramen-soy','カップラーメン（しょうゆ）','ramen','カップ・しょうゆ','cup_ramen_soy_dry',75,300),
  dryCup('cup-ramen-salt','カップラーメン（塩）','ramen','カップ・塩','cup_ramen_salt_dry',75,300),
  dryCup('cup-ramen-miso','カップラーメン（みそ）','ramen','カップ・みそ〔代表値〕','cup_ramen_soy_dry',85,350,'みそ味専用の値ではなく、成分表の油揚げしょうゆ味を代表にしています。味による栄養差はこの数値へ加えていません。'),
  dryCup('cup-ramen-tonkotsu','カップラーメン（豚骨）','ramen','カップ・豚骨〔代表値〕','cup_ramen_soy_dry',80,330,'豚骨味専用の値ではなく、成分表の油揚げしょうゆ味を代表にしています。味による栄養差は未登録です。'),
  dryCup('cup-ramen-seafood','カップラーメン（シーフード）','ramen','カップ・シーフード〔代表値〕','cup_ramen_salt_dry',75,300,'シーフード専用の値ではなく、成分表の油揚げ塩味を代表にしています。魚介の種類と原材料は商品表示で確認してください。'),
  dryCup('cup-ramen-nonfried-soy','ノンフライカップラーメン（しょうゆ）','ramen','カップ・ノンフライしょうゆ','cup_ramen_nonfried_dry',75,350),
  dryCup('cup-ramen-nonfried-salt','ノンフライカップラーメン（塩）','ramen','カップ・ノンフライ塩〔代表値〕','cup_ramen_nonfried_dry',75,350,'ノンフライカップ麺の一般値で、しょうゆ味との味別の差を付けていません。'),
  dryCup('cup-udon-kitsune','カップきつねうどん','udon','カップ・きつね','cup_udon_dry',95,400,'成分表の和風即席カップ麺の代表値で、油揚げの大きさや配合によって変わります。'),
  dryCup('cup-udon-tempura','カップ天ぷらうどん','udon','カップ・天ぷら〔代表値〕','cup_udon_dry',95,400,'和風即席カップ麺の代表値で、天ぷらうどん専用の栄養値ではありません。'),
  dryCup('cup-soba-tempura','カップ天ぷらそば','soba','カップ・天ぷら〔代表値〕','cup_soba_dry',100,400,'和風即席カップ麺の代表値で、そば専用の栄養値ではありません。そばのアレルギー情報は商品表示で確認してください。'),
  dryCup('cup-yakisoba-sauce','カップ焼きそば（ソース）','yakisoba','カップ・ソース','cup_yakisoba_dry',120,0,'乾燥製品の代表値で、湯切りに伴う栄養の流出は補正していません。湯切り用の湯は材料の量に加算していません。'),
  dryCup('cup-yakisoba-salt','カップ焼きそば（塩）','yakisoba','カップ・塩〔代表値〕','cup_yakisoba_dry',110,0,'塩味専用の値は未登録のため、成分表の即席焼きそばを代表にしています。湯切りによる流出は未補正です。'),
];
const bag=(slug,variant,id,grams)=>dish(slug,`袋入り即席ラーメン（${variant}）`,'ramen',`袋麺・${variant}`,[[id,grams*2],['water',800]],{
  genre:'中華',unit:'袋',label:`1袋＝乾燥めんと添付調味料${grams}gに湯400mlを加えた全量`,
  sourceNote:'乾燥めんと添付調味料の重量を基準にした概算です。成分表の袋入り即席中華麺の一般値を使い、味による栄養差は付けていません。スープを残す量の自動補正は行いません。',
});
INSTANT.push(
  bag('bag-ramen-soy','しょうゆ','bag_fried_noodles_dry',100),
  bag('bag-ramen-miso','みそ','bag_fried_noodles_dry',100),
  bag('bag-ramen-salt','塩','bag_fried_noodles_dry',100),
  bag('bag-ramen-nonfried','ノンフライ','bag_nonfried_noodles_dry',90),
);

function riceMeal(slug,name,family,variant,productId,{grams=200,note='',manualNutrition}={}){
  return dish(slug,`${name}（ご飯込み）`,family,`レトルト・${variant}〔ご飯込み〕`,[[productId,grams*2],['rice',360]],{
    nature:'retort',genre:family==='curry'?'洋食':['retort_chukadon_model','retort_mapo_topping'].includes(productId)?'中華':'和食',minutes:8,unit:'皿',
    label:`1皿＝ご飯180g＋レトルトの具${grams}g`,
    sourceNote:`ご飯180gを含む完成1食です。ご飯を別に登録すると二重になるため、別に数えないでください。${note}`,
    manualNutrition,
  });
}
const modelProduct=(id,name,allergens,derivedFrom,groups,proteinSources)=>{PREPARED_INGREDIENTS[id]=ingredient(name,'g',allergens,groups,proteinSources,{derivedFrom,note:`この購入品単体の栄養値は未登録です。完成メニューの栄養は明示した代表配合から概算します。${productNote}`});};
modelProduct('retort_vegetable_curry_model','レトルト野菜カレーの具（ご飯なし・参考配合）',['wheat','milk','soy','apple'],['flour','onion','carrot','potato'],['vegetable'],[]);
modelProduct('retort_keema_curry_model','レトルトキーマカレーの具（ご飯なし・参考配合）',['beef','pork','wheat','milk','soy'],['beef_minced','pork_minced','onion','curry_powder'],['protein','vegetable'],['meat']);
modelProduct('retort_gyudon_model','レトルト牛丼の具（ご飯なし・参考配合）',['beef','wheat','soy'],['beef','soy_sauce'],['protein'],['meat']);
modelProduct('retort_chukadon_model','レトルト中華丼の具（ご飯なし・参考配合）',['pork','shrimp','squid','egg','wheat','soy'],['pork','shrimp','squid','egg','soy_sauce'],['protein','vegetable'],['meat','fish','egg']);
// 購入量は具200gの1パックを想定。加熱後の歩留まりは一定にせず、
// 栄養の配合例と購入品の実測値を同一視しないよう各メニューに明記します。
const modelRice=(items)=>modelNutrition([['rice',180],...items]);
const RETORT=[
  riceMeal('retort-beef-curry','レトルトビーフカレーライス','curry','ビーフ','retort_beef_curry',{note:'カレーの具は成分表のビーフカレー料理の代表値です。個々のレトルト製品の実測値ではありません。'}),
  riceMeal('retort-pork-curry','レトルトポークカレーライス','curry','ポーク','retort_pork_curry',{note:'カレーの具は成分表のポークカレー料理の代表値です。個々のレトルト製品の実測値ではありません。'}),
  riceMeal('retort-chicken-curry','レトルトチキンカレーライス','curry','チキン','retort_chicken_curry',{note:'カレーの具は成分表のチキンカレー料理の代表値です。個々のレトルト製品の実測値ではありません。'}),
  riceMeal('retort-vegetable-curry','レトルト野菜カレーライス','curry','野菜〔配合例〕','retort_vegetable_curry_model',{note:'具は玉ねぎ50g、にんじん20g、じゃがいも50g、トマト40g、植物油5ml、薄力粉4g、カレー粉3g、食塩0.8gの参考配合です。加熱で変わる重量は補正していません。購入する具は200gの1パックを想定した一般例です。',manualNutrition:modelRice([['onion',50],['carrot',20],['potato',50],['canned_tomato',40],['oil',5],['flour',4],['curry_powder',3],['salt',0.8]])}),
  riceMeal('retort-keema-curry','レトルトキーマカレーライス','curry','キーマ〔配合例〕','retort_keema_curry_model',{note:'具は豚ひき肉50g、牛ひき肉30g、玉ねぎ40g、にんじん20g、トマト50g、植物油4ml、カレー粉4g、しょうゆ5mlの参考配合です。加熱で変わる重量は補正していません。購入する具は200gの1パックを想定した一般例です。',manualNutrition:modelRice([['pork_minced',50],['beef_minced',30],['onion',40],['carrot',20],['canned_tomato',50],['oil',4],['curry_powder',4],['soy_sauce',5]])}),
  riceMeal('retort-gyudon','レトルト牛丼','donburi','牛丼〔配合例〕','retort_gyudon_model',{note:'具は牛肉80g、玉ねぎ60g、しょうゆ10ml、みりん10ml、砂糖4gの参考配合です。加熱で変わる重量は補正していません。購入する具は200gの1パックを想定した一般例です。',manualNutrition:modelRice([['beef',80],['onion',60],['soy_sauce',10],['mirin',10],['sugar',4]])}),
  riceMeal('retort-oyakodon','レトルト親子丼','donburi','親子丼','retort_oyakodon_topping',{note:'具は成分表の親子丼の具の代表値です。個々のレトルト製品の実測値ではありません。'}),
  riceMeal('retort-chukadon','レトルト中華丼','donburi','中華丼〔配合例〕','retort_chukadon_model',{note:'具は豚肉30g、えび20g、いか20g、白菜60g、にんじん15g、しいたけ15g、卵0.5個、しょうゆ5ml、オイスターソース5ml、植物油3ml、片栗粉4gの参考配合です。加熱で変わる重量は補正していません。購入する具は200gの1パックを想定した一般例です。',manualNutrition:modelRice([['pork',30],['shrimp',20],['squid',20],['chinese_cabbage',60],['carrot',15],['shiitake',15],['egg',0.5],['soy_sauce',5],['oyster_sauce',5],['oil',3],['starch',4]])}),
  riceMeal('retort-mapodon','レトルト麻婆丼','donburi','麻婆丼','retort_mapo_topping',{note:'豆腐入りの麻婆豆腐料理を具の代表にしています。「豆腐を加える前の素」ではありません。商品が調味料の素だけの場合は別に記録してください。'}),
];

const FORMULA_LABELS={lettuce:['レタス','g'],onion:['玉ねぎ','g'],tomato_paste:['トマトペースト','g'],sugar:['砂糖','g'],vinegar:['酢','ml'],cheese:['チーズ','g'],mayonnaise:['マヨネーズ','g'],soy_sauce:['しょうゆ','ml'],mirin:['みりん','ml'],cabbage:['キャベツ','g'],worcestershire_sauce:['ウスターソース','ml'],bread:['食パン','g'],egg:['卵','個'],salt:['食塩','g'],butter:['バター','g'],tuna_canned:['ツナ缶','g'],tomato:['トマト','g'],cucumber:['きゅうり','g']};
function formulaLabel(id,amount){const [name,unit]=FORMULA_LABELS[id]??[PREPARED_INGREDIENTS[id].name,PREPARED_INGREDIENTS[id].unit];return `${name}${amount}${unit}`;}
function boughtItem(slug,name,family,variant,formula,{nature='fast-food',grams,genre='洋食',proteinSources=['meat'],dairy=false}={}){
  const id=`prepared_item_${slug.replaceAll('-','_')}`;
  const parentIds=[...new Set(formula.map(([key])=>key))];
  PREPARED_INGREDIENTS[id]=ingredient(`${name}（購入品・栄養は参考配合）`,'個',[],['staple',...(proteinSources.length?['protein']:[]),...(dairy?['dairy']:[])],proteinSources,{derivedFrom:parentIds,note:`1個単体のメーカー固有値は未登録です。完成メニューは材料の一般的な参考配合で概算します。${productNote}`});
  return dish(slug,`${name}（一般例）`,family,variant,[[id,2]],{
    nature,genre,unit:'個',minutes:5,label:`1個${grams?`（参考配合約${grams}g）`:''}`,
    sourceNote:`店舗や銘柄を指定しない参考配合です。${formula.map(([key,value])=>formulaLabel(key,value)).join('、')}を1個分の概算に使い、実商品の配合や重量を示すものではありません。買い物は完成品1個として数えます。`,
    manualNutrition:modelNutrition(formula),
  });
}
const burgerBase=[['hamburger_bun',60],['burger_meat_patty',70],['lettuce',10],['onion',10],['tomato_paste',8],['sugar',2],['vinegar',3]];
const BURGERS=[
  boughtItem('burger-plain','ハンバーガー','burger','ハンバーガー',burgerBase,{grams:163}),
  boughtItem('burger-cheese','チーズバーガー','burger','チーズ',[...burgerBase,['cheese',15]],{grams:178,dairy:true}),
  boughtItem('burger-teriyaki','てりやきバーガー','burger','てりやき',[['hamburger_bun',60],['burger_meat_patty',80],['lettuce',12],['mayonnaise',8],['soy_sauce',6],['mirin',6],['sugar',5]],{grams:177}),
  boughtItem('burger-chicken','チキンカツバーガー','burger','チキンカツ',[['hamburger_bun',60],['burger_chicken_patty',90],['cabbage',20],['mayonnaise',10],['worcestershire_sauce',8]],{grams:188}),
  boughtItem('burger-fish','フィッシュバーガー','burger','フィッシュ',[['hamburger_bun',60],['ready_breaded_fish',80],['lettuce',10],['mayonnaise',12],['cheese',10]],{grams:172,proteinSources:['fish'],dairy:true}),
  boughtItem('burger-double','ダブルバーガー','burger','ダブル',[['hamburger_bun',60],['burger_meat_patty',140],['lettuce',10],['onion',10],['tomato_paste',8],['sugar',2],['vinegar',3]],{grams:233}),
];
const SANDWICHES=[
  boughtItem('sandwich-egg','コンビニ風たまごサンド','bread','市販・たまごサンド',[['bread',60],['egg',1],['mayonnaise',12],['salt',0.2]],{nature:'ready-to-eat',proteinSources:['egg']}),
  boughtItem('sandwich-ham','コンビニ風ハムサンド','bread','市販・ハムサンド',[['bread',60],['ready_sliced_ham',30],['lettuce',10],['butter',4]],{nature:'ready-to-eat'}),
  boughtItem('sandwich-tuna','コンビニ風ツナサンド','bread','市販・ツナサンド',[['bread',60],['tuna_canned',40],['mayonnaise',12],['lettuce',8]],{nature:'ready-to-eat',proteinSources:['fish']}),
  boughtItem('sandwich-vegetable','コンビニ風野菜サンド','bread','市販・野菜サンド',[['bread',60],['tomato',30],['cucumber',20],['lettuce',10],['cheese',10],['mayonnaise',8]],{nature:'ready-to-eat',proteinSources:[],dairy:true}),
];
export const PREPARED_RECIPES=[...INSTANT,...RETORT,...BURGERS,...SANDWICHES];
