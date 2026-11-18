import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {CONVENIENCE_RECIPES} from '../convenience-staples.js';
import {catalogVariants} from '../catalog.js';
import {createDiningSearch} from '../dining-search.js';
import {deriveRecipeBasis} from '../nutrition-basis.js';
import {itemFromRecipe, itemNutrition} from '../nutrition.js';
import {pantryClassification} from '../pantry-catalog.js';
import {ingredientGroup} from '../shopping-categories.js';
import {shoppingForEntries} from '../shopping.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
// Each row identifies a particular seller's product and reference serving, including
// regional Seven-Eleven SKUs that use the same short name as another product.
const expected = {
  'melon-pan':['sej', '304151', 'メロンパン', 395], 'strawberry-coppe':['sej', '302928', 'いちごジャム', 349],
  'milk-france':['sej', '303909', 'ミルクフランス', 370], 'chocolate-chip-bread':['sej', '304234', 'ちぎれる', 396],
  anpan:['lawson', '1530835', 'あんぱん', 119], 'cream-pan':['lawson', '1530834', 'クリームパン', 108],
  'apple-danish':['lawson', '1490470', 'りんごのデニッシュ', 109], 'chocolate-croissant':['lawson', '1533076', 'チョコクロワッサン', 109],
  'tuna-mayo-onigiri':['sej', '041909', 'ツナマヨネーズ', 258], 'salmon-onigiri':['sej', '045035', '炭火焼紅鮭切り身', 186],
  'nori-bento':['sej', '044888', '海苔弁当', 716], napolitan:['sej', '091982', 'ナポリタン', 534],
  'zaru-soba':['sej', '090392', 'ざるそば', 354], 'egg-sandwich':['sej', '054037', 'THEたまごサンド', 402],
  'vegetable-salad':['sej', '103049', '野菜が摂れるサラダ', 30], 'salted-egg':['sej', '102041', '味付き半熟ゆでたまご', 65],
  'salad-chicken-bar':['sej', '251065', 'サラダチキンバー', 60], 'karaage-kun':['lawson', '1390563', 'からあげクン', 226],
  'l-chiki':['lawson', '1390578', 'Lチキ', 255], famichiki:['family', '0253116', 'ファミチキ', 251.7],
  'pork-bun':['family', '0240161', '本格肉まん', 221], 'pizza-bun':['family', '0240260', 'コク旨ピザまん', 202],
  'corn-dog':['family', '0251174', 'アメリカンドッグ', 335],
};
const storeNames = {sej:'セブン‐イレブン', lawson:'ローソン', family:'ファミリーマート'};
const dish = id => RECIPES.find(recipe => recipe.id === `convenience-${id}`);

test('23商品を個別の公式商品・販売店・規格に照合できる', () => {
  assert.equal(CONVENIENCE_RECIPES.length, Object.keys(expected).length);
  for (const [id, [store, sku, text, kcal]] of Object.entries(expected)) {
    const recipe = dish(id);
    assert.ok(recipe.name.includes(text) && recipe.name.includes(storeNames[store]), id);
    const url = new URL(recipe.sourceNote.match(/https:\/\/[^\s]+/)[0]);
    assert.equal(url.hostname, `www.${store}.co.jp`, id);
    assert.match(url.pathname, new RegExp(`/${sku}([/._]|$)`), id);
    assert.equal(recipe.manualNutrition.kcal, kcal, id);
    assert.equal(recipe.manualNutrition.fiber === null, store === 'family', id);
    assert.equal(deriveRecipeBasis(recipe, data), 'official', id);
    assert.equal(recipe.allergensKnown, false, id);
    assert.equal(recipe.ingredientsKnown, false, id);
    assert.deepEqual(recipe.steps, [], id);
    const part = recipe.ingredients[0];
    assert.equal(pantryClassification(part.id, data).group, 'prepared', id);
    assert.notEqual(pantryClassification(part.id, data).subgroup, 'other', id);
    assert.equal(ingredientGroup(part.id, data), 'prepared', id);
    for (const [component, value] of Object.entries(recipe.manualNutrition)) {
      const inPackage = INGREDIENTS[part.id].nutritionPerUnit[component];
      if (value === null) assert.equal(inPackage, null, id);
      else assert.ok(Math.abs(inPackage * part.amount / recipe.servings - value) < 1e-8, `${id} ${component}`);
    }
  }
});

test('菓子パンは主食の分類から8品を選べて、コンビニ名や別名で記録できる', () => {
  const sweet = catalogVariants(RECIPES, 'sweet-bread', {query:'コンビニ'});
  assert.equal(sweet.length, 8);
  assert.ok(sweet.every(recipe => recipe.role === 'staple'));
  const find = createDiningSearch(data);
  for (const [term, id] of [['ファミマ ファミチキ', 'famichiki'], ['エルチキ', 'l-chiki'], ['ミニあんぱん', 'anpan'], ['ツナマヨおにぎり', 'tuna-mayo-onigiri']]) {
    assert.ok(find(term).some(choice => choice.recipe?.id === `convenience-${id}`), term);
  }
});

test('4個入りのパンは1個から記録し、からあげクンは5個で1パック分を記録する', () => {
  const date = '2026-11-18';
  const cream = itemFromRecipe(dish('cream-pan'), data, 4);
  const karaage = itemFromRecipe(dish('karaage-kun'), data, .2);
  assert.equal(itemNutrition(cream).kcal, 432);
  assert.deepEqual(dish('karaage-kun').portion, {amount:5, unit:'個', label:'5個入りの1パック'});
  assert.equal(itemNutrition(karaage).kcal, 45.2);
  const entry = {date, id:'lunch', status:'planned', items:[cream, karaage]};
  const shopping = shoppingForEntries([entry], data, {from:date, to:date, servings:1});
  assert.equal(shopping.items.find(item => item.id === 'convenience_cream_pan').required, 1);
  assert.equal(shopping.items.find(item => item.id === 'convenience_cream_pan').unit, '袋');
  assert.equal(shopping.items.find(item => item.id === 'convenience_karaage_kun').required, .2);
});
