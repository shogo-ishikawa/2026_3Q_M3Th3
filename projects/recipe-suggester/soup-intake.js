/** 材料を具・煮汁に分けた家庭料理だけ、残した汁を栄養から除きます。 */
import {NUTRIENT_KEYS, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {recipePortion} from './catalog.js';

export const SOUP_INTAKE_STAGES = Object.freeze([
  {id:'none',label:'飲まない',fraction:0},
  {id:'tenth',label:'具に絡む程度',fraction:0.1},
  {id:'little',label:'少し',fraction:0.25},
  {id:'half',label:'半分',fraction:0.5},
  {id:'most',label:'ほとんど',fraction:0.8},
  {id:'full',label:'全量',fraction:1},
].map(Object.freeze));

// 監査済みの配合だけを対象にします。第2列は許可する全材料、第3列は煮汁へ
// 全量入る材料です。その他は具に残します。第4列は皮・肉だねと汁の配分です。
// 新しい食材を「調味料らしい名前」だけで煮汁に分類する処理は行いません。
const AUDITED_PARTITIONS = [
  ['chicken-tofu-pot', 'chicken tofu chinese_cabbage shimeji negi kombu water sake salt', 'kombu water sake salt'], // 鶏肉と豆腐の塩鍋
  ['soup-001', 'tofu wakame miso water kombu scallion_garnish', 'miso water kombu'], // 豆腐とわかめのみそ汁
  ['soup-002', 'nameko negi miso water bonito', 'miso water bonito'], // なめこと長ねぎのみそ汁
  ['soup-003', 'daikon carrot pork miso water kombu ginger', 'miso water kombu ginger'], // 大根と豚肉のみそ汁
  ['soup-004', 'pumpkin onion soy_milk water olive_oil salt black_pepper', 'pumpkin onion soy_milk water olive_oil salt black_pepper'], // かぼちゃの豆乳ポタージュ（全体を均一な液状として扱う）
  ['soup-005', 'broccoli onion milk water butter salt black_pepper', 'milk water butter salt black_pepper'], // ブロッコリーのミルクスープ
  ['soup-006', 'potato negi milk water butter salt black_pepper', 'potato negi milk water butter salt black_pepper'], // じゃがいもと長ねぎのポタージュ（全体を均一な液状として扱う）
  ['soup-007', 'tomato lentil_cooked onion carrot garlic olive_oil water salt black_pepper', 'garlic olive_oil water salt black_pepper'], // トマトとレンズ豆のスープ
  ['soup-008', 'carrot onion ginger milk water olive_oil salt', 'carrot onion ginger milk water olive_oil salt'], // にんじんとしょうがのポタージュ（全体を均一な液状として扱う）
  ['soup-009', 'corn onion milk water butter salt black_pepper', 'milk water butter salt black_pepper'], // コーンと玉ねぎのミルクスープ
  ['soup-010', 'cabbage white_bean_cooked carrot onion olive_oil water salt parsley', 'olive_oil water salt'], // キャベツと白いんげん豆のスープ
  ['soup-011', 'onion butter water salt black_pepper parsley', 'butter water salt black_pepper'], // 玉ねぎのあめ色スープ
  ['soup-012', 'shimeji onion milk water butter flour salt black_pepper', 'milk water butter flour salt black_pepper'], // きのこのクリームスープ
  ['soup-013', 'spinach egg water bonito soy_sauce salt cornstarch', 'water bonito soy_sauce salt cornstarch'], // ほうれん草と卵のかきたま汁
  ['soup-014', 'tofu shiitake enoki egg water soy_sauce vinegar sesame_oil ginger cornstarch chilli salt', 'water soy_sauce vinegar sesame_oil ginger cornstarch chilli salt'], // 豆腐ときのこの酸辣湯
  ['soup-015', 'chicken cabbage ginger negi water sake salt black_pepper', 'ginger water sake salt black_pepper'], // 鶏肉とキャベツのしょうがスープ
  ['soup-016', 'beef tomato onion celery olive_oil water salt black_pepper', 'olive_oil water salt black_pepper'], // 牛肉とトマトのスープ
  ['soup-017', 'pork chive bean_sprout ginger sesame_oil soy_sauce salt water sesame', 'ginger sesame_oil soy_sauce salt water sesame'], // 豚肉とにらのごまスープ
  ['soup-018', 'cod daikon ginger water kombu sake soy_sauce salt scallion_garnish', 'ginger water kombu sake soy_sauce salt'], // たらと大根の澄まし汁
  ['soup-019', 'salmon potato onion milk water butter salt black_pepper', 'milk water butter salt black_pepper'], // 鮭とじゃがいものミルクスープ
  ['soup-020', 'shrimp shimeji enoki ginger water sake soy_sauce salt sesame_oil', 'ginger water sake soy_sauce salt sesame_oil'], // えびときのこのしょうがスープ
  ['soup-021', 'pumpkin onion coconut_milk water turmeric cumin oil salt', 'coconut_milk water turmeric cumin oil salt'], // かぼちゃのココナッツスープ
  ['soup-022', 'spinach chickpea_cooked tomato onion garlic olive_oil water salt cumin', 'garlic olive_oil water salt cumin'], // ほうれん草とひよこ豆のトマトスープ
  ['soup-023', 'sweet_potato lentil_cooked onion ginger water olive_oil salt cumin', 'ginger water olive_oil salt cumin'], // さつまいもとレンズ豆のスープ
  ['soup-024', 'turnip edamame onion soy_milk water olive_oil salt black_pepper', 'soy_milk water olive_oil salt black_pepper'], // かぶと枝豆の豆乳スープ
  ['soup-025', 'zucchini tomato onion celery garlic olive_oil water salt parsley', 'garlic olive_oil water salt'], // ズッキーニとトマトのスープ
  ['soup-026', 'tofu wakame negi water ginger soy_sauce salt sesame_oil sesame', 'water ginger soy_sauce salt sesame_oil sesame'], // わかめと豆腐のごまスープ
  ['soup-027', 'tofu daikon carrot burdock taro water kombu sesame_oil soy_sauce salt', 'water kombu sesame_oil soy_sauce salt'], // 根菜と豆腐のけんちん汁
  ['soup-028', 'chicken lotus_root carrot ginger water kombu sake soy_sauce salt cornstarch', 'ginger water kombu sake soy_sauce salt cornstarch'], // 鶏肉とれんこんのとろみスープ
  ['soup-029', 'cod cabbage carrot milk water butter salt black_pepper', 'milk water butter salt black_pepper'], // たらとキャベツのミルク煮スープ
  ['soup-030', 'lotus_root shiitake ginger water kombu soy_sauce salt scallion_garnish', 'lotus_root ginger water kombu soy_sauce salt'], // れんこんすり流し汁
  ['soup-031', 'tomato cucumber paprika onion garlic olive_oil vinegar water salt black_pepper', 'tomato cucumber paprika onion garlic olive_oil vinegar water salt black_pepper'], // トマトたっぷりガスパチョ（全体を均一な液状として扱う）
  ['soup-032', 'cucumber yogurt water olive_oil lemon garlic salt black_pepper parsley', 'cucumber yogurt water olive_oil lemon garlic salt black_pepper parsley'], // きゅうりとヨーグルトの冷製スープ（全体を均一な液状として扱う）
  ['soup-033', 'tofu starch carrot shiitake water kombu soy_sauce salt scallion_garnish', 'water kombu soy_sauce salt'], // 豆腐団子のすまし汁
  ['soup-034', 'pork_minced bean_sprout komatsuna soy_milk water ground_sesame miso soy_sauce ginger sesame_oil chilli', 'soy_milk water ground_sesame miso soy_sauce ginger sesame_oil chilli'], // 豆乳ごま担々風スープ
  ['soup-035', 'dried_shiitake mung_vermicelli carrot negi ginger water soy_sauce salt sesame_oil', 'ginger water soy_sauce salt sesame_oil'], // 干ししいたけと春雨のスープ
  ['soup-036', 'shrimp okra tomato onion garlic olive_oil water paprika_powder salt', 'garlic olive_oil water paprika_powder salt'], // えびとオクラのトマトスープ
  ['soup-037', 'barley carrot celery onion cabbage canned_tomato water olive_oil salt dried_basil', 'canned_tomato water olive_oil salt dried_basil'], // 野菜と押し麦の煮込みスープ
  ['soup-038', 'flour chicken_minced carrot negi ginger water salt soy_sauce sesame_oil', 'sesame_oil', {"water":0.9,"salt":0.5,"soy_sauce":0.5}], // 鶏肉と野菜の手作りワンタンスープ
  ['soup-039', 'rice_flour daikon carrot burdock water kombu miso', 'water kombu miso'], // 米粉すいとんと根菜の汁
  ['soup-040', 'aubergine water kombu miso ginger scallion_garnish', 'aubergine water kombu miso'], // 焼きなすのすり流し汁
  ['calendar-soup-oat-mushroom', 'oatmeal shimeji onion soy_milk water salt', 'soy_milk water salt'], // きのことオートミールの豆乳スープ
  ['calendar-soup-tomato-barley', 'cooked_barley canned_tomato carrot cabbage onion water olive_oil salt', 'canned_tomato water olive_oil salt'], // トマトと押し麦のミネストローネ風
  ['calendar-soup-sweet-potato-milk', 'sweet_potato apple milk water salt', 'milk water salt'], // さつまいもとりんごのミルクスープ
  ['calendar-soup-edamame-corn', 'edamame corn soy_milk water salt', 'soy_milk water salt'], // 枝豆とコーンの豆乳スープ
  ['calendar-soup-cabbage-egg', 'cabbage egg miso water kombu', 'miso water kombu'], // キャベツと卵のみそ汁
  ['calendar-soup-daikon-lentil', 'daikon lentil_cooked ginger water soy_sauce sesame_oil', 'ginger water soy_sauce sesame_oil'], // 大根とレンズ豆のしょうがスープ
  ['calendar-soup-cauliflower-potato', 'cauliflower potato soy_milk water salt', 'cauliflower potato soy_milk water salt'], // カリフラワーとじゃがいもの豆乳ポタージュ（全体を均一な液状として扱う）
  ['calendar-soup-lettuce-tofu', 'lettuce tofu water lemon salt olive_oil', 'water lemon salt olive_oil'], // レタスと豆腐のレモンスープ
  ['calendar-soup-tomato-egg', 'tomato egg ginger water salt sesame_oil', 'ginger water salt sesame_oil'], // トマトと卵のしょうがスープ
  ['calendar-soup-carrot-chickpea', 'carrot chickpea_cooked onion water curry_powder olive_oil salt', 'water curry_powder olive_oil salt'], // にんじんとひよこ豆のカレースープ
  ['daily-miso-onion', 'miso water bonito onion', 'miso water bonito'], // 玉ねぎのみそ汁
  ['daily-miso-clam', 'miso water bonito clam', 'miso water bonito'], // あさりのみそ汁
  ['daily-miso-tonjiru', 'miso water bonito pork daikon carrot burdock tofu', 'miso water bonito'], // 豚汁
  ['daily-miso-potato', 'miso water bonito potato negi', 'miso water bonito'], // じゃがいものみそ汁
  ['daily-miso-aburaage-daikon', 'miso water bonito aburaage daikon', 'miso water bonito'], // 油揚げと大根のみそ汁
  ['familiar-yose-nabe', 'cod shrimp chicken tofu chinese_cabbage negi shiitake kombu soy_sauce mirin sake water', 'kombu soy_sauce mirin sake water'], // 寄せ鍋
  ['familiar-kimchi-nabe', 'pork kimchi tofu chinese_cabbage bean_sprout chive miso sesame_oil water', 'miso sesame_oil water'], // キムチ鍋
  ['familiar-mizutaki', 'chicken chinese_cabbage negi carrot shiitake kombu water soy_sauce vinegar lemon', 'kombu water'], // 水炊き
  ['familiar-sukiyaki', 'beef tofu shirataki negi chinese_cabbage shiitake egg soy_sauce mirin sake sugar water', 'soy_sauce mirin sake sugar water'], // すき焼き
  ['familiar-pork-shabu', 'pork chinese_cabbage negi enoki carrot kombu water soy_sauce vinegar lemon', 'kombu water'], // 豚しゃぶしゃぶ
  ['familiar-sesame-soy-nabe', 'pork tofu chinese_cabbage negi shimeji soy_milk water miso ground_sesame soy_sauce', 'soy_milk water miso ground_sesame soy_sauce'], // ごま豆乳鍋
  ['familiar-chanko-nabe', 'chicken_minced negi starch ginger chinese_cabbage carrot shimeji aburaage soy_sauce mirin sake salt water', 'soy_sauce mirin sake salt water'], // 鶏つくねのちゃんこ鍋
  ['familiar-yudofu', 'tofu negi chinese_cabbage kombu water soy_sauce vinegar scallion_garnish', 'kombu water'], // 湯豆腐
  ['familiar-sundubu', 'silken_tofu clam pork kimchi egg negi miso chilli sesame_oil water', 'miso chilli sesame_oil water'], // スンドゥブ
  ['familiar-side-pot-au-feu', 'bacon cabbage potato carrot onion celery water salt black_pepper parsley', 'water salt black_pepper'], // ベーコンと野菜のポトフ
  ['familiar-side-minestrone', 'macaroni canned_tomato cabbage carrot onion celery bacon olive_oil water salt dried_basil', 'canned_tomato olive_oil water salt dried_basil'], // ミネストローネ（マカロニ入り）
  ['familiar-side-onion-gratin-soup', 'onion butter bacon water bread cheese salt black_pepper', 'butter water salt black_pepper'], // オニオングラタンスープ
  ['familiar-side-corn-potage', 'corn onion butter milk water salt black_pepper', 'corn onion butter milk water salt black_pepper'], // コーンポタージュ（全体を均一な液状として扱う）
  ['familiar-side-clam-chowder', 'clam bacon potato onion carrot butter flour milk water salt black_pepper', 'butter flour milk water salt black_pepper'], // クラムチャウダー
  ['familiar-side-wakame-egg-soup', 'wakame egg scallion_garnish water soy_sauce sesame_oil salt sesame', 'water soy_sauce sesame_oil salt sesame'], // わかめと卵のスープ
  ['varied-chinese-corn-soup', 'corn egg starch soy_sauce salt sesame_oil water', 'starch soy_sauce salt sesame_oil water'], // 中華風コーンスープ
  ['varied-chicken-ball-vermicelli-soup', 'chicken_minced ginger negi starch mung_vermicelli chinese_cabbage soy_sauce salt sesame_oil water', 'soy_sauce sesame_oil water', {"salt":0.5}], // 鶏団子と春雨のスープ
  ['varied-yukgaejang-soup', 'beef bean_sprout carrot chive shiitake egg chilli miso soy_sauce sesame_oil garlic water', 'chilli miso soy_sauce sesame_oil garlic water'], // ユッケジャン風スープ
  ['varied-wakame-clear-soup', 'wakame negi soy_sauce salt sesame_oil sesame water', 'soy_sauce salt sesame_oil sesame water'], // わかめスープ
  ['world-tomyum-kung', 'shrimp mushroom tomato water world_tomyum_paste world_lime_juice', 'water world_tomyum_paste world_lime_juice'], // トムヤムクン
  ['simmered-pork-millefeuille-nabe', 'dish_pork_belly_sliced chinese_cabbage shimeji ginger water soy_sauce mirin sake', 'ginger water soy_sauce mirin sake'], // 豚ばらと白菜のミルフィーユ鍋
  ['simmered-pork-mizore-nabe', 'pork daikon negi shimeji simmered_mizuna noodle_chinese_stock soy_sauce sake ginger', 'noodle_chinese_stock soy_sauce sake ginger'], // 豚肉と大根おろしのみぞれ鍋
  ['simmered-chicken-yuzu-kosho-nabe', 'chicken chinese_cabbage tofu simmered_mizuna shiitake water sake soy_sauce simmered_yuzu_kosho ginger', 'water sake soy_sauce simmered_yuzu_kosho ginger'], // 鶏肉と水菜の柚子胡椒鍋
  ['simmered-chicken-salt-lemon-nabe', 'chicken_breast starch chinese_cabbage negi enoki simmered_mizuna lemon_slice lemon garlic ginger salt mirin water', 'lemon garlic ginger salt mirin water'], // 鶏むね肉の塩レモン鍋
  ['simmered-ishikari-nabe', 'salmon potato cabbage onion carrot tofu shiitake water miso mirin sake butter', 'water miso mirin sake butter'], // 鮭とじゃがいもの石狩鍋
  ['simmered-beef-motsu-nabe', 'meat_beef_small_intestine_raw cabbage chive burdock negi garlic ginger chilli noodle_chinese_stock soy_sauce mirin miso', 'garlic ginger chilli noodle_chinese_stock soy_sauce mirin miso'], // 牛もつのにんにく醤油鍋
  ['simmered-oyster-miso-nabe', 'simmered_oyster chinese_cabbage tofu negi shimeji miso mirin sake ginger noodle_niboshi_stock', 'miso mirin sake ginger noodle_niboshi_stock'], // かきと豆腐の味噌鍋
  ['simmered-duck-negi-nabe', 'simmered_duck negi simmered_mizuna simmered_maitake tofu water soy_sauce mirin sake ginger', 'water soy_sauce mirin sake ginger'], // 合鴨と焼きねぎの鍋
  ['simmered-chicken-tomato-cheese-nabe', 'chicken cabbage onion broccoli shimeji canned_tomato cheese garlic olive_oil water salt black_pepper', 'canned_tomato cheese garlic olive_oil water salt black_pepper'], // 鶏肉と野菜のチーズトマト鍋
  ['simmered-chicken-curry-nabe', 'chicken chinese_cabbage negi shimeji aburaage carrot noodle_niboshi_stock soy_sauce mirin curry_powder oil garlic ginger', 'noodle_niboshi_stock soy_sauce mirin curry_powder oil garlic ginger'], // 鶏肉と白菜の和風カレー鍋
  ['simmered-soy-milk-tantan-nabe', 'pork_minced tofu chinese_cabbage bean_sprout komatsuna soy_milk water ground_sesame miso soy_sauce mapo_doubanjiang mapo_tianmianjiang mapo_chilli_oil oil garlic ginger', 'soy_milk water ground_sesame miso soy_sauce mapo_chilli_oil'], // 豚そぼろと野菜の豆乳担々鍋
  ['simmered-pork-spinach-joya-nabe', 'pork spinach negi simmered_maitake water sake soy_sauce mirin lemon', 'water sake soy_sauce mirin lemon'], // 豚肉とほうれん草の常夜鍋
  ['soup311-osuimono-tofu-wakame', 'silken_tofu wakame soup311_awase_dashi soy_sauce salt scallion_garnish', 'soup311_awase_dashi soy_sauce salt'], // 豆腐とわかめのお吸い物
  ['soup311-osuimono-asari', 'clam water sake soy_sauce salt scallion_garnish', 'water sake soy_sauce salt'], // あさりのお吸い物
  ['soup311-arajiru-salmon', 'salmon taro daikon carrot burdock tofu negi soup311_awase_dashi sake soy_sauce ginger', 'soup311_awase_dashi sake soy_sauce ginger'], // 鮭のあら汁（しょうゆ仕立て）
  ['soup311-arajiru-buri', 'yellowtail daikon carrot tofu negi ginger soup311_awase_dashi sake miso', 'ginger soup311_awase_dashi sake miso'], // ぶりのあら汁（みそ仕立て）
  ['soup311-clam-chowder-tomato', 'clam bacon potato onion carrot celery canned_tomato water olive_oil soup311_consomme black_pepper parsley', 'canned_tomato water olive_oil soup311_consomme black_pepper'], // トマトのクラムチャウダー
  ['soup311-pumpkin-milk-potage', 'pumpkin onion butter milk water soup311_consomme black_pepper', 'pumpkin onion butter milk water soup311_consomme black_pepper'], // かぼちゃのミルクポタージュ（全体を均一な液状として扱う）
  ['soup311-consomme-plain', 'water soup311_consomme parsley', 'water soup311_consomme'], // コンソメスープ
  ['soup311-consomme-vegetable', 'cabbage onion carrot mushroom water soup311_consomme black_pepper', 'water soup311_consomme black_pepper'], // 野菜のコンソメスープ
  ['soup311-wonton-pork', 'soup311_wonton_wrappers pork_minced negi ginger soy_sauce sake sesame_oil salt noodle_chinese_stock komatsuna black_pepper', 'sake noodle_chinese_stock', {"soy_sauce":0.5,"sesame_oil":0.5}], // 豚肉と長ねぎのワンタンスープ
];
const HOMOGENEOUS = new Set(['soup-004','soup-006','soup-008','soup-031','soup-032','calendar-soup-cauliflower-potato','familiar-side-corn-potage','soup311-pumpkin-milk-potage']);
const audited = new Map(AUDITED_PARTITIONS.map(([id,all,broth,partial={}])=>{
  const brothIds=new Set(broth.split(' ').filter(Boolean));
  return [id,{id,homogeneous:HOMOGENEOUS.has(id),ingredientFractions:Object.fromEntries(all.split(' ').map(id=>[id,partial[id]??(brothIds.has(id)?1:0)]))}];
}));
const POT_AU_FEU_IDS = new Set('bacon palette_wiener chicken chicken_breast pork cabbage potato carrot onion celery turnip broccoli mushroom shimeji tomato water salt black_pepper parsley'.split(' '));
const POT_AU_FEU_BROTH = new Set(['water','salt','black_pepper']);
const MARKER = '汁・具の摂取割合による概算：';
const ASSUMPTION = '煮汁の塩分・油・溶けた食材は均一と仮定します。肉から溶け出す脂や、具に吸収される塩分は自動で移し替えていません。付けだれ・肉だね・皮に使う調味料は具側に残します。材料と買い物は、残す汁を含めて用意する1人分です。保存済みの過去の記録は変更しません。';
const clone=value=>structuredClone(value);
const empty=()=>Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]));
const validRatio=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const sameNutrition=(left,right)=>NUTRIENT_KEYS.every(key=>left[key]===right[key]||(typeof left[key]==='number'&&typeof right[key]==='number'&&Math.abs(left[key]-right[key])<1e-7));
function materialNutrition(recipe,data){const {manualNutrition,...materials}=recipe;return recipeNutrition(materials,data);}
function partitionNutrition(recipe,data,fractions,broth){
  const out=empty();
  for(const part of recipe.ingredients){
    const fraction=broth?fractions[part.id]:1-fractions[part.id];
    if(fraction===0)continue;
    const nutrients=recipeNutrition({servings:recipe.servings,ingredients:[part]},data);
    for(const key of NUTRIENT_KEYS)out[key]=out[key]===null||nutrients[key]===null?null:out[key]+nutrients[key]*fraction;
  }
  return out;
}
function trustedPotAuFeu(recipe,data){
  if(recipe.custom!==true||recipe.nature!=='home-cooked'||recipe.role!=='soup'||recipe.family!=='soup'||!recipe.name?.startsWith('ポトフ（')||!recipe.sourceNote?.startsWith('ポトフの1皿分です。'))return false;
  if(recipe.ingredients.some(part=>!POT_AU_FEU_IDS.has(part.id))||!recipe.ingredients.some(part=>part.id==='water'&&part.amount>0))return false;
  return recipe.manualNutrition!==undefined&&sameNutrition(recipeNutrition(recipe,data),materialNutrition(recipe,data));
}

/**
 * 既知の材料配分がある家庭料理かを確認します。公式の合計値や任意の手入力値を
 * 具と汁に機械的に分解しません。独自のおでんと麺類の計算は既存モデルに任せます。
 */
export function soupIntakeFor(recipe,data){
  if(!recipe||!Array.isArray(recipe.ingredients)||!recipe.ingredients.length||recipe.nature!=='home-cooked'||(typeof recipe.sourceNote==='string'&&recipe.sourceNote.includes(MARKER)))return null;
  try{
    let definition=audited.get(recipe.id);
    if(recipe.custom===true||recipe.manualNutrition!==undefined){
      if(!trustedPotAuFeu(recipe,data))return null;
      definition={id:'composed-pot-au-feu',homogeneous:false,ingredientFractions:Object.fromEntries(recipe.ingredients.map(part=>[part.id,POT_AU_FEU_BROTH.has(part.id)?1:0]))};
    }
    if(!definition||new Set(recipe.ingredients.map(part=>part.id)).size!==recipe.ingredients.length||recipe.ingredients.some(part=>!Object.hasOwn(definition.ingredientFractions,part.id)))return null;
    // 数量・材料参照・確認状況もここで検証し、不明なデータに操作UIを出しません。
    recipeConfirmation(recipe);
    materialNutrition(recipe,data);
    return {...definition,label:definition.homogeneous?'均一なスープ全体':'具と煮汁',ingredientFractions:{...definition.ingredientFractions},
      brothNutrition:partitionNutrition(recipe,data,definition.ingredientFractions,true),
      solidNutrition:partitionNutrition(recipe,data,definition.ingredientFractions,false),
      sourceNote:definition.homogeneous?'なめらかに混ざったスープ全体を、同じ濃さで食べた割合に応じて計算します。':ASSUMPTION};
  }catch{return null;}
}

/** 調理する材料を減らさず、食べた割合だけ1人分の栄養へ反映します。 */
export function buildSoupIntake({baseRecipe,brothRatio=1,solidRatio=1,id}={},data){
  if(!validRatio(brothRatio)||!validRatio(solidRatio))throw Error('汁と具の割合は0から1の有限な数値で指定してください。');
  const definition=soupIntakeFor(baseRecipe,data);
  if(!definition)throw Error('この料理には確認済みの汁と具の配分がありません。材料から計算できる家庭料理を選んでください。');
  if(id!==undefined&&(typeof id!=='string'||!/^custom-[A-Za-z0-9_-]+$/.test(id)||id.length>120))throw Error('料理の識別子を確認してください。');
  const manualNutrition=brothRatio===1&&solidRatio===1?recipeNutrition(baseRecipe,data):empty();
  if(brothRatio!==1||solidRatio!==1){
    for(const part of baseRecipe.ingredients){
      const brothFraction=definition.ingredientFractions[part.id];
      const consumed=brothFraction*brothRatio+(1-brothFraction)*solidRatio;
      if(consumed===0)continue;
      const nutrients=recipeNutrition({servings:baseRecipe.servings,ingredients:[part]},data);
      for(const key of NUTRIENT_KEYS)manualNutrition[key]=manualNutrition[key]===null||nutrients[key]===null?null:manualNutrition[key]+nutrients[key]*consumed;
    }
  }
  const percent=value=>`${Number((value*100).toFixed(6))}%`;
  const summary=definition.homogeneous?`スープ全体${percent(brothRatio)}`:`汁${percent(brothRatio)}・具${percent(solidRatio)}`;
  const confirmed=recipeConfirmation(baseRecipe),portion=recipePortion(baseRecipe);
  const description=`${MARKER}${summary}。${definition.homogeneous?'均一なスープ全体を食べた割合で計算します。':''}${ASSUMPTION}`;
  const originalNote=baseRecipe.sourceNote?` 元の配合・出典：${baseRecipe.sourceNote}`:'';
  const metadata=Object.fromEntries(['role','genre','minutes','staple','steps','allergens','groups','proteinSources','family','variantLabel','mealBase','nature','shoppingKnown','restaurant'].filter(key=>baseRecipe[key]!==undefined).map(key=>[key,clone(baseRecipe[key])]));
  return {...metadata,id:id??`custom-soup-intake-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    custom:true,name:`${baseRecipe.name}（${summary}）`,servings:1,
    ingredients:baseRecipe.ingredients.map(part=>({id:part.id,amount:part.amount/baseRecipe.servings})),
    portion:clone(portion),manualNutrition,nutritionBasis:'estimate',
    allergensKnown:confirmed.allergensKnown,ingredientsKnown:confirmed.ingredientsKnown,
    sourceNote:(description+originalNote).slice(0,2000)};
}
