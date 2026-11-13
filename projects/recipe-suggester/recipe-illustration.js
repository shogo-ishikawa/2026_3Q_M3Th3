/** 料理の完成写真ではなく、一覧を見分けるための分類イラストを選びます。 */
import {recipeFamily} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';

const LABELS=Object.freeze({
  rice:'ご飯・穀類のイメージ',onigiri:'おにぎりのイメージ',bread:'パンのイメージ',
  noodles:'麺類のイメージ',curry:'カレーのイメージ',pizza:'ピザのイメージ',
  sushi:'寿司のイメージ',burger:'ハンバーガーのイメージ',hotpot:'鍋・煮物のイメージ',
  soup:'汁物のイメージ',sashimi:'刺身のイメージ',grill:'焼き物のイメージ',
  skewer:'串焼きのイメージ','stir-fry':'炒め物のイメージ',fried:'揚げ物のイメージ',
  salad:'サラダ・和え物のイメージ',egg:'卵料理のイメージ',tofu:'豆・豆腐料理のイメージ',
  vegetables:'野菜・きのこ・海藻料理のイメージ',fruit:'果物のイメージ',
  dessert:'お菓子・デザートのイメージ',drink:'飲み物のイメージ',
  cheese:'チーズのイメージ',nuts:'ナッツのイメージ',plate:'食品のイメージ',
});
export const ILLUSTRATION_KINDS=Object.freeze(Object.keys(LABELS));
const families=new Map([
  ...['rice','fried-rice','donburi','omelette-rice','oatmeal'].map(id=>[id,'rice']),
  ['onigiri','onigiri'],['bread','bread'],['naan','bread'],
  ...['udon','soba','yakisoba','pasta','ramen','somen'].map(id=>[id,'noodles']),
  ['curry','curry'],['pizza','pizza'],['sushi','sushi'],['burger','burger'],
  ['karaage','fried'],['cutlet','fried'],['sashimi','sashimi'],['grilled-fish','grill'],
  ['egg-main','egg'],['bean-main','tofu'],['fruit','fruit'],['cheese','cheese'],['nuts','nuts'],
  ...['chocolate','candy','gummy','biscuit','donut','cake','japanese-sweet',
    'ice-dessert','sweets','dessert','yoghurt'].map(id=>[id,'dessert']),
]);
// 既存の表示分類では串焼きも grill です。確認済みのレシピIDだけを区別し、
// 「串」「焼き鳥」などの名前や単位「本」からは推測しません。
const skewers=new Set([
  'familiar-yakitori-negima','varied-yakitori-thigh-salt','varied-yakitori-thigh-tare',
  'varied-yakitori-breast-salt','varied-yakitori-skin','varied-yakitori-tsukune',
  'varied-yakitori-tsukune-cheese','varied-yakitori-ume-shiso',
  'takeaway-yakitori-momo-tare','takeaway-yakitori-momo-salt','takeaway-yakitori-negima-tare',
  'takeaway-yakitori-tsukune-tare','takeaway-yakitori-kawa-tare','takeaway-yakitori-sunagimo-salt',
  'bistro-lamb-spice-skewers',
]);
const result=kind=>({kind,label:LABELS[kind]});

/** 分類だけを参照し、材料・分量・栄養・保存データには触れません。 */
export function recipeIllustration(recipe){
  if(!recipe||typeof recipe!=='object'||Array.isArray(recipe))return result('plate');
  // 自作の未分類料理を名前だけから特定料理のイラストへ振り分けません。
  if(recipe.custom===true&&recipe.family===undefined){
    return result(recipe.role==='soup'?'soup':recipe.role==='drink'?'drink':'plate');
  }
  try{
    const family=recipeFamily(recipe),classification=dishClassification(recipe);
    if(classification.section==='soup')return result('soup');
    if(classification.section==='drink')return result('drink');
    if(classification.section==='staple')return result(families.get(family)??'plate');
    if(recipe.custom!==true&&skewers.has(recipe.id))return result('skewer');
    if(['hotpot','simmer','stew'].includes(classification.method))return result('hotpot');
    if(['fried','sashimi','stir-fry'].includes(classification.method))return result(classification.method);
    if(['salad','dressed'].includes(classification.method))return result('salad');
    if(families.has(family))return result(families.get(family));
    if(classification.category==='egg')return result('egg');
    if(classification.category==='bean')return result('tofu');
    if(['vegetable','mushroom','seaweed'].includes(classification.category))return result('vegetables');
    if(classification.method==='grill'||classification.method==='meuniere')return result('grill');
    return result('plate');
  }catch{return result('plate');}
}
