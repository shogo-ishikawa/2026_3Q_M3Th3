import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultJournal, validateJournal, parseJournal} from '../journal.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};

test('meal detail choices survive journal JSON without changing the other meals',()=>{
 const source=defaultJournal('2026-11-15'),before=structuredClone(source.settings.mealPreferences);
 Object.assign(source.settings.mealPreferences.breakfast,{volume:'hearty',stapleVolume:'light',sideCount:2,sideType:'salad',soup:'none'});
 Object.assign(source.settings.mealPreferences.dinner,{sideCount:3,sideType:'vegetable',soup:'include'});
 const restored=parseJournal(JSON.stringify(source),data);
 assert.deepEqual(restored.settings.mealPreferences.breakfast,source.settings.mealPreferences.breakfast);
 assert.deepEqual(restored.settings.mealPreferences.dinner,source.settings.mealPreferences.dinner);
 assert.deepEqual(restored.settings.mealPreferences.lunch,before.lunch);
});

test('old meal profiles migrate new detail choices to automatic behaviour',()=>{
 const source=defaultJournal('2026-11-15');
 for(const choice of Object.values(source.settings.mealPreferences))for(const key of ['stapleVolume','sideCount','sideType','soup'])delete choice[key];
 const clean=validateJournal(source,data);
 for(const choice of Object.values(clean.settings.mealPreferences))assert.deepEqual([choice.stapleVolume,choice.sideCount,choice.sideType,choice.soup],['auto','auto','auto','auto']);
});

test('invalid imported counts, staple quantities and recipe types fail closed',()=>{
 for(const patch of [{stapleVolume:'huge'},{sideCount:1.5},{sideCount:-1},{sideCount:4},{sideCount:'2'},{sideType:'cake'},{soup:true},{sideCount:NaN}]){
  const source=defaultJournal('2026-11-15');Object.assign(source.settings.mealPreferences.breakfast,patch);
  assert.throws(()=>validateJournal(source,data),JSON.stringify(patch));
 }
});
