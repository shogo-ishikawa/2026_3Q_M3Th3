import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {generateCalendarPlan, replaceRecipe, describeRecipe} from '../planner.js';
import {defaultMealPreference, normaliseMealPreferences} from '../meal-profiles.js';
import {mealSuitabilityAudit, recipeMealSuitability, matchesStaplePreference} from '../meal-suitability.js';
import {recipeFamily, recipePortion} from '../catalog.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const profiles = overrides => Object.fromEntries(['breakfast','lunch','dinner'].map(meal => [meal,{...defaultMealPreference(),...overrides?.[meal]}]));
const planFor = (meal, preferences, extra = {}) => generateCalendarPlan({startDate:'2026-11-15',days:1,seed:7,meal,mealPreferences:preferences,...extra},data);
const recipe = id => RECIPES.find(recipe => recipe.id === id);

test('every source recipe has a reproducible meal audit and the reported stir-fries are excluded at breakfast', () => {
  const saved = JSON.parse(fs.readFileSync(new URL('../docs/meal-suitability-audit.json',import.meta.url),'utf8'));
  assert.deepEqual(saved.recipes,mealSuitabilityAudit(RECIPES));
  assert.equal(saved.recipes.length,RECIPES.length);
  for(const id of ['side-040','shrimp-egg','breakfast-shrimp-pea','breakfast-tofu-scramble']) assert.ok(!recipeMealSuitability(recipe(id)).meals.includes('breakfast'),id);
  for(const id of ['classic-fried-egg','classic-tamagoyaki','classic-grilled-salmon','staple-plain-bread','classic-side-spinach-ohitashi']) assert.ok(recipeMealSuitability(recipe(id)).meals.includes('breakfast'),id);
});

test('breakfast never falls back to lunch stir-fries, including its sides and replacements', () => {
  for(const seed of [1,2,3,5,7,11,19,31]) {
    const plan=planFor('breakfast',profiles(),{days:7,seed});assert.equal(plan.ok,true);
    for(const day of plan.days) for(const id of day.recipeIds) {
      assert.ok(!/もやしとにら|えびと卵の炒め物|えびとグリーンピース/.test(recipe(id).name),recipe(id).name);
      assert.ok(recipeMealSuitability(recipe(id)).meals.includes('breakfast'),recipe(id).name);
    }
    const changed=replaceRecipe(plan,{dayIndex:0,recipeId:plan.days[0].mainId},data);assert.equal(changed.ok,true);
    for(const id of changed.days[0].recipeIds) assert.ok(recipeMealSuitability(recipe(id)).meals.includes('breakfast'));
  }
  const limited={...data,recipes:RECIPES.filter(r=>['shrimp-egg','side-040','plain-rice','soup-001'].includes(r.id))};
  const impossible=generateCalendarPlan({startDate:'2026-11-15',meal:'breakfast'},limited);assert.equal(impossible.ok,false);assert.deepEqual(impossible.days,[]);assert.match(impossible.warnings.join(''),/朝食向け/);
});

test('rice and bread breakfasts keep their actual staple type and compatible course', () => {
  for(const mode of ['rice','bread','rice-or-bread']) for(const seed of [1,3,9]) {
    const plan=planFor('breakfast',profiles({breakfast:{staple:mode}}),{seed});assert.equal(plan.ok,true);
    const foods=plan.days[0].recipeIds.map(recipe),staples=foods.filter(r=>r.staple);assert.ok(staples.length);
    assert.ok(staples.every(r=>matchesStaplePreference(r,mode)));
    if(mode==='bread'){assert.ok(foods.filter(r=>r.role==='main').every(r=>r.genre==='洋食'||r.staple));assert.ok(!foods.some(r=>recipeFamily(r)==='miso-soup'));}
  }
});

test('oatmeal, fixed coffee, yoghurt and fruit can be requested independently without a second main', () => {
  const preferences=profiles({breakfast:{staple:'cereal',drinkId:'drink-coffee',drinkAmount:180,yogurt:true,fruit:true}});
  const plan=planFor('all',preferences);assert.equal(plan.ok,true);
  const morning=plan.days[0], foods=morning.recipeIds.map(recipe);
  assert.equal(foods.filter(r=>r.staple).length,1);assert.equal(recipeFamily(foods.find(r=>r.staple)),'oatmeal');
  assert.ok(foods.some(r=>r.id==='snack-plain-yogurt'));assert.ok(foods.some(r=>recipeFamily(r)==='fruit'));
  assert.equal(foods.filter(r=>r.role==='main').length,0);
  const coffee=recipe('drink-coffee');assert.equal(morning.quantities[coffee.id],180/recipePortion(coffee,data).amount);
  assert.ok(plan.days.slice(1).every(day=>day.recipeIds.every(id=>recipe(id).role!=='drink')));
  const excluded=planFor('breakfast',preferences,{allergens:['milk']});assert.equal(excluded.ok,false);assert.match(excluded.warnings.join(''),/ヨーグルト/);
});

test('lunch and dinner accept rice meals, noodles and handheld meals and swaps keep the preference', () => {
  for(const meal of ['lunch','dinner']) for(const mode of ['rice-meal','noodle','handheld']) {
    const plan=planFor(meal,profiles({[meal]:{staple:mode}}));assert.equal(plan.ok,true,`${meal}:${mode}`);
    const day=plan.days[0], centre=recipe(day.mainId);assert.ok(centre.staple&&matchesStaplePreference(centre,mode));
    assert.equal(day.recipeIds.map(recipe).filter(r=>r.staple).length,1);
    const changed=replaceRecipe(plan,{dayIndex:0,recipeId:day.mainId},data);assert.equal(changed.ok,true);
    const replacement=recipe(changed.days[0].mainId);assert.ok(replacement.staple&&matchesStaplePreference(replacement,mode));
  }
});

test('enabled meals, no-staple and exact fixed quantities have separate meanings', () => {
  const preferences=profiles({breakfast:{enabled:false},lunch:{staple:'none'},dinner:{staple:'fixed',stapleId:'plain-rice',stapleAmount:175}});
  const plan=planFor('all',preferences,{days:2});assert.equal(plan.ok,true);assert.equal(plan.days.length,4);
  assert.ok(plan.days.every(day=>day.meal!=='breakfast'));
  assert.ok(plan.days.filter(day=>day.meal==='lunch').every(day=>day.recipeIds.every(id=>!recipe(id).staple)));
  for(const day of plan.days.filter(day=>day.meal==='dinner')) assert.equal(day.quantities['plain-rice'],175/150);
  const disabled=planFor('all',profiles(Object.fromEntries(['breakfast','lunch','dinner'].map(m=>[m,{enabled:false}]))));assert.equal(disabled.ok,false);
  const migrated=normaliseMealPreferences(undefined,'時短',{stapleId:'plain-rice',stapleAmount:200,drinkId:'drink-coffee',drinkAmount:150});
  assert.equal(migrated.breakfast.drinkId,'drink-coffee');assert.equal(migrated.lunch.drinkId,'none');assert.equal(migrated.dinner.staple,'fixed');
});

test('all automatic proposed portions use practical rice and plate increments', () => {
  for(const volume of ['light','normal','hearty']) {
    const plan=planFor('all',profiles(Object.fromEntries(['breakfast','lunch','dinner'].map(m=>[m,{volume}]))),{days:3});assert.equal(plan.ok,true);
    for(const day of plan.days) for(const id of day.recipeIds) {
      const r=recipe(id),portion=recipePortion(r,data),q=day.quantities[id],actual=portion.amount*q;
      if(recipeFamily(r)==='rice'&&portion.unit==='g')assert.ok([100,150,200].some(n=>Math.abs(actual-n)<1e-8));
      else if(portion.unit==='枚')assert.ok(Math.abs(actual*2-Math.round(actual*2))<1e-8);
      else if(!['soup','drink','snack'].includes(r.role))assert.ok([.5,1,1.5].includes(q));
    }
  }
});
