/** パン類の標準的な組み合わせ。材料表は2人分、選択用の配合は1個分です。 */
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const KEYS=['kcal','protein','fat','carbs','fiber','salt'];
const MEXT='日本食品標準成分表（八訂）増補2023年';
const product=(name,number,group,values,allergens,derivedFrom)=>{
  const source=`${MEXT}、食品番号${number}。可食部100g当たりの代表値。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${number}_${['07013','05037'].includes(number)?6:7}&MODE=0 確認日2026-11-14。`;
  const nutrients=Object.fromEntries(KEYS.map((key,i)=>[key,values[i]/100]));
  return {name,unit:'g',gramsPerUnit:1,allergens,groups:[],proteinSources:[],derivedFrom,
    ingredientsKnown:false,allergensKnown:false,shoppingKnown:true,
    nutritionPerUnit:{...nutrients},rawNutritionPerUnit:{...nutrients},nutritionSource:source,rawNutritionSource:source,estimatedNutrients:[],
    note:'成分表の代表食品です。銘柄ごとの配合やアレルゲンは未確認のため、実物の商品表示を確認してください。完成した製品のg数で量ります。'};
};

// 可食部100g：kcal, protein, fat, carbs, fibre, salt。原値と計算用の値を同一に保持。
export const BREAD_INGREDIENTS=freeze({
  bread_strawberry_jam:product('いちごジャム（高糖度・代表値）','07013','07',[250,.4,.1,63.3,1.3,0],[],['strawberry']),
  bread_marmalade:product('オレンジマーマレード（高糖度・代表値）','07046','7',[233,.2,.1,63.2,.7,0],['orange'],['orange']),
  bread_peanut_butter:product('ピーナッツバター（代表値）','05037','05',[599,20.6,50.4,24.9,7.6,.9],['peanut'],['peanut']),
  bread_ketchup:product('トマトケチャップ（代表値）','17036','17',[116,1.6,.2,27.6,1.7,3.1],[],['tomato']),
});

// data.jsの共通栄養付与処理からも、同じ原値・計算値を参照します。
export const BREAD_NUTRITION=freeze(Object.fromEntries(Object.entries(BREAD_INGREDIENTS).map(([id,item])=>[id,
  Object.fromEntries(['gramsPerUnit','nutritionPerUnit','nutritionSource','rawNutritionPerUnit','rawNutritionSource','estimatedNutrients'].map(key=>[key,item[key]]))])));

const part=(label,ingredients,unit='g',defaultAmount=10,section='具材',note='')=>({label,ingredients,unit,defaultAmount,section,...(note?{note}:{})});
export const BREAD_COMPONENT_INGREDIENTS=freeze({
  ham:{...part('ハム',[['ready_sliced_ham',1]],'g',20),ingredientsKnown:false,allergensKnown:false},
  prosciutto:part('生ハム',[['palette_prosciutto',1]],'g',15),
  bacon:{...part('ベーコン',[['bacon',1]],'g',20),ingredientsKnown:false,allergensKnown:false},
  cheese:part('チーズ',[['cheese',1]],'g',20),
  'cream-cheese':part('クリームチーズ',[['palette_cream_cheese',1]],'g',20),
  tuna:part('ツナ（水煮）',[['tuna_canned',1]],'g',30),
  'boiled-egg':part('ゆで卵',[['egg',1]],'個',1,'具材','固ゆでして殻を除いた卵1個の目安です。'),
  'fried-egg':part('目玉焼き',[['egg',1],['oil',1]],'個',1,'具材','卵1個と焼く油1mlを含みます。黄身と白身が固まるまで加熱します。'),
  'sausage-patty':part('手作りソーセージパティ',[['pork_minced',45],['salt',.35],['black_pepper',.05],['oil',1]],'個',1,'具材','豚ひき肉45gと調味料・焼く油1mlを使う家庭用の1枚です。特定店の製品ではありません。'),
  chicken:part('鶏むね肉のソテー',[['chicken_breast',1],['oil',.02],['salt',.005]],'g',60,'具材','表示g数は加熱前の皮なし鶏むね肉です。100gにつき油2ml・塩0.5gを含みます。'),
  lettuce:part('レタス',[['lettuce',1]],'g',10),
  tomato:part('トマト',[['tomato',1]],'g',30),
  cucumber:part('きゅうり',[['cucumber',1]],'g',20),
  avocado:part('アボカド',[['avocado',1]],'g',30),
  cabbage:part('キャベツ',[['cabbage',1]],'g',30),
  onion:part('玉ねぎ',[['onion',1]],'g',15),
  'green-pepper':part('ピーマン',[['pepper',1]],'g',10),
  corn:part('コーン',[['corn',1]],'g',20),
  shimeji:part('しめじのソテー',[['shimeji',1],['olive_oil',.03],['salt',.003]],'g',35,'具材','表示g数は調理前のしめじです。100gにつきオリーブ油3ml・塩0.3gを含みます。'),
  mayonnaise:part('マヨネーズ',[['mayonnaise',1]],'g',5,'塗るもの・ソース'),
  butter:part('バター',[['butter',1]],'g',5,'塗るもの・ソース'),
  ketchup:part('トマトケチャップ',[['bread_ketchup',1]],'g',10,'塗るもの・ソース'),
  'pizza-sauce':part('簡易ピザソース',[['bread_ketchup',.8],['tomato_paste',.2]],'g',20,'塗るもの・ソース','ケチャップ8gとトマトペースト2gを合わせる10g分の配合です。'),
  'strawberry-jam':part('いちごジャム',[['bread_strawberry_jam',1]],'g',15,'甘いトッピング','高糖度ジャムの代表値です。低糖度品などは商品の表示値と異なります。'),
  marmalade:part('マーマレード',[['bread_marmalade',1]],'g',15,'甘いトッピング','高糖度マーマレードの代表値です。実物の商品表示を確認してください。'),
  'peanut-butter':part('ピーナッツバター',[['bread_peanut_butter',1]],'g',15,'甘いトッピング'),
  honey:part('はちみつ',[['palette_honey',1]],'g',10,'甘いトッピング'),
  maple:part('メープルシロップ',[['palette_maple_syrup',1]],'g',10,'甘いトッピング'),
  chocolate:part('チョコレート',[['chocolate',1]],'g',10,'甘いトッピング'),
  banana:part('バナナ',[['banana',1]],'g',30,'甘いトッピング'),
});

export const BREAD_BASE_INGREDIENTS=freeze({
  'english-muffin':[['palette_english_muffin',60]],sandwich:[['bread',60]],'hot-sandwich':[['bread',60]],toast:[['bread',60]],
});
const preset=(kind,id,label,components,extra={})=>({id,label,recipeId:`bread-${kind}-${id}`,components:[['base',1],...components],...extra});
export const BREAD_PRESETS=freeze({
  'english-muffin':[
    preset('english-muffin','ham-cheese','ハムチーズ',[['ham',20],['cheese',20]]),
    preset('english-muffin','egg-cheese','エッグチーズ',[['fried-egg',1],['cheese',15]]),
    preset('english-muffin','sausage-egg-cheese','ソーセージエッグチーズ',[['sausage-patty',1],['fried-egg',1],['cheese',15]]),
    preset('english-muffin','bacon-egg-cheese','ベーコンエッグチーズ',[['bacon',20],['fried-egg',1],['cheese',15]]),
    preset('english-muffin','tuna-cheese','ツナチーズ',[['tuna',30],['cheese',20],['mayonnaise',5]]),
    preset('english-muffin','custom','具材を指定する',[],{recipeId:'palette-english-muffin',custom:true}),
  ],
  sandwich:[
    preset('sandwich','ham-lettuce','ハムレタス',[['ham',20],['lettuce',10],['mayonnaise',5]],{recipeId:'palette-sandwich'}),
    preset('sandwich','egg-mayo','たまごマヨ',[['boiled-egg',1],['mayonnaise',8]]),
    preset('sandwich','tuna-cucumber','ツナきゅうり',[['tuna',40],['cucumber',20],['mayonnaise',8]]),
    preset('sandwich','ham-cheese','ハムチーズ',[['ham',20],['cheese',20]]),
    preset('sandwich','vegetable','野菜',[['lettuce',15],['tomato',30],['cucumber',20],['mayonnaise',5]]),
    preset('sandwich','chicken','チキンレタス',[['chicken',60],['lettuce',10],['tomato',20],['mayonnaise',5]]),
    preset('sandwich','custom','具材を指定する',[],{custom:true}),
  ],
  'hot-sandwich':[
    preset('hot-sandwich','ham-cheese','ハムチーズ',[['ham',20],['cheese',20],['butter',3]]),
    preset('hot-sandwich','egg-cheese','たまごチーズ',[['boiled-egg',1],['cheese',15],['mayonnaise',5],['butter',3]]),
    preset('hot-sandwich','tuna-melt','ツナメルト',[['tuna',40],['cheese',20],['onion',10],['mayonnaise',5],['butter',3]]),
    preset('hot-sandwich','chicken-cabbage','チキンキャベツ',[['chicken',60],['cabbage',30],['mayonnaise',5],['butter',3]]),
    preset('hot-sandwich','bacon-egg','ベーコンエッグ',[['bacon',20],['fried-egg',1],['cheese',15],['butter',3]]),
    preset('hot-sandwich','sausage-cheese','ソーセージチーズ',[['sausage-patty',1],['cheese',20],['ketchup',8],['butter',3]]),
    preset('hot-sandwich','pizza','ピザ風',[['ham',15],['cheese',25],['onion',15],['green-pepper',10],['pizza-sauce',20],['butter',3]]),
    preset('hot-sandwich','corn-cheese','コーンチーズ',[['corn',30],['cheese',20],['mayonnaise',5],['butter',3]]),
    preset('hot-sandwich','mushroom-cheese','きのこチーズ',[['shimeji',35],['cheese',20],['butter',3]]),
    preset('hot-sandwich','avocado-ham','アボカドハム',[['avocado',35],['ham',20],['cheese',15],['butter',3]]),
    preset('hot-sandwich','custom','具材を指定する',[],{custom:true}),
  ],
  toast:[
    preset('toast','butter','バター',[['butter',5]],{recipeId:'staple-butter-toast'}),
    preset('toast','jam-butter','いちごジャムバター',[['strawberry-jam',15],['butter',5]]),
    preset('toast','marmalade-butter','マーマレードバター',[['marmalade',15],['butter',5]]),
    preset('toast','cheese','チーズ',[['cheese',20]],{recipeId:'staple-cheese-toast'}),
    preset('toast','honey-butter','はちみつバター',[['honey',10],['butter',5]]),
    preset('toast','avocado','アボカド',[['avocado',40]]),
    preset('toast','pizza','ピザトースト',[['ham',15],['cheese',25],['onion',15],['green-pepper',10],['corn',10],['pizza-sauce',20]]),
    preset('toast','peanut-butter','ピーナッツバター',[['peanut-butter',15]]),
    preset('toast','custom','具材を指定する',[],{custom:true}),
  ],
});

const unknown=new Set(['palette_english_muffin','ready_sliced_ham','palette_prosciutto','bacon',...Object.keys(BREAD_INGREDIENTS)]);
const labels={'english-muffin':'イングリッシュマフィン',sandwich:'サンドイッチ','hot-sandwich':'ホットサンド',toast:'トースト'};
function recipeFor(kind,p){
  const amounts=new Map();
  for(const [id,amount] of p.components){
    for(const [ingredient,n] of id==='base'?BREAD_BASE_INGREDIENTS[kind]:BREAD_COMPONENT_INGREDIENTS[id].ingredients)amounts.set(ingredient,(amounts.get(ingredient)??0)+n*amount*2);
  }
  const has=id=>p.components.some(([part])=>part===id);
  const simpleName=p.custom?`${labels[kind]}（具材を指定する）`:kind==='toast'&&p.id==='pizza'?'ピザトースト':`${p.label}${labels[kind]}`;
  const steps=[kind==='english-muffin'?'イングリッシュマフィンを横半分に割り、切り口を軽くトーストする。':kind==='toast'?'食パンは材料表の量を用意する。厚さと重さは製品表示を確認する。':'食パンは材料表の人数分を用意する。野菜は洗って水気を切る。',
    ...(has('boiled-egg')?['卵を沸いた湯で10〜12分ゆでて固ゆでにし、冷まして殻を除く。細かくつぶすか薄切りにする。']:[]),
    ...(has('fried-egg')?['分量の油で目玉焼きを作り、ふたをして黄身と白身が固まるまで加熱する。']:[]),
    ...(has('sausage-patty')?['豚ひき肉へ塩・こしょうを混ぜ、パンに合う平たいパティに成形する。分量の油で両面を焼き、最も厚い部分の中心75℃で1分以上を確認する。']:[]),
    ...(has('chicken')?['鶏むね肉を薄めに切り、分量の油と塩で焼く。最も厚い部分の中心75℃で1分以上を確認してから切る。表示した肉のg数は加熱前の重量。']:[]),
    ...(has('bacon')?['ベーコンは製品の調理方法に従い、中心まで熱くなるまで加熱する。']:[]),
    ...(has('shimeji')?['しめじの石づきを除いて小房に分け、分量のオリーブ油と塩で火が通るまで炒める。']:[]),
    ...(has('pizza-sauce')?['ケチャップとトマトペーストを混ぜて簡易ピザソースを作る。玉ねぎとピーマンは薄切りにする。']:[]),
    kind==='hot-sandwich'?'加熱済みの具とソースを食パンではさむ。バターを選んだ場合は外側に薄く塗り、ホットサンドメーカーの説明に従って両面を焼く。中の具も十分温まったことを確認する。':kind==='toast'?'選んだバターやソース、具材を食パンへ広げてトースターで焼く。チーズを選んだ場合は溶けるまで加熱し、焦げそうなら火力や時間を調整する。ジャムやはちみつは焼いた後に塗ってもよい。':'加熱した具を冷まし、選んだソースと具材をパンにはさむ。作ったら早めに食べ、すぐ食べない分は冷蔵する。',
    'パンの焼き色だけで肉や卵の加熱完了を判断しない。熱い具と溶けたチーズによるやけどに注意して人数分へ分ける。'];
  const confirmed=![...amounts.keys()].some(id=>unknown.has(id));
  const minutes=has('chicken')||has('sausage-patty')?25:kind==='hot-sandwich'?20:15;
  return {id:p.recipeId,name:simpleName,role:kind==='hot-sandwich'?'main':'staple',family:'bread',genre:'洋食',minutes,servings:2,
    staple:true,mealBase:kind!=='toast',nature:'home-cooked',portion:{amount:1,unit:kind==='toast'?'枚':'個',label:kind==='toast'?'食パン1枚約60gと選んだ具材':kind==='english-muffin'?'パン1個約60gと選んだ具材':'食パン2枚合計約60gと選んだ具材'},
    ingredients:[...amounts].map(([id,amount])=>({id,amount})),steps,variantLabel:p.label,displayCategory:'grain',displayMethod:'grill',displaySecondaryCategories:[],
    allergensKnown:confirmed,ingredientsKnown:confirmed,shoppingKnown:true,tags:kind==='hot-sandwich'&&minutes<=20?['時短']:[],
    sourceNote:'家庭向けの明示配合による1例です。店舗の商品配合や公式栄養を再現したものではありません。材料は2人分で、パン1組または1枚が1人分です。詳細で標準の組み合わせを選び、具材や量を変更・削除できます。肉の重量は加熱前、ジャム等は完成製品の重量。加熱による水分・脂の流出は補正していません。加工品の原材料とアレルゲンは実物の商品表示を確認してください。'};
}
export const BREAD_RECIPES=freeze(Object.entries(BREAD_PRESETS).flatMap(([kind,presets])=>presets.filter(p=>p.recipeId.startsWith('bread-')).map(p=>recipeFor(kind,p))));
