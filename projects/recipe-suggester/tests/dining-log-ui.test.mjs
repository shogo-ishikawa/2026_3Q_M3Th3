import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {recipeNutrition, summariseEntries} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';
import {mountDiningLog} from '../dining-log-ui.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const day = '2026-11-17';
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); for(const node of nodes)node.owner=this; }
  remove() { this.owner.children=this.owner.children.filter(node=>node!==this); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
  setAttribute(name, value) { this[name] = value; }
  fire(type) { this.events[type]?.forEach(fn => fn({target:this, preventDefault(){}})); }
}
const oldDocument = globalThis.document;
test.beforeEach(() => { globalThis.document = {createElement:tag => new Element(tag)}; });
test.afterEach(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
function render(options = {}) {
  const saved = [];
  const root = mountDiningLog({data, entries:[], date:day, onSave:entry => saved.push(entry), ...options});
  const walk = element => [element, ...element.children.flatMap(walk)];
  const field = name => walk(root).find(element => element.id === `dining-${name}`);
  const choices = () => field('results').children;
  const pick = key => {
    const control = choices().find(element => element['data-choice'] === key);
    assert.ok(control, key); control.fire('click');
  };
  return {saved, field, choices, pick, find:fn=>walk(root).find(fn), submit:() => root.fire('submit'), set:(id, value, event='input') => {
    const input = field(id); input.value = value; input.fire(event);
  }};
}
const summary = (entries, date=day) => summariseEntries(entries, {from:date, to:date});

test('店と料理の記録を予定の献立と同じ日に追加し、成分が未記載のときはすべて不明に保つ', () => {
  const view = render();
  assert.equal(view.field('meal').value, 'lunch');
  view.set('shop', '学食');
  view.set('dish', '日替わり定食');
  view.field('manual-add').fire('click');
  view.submit();
  const [entry] = view.saved;
  assert.equal(entry.note, '外食');
  assert.deepEqual([entry.date, entry.meal, entry.status], [day, 'lunch', 'eaten']);
  const [item] = entry.items;
  assert.equal(item.name, '学食｜日替わり定食');
  assert.equal(item.recipeId, null);
  assert.equal(item.ingredientsKnown, false);
  assert.equal(item.allergensKnown, false);
  assert.equal(item.nutritionBasis, 'unknown');
  const journal = defaultJournal(day);
  journal.entries.push({id:'dinner', date:day, meal:'dinner', status:'planned', items:[], note:'家族の夕食'}, entry);
  const clean = validateJournal(JSON.parse(JSON.stringify(journal)), data);
  assert.equal(clean.customRecipes.length, 0);
  assert.deepEqual(clean.entries.map(r => r.id), ['dinner', entry.id]);
  assert.ok(Object.values(clean.entries[1].items[0].nutrition).every(value => value === null));
  assert.equal(summary(clean.entries).knownCounts.kcal, 0);
  assert.equal(summary(clean.entries).entryCount, 1);
});

test('料理1人前の表示値を食べた量で換算し、表示値ゼロ・未掲載・不正を区別する', () => {
  const view = render();
  view.set('dish', 'そば');
  view.set('kcal', '421.25');
  view.set('fat', '0');
  view.field('fiber').validity = {badInput:true};
  view.field('manual-add').fire('click');
  view.submit();
  assert.equal(view.saved.length, 0);
  view.field('fiber').validity = {badInput:false};
  view.field('manual-add').fire('click');
  view.set('amount-1','0.5');
  view.submit();
  const item = view.saved[0].items[0], totals = summary(view.saved);
  assert.equal(item.nutritionBasis, 'manual');
  assert.equal(item.nutrition.fiber, null);
  assert.equal(totals.values.kcal, 210.625);
  assert.equal(totals.complete.fat, true);
  assert.equal(totals.knownCounts.fat, 1);
  assert.equal(totals.knownCounts.fiber, 0);
});

test('履歴は新しい識別子で指定日に複写し、以前に修正した表示値と元の記録を保つ', () => {
  const view = render();
  view.set('dish', 'カツ定食');
  view.set('kcal', '500');
  view.field('manual-add').fire('click');
  view.submit();
  const previous = view.saved[0];
  previous.items[0].nutrition.kcal = 507;
  const start = structuredClone(previous);
  const again = render({entries:[previous]});
  again.set('search', 'カツ定食');
  again.pick('history-' + previous.items[0].id);
  again.set('amount-1', '0.5');
  again.set('date', '2026-11-18');
  again.set('meal', 'dinner', 'change');
  again.submit();
  const [entry] = again.saved;
  assert.deepEqual([entry.date, entry.meal, entry.status], ['2026-11-18','dinner','eaten']);
  assert.equal(summary([entry], entry.date).values.kcal, 253.5);
  assert.notEqual(previous.items[0].id, entry.items[0].id);
  assert.deepEqual(previous, start);
});

test('登録した店の最新の値と提供単位を使い、候補から消えた料理を誤って保存しない', () => {
  const restaurant = buildRestaurantRecipe({id:'custom-restaurant-a', genericRecipeId:'chicken-teriyaki',
    storeName:'駅前食堂', menuName:'照り焼き丼', sizeName:'並', inclusion:'ご飯と鶏肉', riceIncluded:true,
    sidesIncluded:false, basis:'per100g', portionAmount:250, portionUnit:'g', sourceUrl:'https://example.com/list',
    checkedDate:day, nutrition:{kcal:140, fiber:null}}, data);
  const view = render({data:{...data, recipes:[...data.recipes, restaurant]}});
  view.set('search', '駅前食堂');
  view.set('search', '該当なし');
  view.submit();
  assert.equal(view.saved.length, 0);
  view.set('search', '駅前食堂');
  view.pick('recipe-' + restaurant.id);
  assert.equal(view.field('amount-1').value,'250');
  assert.equal(view.field('match-1').value,'menu');
  view.set('amount-1', '125');
  view.submit();
  const [item] = view.saved[0].items;
  assert.equal(item.restaurant.storeName, '駅前食堂');
  assert.equal(item.nutritionBasis, 'official');
  assert.equal(summary(view.saved).values.kcal, 175);
  assert.equal(item.nutrition.fiber, null);
});


test('定食を主菜とご飯に分けて選び、検索結果の栄養と料理の識別子を一食へ渡す', () => {
  const view=render();
  view.set('search','唐揚げ定食');
  const first=view.choices()[0]['data-choice'];
  assert.match(first,/^recipe-/);
  view.pick(first);
  assert.equal(view.field('match-1').value,'similar');
  view.set('name-1','学食の唐揚げ');
  view.set('search','ごはん');
  view.pick('recipe-plain-rice');
  view.set('amount-2','100');
  view.set('shop','大学食堂');
  view.submit();
  const [entry]=view.saved, [chicken,rice]=entry.items;
  assert.equal(chicken.recipeId, first.slice(7));
  assert.equal(chicken.name,'学食の唐揚げ');
  assert.equal(chicken.diningMatch.storeName,'大学食堂');
  assert.equal(chicken.diningMatch.mode,'similar');
  assert.notEqual(chicken.diningMatch.referenceName, chicken.name);
  assert.ok(chicken.proteinSources.length);
  const reference=RECIPES.find(r=>r.id==='plain-rice');
  assert.equal(rice.quantity,100 / recipePortion(reference,data).amount);
  assert.equal(summary([entry]).values.kcal,chicken.nutrition.kcal + recipeNutrition(reference,data).kcal * rice.quantity);
  assert.equal(validateJournal({...defaultJournal(day),entries:[entry]},data).entries[0].items[0].name,chicken.name);
});

test('記録を開き直して日付・量・品数を変更し、削除する前の食事記録を保つ', () => {
  const create=render();
  create.set('search','焼き魚定食');
  create.pick(create.choices()[0]['data-choice']);
  create.set('name-1','店の焼き魚');
  create.set('search','ごはん');
  create.pick('recipe-plain-rice');
  create.submit();
  const initialEntry=create.saved[0], before=structuredClone(initialEntry);
  const edit=render({initialEntry,meal:'dinner',date:'2026-11-30'});
  assert.equal(edit.field('date').value,day);
  assert.equal(edit.field('name-1').value,'店の焼き魚');
  assert.equal(edit.field('submit').textContent,'変更を保存');
  edit.find(el=>el['aria-label']==='店の焼き魚を外す').fire('click');
  edit.set('amount-2','200');
  edit.set('date','2026-11-18');
  edit.submit();
  const next=edit.saved[0];
  assert.deepEqual(initialEntry,before);
  assert.equal(next.id,initialEntry.id);
  assert.equal(next.items.length,1);
  assert.equal(next.items[0].id,initialEntry.items[1].id);
  assert.equal(next.items[0].quantity,200 / next.items[0].portion.amount);
});

test('食べた量を消した間は以前の栄養合計を提示せず、項目を外すと空の食事は保存できない', () => {
  const view=render();
  view.set('search','ごはん');
  view.pick('recipe-plain-rice');
  view.set('amount-1','');
  assert.match(view.field('total').children[1].textContent,/各料理の食べた量/);
  view.submit();
  assert.equal(view.saved.length,0);
  view.find(el=>el['aria-label']==='ご飯を外す').fire('click');
  assert.ok(view.field('submit').disabled);
  view.submit();
  assert.equal(view.saved.length,0);
});

test('検索に表示する件数を増やして選ぶことができ、候補の無い検索から勝手に料理を加えない', () => {
  const view=render();
  view.set('search','鶏');
  assert.equal(view.choices().length,6);
  view.field('more').fire('click');
  assert.equal(view.choices().length,14);
  view.set('search','候補のない料理qqq');
  assert.equal(view.choices().length,0);
  view.submit();
  assert.equal(view.saved.length,0);
});

test('旧版の栄養不明の外食を料理に結び直し、食べた割合と店名を引き継ぐ', () => {
  const create=render();
  create.set('dish','焼き魚定食'); create.set('shop','学食');
  create.field('manual-add').fire('click'); create.set('amount-1','0.5'); create.submit();
  const previous=create.saved[0], before=structuredClone(previous);
  const edit=render({initialEntry:previous,entries:[previous]});
  edit.find(el=>el.textContent==='料理を探して置き換える').fire('click');
  assert.equal(edit.field('search').value,'焼き魚定食');
  assert.ok(!edit.choices().find(el=>el['data-choice']==='history-'+previous.items[0].id));
  edit.pick(edit.choices()[0]['data-choice']);
  edit.submit();
  const result=edit.saved[0];
  assert.equal(result.id,previous.id); assert.equal(result.items.length,1);
  const [item]=result.items;
  assert.equal(item.id,previous.items[0].id); assert.equal(item.quantity,.5);
  assert.equal(item.diningMatch.mode,'similar'); assert.equal(item.diningMatch.storeName,'学食');
  assert.equal(item.diningMatch.actualName,'焼き魚定食'); assert.ok(item.recipeId);
  assert.ok(summary([result]).values.kcal>0); assert.deepEqual(previous,before);
});

test('過去の料理の別名と店名を消し、別名がない参照料理として保存し直せる', () => {
  const create=render(); create.set('search','ご飯'); create.pick('recipe-plain-rice');
  create.set('shop','最初の店'); create.set('name-1','店のご飯'); create.submit();
  const initialEntry=create.saved[0];
  const edit=render({initialEntry,entries:[initialEntry]});
  edit.set('name-1',''); edit.set('shop',''); edit.submit();
  const [item]=edit.saved[0].items;
  assert.equal(item.diningMatch.storeName,'');
  assert.equal(item.name,'ご飯'); assert.equal(item.diningMatch.actualName,'ご飯');
});
