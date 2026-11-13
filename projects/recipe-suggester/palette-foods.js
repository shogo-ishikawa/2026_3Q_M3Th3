/** v3.8の単品食品と組み合わせの素体。材料・分量は2人分、portionは1人分です。 */
const KEYS = ['kcal','protein','fat','carbs','fiber','salt'];
const freeze = value => {
  if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const food = (name, allergens, groups=[], proteinSources=[], extra={}) =>
  ({name,unit:'g',allergens,groups,proteinSources,...extra});
const productNote = '成分表の代表食品を使う一般例です。銘柄・配合は特定していないため、実物の原材料・アレルゲン・栄養表示を確認してください。';
const unconfirmedProduct = {ingredientsKnown:false,allergensKnown:false,shoppingKnown:true};

export const PALETTE_INGREDIENTS = freeze({
  palette_chikuwa:food('焼きちくわ',['wheat','egg','soy'],['protein'],['fish'],{...unconfirmedProduct,note:'卵白・でんぷんを含む代表配合を想定。'+productNote}),
  palette_hanpen:food('はんぺん',['egg','yam'],['protein'],['fish'],{...unconfirmedProduct,note:'卵白とやまいもを含む代表配合を想定。'+productNote}),
  palette_atsuage:food('厚揚げ（生揚げ）',['soy'],['protein'],['soy'],{derivedFrom:['tofu'],note:'油抜き前の製品重量。油抜きによる減少は補正しません。'}),
  palette_ganmodoki:food('がんもどき',['soy','egg','yam','sesame'],['protein'],['soy'],{...unconfirmedProduct,derivedFrom:['tofu'],note:'卵・やまいも・ごまも含む代表配合を想定。'+productNote}),
  palette_wiener:food('ウインナーソーセージ',['pork','chicken','milk','egg','soy'],['protein'],['meat'],{...unconfirmedProduct,derivedFrom:['pork'],note:productNote}),
  palette_chicken_nugget:food('チキンナゲット（調理済み）',['chicken','wheat','egg','milk','soy'],['protein'],['meat'],{...unconfirmedProduct,derivedFrom:['chicken','flour'],note:'衣と吸収油を含む完成品の重量。油は重ねて加算しません。'+productNote}),
  palette_oyster_fry:food('カキフライ（調理済み）',['wheat','egg','milk','soy'],['protein'],['fish'],{...unconfirmedProduct,derivedFrom:['breadcrumbs'],note:'かき・衣・吸収油を含む完成品重量。かき自体のアレルギーは個別に除外してください。'+productNote}),
  palette_prosciutto:food('生ハム（促成・骨なし）',['pork'],['protein'],['meat'],{...unconfirmedProduct,derivedFrom:['pork'],note:'促成生ハムの可食重量。長期熟成品とは塩分や水分が異なります。'+productNote}),
  palette_takuan:food('たくあん（塩押し大根漬）',[],['vegetable'],[],{...unconfirmedProduct,derivedFrom:['daikon'],note:'塩押し大根漬の代表値。甘い製品や昆布入り製品とは配合が異なります。'+productNote}),
  palette_camembert:food('カマンベールチーズ',['milk'],['dairy'],[],{derivedFrom:['milk']}),
  palette_cheddar:food('チェダーチーズ',['milk'],['dairy'],[],{derivedFrom:['milk']}),
  palette_cream_cheese:food('クリームチーズ',['milk'],['dairy'],[],{derivedFrom:['milk']}),
  palette_blue_cheese:food('ブルーチーズ',['milk'],['dairy'],[],{derivedFrom:['milk']}),
  palette_processed_cheese:food('プロセスチーズ',['milk'],['dairy'],[],{derivedFrom:['milk']}),
  palette_pistachio:food('ピスタチオ（いり・味付け）',['pistachio'],[],[],{note:'殻を除いた可食重量。成分表の味付け品の塩分を含みます。無塩品ではありません。'}),
  palette_macadamia:food('マカダミアナッツ（いり・味付け）',['macadamia'],[],[],{note:'殻を除いた可食重量。成分表の味付け品の塩分を含みます。無塩品ではありません。'}),
  palette_bagel:food('ベーグル（プレーン）',['wheat','egg','milk','soy'],['staple'],[],{...unconfirmedProduct,derivedFrom:['flour'],note:'具やトッピングを加える前のパン重量。卵・乳・大豆を含む製品も想定したアレルゲン登録です。'+productNote}),
  palette_waffle:food('ワッフル（プレーン・焼成済み）',['wheat','egg','milk'],['staple'],[],{derivedFrom:['flour','egg','milk','butter','palette_baking_powder'],note:'明示した家庭用生地を焼き、1枚70gに仕上げる配合モデル。ジャム・クリームは含みません。'}),
  palette_muffin_base:food('マフィン生地（プレーン・焼成前）',['wheat','egg','milk'],['staple'],[],{derivedFrom:['flour','egg','milk','butter','palette_baking_powder'],note:'混ぜる具材を除いた生地の重量。焼いた市販マフィンの成分ではありません。'}),
  palette_baking_powder:food('ベーキングパウダー',[],[],[],{note:'でんぷんと膨張剤から成る単品を想定。実物の表示を確認してください。'}),
  palette_maple_syrup:food('メープルシロップ',[],[],[],{note:'メープル樹液由来のシロップ。メープル風味の加糖シロップとは異なります。'}),
  palette_honey:food('はちみつ',[],[],[],{note:'純粋はちみつの代表値。乳児用の食品ではありません。'}),
  palette_whipped_cream:food('ホイップクリーム（乳脂肪・加糖）',['milk'],['dairy'],[],{derivedFrom:['milk'],note:'砂糖を加えた乳脂肪のホイップクリーム。植物性クリームとは異なります。'}),
  palette_anago_steamed:food('蒸しあなご（骨を除く可食部）',[],['protein'],['fish'],{note:'蒸したあなごの可食重量。甘いたれは別材料です。'}),
});

// 八訂増補2023年。各行は可食部100gあたりのkcal, P, F, C, fiber, salt。
const MEXT_ROWS = {
  palette_chikuwa:['10','10381',[107,13.2,.4,13.3,0,2.5]],
  palette_hanpen:['10','10385',[93,9.9,1,11.4,0,1.5]],
  palette_atsuage:['4','04039',[143,10.7,11.3,.9,.8,0]],
  palette_ganmodoki:['4','04041',[223,15.3,17.8,1.6,1.4,.5]],
  palette_wiener:['11','11186',[319,11.5,30.6,3.3,0,1.9]],
  palette_chicken_nugget:['11','11292',[235,15.5,13.7,14.9,1.2,1.6]],
  palette_oyster_fry:['10','10430',[256,7.6,11.1,32.9,null,1]],
  palette_prosciutto:['11','11181',[243,24,16.6,.5,0,5.8]],
  palette_takuan:['6','06138',[43,.6,.3,10.8,2.3,3.3]],
  palette_camembert:['13','13034',[291,19.1,24.7,.9,0,2]],
  palette_cheddar:['13','13037',[390,25.7,33.8,1.4,0,2]],
  palette_cream_cheese:['13','13035',[313,8.2,33,2.3,0,.7]],
  palette_blue_cheese:['13','13039',[326,18.8,29,1,0,3.8]],
  palette_processed_cheese:['13','13040',[313,22.7,26,1.3,0,2.8]],
  palette_pistachio:['5','05026',[617,17.4,56.1,20.9,9.2,.7]],
  palette_macadamia:['5','05031',[751,8.3,76.7,12.2,6.2,.5]],
  palette_bagel:['1','01148',[270,9.6,2,54.6,2.5,1.2]],
  palette_baking_powder:['17','17084',[150,null,1.2,29,null,17.3]],
  palette_maple_syrup:['3','03023',[266,.1,0,66.3,0,0]],
  palette_honey:['3','03022',[329,.3,null,81.9,0,0]],
  palette_whipped_cream:['13','13017',[409,1.8,40.7,12.9,0,.1]],
  palette_anago_steamed:['10','10016',[173,17.6,12.7,null,0,.3]],
};
const supplemental = {
  palette_oyster_fry:{fiber:.65}, palette_baking_powder:{protein:.03,fiber:0},
  palette_honey:{fat:.03}, palette_anago_steamed:{carbs:.03},
};
const supplementationNotes = {
  palette_oyster_fry:'未測定の食物繊維は完成100g中に乾燥パン粉10gを使う仮定から0.65g/100gで概算。衣と吸収油を二重加算しません。',
  palette_baking_powder:'微量たんぱく質Trは0.03g/100gで概算。未測定繊維は精製でんぷんと無機塩の配合を想定して0gと仮定。',
  palette_honey:'微量脂質Trは0.01以上0.05g未満の中央0.03g/100gで概算。',
  palette_anago_steamed:'総炭水化物Trは0.03g/100gで概算。別列の利用可能炭水化物を代入しません。',
};
const perGram = values => Object.fromEntries(KEYS.map((key,index)=>[key,values[index]===null?null:Number((values[index]/100).toFixed(8))]));
const nutrition = Object.fromEntries(Object.entries(MEXT_ROWS).map(([id,[group,code,raw]])=>{
  const rawNutritionPerUnit=perGram(raw), estimates=supplemental[id]??{};
  const source=`日本食品標準成分表（八訂）増補2023年 食品番号${code}。可食部100g値を1gへ換算。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${code}_7`;
  const nutritionPerUnit={...rawNutritionPerUnit};
  for(const [key,value]of Object.entries(estimates))nutritionPerUnit[key]=Number((value/100).toFixed(8));
  return [id,{nutritionPerUnit,rawNutritionPerUnit,rawNutritionSource:source,nutritionSource:source+' '+(supplementationNotes[id]??'')+' '+(PALETTE_INGREDIENTS[id].note??''),estimatedNutrients:Object.keys(estimates)}];
}));

// 配合モデルは原料のg重量で計算。牛乳のml値ではなく普通牛乳100g値を使います。
const BATTER_ROWS = {
  flour:[349,8.3,1.5,75.8,2.5,0], egg:[142,12.2,10.2,.4,0,.4],
  milk:[61,3.3,3.8,4.8,0,.1], butter:[700,.6,81,.2,0,1.9],
  sugar:[391,0,0,99.3,0,0], baking:[150,.03,1.2,29,0,17.3],
};
const blend = (formula, finalWeight) => KEYS.map((_,index)=>formula.reduce((sum,[id,g])=>sum+BATTER_ROWS[id][index]*g/100,0)*100/finalWeight);
const muffinFormula=[['flour',35],['egg',20],['milk',15],['butter',10],['sugar',19],['baking',1]];
const waffleFormula=[['flour',30],['egg',15],['milk',25.75],['butter',8],['sugar',10],['baking',.7]];
for(const [id,formula,finalWeight,note]of [
  ['palette_muffin_base',muffinFormula,100,'生地100gは薄力粉35g、全卵20g、普通牛乳15g、有塩バター10g、砂糖19g、ベーキングパウダー1g。具を加える前の焼成前の重量で計算します。'],
  ['palette_waffle',waffleFormula,70,'薄力粉30g、全卵15g、普通牛乳25.75g、有塩バター8g、砂糖10g、ベーキングパウダー0.7gを焼き、1枚70gに仕上げる家庭用の概算。水分減少は仕上がり重量の仮定で扱い、トッピングは含めません。'],
]){
  const source='日本食品標準成分表（八訂）増補2023年の薄力粉01015・全卵12004・普通牛乳13003・有塩バター14017・上白糖03003・ベーキングパウダー17084を合算した配合モデル。実測値・市販品の表示値ではありません。https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html '+note;
  nutrition[id]={nutritionPerUnit:perGram(blend(formula,finalWeight)),rawNutritionPerUnit:Object.fromEntries(KEYS.map(key=>[key,null])),rawNutritionSource:'この配合に対応する成分表の完成食品は未登録。',nutritionSource:source,estimatedNutrients:[...KEYS]};
}
export const PALETTE_NUTRITION = freeze(nutrition);

const parts = values => {
  const amounts=new Map();
  for(const [id,amount]of values)amounts.set(id,(amounts.get(id)??0)+amount);
  return [...amounts].map(([id,amount])=>({id,amount}));
};
const recipe = (slug,name,role,family,items,extra={}) => {
  const result={
  id:`palette-${slug}`,name,role,family,genre:'その他',minutes:5,servings:2,
  ingredients:parts(items),steps:[],staple:role==='staple',mealBase:false,nature:'ready-to-eat',
  portion:{amount:1,unit:'皿'},allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
  sourceNote:productNote,...extra,
  };
  result.tags=role==='staple'?[]:result.minutes<=20?['時短']:[];
  // 一般商品は表示の確認が済んだ料理として自動提案しません。
  if(result.ingredients.some(part=>PALETTE_INGREDIENTS[part.id]?.ingredientsKnown===false)||['ham','bacon','sandwich'].includes(slug)){
    Object.assign(result,unconfirmedProduct);
    result.sourceNote+=' 全原材料とアレルギー情報は未確認です。実物の原材料表示を確認して記録してください。';
  }
  return result;
};
const small = (slug,name,ingredient,grams,extra={}) => recipe(slug,name,'side','small-dish',[[ingredient,grams*2]],{
  portion:{amount:grams,unit:'g'},displayMethod:'cold',...extra,
});
const cheese = (slug,label,ingredient,grams=20) => recipe(`cheese-${slug}`,label,'snack','cheese',[[ingredient,grams*2]],{
  genre:'洋食',variantLabel:label,portion:{amount:grams,unit:'g'},
});
const nuts = (slug,label,ingredient) => recipe(`nuts-${slug}`,label,'snack','nuts',[[ingredient,30]],{
  variantLabel:label,portion:{amount:15,unit:'g'},
});
const nigiri = (slug,label,items,steps,extra={}) => recipe(`nigiri-${slug}`,`${label}のにぎり寿司`,'staple','sushi',[
  ['rice',45],['vinegar',3],['sugar',1.25],['salt',.125],['soy_sauce',1],...items,
],{genre:'和食',minutes:20,nature:'home-cooked',mealBase:true,variantLabel:label,
  portion:{amount:1,unit:'貫',label:'握り1貫（ご飯約22.5g）'},
  sourceNote:'握り1貫を基準にした家庭用の配合です。材料は2貫分で、しょうゆも含みます。刺身用の魚介を使い、実際に食べた貫数を指定します。',
  steps:['温かいご飯に米酢、砂糖、塩を混ぜて冷まし、作る貫数に分ける。',...steps,'清潔な手や器具で酢飯と具を合わせ、しょうゆを添える。食べる直前まで冷蔵する。'],...extra});

export const PALETTE_RECIPES = [
  recipe('oden','おでん','main','main',[
    ['daikon',160],['egg',2],['konjac',120],['palette_chikuwa',60],['water',400],['soy_sauce',16],['mirin',10],
  ],{genre:'和食',minutes:50,nature:'home-cooked',displayCategory:'bean',displaySecondaryCategories:['meat','fish','egg','vegetable'],displayMethod:'simmer',
    sourceNote:'1皿分は大根、卵、こんにゃく、ちくわと煮汁の目安です。詳細で具材と量を選べます。煮汁は飲む分を指定し、具への吸収や煮汁との塩分移動は補正しません。',
    steps:['大根の皮をむいて厚く切り、下ゆでする。卵は中まで固ゆでにして殻をむき、こんにゃくも下ゆでして切る。','鍋に水と調味料を入れ、下ごしらえした具を加えて弱火で味を含ませる。','練り物は加熱しすぎないよう後半に加える。食べる具の量と飲む煮汁を分けて記録する。']}),
  small('wiener','ウインナーソーセージ','palette_wiener',60,{portion:{amount:3,unit:'本',label:'1本約20g、3本が基準'},displayCategory:'meat',displayMethod:'grill'}),
  small('chicken-nugget','チキンナゲット','palette_chicken_nugget',100,{portion:{amount:5,unit:'個',label:'1個約20g、5個が基準'},displayCategory:'meat',displayMethod:'fried'}),
  recipe('oyster-fry','カキフライ','main','cutlet',[['palette_oyster_fry',180]],{portion:{amount:3,unit:'個',label:'1個約30g、3個が基準'},displayCategory:'fish',displayMethod:'fried'}),
  small('prosciutto','生ハム','palette_prosciutto',30,{displayCategory:'meat'}),
  small('ham','ロースハム','ready_sliced_ham',40,{portion:{amount:2,unit:'枚',label:'1枚約20g、2枚が基準'},displayCategory:'meat'}),
  small('bacon','ベーコン','bacon',40,{portion:{amount:2,unit:'枚',label:'1枚約20g、2枚が基準'},displayCategory:'meat',displayMethod:'grill'}),
  small('takuan','たくあん','palette_takuan',30,{genre:'和食',displayCategory:'vegetable',displayMethod:'pickled'}),
  cheese('camembert','カマンベールチーズ','palette_camembert'),
  cheese('cheddar','チェダーチーズ','palette_cheddar'),
  cheese('cream','クリームチーズ','palette_cream_cheese'),
  cheese('blue','ブルーチーズ','palette_blue_cheese'),
  cheese('processed','プロセスチーズ','palette_processed_cheese'),
  cheese('parmesan','パルメザンチーズ','parmesan_cheese',10),
  nuts('pistachio','ピスタチオ（いり・味付け）','palette_pistachio'),
  nuts('macadamia','マカダミアナッツ（いり・味付け）','palette_macadamia'),
  nuts('pine','松の実（無調味）','pine_nuts'),
  recipe('bagel','ベーグル','staple','bread',[['palette_bagel',200]],{genre:'洋食',variantLabel:'プレーン',portion:{amount:1,unit:'個',label:'プレーン1個約100g、トッピング別'},sourceNote:'プレーンのベーグル1個100gを基準に、クリームチーズや果物などを別に加えられます。'}),
  recipe('waffle','ワッフル','snack','cake',[['palette_waffle',140]],{genre:'洋食',variantLabel:'プレーン',nature:'home-cooked',portion:{amount:1,unit:'個',label:'プレーン1枚約70g、トッピング別'},
    sourceNote:'焼成済みのプレーン1枚70gの家庭用配合モデルです。クリームやシロップは別に加えます。実商品の栄養表示ではありません。',
    steps:['焼成済みのプレーンワッフルを用意する。必要に応じて表示に従い温める。','選んだトッピングを表示した量だけ添える。']}),
  recipe('muffin','マフィン','snack','cake',[
    ['flour',49],['egg',.56],['milk',21/1.03],['butter',14],['sugar',26.6],['palette_baking_powder',1.4],
  ],{genre:'洋食',minutes:35,variantLabel:'プレーン',nature:'home-cooked',portion:{amount:1,unit:'個',label:'1個分はプレーン生地70g、具材別'},
    sourceNote:'プレーンのマフィン生地70gを1個分とし、具材を混ぜて焼く家庭用の目安です。焼成による水分減少は栄養量へ加算しません。',
    steps:['バターを室温に戻して砂糖を混ぜ、溶き卵と牛乳を少しずつ加える。','薄力粉とベーキングパウダーを合わせ、選んだ具材とともにさっくり混ぜる。','耐熱のマフィン型へ分け、180℃に予熱したオーブンで約20〜25分焼く。中心に刺した竹串に生の生地が付かないことを確認し、焼き足す場合は様子を見ながら加熱する。']}),
  recipe('sandwich','サンドイッチ','staple','bread',[
    ['bread',120],['ready_sliced_ham',40],['lettuce',20],['mayonnaise',10],
  ],{genre:'洋食',minutes:10,nature:'home-cooked',mealBase:true,variantLabel:'ハムとレタス',portion:{amount:1,unit:'個',label:'食パン60gと具を使った1組'},
    sourceNote:'食パン2枚分を約60gとして具をはさむ1組です。パンの種類や具材、ソースは詳細で選べます。',
    steps:['野菜を洗って水気を切る。加熱が必要な具材は先に十分加熱して冷ます。','パンへ選んだソースを薄く塗り、具材をはさむ。','食べやすく切り、食べるまで冷蔵する。']}),
  nigiri('chutoro','中トロ',[['tuna_mediumfat_sashimi',25]],['中トロは刺身用を用意して切る。']),
  nigiri('seabream','たい',[['seabream_sashimi',25]],['たいは刺身用を用意して切る。']),
  nigiri('yellowtail','ぶり',[['yellowtail_sashimi',25]],['ぶりは刺身用を用意して切る。']),
  nigiri('scallop','ほたて',[['scallop_sashimi',30]],['ほたて貝柱は刺身用を用意する。']),
  nigiri('octopus','たこ',[['octopus',25]],['ゆでだこの水気を拭いて薄く切る。']),
  nigiri('egg','玉子',[['egg',.6],['sugar',1],['oil',1]],['卵と分量の砂糖を混ぜ、油を引いたフライパンで中心まで十分火を通す。冷まして切る。']),
  nigiri('anago','あなご',[['palette_anago_steamed',30],['soy_sauce',1],['mirin',1],['sugar',1]],['蒸しあなごを食べやすく切る。追加のしょうゆ・みりん・砂糖を煮詰めた少量のたれを添える。']),
];
