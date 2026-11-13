/** 本格麻婆豆腐に使う食材。表示済みの値と計算用の概算補完を分けて保持します。 */
const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const mext = (group, code) => `https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=${group}_${code}_7`;
const definitions = {
  mapo_garlic_shoots: {
    name:'にんにくの芽（茎にんにく・生）', allergens:[], groups:['vegetable'], derivedFrom:[],
    values:[44, 1.9, .3, 10.6, 3.8, 0],
    source:`日本食品標準成分表（八訂）増補2023年 食品番号06224「茎にんにく・花茎・生」の可食部100g値。${mext(6,'06224')}`,
    note:'葉にんにくや発芽したにんにくの球根ではなく、一般に「にんにくの芽」として売られる花茎です。かたい根元を除き、調理前の可食部を量ります。',
  },
  mapo_doubanjiang: {
    name:'豆板醤（小麦・大豆・ごまを含む想定）', allergens:['wheat','soy','sesame'], groups:[], derivedFrom:['flour','soybeans','sesame_oil'],
    values:[49, 2, 2.3, 7.9, 4.3, 17.8],
    source:`日本食品標準成分表（八訂）増補2023年 食品番号17004「トウバンジャン」の可食部100g値。${mext(17,'17004')}`,
    note:'そら豆・とうがらし等を使う辛味調味料の一般値です。そら豆を大豆と取り違えるのではなく、成分表の調味料説明と市販品の原料差を考慮して小麦・大豆・ごまを含む製品を想定します。個別商品の原材料と塩分は表示を確認してください。',
  },
  mapo_tianmianjiang: {
    name:'甜麺醤（小麦・大豆を含む想定）', allergens:['wheat','soy'], groups:[], derivedFrom:['flour','soybeans'],
    values:[249, 8.5, 7.7, 38.1, 3.1, 7.3],
    source:`日本食品標準成分表（八訂）増補2023年 食品番号17106「テンメンジャン」の可食部100g値。${mext(17,'17106')}`,
    note:'甘味のある発酵調味料の一般値です。小麦・大豆を含む製品を想定しています。商品による原料・油脂・糖分・塩分の差は実物の表示を優先してください。',
  },
  mapo_douchi: {
    name:'豆豉（粒・塩漬け発酵黒大豆）', allergens:['soy'], groups:[], derivedFrom:['soybeans'],
    // S&B 菜館豆豉の15g表示を100gへ換算。糖質2.9gを総炭水化物と同一視しません。
    values:[42 / 15 * 100, 3.8 / 15 * 100, 1.7 / 15 * 100, null, null, 1.5 / 15 * 100],
    estimates:{carbs:2.9 / 15 * 100 + 7.6, fiber:7.6},
    source:'S&B「菜館 豆豉」製品15gあたりの公式表示（エネルギー42kcal、たんぱく質3.8g、脂質1.7g、糖質2.9g、食塩相当量1.5g）を100gへ換算。総炭水化物と食物繊維は未掲載。https://www.sbfoods.co.jp/products/detail/18742.html',
    estimateSource:`食物繊維は塩漬け発酵大豆の類似食品「寺納豆」（食品番号04049）の7.6g/100gで近似。総炭水化物は表示糖質19.333333g/100gに推定食物繊維7.6g/100gを加えて概算。豆豉そのものの分析値ではありません。${mext(4,'04049')}`,
    note:'粒の豆豉を刻んで使う想定です。油・しょうゆ等を加えた「豆豉醤」の栄養ではありません。発酵や製品による差があり、使用商品の表示を優先してください。',
  },
  mapo_huajiao: {
    name:'花椒（粉・食塩無添加）', allergens:[], groups:[], derivedFrom:[],
    values:[366, 8.9, 6.1, 68.9, null, 0], estimates:{fiber:25.3},
    source:'ユウキ食品「花椒」公式原材料・栄養成分情報の100g値。原材料は花椒のみ。食物繊維は未掲載。https://www2.youki.co.jp/api/goods/info/110202.html',
    estimateSource:'食物繊維は少量の乾燥香辛料の計算用として、既存DBと同じUSDA SR Legacyの黒こしょう25.3g/100gを代理値に使用。花椒の実測値ではなく、0.5gの使用で食物繊維約0.127gとする概算です。https://www.nal.usda.gov/sites/default/files/page-files/Total_Dietary_Fiber.pdf',
    note:'日本の山椒とは別の香辛料です。食塩入りの花椒塩ではなく、花椒のみの粉を量ります。',
  },
  mapo_chilli_oil: {
    name:'ラー油（具なし・ごま油を含む想定）', allergens:['sesame'], groups:[], derivedFrom:['sesame_oil'],
    values:[887, .1, 99.8, null, null, 0], estimates:{carbs:.03, fiber:0},
    source:`日本食品標準成分表（八訂）増補2023年 食品番号17006「ラー油」の可食部100g値。炭水化物はTr、食物繊維は未掲載。${mext(17,'17006')}`,
    estimateSource:'炭水化物Trは0.01以上0.05g未満/100gの中央0.03g/100gで概算。食物繊維は具を含まない香味油として計算上0g/100gと仮定します。にんにく・ナッツ等の具入り「食べるラー油」へは適用しません。https://fooddb.mext.go.jp/help.html',
    note:'ごま油に唐辛子の香味を移した具なしのラー油を想定します。唐辛子の粉や具入りラー油とは別に重量を量り、調理用の油に重ねて使う分として脂質へ加算します。',
  },
};

export const MAPO_INGREDIENTS = freeze(Object.fromEntries(Object.entries(definitions).map(([id, food]) => [id, {
  name:food.name, unit:'g', allergens:food.allergens, groups:food.groups, proteinSources:[], derivedFrom:food.derivedFrom,
  note:food.note,
}])));

export const MAPO_NUTRITION = freeze(Object.fromEntries(Object.entries(definitions).map(([id, food]) => {
  const raw = Object.fromEntries(keys.map((key, index) => [key, food.values[index] === null ? null : food.values[index] / 100]));
  const estimatedNutrients = keys.filter(key => Object.hasOwn(food.estimates ?? {}, key));
  const nutritionPerUnit = {...raw, ...Object.fromEntries(estimatedNutrients.map(key => [key, food.estimates[key] / 100]))};
  const rawNutritionSource = `${food.source} 確認日2026-11-13。${food.note}`;
  return [id, {gramsPerUnit:1, nutritionPerUnit, rawNutritionPerUnit:raw, rawNutritionSource, estimatedNutrients,
    nutritionSource:`${rawNutritionSource}${food.estimateSource ? ` 計算用の概算補完：${food.estimateSource}` : ''}`}];
})));
