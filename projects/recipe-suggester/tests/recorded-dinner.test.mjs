import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal} from '../journal.js';
import {generateCalendarPlan} from '../planner.js';
import {createDiningItem, createDiningEntry} from '../dining-meal.js';
import {previewRecordedDinner, mealsBeforeDinner} from '../recorded-dinner.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const date='2026-11-18';
function sample() {
  const state=defaultJournal(date);
  const recipe=RECIPES.find(r=>r.id==='classic-grilled-salmon');
  const item=createDiningItem({recipe},{amount:1,mode:'similar',actualName:'本日の焼き鮭'},data);
  state.entries.push(createDiningEntry({date,meal:'lunch',items:[item]},data));
  return state;
}

test('dinner preview uses food actually eaten on the selected date without changing the journal or an unrelated draft',()=>{
  const state=sample();
  state.settings.startDate='2026-12-01';
  const other=generateCalendarPlan({...state.settings,days:1,meal:'dinner',seed:21},data);
  const original=structuredClone({state,other});
  const {earlier,day,inDraft}=previewRecordedDinner(state,date,other,data,20);
  assert.equal(earlier[0].items[0].name,'本日の焼き鮭');
  assert.equal(day.date,date);assert.equal(day.meal,'dinner');assert.equal(inDraft,false);
  assert.ok(day.reasons.some(reason=>reason.includes('外食')));
  assert.deepEqual({state,other},original);
  for(const status of ['planned','eaten']){
    const entry={...state.entries[0],status};
    assert.deepEqual(mealsBeforeDinner([entry], '2026-11-19'),[]);
    assert.deepEqual(mealsBeforeDinner([{...entry,meal:'dinner'}],date),[]);
    if(status==='planned')assert.deepEqual(mealsBeforeDinner([entry],date),[]);
  }
});
test('updating a dinner in a multi-day draft preserves every other meal and the original draft',()=>{
  const state=sample(),draft=generateCalendarPlan({...state.settings,days:2,meal:'all',seed:22},data);
  const original=structuredClone(draft);
  const {inDraft,proposal,day}=previewRecordedDinner(state,date,draft,data,23);
  assert.equal(inDraft,true);
  assert.equal(day.date,date);assert.equal(day.meal,'dinner');
  const others=plan=>plan.days.filter(d=>!(d.meal==='dinner'&&d.date===date));
  assert.deepEqual(others(proposal),others(original));
  assert.deepEqual(draft,original);
});
