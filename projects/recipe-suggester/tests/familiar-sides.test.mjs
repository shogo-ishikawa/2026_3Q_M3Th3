import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {FAMILIAR_SIDE_INGREDIENTS,FAMILIAR_SIDE_RECIPES} from '../familiar-sides.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe,recipeNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {FOOD_CATEGORIES,COOKING_METHODS,dishClassification} from '../dish-hierarchy.js';

const ownIds=new Set(FAMILIAR_SIDE_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:{...INGREDIENTS,...Object.fromEntries(Object.entries(FAMILIAR_SIDE_INGREDIENTS).map(([id,item])=>[id,{...item,...INGREDIENT_NUTRITION[id]}]))},recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...FAMILIAR_SIDE_RECIPES]};
const get=slug=>FAMILIAR_SIDE_RECIPES.find(recipe=>recipe.id===`familiar-side-${slug}`);

const signature=recipe=>recipe.ingredients.map(part=>`${part.id}:${part.amount/recipe.servings}`).sort().join('|');

test('生野菜と定番の副菜31品・汁物6品を既存DBと重複なく追加する',()=>{
  assert.equal(FAMILIAR_SIDE_RECIPES.length,37);
  assert.equal(FAMILIAR_SIDE_RECIPES.filter(recipe=>recipe.role==='side').length,31);
  assert.equal(FAMILIAR_SIDE_RECIPES.filter(recipe=>recipe.role==='soup').length,6);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  const previousSignatures=new Set(RECIPES.filter(recipe=>!ownIds.has(recipe.id)).map(signature));
  for(const recipe of FAMILIAR_SIDE_RECIPES)assert.ok(!previousSignatures.has(signature(recipe)),recipe.id);
  assert.equal(new Set(FAMILIAR_SIDE_RECIPES.map(signature)).size,FAMILIAR_SIDE_RECIPES.length);
});

test('添え物を含む材料・人数可変の手順・表示用階層を明示する',()=>{
  const categories=new Set(FOOD_CATEGORIES.map(item=>item.id)),methods=new Set([...COOKING_METHODS.map(item=>item.id),'karaage','cutlet','croquette','fry']);
  for(const recipe of FAMILIAR_SIDE_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);assert.equal(recipe.nature,'home-cooked',recipe.id);
    assert.equal(recipe.allergensKnown,true,recipe.id);assert.equal(recipe.ingredientsKnown,true,recipe.id);
    assert.equal(recipe.staple,false,recipe.id);assert.equal(recipe.mealBase,false,recipe.id);
    assert.equal(recipe.tags.includes('時短'),recipe.minutes<=20,recipe.id);
    assert.ok(recipe.tags.every(tag=>['定番','さっぱり','時短','ガッツリ'].includes(tag)),recipe.id);
    assert.equal(new Set(recipe.tags).size,recipe.tags.length,recipe.id);
    assert.equal(recipe.portion.amount,1,recipe.id);assert.equal(recipe.portion.unit,recipe.role==='soup'?'杯':'皿',recipe.id);
    assert.ok(recipe.steps.length>=3,recipe.id);
    for(const step of recipe.steps)assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),`${recipe.id}:${step}`);
    assert.ok(categories.has(recipe.displayCategory),recipe.id);assert.ok(methods.has(recipe.displayMethod),recipe.id);
    assert.equal(new Set(recipe.displaySecondaryCategories).size,recipe.displaySecondaryCategories.length,recipe.id);
    for(const category of recipe.displaySecondaryCategories)assert.ok(categories.has(category)&&category!==recipe.displayCategory,recipe.id);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0,recipe.id);}
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    assert.doesNotThrow(()=>describeRecipe(recipe.id,data),recipe.id);
    if(recipe.role==='side'){
      const display=dishClassification(recipe);assert.equal(display.category,recipe.displayCategory,recipe.id);assert.equal(display.method,['karaage','cutlet','croquette','fry'].includes(recipe.displayMethod)?'fried':recipe.displayMethod,recipe.id);
    }else assert.equal(dishClassification(recipe).section,'soup',recipe.id);
  }
});

test('生野菜だけの皿とみそマヨ・卵チーズ入りシーザーを別の内容で計算する',()=>{
  const raw=describeRecipe(get('raw-vegetable').id,data),sticks=describeRecipe(get('sticks-miso-mayo').id,data),caesar=describeRecipe(get('caesar').id,data);
  assert.deepEqual(raw.allergens,[]);
  assert.ok(raw.ingredients.every(part=>data.ingredients[part.id].groups.includes('vegetable')));
  for(const id of ['daikon','carrot','cucumber','celery','miso','mayonnaise'])assert.ok(sticks.ingredients.some(part=>part.id===id),id);
  for(const allergen of ['egg','milk','wheat','soy'])assert.ok(sticks.allergens.includes(allergen),allergen);
  for(const id of ['egg','parmesan_cheese','bread','bacon','mayonnaise','yogurt'])assert.ok(caesar.ingredients.some(part=>part.id===id),id);
  for(const allergen of ['egg','milk','wheat','soy','pork'])assert.ok(caesar.allergens.includes(allergen),allergen);
  assert.deepEqual(FAMILIAR_SIDE_INGREDIENTS.parmesan_cheese.allergens,['milk']);
  assert.deepEqual(FAMILIAR_SIDE_INGREDIENTS.parmesan_cheese.derivedFrom,['milk']);
  const values=recipeNutrition(get('caesar'),data);
  for(const key of ['kcal','protein','fat','carbs','salt'])assert.ok(Number.isFinite(values[key])&&values[key]>=0,key);
  assert.ok(values.fiber===null||(Number.isFinite(values.fiber)&&values.fiber>=0));
  assert.ok(values.kcal>recipeNutrition(get('raw-vegetable'),data).kcal);
});

test('除外条件は添えるドレッシング・クルトン・バターにも適用する',()=>{
  const noEgg=new Set(eligibleRecipes({allergens:['egg']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(noEgg.has(get('raw-vegetable').id));assert.ok(!noEgg.has(get('sticks-miso-mayo').id));assert.ok(!noEgg.has(get('caesar').id));
  const noMilk=new Set(eligibleRecipes({allergens:['milk']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noMilk.has(get('potato-butter').id));assert.ok(noMilk.has(get('roast-vegetables').id));
  const noSesame=new Set(eligibleRecipes({allergens:['sesame']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noSesame.has(get('warm-vegetables').id));
  const noBread=new Set(eligibleRecipes({excludedIngredients:['bread']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noBread.has(get('caesar').id));assert.ok(noBread.has(get('green-vinaigrette').id));
});

test('スティック半皿を2人分にすると添えるみそマヨも半量を買い物へ反映する',()=>{
  const item=itemFromRecipe(describeRecipe(get('sticks-miso-mayo').id,data),data,0.5);
  const result=shoppingForEntries([{id:'sticks-plan',date:'2026-11-12',meal:'dinner',status:'planned',items:[item],note:''}],data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[]});
  assert.equal(result.items.find(part=>part.id==='daikon').required,60);
  assert.equal(result.items.find(part=>part.id==='mayonnaise').required,12);
  assert.equal(result.items.find(part=>part.id==='miso').required,6);
  assert.deepEqual(result.missingMenus,[]);
});

test('ポトフは具と汁を含む1杯の汁物にし、ご飯や主菜を重ねたデータにしない',()=>{
  const soup=get('pot-au-feu');
  assert.equal(soup.role,'soup');assert.equal(soup.family,'soup');assert.equal(soup.mealBase,false);
  assert.equal(soup.portion.unit,'杯');assert.ok(soup.ingredients.some(part=>part.id==='bacon'));
  assert.ok(!soup.ingredients.some(part=>part.id==='rice'||part.id==='bread'));
  assert.match(soup.sourceNote,/具も汁も食べる/);
});
