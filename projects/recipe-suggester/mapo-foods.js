/** 陳建一さんの公開配合を参考に、にんにくの芽で作る家庭向けの麻婆豆腐。 */
export const MAPO_SEARCH_ALIASES = Object.freeze(['陳麻婆豆腐','陳建一','四川麻婆豆腐','辛い麻婆豆腐','芽にんにく','にんにくの芽']);
export const MAPO_RECIPES = [{
  id:'mapo-tofu-chen-style', name:'本格麻婆豆腐（陳建一風・にんにくの芽）',
  role:'main',family:'bean-main',genre:'中華',nature:'home-cooked',
  minutes:30,servings:2,staple:false,mealBase:false,
  ingredientsKnown:true,allergensKnown:true,shoppingKnown:true,
  variantLabel:'本格・陳建一風（にんにくの芽）',portion:{amount:1,unit:'皿'},
  displayCategory:'bean',displaySecondaryCategories:['meat','vegetable'],displayMethod:'simmer',
  tags:['定番','ガッツリ'],
  ingredients:[
    ['tofu',400],['pork_minced',100],['mapo_garlic_shoots',40],['negi',30],['garlic',5],
    ['mapo_doubanjiang',18],['mapo_tianmianjiang',18],['mapo_douchi',10],['chilli',2],
    ['water',170],['sake',15],['soy_sauce',10],['starch',10],['oil',20],['mapo_chilli_oil',10],['mapo_huajiao',.5],
  ].map(([id,amount])=>({id,amount})),
  steps:[
    '豆腐を約2cm角に切る。にんにくの芽は硬い端を落として薄い小口切り、長ねぎ・にんにく・豆豉は細かく刻む。片栗粉の重さの2倍量の水を材料から取り分け、片栗粉を溶く。',
    '別鍋の湯で豆腐を静かに温め、水気を切る。下ゆでの湯は捨て、煮汁には使わない。',
    'フライパンに植物油を熱し、ひき肉をほぐしながらよく炒める。にんにくの芽を加え、硬さが取れるまで炒める。',
    'いったん火を弱め、にんにく・豆板醤・甜麺醤・豆豉・粉とうがらしを加える。焦がさず炒め、油に香りを移す。',
    '残りの水と酒・しょうゆを加え、豆腐を入れて煮る。ひき肉を含め中心75℃で1分以上の加熱を確認し、にんにくの芽にも十分火を通す。',
    '長ねぎを加える。水溶き片栗粉を混ぜ直して少しずつ加え、豆腐を崩さないよう鍋を揺すってとろみを付ける。煮立たせて片栗粉に火を通す。',
    '分量のラー油を回し入れて仕上げ、器に盛って花椒を振る。材料の油とラー油はこの料理全量に使う量。辛味をさらに足す場合は、追加した調味料もアレンジで記録する。',
  ],
  sourceNote:'陳建一さんの「陳麻婆豆腐」（シェフごはん）を参考にした家庭用2皿のアレンジ。https://chefgohan.gnavi.co.jp/detail/4432/ 葉にんにくの代わりに、にんにくの芽（茎にんにく）40gを薄く切って先に炒めます。豆腐400g・豚ひき肉100gを基準に量を調整し、スープは水、紹興酒は料理酒で代用。水170mlのうち20mlは水溶き片栗粉用です。下ゆでは無塩の湯を使い、油と調味料を含む全量から栄養を概算します。豆板醤・甜麺醤は小麦・大豆、ラー油はごまを含む想定。実際の商品の表示も確認してください。花椒と豆豉の一部の栄養には明示した代理推定を含みます。',
}];
