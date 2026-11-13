/** v3.10: エスニック料理、ナン、カニクリームコロッケ。材料は2人分。 */
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const food=(name,allergens=[],groups=[],proteinSources=[],extra={})=>
  ({name,unit:'g',allergens,groups,proteinSources,...extra});

export const WORLD_INGREDIENTS=freeze({
  world_mutton:food('マトン（ロース・脂身つき・生）',[],['protein'],['meat'],{
    note:'羊肉のうち成羊のマトンです。ラム・牛肉・豚肉とは分け、ロース脂身つきをカレー用羊肉の代表に使用します。部位や脂身の量で変わります。',
  }),
  world_paneer:food('パニール（インドのフレッシュチーズ）',['milk'],['dairy'],[],{
    derivedFrom:['milk'],note:'無調味パニールの代表的な製品表示を使用。水切りの程度で脂質や重量が変わります。モッツァレラや豆腐の値ではありません。',
  }),
  world_bread_flour:food('強力粉（1等）',['wheat'],['staple'],[],{derivedFrom:['flour']}),
  world_wholemeal_flour:food('全粒粉（強力粉）',['wheat'],['staple'],[],{derivedFrom:['flour']}),
  world_lime_juice:food('ライム果汁（生）',[],[],[],{note:'皮を除いた搾り汁のg重量。mlとみなす密度換算はしません。'}),
  world_tomyum_paste:food('トムヤムペースト（えび・大豆を含む代表品）',['shrimp','soy'],[],[],{
    derivedFrom:['shrimp','garlic'],note:'スリーシェフの表示を代表に、レモングラス・ガランガル・ライム葉・えびエキスなどを含むペーストを想定します。食塩濃度や原材料は銘柄ごとに異なるため、実物の表示を確認してください。',
  }),
  world_garam_masala:food('ガラムマサラ（混合香辛料）',[],[],[],{
    note:'FAUCHONガラムマサラの表示を代表に使用。香辛料と少量のコーン油からなる混合物で、カレールウではありません。',
  }),
});

const perGram=values=>Object.fromEntries(KEYS.map((key,index)=>[key,values[index]===null?null:Number((values[index]/100).toFixed(8))]));
const mext=(group,code)=>`日本食品標準成分表（八訂）増補2023年 食品番号${code}。可食部100gを1gに換算。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${code}_7`;
const rows={
  world_mutton:{raw:[192,19.3,15,.2,0,.2],source:mext('11','11199')},
  world_bread_flour:{raw:[337,11.8,1.5,71.7,2.7,0],source:mext('1','01020')},
  world_wholemeal_flour:{raw:[320,12.8,2.9,68.2,11.2,0],source:mext('1','01023')},
  world_lime_juice:{raw:[39,.4,.1,9.3,.2,0],source:mext('7','07145')},
  world_paneer:{
    raw:[312,20,24,4,null,24*2.54/1000],estimates:{fiber:0},
    source:'Sabar Dairy（製造者）Amul Fresh Paneer、100g当たりの表示。Na24mgから食塩相当量=Na×2.54÷1000で換算。確認日2026-11-13。https://sabardairy.org/product/amul-fresh-paneer/',
    note:'食物繊維は未表示のためrawではnull。乳由来の無調味チーズを想定して計算用に0g/100gと仮定します。',
  },
  world_tomyum_paste:{
    raw:[237,4.2,17.8,14.9,null,17.8],estimates:{fiber:1.8},
    source:'輸入販売者アライドコーポレーション、スリーシェフ トムヤムペースト227gの100g当たり表示。確認日2026-11-13。https://allied-thai.co.jp/products/threechef_tomyumpaste_227g_rt',
    note:'食物繊維は未表示のためrawではnull。香味野菜・ハーブを製品100g中60g、その繊維を3g/100gとする配合仮定から1.8g/100gを計算用に補完。実測値でも製造者の配合でもありません。',
  },
  world_garam_masala:{
    raw:[430,14,15,59,null,.2],estimates:{fiber:36.9},
    source:'エスビー食品FAUCHONガラムマサラ、10g当たり表示を100gへ換算。確認日2026-11-13。https://www.sbfoods.co.jp/products/detail/16299.html',
    note:'食物繊維は未表示のためrawではnull。同じ混合乾燥香辛料である成分表17061カレー粉の36.9g/100gを近似値として補完。配合が異なるため概算です。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=17_17061_7',
  },
};
export const WORLD_NUTRITION=freeze(Object.fromEntries(Object.entries(rows).map(([id,row])=>{
  const rawNutritionPerUnit=perGram(row.raw),nutritionPerUnit={...rawNutritionPerUnit};
  for(const [key,value]of Object.entries(row.estimates??{}))nutritionPerUnit[key]=Number((value/100).toFixed(8));
  return [id,{gramsPerUnit:1,rawNutritionPerUnit,nutritionPerUnit,rawNutritionSource:row.source,
    nutritionSource:[row.source,row.note,WORLD_INGREDIENTS[id].note].filter(Boolean).join(' '),
    estimatedNutrients:Object.keys(row.estimates??{})}];
})));

const parts=items=>items.map(([id,amount])=>({id,amount}));
const recipe=(slug,name,role,family,items,steps,extra={})=>({
  id:`world-${slug}`,name,role,family,genre:'エスニック',minutes:35,servings:2,
  ingredients:parts(items),steps,staple:role==='staple',mealBase:false,nature:'home-cooked',
  portion:{amount:1,unit:'皿'},allergensKnown:true,ingredientsKnown:true,shoppingKnown:true,
  tags:[],sourceNote:'家庭用の明示配合を材料ごとに合算した概算です。調理による水分減少は栄養の増加とみなしません。',...extra,
});
const riceStep='ご飯を添えて人数分へ盛る。';
const riceNote='初期値は炊飯済みのご飯1人150gを含みます。詳細でライスのg数を変更し、0g（カレーのみ）にもできます。ナンは別メニューで加えます。';
const curry=(slug,name,items,steps,extra={})=>recipe(slug,name,'staple','curry',[
  ['rice',300],...items,
],[...steps,riceStep],{mealBase:true,variantLabel:name,displayMethod:'simmer',...extra,
  sourceNote:`${extra.sourceNote??'材料を明示した家庭用のカレー配合です。'} ${riceNote}`,
});
const saagSteps=(protein,paneer=false)=>[
  'ほうれん草を洗ってさっと下ゆでし、水気を切って細かく刻むかペーストにする。玉ねぎ、にんにく、しょうがも細かくする。',
  '鍋で油を温め、クミン、玉ねぎ、にんにく、しょうがを香りよく炒める。トマトとカレー粉を加えて水分を飛ばす。',
  paneer?'ヨーグルトと水を混ぜて軽く煮詰め、ほうれん草と角切りにしたパニールを加えて崩さないよう温める。':`${protein}を食べやすく切って加える。ヨーグルトと水を混ぜ、肉の中心まで十分に火が通るまで煮る。`,
  paneer?'ガラムマサラと塩で味を調え、全体が均一に熱くなるまで弱火でなじませる。':'ほうれん草、ガラムマサラ、塩を加えてなじませ、必要なら水を少しずつ足して濃度を調える。',
];
const naanBase=[['world_bread_flour',120],['flour',40],['yogurt',60],['milk',40],['sugar',8],['salt',1],['palette_baking_powder',4],['oil',6]];
const naanSteps=[
  '粉、ベーキングパウダー、砂糖、塩をよく混ぜ、ヨーグルト、牛乳、油を加えてなめらかになるまでこねる。',
  '生地を覆って約30分休ませる。焼く枚数に等分し、薄くのばす。打ち粉を使う場合は計量した粉から取り分ける。',
  '焦げ付きにくいフライパンを温め、弱めの火で両面を焼く。表面に焼き色が付き、中に生の粉や生地が残らないことを確認する。',
];
const naan=(slug,name,extraItems=[],extra={})=>recipe(`naan-${slug}`,name,'staple','naan',[
  ...naanBase,...extraItems,
],naanSteps,{
  minutes:45,variantLabel:name.replace(/ナン$/,''),displayMethod:'grill',
  portion:{amount:1,unit:'枚',label:'1枚はプレーン生地を焼いて約125gが目安。追加具材の重量は別。'},
  sourceNote:'明治の発酵不要ヨーグルトナンを参考にした、強力粉入りの家庭用配合です。材料は2枚分、1人1枚。栄養と買い物は焼成前の全材料から計算し、焼成後の重量は水分減少を含む目安です。https://www.meiji.co.jp/meiji-shokuiku/shokuikurecipe/recipe/0907.html',
  ...extra,
});

export const WORLD_RECIPES=freeze([
  recipe('tomyum-kung','トムヤムクン','soup','soup',[
    ['shrimp',160],['mushroom',80],['tomato',100],['water',450],['world_tomyum_paste',24],['world_lime_juice',10],
  ],[
    'えびは殻や背わたを除いて可食部を用意し、マッシュルームとトマトを食べやすく切る。',
    '鍋に水とトムヤムペーストを入れて溶かし、マッシュルームとトマトを加えて煮る。',
    'えびを加え、中心まで十分に火が通るまで加熱する。加熱しすぎて硬くならないよう様子を見る。',
    '火を弱めてライム果汁を混ぜる。具とスープを人数に合わせて器へ分ける。',
  ],{minutes:20,portion:{amount:1,unit:'杯'},displayCategory:'fish',displayMethod:'simmer',tags:['時短'],
    sourceNote:'えびときのこを使うタイのスープ。S&Bのトムヤムクンを参考に、タイの香味素材は原材料が明示されたトムヤムペーストでまとめた家庭用配合です。スープは全量摂取する想定。マッシュルームはふくろたけの代用です。https://www.sbfoods.co.jp/recipe/detail/04975.html'}),
  curry('massaman-chicken','マッサマンカレー',[
    ['chicken',240],['potato',180],['onion',100],['green_beans',30],['coconut_milk',200],['peanut',20],
    ['garlic',6],['ginger',6],['curry_powder',10],['world_garam_masala',2],['fish_sauce',6],['sugar',6],['oil',8],['water',150],
  ],[
    '鶏肉とじゃがいもを食べやすく切る。玉ねぎは薄切り、いんげんは短く切り、落花生を粗く刻む。',
    '鍋に油を入れ、にんにく、しょうが、玉ねぎを炒める。鶏肉を加え、表面の色が変わったら香辛料を混ぜる。',
    'じゃがいも、水、ココナッツミルクを加え、鶏肉の中心とじゃがいもに火が通るまで穏やかに煮る。',
    'いんげん、落花生、ナンプラー、砂糖を加えて煮含める。濃くなりすぎたら水で調える。',
  ],{minutes:40,displayCategory:'meat',sourceNote:'S&Bの家庭用マッサマンカレーを参考に、落花生とココナッツミルクを用い、玉ねぎ・ナンプラー・混合香辛料で調整した独自の明示配合です。参照レシピの栄養値の転載ではありません。https://www.sbfoods.co.jp/recipe/detail/05248.html'}),
  curry('mutton-curry','マトンカレー',[
    ['world_mutton',260],['onion',180],['canned_tomato',160],['yogurt',80],['garlic',8],['ginger',10],
    ['curry_powder',8],['cumin',2],['turmeric',1],['world_garam_masala',2],['chilli',.5],['oil',12],['salt',2],['water',200],
  ],[
    'マトンを食べやすい角切りにし、ヨーグルトとカレー粉の一部をもみ込む。玉ねぎを薄切りにする。',
    '鍋で油とクミンを温め、玉ねぎを色づくまで炒める。にんにく、しょうが、残りのカレー粉、ターメリック、唐辛子を加える。',
    'マトンを漬けたヨーグルトごと加え、トマト、水、塩を混ぜる。沸いたら弱火にして、肉が軟らかくなるまで約50〜60分煮る。',
    '煮詰まりすぎないよう水を補い、肉の中心まで火が通ったことを確認する。最後にガラムマサラを加えて香りを整える。',
  ],{minutes:85,displayCategory:'meat',sourceNote:'アジャンタのマトンカレーの羊肉・玉ねぎ・トマト・ヨーグルト・香辛料という構成を参考にした家庭用の独自配合です。羊肉はマトンロース脂身つきの成分表を代表値に使用し、店の製品栄養を再現するものではありません。https://www.ajanta.com/c/ajanta/MUTTONCURRY'}),
  curry('saag-chicken','サグチキンカレー',[
    ['chicken',240],['spinach',240],['onion',160],['canned_tomato',120],['yogurt',80],['garlic',8],['ginger',8],
    ['curry_powder',8],['cumin',1.5],['world_garam_masala',2],['oil',12],['salt',2],['water',160],
  ],saagSteps('鶏肉'),{minutes:40,displayCategory:'meat',displaySecondaryCategories:['vegetable'],
    sourceNote:'ハウス食品のサグチキンカレーのほうれん草ペーストと鶏肉の調理を参考に、市販ルウに代えて香辛料とヨーグルトを使った独自配合です。ほうれん草の量は下ゆで前の可食重量、ゆで汁への損失は補正しません。https://housefoods.jp/recipe/rcp_00026433.html'}),
  curry('saag-paneer','サグパニールカレー',[
    ['world_paneer',180],['spinach',240],['onion',160],['canned_tomato',120],['yogurt',80],['garlic',8],['ginger',8],
    ['curry_powder',8],['cumin',1.5],['world_garam_masala',2],['oil',10],['salt',1.8],['water',140],
  ],saagSteps('パニール',true),{minutes:35,displayCategory:'vegetable',displaySecondaryCategories:['dairy'],
    sourceNote:'サグチキンと同じほうれん草ソースに、乳を固めたパニールを使う家庭用の明示配合です。パニールはSabar Dairyの100g当たり表示を代表値に使用します。ほうれん草の量は下ゆで前の可食重量です。https://sabardairy.org/product/amul-fresh-paneer/'}),
  recipe('crab-cream-croquette','カニクリームコロッケ','main','cutlet',[
    ['crab',100],['onion',60],['butter',20],['flour',35],['milk',220],['egg',.5],['breadcrumbs',30],['oil',22],['salt',.8],['black_pepper',.2],
  ],[
    '玉ねぎをみじん切りにし、少量の油でしんなりするまで炒める。かに身の殻を確認してほぐす。',
    '別の鍋でバターを溶かす。薄力粉の約七割を加えて弱火で炒め、牛乳を少しずつ混ぜて、木べらの跡が残る硬さのホワイトソースにする。',
    '玉ねぎ、かに身、塩、こしょうを混ぜる。浅い容器へ広げ、粗熱を取って冷蔵庫で約60分、成形できる硬さまで冷やす。',
    '人数分をそれぞれ同じ数の俵形にする。残りの薄力粉、溶き卵、パン粉を付け、約180℃の油で衣がきつね色になるまで揚げて十分油を切る。',
  ],{genre:'洋食',minutes:110,portion:{amount:2,unit:'個',label:'大きめ2個が1人分。1個の仕上がり約100gが目安。'},displayCategory:'fish',displayMethod:'fried',
    sourceNote:'S&Bカニクリームコロッケを参考にした、かに身と牛乳のホワイトソースを使う家庭用配合です。材料は大きめ4個分。油は炒め油2mlと完成品へ残る吸収油20ml、計22ml/2人分を概算し、鍋に張る揚げ油を全量加算しません。衣の材料は実際に付着する量の目安です。https://www.sbfoods.co.jp/recipe/detail/03891.html'}),
  naan('plain','プレーンナン'),
  naan('garlic','ガーリックナン',[['garlic',6],['butter',10]],{
    steps:[...naanSteps,'焼き上がりに溶かしたバターと細かく刻んだにんにくを薄く塗り、弱火で再度温めてにんにくへ火を通す。'],
  }),
  naan('butter','バターナン',[['butter',16]],{steps:[...naanSteps,'焼き上がった熱いうちにバターを薄く塗り、均等になじませる。']}),
  naan('cheese','チーズナン',[['cheese',60]],{
    steps:[naanSteps[0],'生地を覆って約30分休ませ、焼く枚数に等分する。薄くのばしてチーズを包み、閉じ目を密着させて平らに整える。',naanSteps[2]],
    portion:{amount:1,unit:'枚',label:'1枚はプレーン生地約125gにチーズ30gを加えた目安。'},
  }),
  naan('sesame','ごまナン',[['sesame',10]],{steps:[naanSteps[0],naanSteps[1],'表面にごまを均等に押し付け、焦げ付きにくいフライパンで両面を焼く。弱めの火で中まで火を通す。']}),
  naan('wholewheat','全粒粉ナン',[],{
    ingredients:parts([['world_wholemeal_flour',80],['world_bread_flour',80],['yogurt',60],['milk',40],['sugar',8],['salt',1],['palette_baking_powder',4],['oil',6]]),
    sourceNote:'小麦粉の半分を全粒粉にした家庭用ナンです。全粒粉は強力粉全粒粉01023の値で計算します。2枚分の材料から1枚の栄養を計算し、焼成後は1枚約125gを目安とします。https://www.meiji.co.jp/meiji-shokuiku/shokuikurecipe/recipe/0907.html',
  }),
]);
