import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {menuOccasions, schoolSeason, calendarSeason} from '../occasion-calendar.js';
import {isAvailableOnDate, personalPlanOptions, rememberSuggestions} from '../planner-personalization.js';
import {generateCalendarPlan, regeneratePlanMeal} from '../planner.js';
import {defaultJournal, validateJournal, parseJournal, replaceJournal, readJournalBackup, JOURNAL_KEY} from '../journal.js';
import {recipeOccasionIds} from '../celebration-recipes.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const annual = {date:'2026-06-18', occasion:'anniversary', annual:true};
const graduation = {date:'2026-04-19', occasion:'graduation', annual:false};

test('祝日・固定の行事・年ごとに動く暦を日本の年月日で判定する', () => {
  for (const [date, occasion] of Object.entries({
    '2026-01-12':'coming-of-age', '2026-02-14':'valentine', '2026-03-03':'hinamatsuri', '2026-03-14':'white-day',
    '2025-02-02':'setsubun','2026-02-03':'setsubun', '2026-03-20':'spring-equinox', '2027-03-21':'spring-equinox',
    '2026-05-05':'childrens-day', '2026-07-07':'tanabata', '2026-07-20':'marine-day', '2026-08-11':'mountain-day',
    '2020-07-23':'marine-day', '2021-07-22':'marine-day','2020-08-10':'mountain-day', '2021-08-08':'mountain-day',
    '2026-08-13':'obon','2026-08-16':'obon','2026-09-21':'respect-for-aged',
    '2026-09-23':'autumn-equinox', '2028-09-22':'autumn-equinox','2026-09-25':'harvest-moon','2025-10-06':'harvest-moon',
    '2036-10-04':'harvest-moon', '2026-10-31':'halloween', '2026-12-24':'christmas', '2026-01-02':'new-year',
  })) assert.ok(menuOccasions(date).includes(occasion), date);
  for (const [date, absent] of [['2025-02-03','setsubun'],['2026-09-27','harvest-moon'],['2033-09-08','harvest-moon'],
    ['2033-10-07','harvest-moon'],['2037-02-03','setsubun'],['2015-08-11','mountain-day'], ['2021-07-19','marine-day']]) {
    assert.ok(!menuOccasions(date).includes(absent), date);
  }
});

test('学校の実際の式日と毎年の記念日を区別し、通常の季節と重なる行事を保つ', () => {
  const events = [annual, graduation, {date:'2026-12-25', occasion:'anniversary', annual:true}];
  assert.deepEqual(menuOccasions('2027-12-25', '1980-12-25', events), ['anniversary','birthday','christmas']);
  assert.deepEqual(menuOccasions('2027-06-18', null, events), ['anniversary']);
  assert.deepEqual(menuOccasions('2025-06-18', null, events), []);
  assert.deepEqual(menuOccasions('2026-04-19', null, events), ['graduation']);
  assert.deepEqual(menuOccasions('2027-04-19', null, events), []);
  assert.equal(schoolSeason('2026-03-31'), 'graduation');assert.equal(schoolSeason('2026-04-15'), 'school-entry');
  assert.equal(schoolSeason('2026-04-16'), null);
  assert.deepEqual(['02','03','06','09','12'].map(m => calendarSeason('2026-'+m+'-01')), ['winter','spring','summer','autumn','winter']);
});

test('翌年と再提案では前回の行事主菜を避け、除外食材のため候補が一品なら使い続ける', () => {
  const recipe = id => RECIPES.find(item => item.id === id);
  const mains = ['celebration-christmas-lemon-chicken', 'celebration-christmas-herb-cod'].map(recipe);
  const smallCatalog = {...data, recipes:mains};
  const settings = date => {
    const s={...defaultJournal(date).settings, meal:'dinner', days:1, seed:1};
    Object.assign(s.mealPreferences.dinner, {staple:'none', sideCount:0, soup:'none'}); return s;
  };
  const first = generateCalendarPlan(settings('2025-12-25'), smallCatalog);
  assert.ok(first.ok);
  const id = first.days[0].mainId;
  const suggested = rememberSuggestions(undefined, first, mains);
  assert.deepEqual(suggested, [id]);
  const options = {personalization:{suggested}};
  const next = generateCalendarPlan(settings('2026-12-25'), smallCatalog, options);
  assert.ok(next.ok);assert.notEqual(next.days[0].mainId,id);
  const recent = rememberSuggestions(suggested,next,mains);
  const another = generateCalendarPlan(settings('2027-12-25'),smallCatalog,{personalization:{suggested:recent}});
  assert.equal(another.days[0].mainId,id);
  const replacement = regeneratePlanMeal(first,{dayIndex:0,personalization:{suggested}},smallCatalog);
  assert.notEqual(replacement.days[0].mainId,id);
  const fishOnly=generateCalendarPlan({...settings('2026-12-25'), allergens:['chicken']},smallCatalog,options);
  assert.equal(fishOnly.days[0].mainId, mains[1].id);
  const saved = {date:'2024-12-25',meal:'dinner',status:'planned',items:[{recipeId:id}]};
  assert.notEqual(generateCalendarPlan(settings('2026-12-25'),smallCatalog,{entries:[saved]}).days[0].mainId,id);
});

test('家族の行事と日付を含まない提案履歴を本人のデータに保存し、退避に家族の日付を残さない', () => {
  const journal = {...defaultJournal('2026-05-01'), familyCalendar:[graduation, annual], suggestedRecipeIds:['plain-rice']};
  const raw=JSON.stringify(journal), clean = parseJournal(raw, data);
  assert.deepEqual(clean.familyCalendar, journal.familyCalendar);
  assert.deepEqual(personalPlanOptions(clean).suggested, ['plain-rice']);
  const store=new Map([[JOURNAL_KEY,raw]]), storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  assert.equal(replaceJournal(storage, defaultJournal('2026-05-01'), data), true);
  assert.ok(!Object.hasOwn(JSON.parse(readJournalBackup(storage).raw), 'familyCalendar'));
  for (const bad of [[{...annual,date:'2026-02-30'}], [{...annual,occasion:'random'}], [{...annual,annual:1}], [annual,annual]])
    assert.throws(()=>validateJournal({...journal, familyCalendar:bad},data));
  assert.ok(!Object.hasOwn(validateJournal(defaultJournal(),data),'suggestedRecipeIds'));
  assert.deepEqual(recipeOccasionIds({id:'plain-rice'}), []);
});


test('普段の定番料理は行事以外でも使え、行事専用料理・卒業祝いの候補期間を区別する', () => {
  const classic = RECIPES.find(dish => dish.id === 'familiar-buri-teriyaki');
  const school = RECIPES.find(dish => dish.id.startsWith('celebration-') && recipeOccasionIds(dish).includes('graduation'));
  assert.ok(recipeOccasionIds(classic).includes('new-year'));
  assert.ok(isAvailableOnDate(classic, [], '2027-05-10', {seasonal:false}));
  assert.ok(isAvailableOnDate(school, [], '2027-03-10', {seasonal:true}));
  assert.ok(!isAvailableOnDate(school, [], '2027-05-10', {seasonal:true}));
  assert.ok(isAvailableOnDate(school, ['graduation'], '2027-05-10', {seasonal:true}));
});

test('保存して翌年に開いたハロウィンの夕食では、登録済みの定番も含めて主菜を一巡させる', () => {
  const choices = [{date:'2026-10-31'}, {date:'2027-10-31'}, {date:'2028-10-31'}, {date:'2029-10-31'}];
  let journal = defaultJournal(choices[0].date);
  const chosen = [];
  for (const {date} of choices) {
    journal.settings.startDate = date;
    const result = generateCalendarPlan({...journal.settings, days:1, seed:11}, data, {personalization:personalPlanOptions(journal)});
    assert.ok(result.ok);
    const id = result.days[0].mainId;
    assert.ok(recipeOccasionIds({id}).includes('halloween'));
    assert.ok(!chosen.includes(id), id);
    chosen.push(id);
    journal.suggestedRecipeIds = rememberSuggestions(journal.suggestedRecipeIds, result, RECIPES);
    journal = parseJournal(JSON.stringify(journal), data);
  }
});
