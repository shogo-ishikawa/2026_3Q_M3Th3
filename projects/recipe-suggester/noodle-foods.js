/**
 * 麺類の概算モデル。モデルは1杯、公開レシピは2杯分。
 * soupだけが「飲んだ量」で変わり、麺・固形の具・トッピングは全量を食べる想定です。
 * 特定の店舗の栄養表示ではありません。出典と配合は docs/noodle-sources.md を参照。
 */
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nutrientKeys = ['kcal','protein','fat','carbs','fiber','salt'];
const mext = (group, code) => `https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${code}_7`;
const definitions = {
  noodle_chinese_stock: {
    name:'中華だし（鶏・豚・野菜の抽出液）', unit:'ml', allergens:['chicken','pork'], groups:[], derivedFrom:['chicken','pork'],
    values:[3,.8,0,null,null,.1], estimates:{carbs:.03,fiber:0},
    source:`日本食品標準成分表（八訂）増補2023年 食品番号17025「中華だし」の可食部100g値。${mext(17,'17025')}`,
    estimateSource:'炭水化物Trは0.01以上0.05g未満/100gの中央0.03g/100gで近似。食物繊維未掲載は固形物をこした抽出液として計算上0g/100gと仮定。液体は1ml≒1gで換算。',
    note:'鶏・豚・野菜から取った液体のだしです。顆粒だしや濃縮スープとは別の食材です。骨やだしがらの全重量を食べた栄養として加算しません。',
  },
  noodle_niboshi_stock: {
    name:'煮干しだし（いわし・抽出液）', unit:'ml', allergens:[], groups:[], derivedFrom:['sardine'],
    values:[1,.1,.1,null,0,.1], estimates:{carbs:.03},
    source:`日本食品標準成分表（八訂）増補2023年 食品番号17023「煮干しだし」の可食部100g値。${mext(17,'17023')}`,
    estimateSource:'炭水化物Trは0.01以上0.05g未満/100gの中央0.03g/100gで近似。液体は1ml≒1gで換算。',
    note:'いわし煮干しの抽出液を量ります。固形の煮干しを丸ごと食べる栄養とは区別します。いわし以外の魚や混合だしを使う場合は原材料を確認してください。',
  },
  noodle_tonkotsu_concentrate: {
    name:'豚骨白湯の濃縮スープ（代表）', unit:'g', allergens:['sesame','soy','pork'], groups:[], derivedFrom:['pork','sesame_oil','soybeans'],
    values:[347,16.1,30.2,2.6,null,13.7], estimates:{fiber:0},
    source:'エバラ「豚骨白湯（トンコツパイタン）1kg」公式100g表示。https://gyoumuyou.ebarafoods.com/products/detail/TPE1.html',
    estimateSource:'食物繊維未掲載は、固形の具を含まない濃縮がらスープとして計算上0g/100gと仮定。',
    note:'豚骨を炊き出した濃縮品の一例を代表値に使用します。薄める前の重量です。骨の可食量から栄養を推定した値ではありません。商品によって濃度・油・塩分・アレルゲンが変わるため実物の表示を優先してください。',
  },
  noodle_chicken_oil: {
    name:'鶏油（香味油・ごま油等を含む代表）', unit:'g', allergens:['soy','chicken','sesame'], groups:[], derivedFrom:['chicken','sesame_oil','soybeans'],
    values:[899,0,99.9,0,null,.02], estimates:{fiber:0},
    source:'業務スーパー「鶏油（チーユ）」公式100g表示。https://www.gyomusuper.jp/product/detail.php?go_id=2532',
    estimateSource:'食物繊維未掲載は、具を含まない香味油として計算上0g/100gと仮定。',
    note:'鶏油にねぎ・しょうが・ごま油などを合わせた香味油の代表値です。純粋な鶏脂と原材料は異なります。',
  },
  noodle_pork_fat: {
    name:'豚脂身（背脂の近似・調理前重量）', unit:'g', allergens:['pork'], groups:[], derivedFrom:['pork'],
    values:[644,5.4,70.7,0,0,.1],
    source:`日本食品標準成分表（八訂）増補2023年 食品番号11122「ぶた・大型種肉・かたロース・脂身・生」を背脂の代理値に使用。${mext(11,'11122')}`,
    note:'背脂専用の分析値ではなく、豚の脂身による概算です。細かくして加熱し、溶けた脂もスープに入れる想定。水分量や下ゆでによる脂の流出は未補正です。ラードそのものの栄養とは異なります。',
  },
  noodle_chashu: {
    name:'チャーシュー（焼き豚の一般値）', unit:'g', allergens:['wheat','soy','pork'], groups:['protein'], derivedFrom:['pork','soy_sauce'], proteinSources:['meat'],
    values:[166,19.4,8.2,5.1,0,2.4],
    source:`日本食品標準成分表（八訂）増補2023年 食品番号11195「焼き豚」の可食部100g値。${mext(11,'11195')}`,
    note:'加熱・味付け済みの製品重量。しょうゆを使う焼き豚を想定します。1枚は20gの仮定で、大判・厚切り・脂の多い豚バラの店舗商品とは差があります。追加のたれは含みません。',
  },
  noodle_menma_water: {
    name:'メンマ（水煮・水切り後）', unit:'g', allergens:[], groups:['vegetable'], derivedFrom:[],
    values:[11,.7,.2,2.9,2.4,.02],
    source:'ヤマサン食品工業「メンマ300g」公式の水煮可食部100g表示。https://www.yamasanfood.co.jp/product/007011/',
    note:'無調味の水煮の重量です。味付けメンマのトッピングではしょうゆ・砂糖・ごま油を別に加えます。塩漬けメンマとは異なり、袋の液は含みません。',
  },
};

export const NOODLE_INGREDIENTS = freeze(Object.fromEntries(Object.entries(definitions).map(([id, food]) => [id, {
  name:food.name,unit:food.unit,allergens:food.allergens,groups:food.groups,
  proteinSources:food.proteinSources ?? [],derivedFrom:food.derivedFrom,note:food.note,
}])));
export const NOODLE_NUTRITION = freeze(Object.fromEntries(Object.entries(definitions).map(([id, food]) => {
  const raw = Object.fromEntries(nutrientKeys.map((key, index) => [key,food.values[index] === null ? null : food.values[index] / 100]));
  const estimatedNutrients = Object.keys(food.estimates ?? {});
  const rawNutritionSource = `${food.source} 確認日2026-11-13。${food.note}`;
  return [id,{gramsPerUnit:1,rawNutritionPerUnit:raw,rawNutritionSource,estimatedNutrients,
    nutritionPerUnit:{...raw,...Object.fromEntries(estimatedNutrients.map(key=>[key,food.estimates[key]/100]))},
    nutritionSource:`${rawNutritionSource}${food.estimateSource ? ` 計算用の概算補完：${food.estimateSource}` : ''}`}];
})));

const ingredients = entries => entries.map(([id,amount])=>({id,amount}));
/** ingredients は表示単位1単位あたり。小さじや枚を保存時に食材本来のg・個・mlへ戻します。 */
export const NOODLE_TOPPINGS = freeze([
  {id:'ajitama',label:'味玉',unit:'個',defaultAmount:1,ingredients:ingredients([['egg',1],['soy_sauce',3],['mirin',1],['sugar',1]]),note:'卵1個＝可食部約50g。漬け汁の全量ではなく、付着・吸収分をしょうゆ3ml・みりん1ml・砂糖1g/個と仮定。みりんは加熱して使います。'},
  {id:'chashu',label:'チャーシュー',unit:'枚',defaultAmount:2,ingredients:ingredients([['noodle_chashu',20]]),note:'1枚≈20gの仮定。大判・厚切りは枚数を調整するか、食材の追加で実重量を指定してください。'},
  {id:'menma',label:'味付けメンマ',unit:'g',defaultAmount:20,ingredients:ingredients([['noodle_menma_water',.85],['soy_sauce',.06],['sugar',.03],['sesame_oil',.025],['water',.0242]]),note:'出来上がり約100g分を水煮メンマ85g・しょうゆ6ml・砂糖3g・ごま油2.5ml・水2.42mlで近似。しょうゆ1ml＝1.18g、ごま油1ml＝0.92gとして材料合計は99.8gで、水分減少は未補正。煮汁もからめて食べる想定。'},
  {id:'garlic',label:'卓上にんにく（おろし）',unit:'小さじ',defaultAmount:1,ingredients:ingredients([['garlic',3]]),note:'小さじ1杯≈3g。食塩・油を加えていない生にんにく。混合スープではなく食べた追加分として全量を加算します。'},
  {id:'corn',label:'コーン',unit:'g',defaultAmount:30,ingredients:ingredients([['corn',1]]),note:'無調味の粒。材料表の重量を量り、加熱して使います。'},
  {id:'negi',label:'長ねぎ',unit:'g',defaultAmount:10,ingredients:ingredients([['negi',1]]),note:'可食部の生重量。小口切りにします。'},
  {id:'nori',label:'焼き海苔（小片）',unit:'枚',defaultAmount:2,ingredients:ingredients([['nori',.5]]),note:'ラーメン用の小片1枚≈0.5g。全形の海苔1枚ではありません。'},
  {id:'spinach',label:'ほうれん草',unit:'g',defaultAmount:40,ingredients:ingredients([['spinach',1]]),note:'ゆでる前の可食部重量。下ゆでして水気を絞ります。ゆで汁に流出する栄養は未補正。'},
  {id:'boiled-egg',label:'ゆで卵',unit:'個',defaultAmount:1,ingredients:ingredients([['egg',1]]),note:'可食部約50g/個。殻を除き、食べる分を記録します。'},
  {id:'bean-sprout',label:'もやし',unit:'g',defaultAmount:80,ingredients:ingredients([['bean_sprout',1]]),note:'加熱前の可食部重量。中心まで加熱して湯を切ります。'},
]);

const style = (id,label,noodleAmount,soup,solids,defaultToppings=[],extra={}) => ({
  id,recipeId:id,label,kind:soup.length ? 'ramen' : 'soupless',noodleIngredientId:'ramen_noodles',noodleAmount,
  soup:ingredients(soup),solids:ingredients(solids),defaultToppings:defaultToppings.map(([id,amount])=>({id,amount})),
  soupVolumeMl:soup.length ? 400 : 0,...extra,
});
const oldSoup = [['water',350],['ginger',2],['sesame_oil',4]];
const legacyStyles = [
  style('daily-ramen-soy','しょうゆ',150,[...oldSoup,['soy_sauce',15],['salt',.6]],[['pork',50],['negi',20],['cabbage',50]],[],{soupVolumeMl:350}),
  style('daily-ramen-salt','塩',150,[...oldSoup,['garlic',1],['salt',1.2]],[['chicken_breast',60],['negi',20],['cabbage',50]],[],{soupVolumeMl:350}),
  style('daily-ramen-miso','みそ',150,[...oldSoup,['miso',20],['soy_sauce',4],['garlic',2]],[['pork',60],['bean_sprout',80],['corn',20]],[],{soupVolumeMl:350}),
  style('daily-ramen-tanmen','タンメン',150,[...oldSoup,['salt',1.2],['soy_sauce',3]],[['pork',40],['carrot',30],['onion',40],['cabbage',90],['bean_sprout',50]],[],{soupVolumeMl:350}),
];
const newStyles = [
  style('noodle-ramen-niboshi','煮干ししょうゆ',250,[['noodle_niboshi_stock',400],['soy_sauce',20],['salt',.8],['noodle_chicken_oil',5]],[],[['chashu',2],['menma',20],['negi',10]]),
  style('noodle-ramen-miso-butter-corn','味噌バターコーン',250,[['noodle_chinese_stock',400],['miso',30],['soy_sauce',5],['butter',10],['garlic',3],['ginger',3]],[['pork_minced',40],['bean_sprout',80],['corn',50]],[['negi',10]]),
  style('noodle-ramen-tonkotsu','豚骨',250,[['water',400],['noodle_tonkotsu_concentrate',30]],[],[['chashu',2],['negi',10]]),
  style('noodle-ramen-iekei','家系風・豚骨しょうゆ',250,[['water',400],['noodle_tonkotsu_concentrate',25],['soy_sauce',15],['noodle_chicken_oil',10]],[['spinach',40],['nori',1.5]],[['chashu',2],['negi',10]]),
  style('noodle-ramen-jiro','二郎系風',400,[['water',400],['noodle_tonkotsu_concentrate',25],['soy_sauce',25],['noodle_pork_fat',25],['garlic',8]],[['bean_sprout',200],['cabbage',80]],[['chashu',4]],{soupVolumeMl:400}),
  style('noodle-ramen-seabura','背脂ちゃっちゃ風',250,[['noodle_niboshi_stock',200],['noodle_chinese_stock',200],['soy_sauce',25],['salt',.5],['noodle_pork_fat',20]],[['onion',30]],[['chashu',2],['menma',20],['negi',10]]),
  style('noodle-ramen-tantan','担々麺（汁あり）',250,[['noodle_chinese_stock',400],['ground_sesame',20],['soy_sauce',12],['miso',10],['mapo_chilli_oil',8],['mapo_doubanjiang',5]],[['pork_minced',60],['mapo_tianmianjiang',5],['oil',3],['ginger',3],['garlic',3],['komatsuna',50]],[['negi',10]]),
  style('noodle-aburasoba','油そば',250,[],[['soy_sauce',18],['vinegar',10],['sesame_oil',10],['noodle_chicken_oil',5],['sugar',3]],[['chashu',2],['menma',20],['negi',15],['nori',2]]),
  style('noodle-hiyashi-chuka','冷やし中華',250,[],[['cucumber',50],['tomato',60],['ready_sliced_ham',30],['egg',.5],['oil',2],['soy_sauce',20],['vinegar',20],['sugar',10],['sesame_oil',5],['water',20]],[]),
  style('noodle-soupless-tantan','汁なし担々麺',250,[],[['pork_minced',60],['ground_sesame',20],['soy_sauce',15],['vinegar',10],['mapo_chilli_oil',10],['mapo_doubanjiang',5],['mapo_tianmianjiang',8],['mapo_huajiao',.3],['oil',3],['ginger',3],['garlic',3],['komatsuna',50],['water',20]],[['negi',15]]),
];
export const NOODLE_STYLES = freeze([...legacyStyles,...newStyles]);

const toppingById = new Map(NOODLE_TOPPINGS.map(t=>[t.id,t]));
const fullIngredients = model => {
  const rows = [{id:model.noodleIngredientId,amount:model.noodleAmount},...model.soup,...model.solids];
  model.defaultToppings.forEach(selection => toppingById.get(selection.id).ingredients.forEach(row=>rows.push({id:row.id,amount:row.amount*selection.amount})));
  const amounts = new Map(); rows.forEach(({id,amount})=>amounts.set(id,(amounts.get(id)??0)+amount));
  return [...amounts].map(([id,amount])=>({id,amount:Math.round(amount*2*1e8)/1e8}));
};
const basePrep = '食材は材料表の表示量を用意する。中華麺の量はゆで上がりの重量。生麺や乾麺は商品の表示に従って別鍋でゆで、湯を切ってから量る。ゆで湯は材料のスープ用の水とは別に用意し、捨てる。';
const toppingPrep = 'チャーシューは加熱済みのものを表示量に切って温める。味付けメンマを使う場合は、水煮メンマ：しょうゆ：砂糖：ごま油：水＝85：7.08：3：2.3：2.42の重量比で、調味料を材料表の全量から取り分けて絡め、汁気を含めて使う。しょうゆ・ごま油も重さで量り、残りをスープやたれへ使う。薬味は細かく切り、海苔は食べやすく切る。';
const modelSteps = {
  'noodle-ramen-niboshi': [basePrep,toppingPrep,'煮干しだしを温め、メンマ用を除くしょうゆ・塩・鶏油を加える。ゆでた麺を器に入れ、スープを注ぎ、チャーシュー・メンマ・長ねぎを盛る。'],
  'noodle-ramen-miso-butter-corn': [basePrep,'もやしを洗い、にんにくとしょうがを刻む。鍋に中華だしを取り、豚ひき肉・もやし・コーン・にんにく・しょうがを加えてほぐしながら煮る。ひき肉の中心75℃で1分以上の加熱を確認する。','味噌としょうゆを溶き入れ、バターを加えてスープに溶かす。麺とスープを器に盛り、具をのせ、刻んだ長ねぎを添える。バターはスープに溶けた分として飲んだ量に応じて栄養を概算する。'],
  'noodle-ramen-tonkotsu': [basePrep,toppingPrep,'鍋に材料表の水と濃縮豚骨白湯を入れ、よく混ぜて温める。濃縮スープの重量は薄める前の量。麺を器に入れてスープを注ぎ、チャーシューと長ねぎを盛る。'],
  'noodle-ramen-iekei': [basePrep,toppingPrep,'ほうれん草は根元を洗って別鍋で下ゆでし、水に取って水気を絞り、切る。材料表のほうれん草は下ゆで前の可食部重量。','鍋に水・濃縮豚骨白湯・しょうゆ・鶏油を入れ、よく混ぜながら温める。麺を器に入れてスープを注ぎ、ほうれん草・海苔・チャーシュー・長ねぎを盛る。'],
  'noodle-ramen-jiro': [basePrep,toppingPrep,'キャベツを食べやすく切り、もやしと一緒に別鍋で中心まで加熱して湯を切る。にんにくと豚脂身は細かく刻む。','鍋に材料表の水と濃縮豚骨白湯・しょうゆ・豚脂身・にんにくを入れ、脂身が柔らかくなるまで煮る。脂身を含め中心75℃で1分以上の加熱を確認する。溶けた脂を捨てずにスープへ混ぜる。','麺を器に入れ、スープを注ぎ、野菜とチャーシューを盛る。背脂はスープと一緒に残る想定の概算。実際の店舗の大盛り・麺の生重量とは区別する。'],
  'noodle-ramen-seabura': [basePrep,toppingPrep,'玉ねぎをみじん切りにする。豚脂身を細かく刻み、煮干しだし・中華だし・メンマ用を除くしょうゆ・塩と一緒に煮る。脂身を含め中心75℃で1分以上加熱し、溶けた脂もスープに混ぜる。','麺を器に入れてスープを注ぎ、玉ねぎ・チャーシュー・メンマ・長ねぎを盛る。背脂はスープと一緒に残る想定で、飲んだ量に応じて栄養を概算する。'],
  'noodle-ramen-tantan': [basePrep,'にんにく・しょうが・長ねぎを刻む。小松菜は食べやすく切って別鍋でゆで、水気を切る。フライパンに植物油を熱し、豚ひき肉・にんにく・しょうが・甜麺醤を炒め、ひき肉の中心75℃で1分以上の加熱を確認する。','別鍋で中華だしを温め、しょうゆ・味噌・豆板醤・すりごま・ラー油を混ぜる。麺とスープを器に盛り、肉そぼろ・小松菜・長ねぎをのせる。ごまとラー油はスープに混ぜた分として飲んだ量に応じて概算する。'],
  'noodle-aburasoba': [basePrep,toppingPrep,'メンマ用を除くしょうゆ・砂糖・ごま油に、酢・鶏油を混ぜてたれを作る。湯をよく切った熱い麺と和え、チャーシュー・メンマ・長ねぎ・海苔をのせる。','よく混ぜていただく。たれと油は全量を食べる想定で、スープの飲用率は使わない。追加の卓上調味料も記録する。'],
  'noodle-hiyashi-chuka': [basePrep,'きゅうり・ハムを細切りにし、トマトを切る。卵を溶き、植物油を薄く引いたフライパンで両面を中心まで焼いてから細切りにする。','しょうゆ・酢・砂糖・ごま油・材料表の水を混ぜてたれを作る。麺はゆでたら流水で冷やして水気をよく切り、ゆで上がりの表示量を器に盛る。','麺に具をのせてたれをかける。たれは全量を食べる想定。冷やした具材を長時間室温に置かず、出来上がったら早めにいただく。'],
  'noodle-soupless-tantan': [basePrep,'にんにく・しょうが・長ねぎを刻む。小松菜を食べやすく切って別鍋でゆで、水気を切る。フライパンに植物油を熱し、ひき肉・にんにく・しょうがを炒める。豆板醤・甜麺醤・材料表の水を加え、肉の中心75℃で1分以上加熱する。','器ですりごま・しょうゆ・酢・ラー油・花椒を混ぜる。湯をよく切った麺を絡め、肉そぼろ・小松菜・長ねぎを盛る。よく混ぜていただく。','たれと油は全量を食べる想定で、スープの飲用率は使わない。花椒やラー油をさらに足した場合は追加分も記録する。'],
};
const sourceNote = '配合は本アプリの家庭向け代表モデルで、特定店舗の再現や分析値ではありません。麺はゆでた状態、肉・野菜は材料の表示状態の可食部重量です。新しいだし・脂身・チャーシュー等は文部科学省の成分表またはメーカー公式表示から計算。抽出に使った骨やだしがらを食べた量として加えません。出典・全配合・換算仮定は docs/noodle-sources.md を参照。';
export const NOODLE_RECIPES = newStyles.map(model => ({
  id:model.recipeId,name:model.id === 'noodle-ramen-tantan' ? model.label : model.kind === 'ramen' ? `${model.label}ラーメン` : model.label,
  role:'staple',family:'ramen',genre:'中華',nature:'home-cooked',minutes:model.id.includes('jiro')||model.id.includes('seabura') ? 35 : 25,
  servings:2,staple:true,mealBase:true,ingredientsKnown:true,allergensKnown:true,shoppingKnown:true,
  variantLabel:model.label,portion:{amount:1,unit:'皿'},tags:[],
  ingredients:fullIngredients(model),steps:modelSteps[model.id],sourceNote,
  nutritionNote:model.kind === 'ramen'
    ? `麺はゆで上がり${model.noodleAmount}g/杯。だし・水の基準量は${model.soupVolumeMl}ml/杯（調味料等を加える前）。麺・具は全量、スープだけを飲んだ量で調整する概算。脂・塩分が均一に混ざると仮定。材料・買い物量は用意する全量です。`
    : `麺はゆで上がり${model.noodleAmount}g/皿。麺・具・たれ・油を全量食べる概算。汁ありラーメンのスープ飲用率は適用しません。`,
}));

export const NOODLE_SEARCH_ALIASES = freeze(['にぼし','煮干し','とんこつ','豚骨','いえけい','家系','じろう','二郎系','せあぶら','背脂','ちゃっちゃ','チャッチャ','みそバターコーン','味噌バターコーン','たんたんめん','担々麺','タンタン麺','あぶらそば','油そば','ひやしちゅうか','冷やし中華','汁なし担々麺','あじたま','味玉','チャーシュー','メンマ','にんにく']);
