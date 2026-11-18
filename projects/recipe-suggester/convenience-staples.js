/** 商品ページの栄養表示を食べた個数・包装数に合わせて記録する。 */
const checked = '2026-11-18';
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const seven = code => `https://www.sej.co.jp/products/a/item/${code}/`;
const lawson = code => `https://www.lawson.co.jp/recommend/original/detail/${code}_1996.html`;
const familyMart = path => `https://www.family.co.jp/goods/${path}.html`;
const stores = {
  seven: ['セブン‐イレブン', 'セブンイレブン', 'セブン'],
  lawson: ['ローソン', 'LAWSON'],
  familyMart: ['ファミリーマート', 'ファミマ'],
};
const morningSnack = ['朝食', '間食'];
const meals = ['朝食', '昼食', '夕食'];
const lunchDinner = ['昼食', '夕食'];
const hotChicken = ['昼食', '夕食', '間食', '晩酌'];
const eggMilkWheat = ['egg', 'milk', 'wheat'];

// 値の順序はエネルギー、たんぱく質、脂質、炭水化物、食物繊維、食塩相当量。
// 表示を確認できたアレルゲンや商品名で分かる素材だけを保存する。全原材料は未確認。
const sweetBreads = [
  {id:'melon-pan', store:'seven', name:'ふんわりしっとりメロンパン', aliases:['メロンパン'],
    values:[395, 7.9, 12, 64.8, 2, .48], url:seven('304151'), allergens:eggMilkWheat, occasions:['間食']},
  {id:'strawberry-coppe', store:'seven', name:'ふんわりコッペ いちごジャム＆マーガリン', aliases:['ジャムパン', 'いちごジャムコッペパン'],
    values:[349, 6.4, 12.5, 53.6, 1.6, 1.1], url:seven('302928'), allergens:eggMilkWheat, occasions:morningSnack},
  {id:'milk-france', store:'seven', name:'小麦香る練乳ミルクフランス', aliases:['ミルクフランス', '練乳パン'],
    values:[370, 7.1, 17.8, 46, 1.3, .82], url:seven('303909'), allergens:eggMilkWheat, occasions:['間食']},
  {id:'chocolate-chip-bread', store:'seven', name:'チョコチップのせましたちぎれるスイートブレッド', aliases:['チョコチップパン', 'ちぎりパン'],
    values:[396, 8.2, 15, 58.1, 1.9, .83], url:seven('304234'), allergens:eggMilkWheat, occasions:['間食'], note:'近畿向けの商品です。'},
  {id:'anpan', store:'lawson', name:'つぶあんぱん', aliases:['あんパン', 'つぶあんパン', 'ミニあんぱん'],
    values:[119, 3.2, 1.2, 24.8, 1.6, .1], url:lawson('1530835'), allergens:['wheat', 'egg', 'milk', 'soy'], occasions:morningSnack, packCount:4},
  {id:'cream-pan', store:'lawson', name:'クリームパン', aliases:['カスタードパン', 'ミニクリームパン'],
    values:[108, 2.6, 3.2, 17.4, .4, .1], url:lawson('1530834'), allergens:['wheat', 'egg', 'milk', 'soy'], occasions:morningSnack, packCount:4},
  {id:'apple-danish', store:'lawson', name:'角切りりんごのデニッシュ', aliases:['アップルデニッシュ', 'りんごパン'],
    values:[109, 2, 3.4, 17.9, .7, .3], url:lawson('1490470'), allergens:['wheat', 'egg', 'milk', 'soy', 'apple'], occasions:morningSnack, packCount:4},
  {id:'chocolate-croissant', store:'lawson', name:'バター香るチョコクロワッサン', aliases:['チョコクロワッサン', 'ミニクロワッサン'],
    values:[109, 1.6, 6.6, 11.1, .5, .2], url:lawson('1533076'), allergens:['wheat', 'egg', 'milk', 'soy'], occasions:morningSnack, packCount:4},
].map(product => ({...product, family:'sweet-bread', role:'staple', genre:'洋食', group:'菓子パン',
  label:product.packCount ? '4個入りのうち1個（関東の表示値）' : '1個入りのパン1包装'}));

const products = [...sweetBreads,
  {id:'tuna-mayo-onigiri', store:'seven', name:'手巻おにぎり ツナマヨネーズ', aliases:['ツナマヨおにぎり', 'シーチキンおにぎり'],
    role:'staple', family:'onigiri', group:'おにぎり', occasions:[...meals, '間食'], values:[258, 5.2, 10.6, 36.5, 1.9, 1.2],
    url:seven('041909'), allergens:['egg', 'wheat'], label:'おにぎり1個（海苔込み）'},
  {id:'salmon-onigiri', store:'seven', name:'新潟県産コシヒカリおむすび 炭火焼紅鮭切り身', aliases:['鮭おにぎり', 'しゃけおにぎり', '紅しゃけ'],
    role:'staple', family:'onigiri', group:'おにぎり', occasions:[...meals, '間食'], values:[186, 5.9, 1.7, 37.6, 1.5, 1.3],
    url:seven('045035'), allergens:['salmon'], label:'紅鮭入りのおむすび1個', note:'関東・山梨・北陸向けの商品です。'},
  {id:'nori-bento', store:'seven', name:'海苔弁当', aliases:['のり弁', 'のりべんとう', '白身魚フライ'],
    role:'staple', family:'other-staple', group:'弁当', occasions:lunchDinner, values:[716, 16.2, 25.8, 107.2, 5.1, 3.5],
    url:seven('044888'), allergens:eggMilkWheat, label:'ご飯とおかずを含む弁当1包装', unit:'食', complete:true},
  {id:'napolitan', store:'seven', name:'ソース味わうナポリタン', aliases:['ナポリタンスパゲティ', 'ケチャップスパゲティ'],
    role:'staple', family:'pasta', group:'パスタ', genre:'洋食', occasions:lunchDinner, values:[534, 17.5, 16.1, 82.5, 5.7, 5.1],
    url:seven('091982'), allergens:eggMilkWheat, label:'ソースと具を含むパスタ1包装', unit:'食', complete:true, note:'鳥取・島根・広島・山口向けの商品です。'},
  {id:'zaru-soba', store:'seven', name:'信州産石臼挽きそば粉のざるそば', aliases:['ざるそば', '冷たいそば', '冷やしそば'],
    role:'staple', family:'soba', group:'そば', occasions:lunchDinner, values:[354, 16.4, 3.4, 67.1, 5.4, 1.9],
    url:seven('090392'), allergens:['egg', 'wheat', 'buckwheat'], label:'ざるそば1包装', unit:'食', complete:true,
    note:'山梨・長野向けの商品です。つゆだけの栄養表示はありません。'},
  {id:'egg-sandwich', store:'seven', name:'こだわりTHEたまごサンド', aliases:['卵サンドイッチ', 'エッグサンド'],
    role:'staple', family:'bread', group:'サンドイッチ', genre:'洋食', occasions:['朝食', '昼食'], values:[402, 10.8, 29.3, 24.3, 1.2, 1.3],
    url:seven('054037'), allergens:eggMilkWheat, label:'たまごサンド1包装（商品番号054037）', unit:'食', complete:true},
  {id:'vegetable-salad', store:'seven', name:'1／3日分の野菜が摂れるサラダ', aliases:['カップサラダ', '野菜サラダ', '生野菜サラダ'],
    role:'side', family:'side', group:'サラダ', genre:'洋食', category:'vegetable', method:'salad', occasions:meals, values:[30, 1.6, .5, 5.7, 2.1, .16],
    url:seven('103049'), allergens:[], label:'サラダ1包装。別売りのドレッシングを除く', unit:'食'},
  {id:'salted-egg', store:'seven', name:'7プレミアム 味付き半熟ゆでたまご', aliases:['味付け卵', 'ゆで卵', '半熟卵'],
    role:'side', family:'small-dish', group:'惣菜', category:'egg', method:'boil', occasions:['朝食', '昼食', '夕食', '間食', '晩酌'],
    values:[65, 5.8, 4.3, .7, .1, .6], url:seven('102041'), allergens:['egg'], label:'1個入りの味付け卵1個'},
  {id:'salad-chicken-bar', store:'seven', name:'7プレミアム サラダチキンバー', aliases:['サラダチキン', 'チキンスティック'],
    role:'snack', family:'functional-snack', group:'惣菜', occasions:['昼食', '夕食', '間食', '晩酌'],
    values:[60, 12.2, 1.2, 0, 0, .8], url:seven('251065'), allergens:['egg', 'milk', 'wheat', 'chicken'], label:'個包装のサラダチキンバー1本', unit:'本'},
  {id:'karaage-kun', store:'lawson', name:'からあげクン レギュラー', aliases:['からあげくん', '唐揚げ', 'ホットスナック'],
    role:'main', family:'karaage', group:'ホットスナック', category:'meat', method:'karaage', occasions:hotChicken,
    values:[226, 14.4, 15.4, 7.8, .5, 1.5], url:'https://www.lawson.co.jp/sp/recommend/original/detail/1390563_2168.html',
    allergens:['wheat', 'egg', 'milk', 'soy', 'chicken', 'pork'], label:'5個入りの1パック', portionAmount:5, purchaseUnit:'袋'},
  {id:'l-chiki', store:'lawson', name:'Lチキ レギュラー', aliases:['エルチキ', 'フライドチキン', '骨なしチキン'],
    role:'main', family:'meat-main', group:'ホットスナック', category:'meat', method:'fried', occasions:hotChicken,
    values:[255, 13.7, 16.6, 12.8, .5, 1.6], url:lawson('1390578'), allergens:['wheat', 'egg', 'milk', 'soy', 'chicken'], label:'フライドチキン1個'},
  {id:'famichiki', store:'familyMart', name:'ファミチキ', aliases:['骨なしチキン', 'フライドチキン'],
    role:'main', family:'meat-main', group:'ホットスナック', category:'meat', method:'fried', occasions:hotChicken,
    values:[251.7, 12.7, 15.7, 14.8, null, 1.3], url:familyMart('friedfoods/0253116'), allergens:['wheat', 'egg', 'milk', 'soy', 'chicken'], label:'骨なしのファミチキ1個'},
  {id:'pork-bun', store:'familyMart', name:'じゅわっとジューシー本格肉まん', aliases:['にくまん', '豚まん', '中華まん'],
    role:'snack', family:'hot-snack', group:'中華まん', genre:'中華', occasions:['昼食', '間食'], values:[221, 6.4, 8.2, 30.3, null, .9],
    url:familyMart('chukaman/0240161'), allergens:['wheat', 'sesame', 'soy', 'chicken', 'pork', 'gelatin'], label:'肉まん1個'},
  {id:'pizza-bun', store:'familyMart', name:'のびーるチーズのコク旨ピザまん', aliases:['ピザマン', '中華まん'],
    role:'snack', family:'hot-snack', group:'中華まん', genre:'中華', occasions:['昼食', '間食'], values:[202, 5.8, 6.7, 29.6, null, .9],
    url:familyMart('chukaman/0240260'), allergens:['wheat', 'egg', 'milk', 'orange', 'soy'], label:'ピザまん1個'},
  {id:'corn-dog', store:'familyMart', name:'アメリカンドッグ', aliases:['アメリカンドック', 'コーンドッグ'],
    role:'snack', family:'hot-snack', group:'ホットスナック', genre:'洋食', occasions:['間食'], values:[335, 7, 18.1, 35.8, null, 1.8],
    url:familyMart('friedfoods/0251174'), allergens:['wheat', 'egg', 'milk', 'soy', 'chicken', 'pork', 'gelatin'], label:'アメリカンドッグ1本。追加のソースを除く', unit:'本'},
];

const ingredientId = product => `convenience_${product.id.replaceAll('-', '_')}`;
const displayName = product => `${product.name}（${stores[product.store][0]}${product.packCount ? '・4個入' : ''}）`;
const nutrientValues = (product, multiplier = 1) => Object.fromEntries(keys.map((key, index) => [key,
  product.values[index] === null ? null : Number((product.values[index] * multiplier).toFixed(6))]));
const sourceText = product => `${stores[product.store][0]}の商品表示。表示の基準は「${product.label}」。${product.note ?? ''}${product.values[4] === null ? '食物繊維は未表示です。' : ''}確認日 ${checked}。出典 ${product.url}`;

export const CONVENIENCE_INGREDIENTS = Object.fromEntries(products.map(product => [ingredientId(product), {
  name:`${displayName(product)}${product.id === 'karaage-kun' ? '・5個入り' : ''}`, unit:product.packCount ? '袋' : product.purchaseUnit ?? product.unit ?? '個',
  allergens:product.allergens, groups:product.role === 'staple' ? ['staple'] : [], proteinSources:[],
  note:`購入する完成品です。${product.packCount ? '1袋に4個入っています。' : ''}全原材料は店頭の表示で確認してください。`,
}]));

export const CONVENIENCE_NUTRITION = Object.fromEntries(products.map(product => {
  const values = nutrientValues(product, product.packCount ?? 1);
  const source = `${product.packCount ? '購入単位1袋＝4個。1個当たりの表示を4倍して算出。' : ''}${sourceText(product)}`;
  return [ingredientId(product), {nutritionPerUnit:values, rawNutritionPerUnit:{...values}, estimatedNutrients:[], nutritionSource:source, rawNutritionSource:source}];
}));

export const CONVENIENCE_RECIPES = products.map(product => ({
  id:`convenience-${product.id}`, name:displayName(product), variantLabel:product.name, family:product.family,
  role:product.role, genre:product.genre ?? '和食', staple:product.role === 'staple', mealBase:product.complete ?? false,
  servings:2, minutes:1, nature:'ready-to-eat', processed:true,
  ingredients:[{id:ingredientId(product), amount:2 / (product.packCount ?? 1)}], steps:[], tags:product.role === 'staple' ? [] : ['時短'],
  mealOccasions:[...product.occasions], searchAliases:['コンビニ', 'コンビニエンスストア', product.group, ...stores[product.store], ...product.aliases],
  ...(product.category ? {displayCategory:product.category, displayMethod:product.method} : {}),
  ingredientsKnown:false, allergensKnown:false, shoppingKnown:true,
  portion:{amount:product.portionAmount ?? 1, unit:product.unit ?? '個', label:product.label},
  manualNutrition:nutrientValues(product), sourceNote:`${sourceText(product)} 商品改定や地域によって規格が異なります。手元の商品の表示を優先してください。`,
}));
