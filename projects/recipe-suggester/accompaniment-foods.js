/** ご飯や主菜へ添える単品。ご飯・しょうゆ・たれは自動で重ねません。 */
const CHECKED='2026-11-13';
const NOTICE='ご飯やほかの料理に添えた分だけを記録します。ご飯、しょうゆ、たれは含みません。同じ分が料理に含まれている場合は重ねて登録しないでください。';
const PRODUCT_NOTICE='製品や味付けで原材料と栄養が変わるため、実際の商品表示を優先してください。全原材料は未登録のため自動提案には使いません。';
const EGG_SAFETY='生食用と表示された期限内のひび割れのない卵を使い、食べる直前に割って速やかに食べます。高齢者、乳幼児、妊娠中の方、免疫機能が低下している方は生卵を避け、十分加熱した卵を選んでください。';
const EGG_SAFETY_URL='https://www.fsc.go.jp/e-mailmagazine/mailmagazine_h2902_r2.html';
const fish=(name,extra={})=>({name,unit:'g',allergens:[],groups:['protein'],proteinSources:['fish'],...extra});

export const ACCOMPANIMENT_INGREDIENTS={
  acmp_tuna_oil:fish('ツナ缶（油漬け・液汁を含む）',{derivedFrom:['tuna'],note:'成分表のまぐろ油漬け・ライトの代表値です。油と液汁を含む製品重量を量ります。油を切った身だけの重量へ同じ値を当てません。調味料や油の原材料は商品表示で確認してください。'}),
  acmp_onsen_egg:{name:'温泉卵（たれなし・購入品）',unit:'個',allergens:['egg'],groups:['protein'],proteinSources:['egg'],derivedFrom:['egg'],note:'完成品を個数で買う材料です。卵の生・固ゆでの成分値を流用せず、参照商品の表示はメニューの栄養に保存します。'} ,
  acmp_seasoned_nori:{name:'味付けのり（購入品）',unit:'g',allergens:[],groups:[],proteinSources:[],note:'味付けのりの製品重量です。焼きのりとは別の成分値を使います。しょうゆやエキスなど全原材料は未確認です。'},
  acmp_tarako:fish('たらこ（塩蔵・非加熱）',{derivedFrom:['cod'],note:'食塩で漬けたたらこの非加熱の可食部重量です。塩漬け前の卵巣や焼きたらこの値ではありません。調味料は商品表示で確認してください。'}),
  acmp_mentaiko:fish('辛子明太子（購入品）',{derivedFrom:['cod'],note:'すけとうだらのからしめんたいこの製品重量です。漬け込み調味料の全原材料は未確認です。'}),
  acmp_salmon_flakes:fish('鮭フレーク（購入品）',{allergens:['salmon','soy'],derivedFrom:['salmon'],note:'完成品の製品重量です。参照商品はニッスイ「焼さけあらほぐし」45g。大豆を含む商品例で、無調味の焼き鮭とは別に扱います。'}),
};

const make=(slug,name,category,ingredientId,basisAmount,unit,note,extra={})=>({
  id:`acmp-${slug}`,name,role:'side',genre:'和食',minutes:1,servings:2,
  family:'small-dish',variantLabel:name,nature:'ready-to-eat',staple:false,mealBase:false,
  displayCategory:category,displayMethod:'cold',displaySecondaryCategories:[],
  portion:{amount:basisAmount,unit},ingredients:[{id:ingredientId,amount:basisAmount*2}],
  allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,tags:['定番','時短'],steps:[],
  sourceNote:`${NOTICE} ${note} ${PRODUCT_NOTICE}確認日${CHECKED}。`,...extra,
});

export const ACCOMPANIMENT_RECIPES=[
  make('tuna-oil','ツナ（油漬け・液汁を含む）','fish','acmp_tuna_oil',35,'g',
    'まぐろ油漬けのフレーク・ライトを使った一般例です。液汁込みの量で、油切り後の量ではありません。出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_10263_7',{
    variantLabel:'ツナ（油漬け・オイル・液汁を含む）',
  }),
  make('tuna-water','ツナ（水煮・ノンオイル・液汁を含む）','fish','tuna_canned',35,'g',
    'まぐろ水煮のフレーク・ライトを使った一般例です。液汁込みの量で、水切り後の量ではありません。ノンオイルでも魚由来の脂質は含みます。出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_10260_7'),
  make('egg-raw','生卵','egg','egg',1,'個','',{
    allergensKnown:true,ingredientsKnown:true,
    portion:{amount:1,unit:'個',label:'殻を除いた可食部50gの卵1個。ご飯やしょうゆは別に記録'},
    sourceNote:`${NOTICE} 卵は殻を除いた可食部50gを1個として換算します。生の全卵の成分値を使い、加熱した卵とは区別します。すき焼きなど、料理側に卵を含む場合は、同じ卵を別添えとして二重計上しないよう材料と量を確認します。${EGG_SAFETY}確認日${CHECKED}。栄養の出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=12_12004_7 取扱いの出典: ${EGG_SAFETY_URL}`,
  }),
  make('onsen-egg','温泉卵（たれなし・市販品）','egg','acmp_onsen_egg',1,'個',
    '参照商品：バロー ValorSelect 温泉たまご（たれなし）6個入り。栄養の基準は1個・可食部標準47gで、6個全部の値ではありません。食物繊維は未表示です。出典: https://valor.jp/product/1571/',{
    manualNutrition:{kcal:66,protein:6,fat:4.5,carbs:0.3,fiber:null,salt:0.2},
    portion:{amount:1,unit:'個',label:'参照商品の卵1個・可食部標準47g。たれは含まない'},
  }),
  make('seasoned-nori','味付けのり','seaweed','acmp_seasoned_nori',2,'g',
    '成分表の味付けのりの代表値です。枚数は切り方で変わるため重量で記録します。出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=9_09005_7'),
  make('tarako','たらこ（塩蔵・非加熱）','fish','acmp_tarako',20,'g',
    '成分表のたらこ・生は塩蔵品の非加熱状態です。生食できる製品を選び、表示された保存方法と期限に従ってください。出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_10202_7'),
  make('mentaiko','辛子明太子','fish','acmp_mentaiko',20,'g',
    '成分表のからしめんたいこの代表値です。生食できる製品を選び、表示された保存方法と期限に従ってください。出典: https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=10_10204_7'),
  make('salmon-flakes','鮭フレーク（市販品）','fish','acmp_salmon_flakes',10,'g',
    '参照商品：ニッスイ 焼さけあらほぐし・45g。公式表示の1びん45gの栄養を、食べる量10gへ換算した記録例です。食物繊維は未表示です。出典: https://www.nissui.co.jp/product/00046.html',{
    manualNutrition:{kcal:87*10/45,protein:11.2*10/45,fat:4.5*10/45,carbs:0.6*10/45,fiber:null,salt:1.8*10/45},
  }),
];
