import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCalendarPlan, regeneratePlanMeal, addPlanDish, planMealPreference, updatePlanStaple, toggleDish, replaceRecipe, describeRecipe, shoppingList} from '../planner.js';
import {defaultMealPreference, normaliseMealPreferences} from '../meal-profiles.js';
import {recipeFamily, isCompleteMeal} from '../catalog.js';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
const data = {recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const profiles = changes => Object.fromEntries(['breakfast','lunch','dinner'].map(meal=>[meal,{...defaultMealPreference(),...(changes?.[meal]??{})}]));
const settings = extra => ({startDate:'2026-11-15',days:2,meal:'all',seed:9,...extra});
const roles = day => day.recipeIds.map(id=>describeRecipe(id,data).role);

test('staple volume changes rice independently from hearty main and side portions',()=>{
  const plan=generateCalendarPlan(settings({meal:'dinner',mealPreferences:profiles({dinner:{staple:'rice',volume:'hearty',stapleVolume:'light'}})}),data);
  assert.equal(plan.ok,true);
  for(const day of plan.days){assert.equal(day.quantities['plain-rice'],100/150);assert.equal(day.quantities[day.mainId],1.5);}
});

test('explicit side counts and salad type apply even beside yoghurt at breakfast',()=>{
  const plan=generateCalendarPlan(settings({mealPreferences:profiles({breakfast:{staple:'bread',yogurt:true,sideCount:2,sideType:'salad',soup:'none'},dinner:{sideCount:3,sideType:'salad',soup:'none'}})}),data);
  assert.equal(plan.ok,true);
  for(const day of plan.days.filter(day=>['breakfast','dinner'].includes(day.meal))){
    assert.equal(roles(day).filter(role=>role==='side').length,day.meal==='breakfast'?2:3);
    assert.ok(day.recipeIds.some(id=>/サラダ|コールスロー/.test(describeRecipe(id,data).name)));
    assert.ok(!roles(day).includes('soup'));
    assert.equal(new Set(day.recipeIds).size,day.recipeIds.length);
  }
});

test('automatic side count with an explicit salad guarantees one salad and zero overrides it',()=>{
  for(const count of ['auto',0]){
    const plan=generateCalendarPlan(settings({meal:'breakfast',mealPreferences:profiles({breakfast:{staple:'rice',sideCount:count,sideType:'salad'}})}),data);
    assert.equal(plan.ok,true);
    assert.equal(roles(plan.days[0]).filter(role=>role==='side').length,count===0?0:1);
  }
});

test('explicit soup can accompany broth noodles while automatic mode omits it',()=>{
  for(const soup of ['auto','include','none']){
    const plan=generateCalendarPlan(settings({meal:'dinner',mealPreferences:profiles({dinner:{staple:'fixed',stapleId:'noodle-ramen-miso-butter-corn',soup}})}),data);
    assert.equal(plan.ok,true);
    assert.equal(roles(plan.days[0]).includes('soup'),soup==='include');
  }
});

test('one meal can change staple, genre, mood and portions without changing any other meal or global defaults',()=>{
  const original=generateCalendarPlan(settings(),data), before=structuredClone(original);
  const updated=regeneratePlanMeal(original,{dayIndex:2,mealPreference:{staple:'noodle',volume:'hearty',stapleVolume:'light',sideCount:0,soup:'none'},genre:'中華'},data);
  assert.equal(updated.ok,true);
  assert.deepEqual(updated.settings,original.settings);
  assert.deepEqual(original,before);
  for(let i=0;i<updated.days.length;i++)if(i!==2)assert.deepEqual(updated.days[i],original.days[i]);
  const changed=updated.days[2], main=describeRecipe(changed.mainId,data);
  assert.ok(['pasta','udon','soba','somen','yakisoba','ramen'].includes(recipeFamily(main)));
  assert.equal(main.genre,'中華');
  assert.equal(changed.quantities[main.id],.5);
  assert.equal(changed.mealPreference.volume,'hearty');
  assert.equal(changed.targetGenre,'中華');
  assert.equal(roles(changed).filter(role=>role==='side').length,0);
  assert.equal(planMealPreference(updated,2).staple,'noodle');
});

test('replacement API accepts one-meal preferences and persists them for later replacements',()=>{
  const original=generateCalendarPlan(settings({meal:'lunch'}),data);
  const updated=replaceRecipe(original,{dayIndex:0,recipeId:original.days[0].mainId,mealPreference:{staple:'handheld',sideCount:0,soup:'none'},genre:'洋食'},data);
  assert.equal(updated.ok,true);
  assert.equal(recipeFamily(describeRecipe(updated.days[0].mainId,data)),'bread');
  assert.equal(planMealPreference(updated,0).sideCount,0);
  assert.deepEqual(updated.days[1],original.days[1]);
});

test('manual additions preserve all dishes and shopping uses the selected added portion once',()=>{
  const original=generateCalendarPlan(settings({meal:'lunch'}),data), before=structuredClone(original);
  const updated=addPlanDish(original,{dayIndex:0,recipeId:'snack-plain-yogurt',quantity:1.5},data);
  assert.deepEqual(original,before);
  assert.deepEqual(updated.days[0].recipeIds.slice(0,-1),original.days[0].recipeIds);
  assert.deepEqual(updated.days[1],original.days[1]);
  assert.equal(updated.days[0].quantities['snack-plain-yogurt'],1.5);
  const recipe=describeRecipe('snack-plain-yogurt',data);
  const base=shoppingList(original,1,data), after=shoppingList(updated,1,data);
  for(const part of recipe.ingredients)assert.ok(Math.abs(after.find(p=>p.id===part.id).amount-(base.find(p=>p.id===part.id)?.amount??0)-part.amount*1.5/recipe.servings)<1e-9);
  assert.throws(()=>addPlanDish(updated,{dayIndex:0,recipeId:'snack-plain-yogurt'},data),/すでに/);
});

test('manual additions fail closed on allergens and invalid quantities; omitted recipes can return',()=>{
  const plan=generateCalendarPlan(settings({meal:'lunch',allergens:['milk']}),data);
  assert.throws(()=>addPlanDish(plan,{dayIndex:0,recipeId:'snack-plain-yogurt'},data),/除外条件/);
  const normal=generateCalendarPlan(settings({meal:'lunch'}),data);
  const added=addPlanDish(normal,{dayIndex:0,recipeId:'snack-plain-yogurt'},data);
  const omitted=toggleDish(added,{dayIndex:0,recipeId:'snack-plain-yogurt'},data);
  const restored=addPlanDish(omitted,{dayIndex:0,recipeId:'snack-plain-yogurt',quantity:.5},data);
  assert.equal(restored.days[0].recipeIds.filter(id=>id==='snack-plain-yogurt').length,1);
  assert.ok(!restored.days[0].omittedRecipeIds.includes('snack-plain-yogurt'));
  assert.equal(restored.days[0].quantities['snack-plain-yogurt'],.5);
  for(const quantity of [0,-1,Infinity,1001,'1'])assert.throws(()=>addPlanDish(normal,{dayIndex:0,recipeId:'snack-plain-yogurt',quantity},data),/量/);
});

test('manual staple edits seed the next local editor without altering shared defaults',()=>{
  const plan=generateCalendarPlan(settings({meal:'dinner',mealPreferences:profiles({dinner:{staple:'rice'}})}),data);
  const adjusted=updatePlanStaple(plan,{dayIndex:0,stapleId:'staple-butter-toast',amount:1.5},data);
  assert.equal(planMealPreference(adjusted,0).staple,'fixed');
  assert.equal(planMealPreference(adjusted,0).stapleId,'staple-butter-toast');
  assert.equal(planMealPreference(adjusted,0).stapleAmount,1.5);
  assert.equal(adjusted.settings.mealPreferences.dinner.staple,'rice');
});

test('new preference defaults migrate old profiles and reject malformed side settings',()=>{
  const old=profiles();for(const choice of Object.values(old))for(const key of ['stapleVolume','sideCount','sideType','soup'])delete choice[key];
  assert.equal(normaliseMealPreferences(old).breakfast.stapleVolume,'auto');
  for(const patch of [{stapleVolume:'huge'},{sideCount:4},{sideCount:'2'},{sideType:'unknown'},{soup:true}])assert.throws(()=>normaliseMealPreferences(profiles({breakfast:patch})));
});


test('safe bagel, muffin and sandwich centres can be chosen in bread breakfasts without another main or plain bread',()=>{
  for(const centreId of ['breakfast-bagel-egg-cheese','breakfast-bagel-ham-cheese','breakfast-english-muffin-egg','breakfast-english-muffin-ham-cheese','bread-sandwich-tuna-cucumber']){
    const limited={...data,recipes:data.recipes.filter(recipe=>recipe.id===centreId || recipe.role!=='main'&&!isCompleteMeal(recipe))};
    const plan=generateCalendarPlan(settings({days:1,meal:'breakfast',mealPreferences:profiles({breakfast:{staple:'bread',sideCount:0,soup:'none'}})}),limited);
    assert.equal(plan.ok,true,centreId);
    assert.equal(plan.days[0].mainId,centreId);
    assert.deepEqual(plan.days[0].recipeIds,[centreId]);
  }
});


test('diversity never discards the only centre that matches a requested genre or mood',()=>{
  const onlyTwo={...data,recipes:RECIPES.filter(recipe=>['chicken-teriyaki','chicken-tomato'].includes(recipe.id))};
  const initial=generateCalendarPlan(settings({days:1,meal:'dinner',preferences:{genreMode:'single',genre:'和食'},mealPreferences:profiles({dinner:{staple:'none',sideCount:0,soup:'none'}})}),onlyTwo);
  assert.equal(initial.ok,true);
  assert.equal(initial.days[0].mainId,'chicken-teriyaki');
  const updated=regeneratePlanMeal(initial,{dayIndex:0,genre:'和食'},onlyTwo);
  assert.equal(updated.days[0].mainId,'chicken-teriyaki');
  assert.ok(!updated.days[0].warnings.some(message=>message.includes('希望ジャンル以外')));
  const moodRecipes=onlyTwo.recipes.map(recipe=>({...recipe,genre:'和食',tags:recipe.id==='chicken-teriyaki'?['さっぱり']:['ガッツリ']}));
  const moodData={...onlyTwo,recipes:moodRecipes};
  const moodPlan=generateCalendarPlan(settings({days:1,meal:'dinner',mealPreferences:profiles({dinner:{mood:'さっぱり',staple:'none',sideCount:0,soup:'none'}})}),moodData);
  const moodUpdated=regeneratePlanMeal(moodPlan,{dayIndex:0,genre:'all',mealPreference:{mood:'さっぱり'}},moodData);
  assert.equal(moodUpdated.days[0].mainId,'chicken-teriyaki');
});
