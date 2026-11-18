import {configureQuantityInput,readQuantityInput,installQuantitySteppers,setQuantityPresets} from './quantity-input.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from './data.js';
import {generateCalendarPlan, replaceRecipe, toggleDish, activeRecipeIds, describeRecipe, eligibleRecipes, updatePlanStaple, regeneratePlanMeal, addPlanDish, planMealPreference} from './planner.js';
import {GENRES, rebalanceGenreRatios} from './storage.js';
import {MAX_IMPORT_BYTES, readJournal, writeJournal, replaceJournal, readJournalBackup, markJournalExport, readJournalExportTime, defaultJournal, validateJournal, parseJournal, dateKey, dateIsValid, monthCells, shiftDate, entriesForDay} from './journal.js';
import {createJournalHistory, manualEditAffected} from './journal-history.js';
import {mountQuickRecord} from './quick-record-ui.js';
import {createRecordSummary} from './record-summary-ui.js';
import {renderCatalogFilters} from './catalog-filter-ui.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition, itemFromRecipe, itemNutrition, sumNutrition, summariseEntries} from './nutrition.js';
import {removeShoppingIngredient,shoppingMenuContext,shoppingMenusFromEntries} from './shopping-workflow.js';
import {INGREDIENT_GROUPS,ingredientGroup,commonPantryIds} from './shopping-categories.js';
import {mountShoppingWorkflow,shoppingChecklistText} from './shopping-workflow-ui.js';
import {createShoppingReceipt,migrateLegacyReceipts} from './shopping-status.js';
import {mountPantry} from './pantry-ui.js';
import {mountMealSettings} from './meal-settings-ui.js';
import {mountPlanDishPicker,mountPlanMealEditor} from './meal-plan-editor-ui.js';
import {planPortionLabel,portionLabel,formatCookingIngredient,recordPortionPresets} from './portion-guide.js';
import {mountCatalogFavourites} from './catalog-favourites-ui.js';
import {formatNutrient} from './nutrient-format.js';
import {catalogFamilies,catalogVariants,recipeFamily,recipePortion,quantityFromAmount,CATALOG_CATEGORIES,FOOD_NATURES,recipeNature,isCompleteMeal} from './catalog.js';
import {deriveReference} from './dietary-reference.js';
import {analyseIntake,compareIntake} from './intake.js';
import {isBanshakuDish} from './meal-suitability.js';
import {setupTabs} from './tabs.js';
import {previewReset,resetEntriesRange,createCatalogEntry} from './record-actions.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {FOOD_COMPOSERS, foodComposerFor, defaultFoodSelection, eligibleFoodSelection} from './food-composer.js';
import {mountFoodComposer,foodRecipeSwitch} from './food-composer-ui.js';
import {mountSaladBuilder} from './salad-builder-ui.js';
import {SALAD_COMPONENTS} from './salad-builder.js';
import {DISH_CUSTOMISERS,eligibleDishSelections} from './dish-customisation.js';
import {mountDishCustomiser} from './dish-customisation-ui.js';
import {meatChoiceFor,defaultMeatSelection,eligibleMeatSelections} from './meat-choices.js';
import {mountMeatChoice} from './meat-choices-ui.js';
import {mountRecipeArrangement} from './recipe-arrangement-ui.js';
import {mountMealSets} from './meal-sets-ui.js';
import {mountFamilyDinners} from './family-dinners-ui.js';
import {mountBatchCooking} from './batch-cooking-ui.js';
import {derivePurchase} from './purchase-conversion.js';
import {mountPurchaseEditor} from './purchase-conversion-ui.js';
import {mountRestaurantMenu} from './restaurant-menu-ui.js';
import {mealsBeforeDinner,previewRecordedDinner} from './recorded-dinner.js';
import {mountDiningLog} from './dining-log-ui.js';
import {restaurantVariantsFor} from './restaurant-menu.js';
import {createFavourite,favouriteKey} from './favourites.js';
import {mountFavourites} from './favourites-ui.js';
import {mountTextLog} from './text-log-ui.js';
import {canConfigureTextRecipe,mountTextRecipeConfigurator} from './text-log-configurator-ui.js';
import {mealOverlapWarnings} from './meal-overlap.js';
import {nutritionBasisBadge} from './nutrition-basis-ui.js';
import {deriveRecipeBasis} from './nutrition-basis.js';
import {soupIntakeFor} from './soup-intake.js';
import {mountSoupIntake} from './soup-intake-ui.js';
import {recipeIllustrationElement} from './recipe-illustration-ui.js?v=3.29.0';
import {recipeArtwork,liveBreadArtworkRecipe,snapshotArtworkRecipe} from './recipe-illustration.js?v=3.29.0';
import {MAPO_SEARCH_ALIASES} from './mapo-foods.js';
import {NOODLE_TOPPINGS} from './noodle-foods.js';
import {noodleComposerFor,defaultNoodleSelection,eligibleNoodleSelections} from './noodle-composer.js';
import {mountNoodleComposer} from './noodle-composer-ui.js';
import {curryRiceFor,defaultCurryRiceSelection,eligibleCurryRiceSelections} from './curry-rice.js';
import {mountCurryRice} from './curry-rice-ui.js';
import {groupMenuRecipes,getVariationGroup,variantLabel,variationSearchAliases} from './menu-variations.js';
import {FOOD_CATEGORIES,COOKING_METHODS,dishClassification,browseDishes,availableDishCategories,availableCookingMethods} from './dish-hierarchy.js';

installQuantitySteppers(document);

const builtin = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const MEALS = {breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'};
const ROLES = {staple:'主食',main:'主菜',side:'副菜',soup:'汁物',drink:'飲み物',snack:'間食'};
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const node = (tag, className='', text) => { const e=document.createElement(tag); if(className)e.className=className; if(text!==undefined)e.textContent=text; return e; };
const button = (text, action, className='button-text') => { const e=node('button',className,text); e.type='button'; e.addEventListener('click',guard(action)); return e; };
const fmt = (value, digits=1) => Number(value).toLocaleString('ja-JP',{maximumFractionDigits:digits});
const amount = (n,unit='') => `${fmt(n,2)}${unit ? ` ${unit}`:''}`;
const dateLabel = date => new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date(`${date}T12:00:00`));
let storage;
try {storage=window.localStorage;} catch {storage={getItem(){throw Error();},setItem(){throw Error();}};}
const loaded=readJournal(storage,builtin);
let recovery=loaded.recovery??null,undoNoticeVisible=false,undoNoticeTimer;
let backupValidity={raw:null,valid:false};
const undoHistory=createJournalHistory();
let state=loaded.state, selectedDate=dateKey(), month=selectedDate.slice(0,7), plan=null;
let visiblePlanDate='';
let recordSelectionId='', activeFamily='rice',undoReset=null,resetDateAnchor='',recordPickerSummary=null,summaryRefreshQueued=false;
let draftShoppingIds=new Map();
let shoppingSelection={},kitchenTab='checklist',pantryFilter={};
let roleFilter='all',recipeLimit=12,shoppingText='',storageWarning='',editing=null,toastTimer,manualBasis='manual';
const data=()=>({...builtin,recipes:[...RECIPES,...state.customRecipes]});
const recipeById=id=>data().recipes.find(r=>r.id===id);
const toast=node('div','toast'); toast.hidden=true; toast.setAttribute('aria-hidden','true'); document.body.append(toast);

function tell(message,error=false){
  const text=[message,storageWarning].filter(Boolean).join(' ');
  $('app-message').textContent=text; $('app-message').hidden=!text; $('app-message').className=`notice${error||storageWarning?' error':''}`;
  if(!text)return; toast.textContent=text; toast.hidden=false; toast.classList.toggle('error',error||!!storageWarning);
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.hidden=true,6500);
}
function guard(fn){return (...args)=>{try{const result=fn(...args); if(result?.catch)result.catch(e=>tell(e.message,true));}catch(e){tell(e.message,true);}};}
function persist(){
  const saved=writeJournal(storage,state,builtin);
  if(!saved)recovery=readJournal(storage,builtin).recovery??recovery;
  storageWarning=saved?'':recovery?'元の保存データを保護しています。復旧画面から保存方法を選んでください。':'このブラウザーに保存できません。画面を閉じる前にデータを書き出してください。';
  return saved;
}
function commit(change,{invalidate=true,message='',render=true}={}){
  if(recovery){renderAll();throw Error('元の保存データを保護しています。先に復旧画面で元データを書き出すか、保存データを読み込んでください。');}
  const next=structuredClone(state); change(next); const clean=validateJournal(next,builtin);
  const warnings=[],catalogData={...builtin,recipes:[...RECIPES,...clean.customRecipes]};
  for(const entry of clean.entries){
    const prior=state.entries.find(old=>old.id===entry.id),sameSlot=prior&&prior.date===entry.date&&prior.meal===entry.meal&&prior.status===entry.status;
    const added=sameSlot?entry.items.filter(item=>!prior.items.some(old=>old.id===item.id)):entry.items;
    if(!added.length)continue;
    warnings.push(...mealOverlapWarnings(entry,clean.entries.filter(other=>other.id!==entry.id),catalogData,{focusItemIds:added.map(item=>item.id)}));
  }
  const messages=[...new Set(warnings.map(warning=>warning.message))];
  if(messages.length&&!confirm(`${messages.join('\n')}\n\n追加のご飯や別皿として、このまま登録しますか？`)){tell('登録を取り消しました。');return false;}
  const remembered=undoHistory.record(state,clean,message||'記録の変更',{invalidatePlan:invalidate});
  state=clean;undoReset=null; if(invalidate)plan=null; persist(); if(render)renderAll();else{renderPersistenceStatus();renderHistory();} if(message||storageWarning)tell(message);
  if(remembered)showUndoNotice();
  return true;
}
function downloadText(text,filename){
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=node('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderPersistenceStatus(){
  $('journal-recovery').hidden=!recovery;
  const backup=readJournalBackup(storage),exported=readJournalExportTime(storage);
  $('backup-export-time').textContent=exported?`最後のバックアップ書き出し：${new Date(exported).toLocaleString('ja-JP')}`:'バックアップはまだ書き出していません。';
  if(backup&&backup.raw!==backupValidity.raw){
    backupValidity={raw:backup.raw,valid:false};try{parseJournal(backup.raw,builtin);backupValidity.valid=true;}catch{}
  }
  $('backup-status-note').textContent=backup?`変更前のデータを端末内に退避しています（${new Date(backup.savedAt).toLocaleString('ja-JP')}）。${backupValidity.valid?'':'この元データは自動で読み込めないため、ファイルに書き出して内容を確認してください。'}`:'読み込みや復旧でデータを置き換える前に、元の内容を端末内へ退避します。';
  $('download-journal-backup').disabled=!backup;$('restore-journal-backup').disabled=!backup||!backupValidity.valid;
}
function renderHistory(){
  const available=undoHistory.size>0&&!recovery;
  $('undo-last-action').disabled=!available;
  $('undo-notice').hidden=!available||!undoNoticeVisible;
  $('undo-action-label').textContent=undoHistory.label||'記録を変更しました。';
  document.body.dataset.hasUndoNotice=String(available&&undoNoticeVisible);
}
function showUndoNotice(){
  undoNoticeVisible=true;clearTimeout(undoNoticeTimer);renderHistory();
  undoNoticeTimer=setTimeout(()=>{undoNoticeVisible=false;renderHistory();},20000);
}
function reconcileMealSelections(next,recipes){
  let changed=false;
  for(const choice of Object.values(next.settings.mealPreferences)){
    if(choice.staple==='fixed'&&!recipes.some(r=>r.id===choice.stapleId&&(r.staple||r.role==='staple'))){choice.staple='auto';choice.stapleId='auto';choice.stapleAmount=null;changed=true;}
    if(choice.drinkId!=='none'&&!recipes.some(r=>r.id===choice.drinkId&&r.role==='drink')){choice.drinkId='none';choice.drinkAmount=null;changed=true;}
  }return changed;
}
function performUndo(){
  if(recovery)throw Error('保存データを復旧してから操作してください。');
  const invalidatePlan=undoHistory.invalidatesPlan;
  let choicesAdjusted=false;
  const previous=undoHistory.undo(state,{validate:next=>{
    const recipes=[...RECIPES,...next.customRecipes],s=next.settings;
    if(!['auto','none'].includes(s.stapleId)&&!recipes.some(r=>r.id===s.stapleId&&(r.role==='staple'||r.role==='main'&&r.staple===true))){s.stapleId='auto';s.stapleAmount=null;s.stapleMode='adaptive';choicesAdjusted=true;}
    if(s.drinkId!=='none'&&!recipes.some(r=>r.id===s.drinkId&&r.role==='drink')){s.drinkId='none';s.drinkAmount=null;choicesAdjusted=true;}
    if(reconcileMealSelections(next,recipes))choicesAdjusted=true;
    return validateJournal(next,builtin);
  }});if(!previous)return;
  if(manualEditAffected(state,previous,editing))resetManual();
  state=previous;undoReset=null;if(invalidatePlan||choicesAdjusted)plan=null;persist();renderAll();
  tell(`直前の記録変更を元に戻しました。${choicesAdjusted?'取り消しで選べなくなった主食・飲み物の指定も解除しました。':''}`);if(undoHistory.size)showUndoNotice();
}
function replaceSavedJournal(next,message){
  if(!replaceJournal(storage,next,builtin))throw Error('元データの退避または新しい内容の保存ができませんでした。現在の保存データはそのままです。先にJSONを書き出し、端末の空き容量などを確認してください。');
  state=next;recovery=null;storageWarning='';undoHistory.clear();undoReset=null;plan=null;undoNoticeVisible=false;
  resetManual();catalogFavouriteFilters={};shoppingSelection={};kitchenTab='checklist';$('shopping-from').value=state.settings.startDate;renderAll();tell(message);
}
function quantityPresets(input,recipe,portion){
  setQuantityPresets(input,recipe&&!input.disabled?recordPortionPresets(recipe,portion):[]);
}
function bind(id,event,fn){$(id).addEventListener(event,guard(fn));}
function selectOptions(element,options,value){
  element.replaceChildren(...options.map(([id,label,disabled=false])=>{const option=node('option','',label); option.value=id; option.disabled=disabled; return option;}));
  if(options.some(([id])=>id===value))element.value=value;
}
function check(id,label,checked,fn){const e=node('label','choice-label'),input=node('input');input.type='checkbox';input.value=id;input.checked=checked;if(fn)input.addEventListener('change',guard(()=>fn(input.checked)));e.append(input,node('span','',label));return e;}
function safeShift(date,n){try{return shiftDate(date,n);}catch{return n<0?'2000-01-01':'2100-12-31';}}
function setDate(date){if(!dateIsValid(date))throw Error('日付は2000年から2100年までで指定してください。');selectedDate=date;month=date.slice(0,7);$('nutrition-date').value=date;renderCalendar();renderNutrition();renderReset();}
function selectedEntry(items,note=''){return {id:uid(),date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,note,items};}
function snapshot(id,quantity=1){const recipe=describeRecipe(id,data());if(!recipe)throw Error('このメニューは見つかりませんでした。');const item=itemFromRecipe(recipe,data(),quantity);item.portion=recipePortion(recipe,data());return item;}
function saveFavourite(item,genre){
  const key=favouriteKey(item),prior=state.favourites.find(saved=>favouriteKey(saved.item)===key),favourite=createFavourite(item,data(),{genre:genre??recipeById(item.recipeId)?.genre??prior?.genre});
  commit(next=>{if(prior)next.favourites[next.favourites.findIndex(saved=>saved.id===prior.id)]={...favourite,id:prior.id};else next.favourites.push(favourite);},{invalidate:false,message:prior?'お気に入りの量を更新しました。':'お気に入りに保存しました。記録タブやメニューのお気に入りから呼び出せます。'});
}
function favouriteAction(getItem,getGenre=()=>undefined){return button('☆ お気に入りに保存',()=>{const item=getItem();if(!item)throw Error('先に料理と数量を確認してください。');saveFavourite(item,getGenre());},'button-secondary favourite-current');}
function addQuickEntry(entry,message='食事を記録しました。'){
  const saved=commit(next=>next.entries.push(entry),{invalidate:false,message});if(saved)setDate(entry.date);return saved;
}

function renderSettings(){
  const s=state.settings,p=s.preferences;
  document.documentElement.dataset.textSize=s.textSize;
  for(const input of document.querySelectorAll('input[name="text-size"]'))input.checked=input.value===s.textSize;
  $('start-tab').value=s.startTab;
  $('hide-recipe-illustrations').checked=s.hideRecipeIllustrations;
  if(s.hideRecipeIllustrations){
    for(const artwork of document.querySelectorAll('.recipe-art'))artwork.remove();
    for(const card of document.querySelectorAll('.has-recipe-art'))card.classList.remove('has-recipe-art');
  }
  for(const [id,value]of Object.entries({'start-date':s.startDate,'plan-days':s.days,servings:s.servings,'genre-mode':p.genreMode,'single-genre':p.genre==='all'?'和食':p.genre}))$(id).value=value;
  $('meal-settings').replaceChildren(mountMealSettings({settings:s,data:data(),onChange:(meal,patch)=>{const saved=commit(next=>{Object.assign(next.settings.mealPreferences[meal],patch);},{render:false});if(saved){renderPlan();renderShopping();}return saved;},onError:message=>tell(message,true)}));
  $('required-allergens').replaceChildren();$('other-allergens').replaceChildren();
  for(const a of ALLERGENS)(a.category==='required'?$('required-allergens'):$('other-allergens')).append(check(a.id,a.label,s.allergens.includes(a.id),yes=>commit(next=>{next.settings.allergens=yes?[...next.settings.allergens,a.id]:next.settings.allergens.filter(id=>id!==a.id);},{message:'避ける食材を更新しました。'})));
  $('allergen-count').textContent=`${s.allergens.length}件`;
  $('single-genre-field').hidden=p.genreMode!=='single';$('genre-ratio-field').hidden=p.genreMode!=='ratio';
  $('genre-ratios').replaceChildren();
  for(const genre of GENRES){const label=node('label','ratio-input-label',genre),input=node('input');input.type='number';input.min=0;input.max=100;input.step=1;input.value=p.genreRatios[genre];configureQuantityInput(input,{integerOnly:true});input.setAttribute('aria-label',`${genre}の割合`);input.addEventListener('change',guard(()=>commit(next=>{next.settings.preferences.genreRatios=rebalanceGenreRatios(next.settings.preferences.genreRatios,genre,readQuantityInput(input,{label:`${genre}の割合`}));})));label.append(input,node('span','','%'));$('genre-ratios').append(label);}
  $('ratio-total').textContent=`${Object.values(p.genreRatios).reduce((a,b)=>a+b,0)}%`;
  renderIngredientSearch(false);renderIngredientSearch(true);
}
function renderIngredientSearch(preferred){
  const prefix=preferred?'preferred':'ingredient',values=preferred?state.settings.preferences.preferredIngredients:state.settings.excludedIngredients;
  $(prefix+'-selections').replaceChildren(...values.map(id=>button(`${INGREDIENTS[id].name} ×`,()=>commit(next=>{if(preferred)next.settings.preferences.preferredIngredients=next.settings.preferences.preferredIngredients.filter(x=>x!==id);else next.settings.excludedIngredients=next.settings.excludedIngredients.filter(x=>x!==id);}))));
  const query=$(prefix+'-search').value.trim(),box=$(prefix+'-options');box.replaceChildren();if(!query)return;
  const matches=Object.entries(INGREDIENTS).filter(([id,i])=>matchesJapaneseQuery([i.name,id],query)&&!values.includes(id)).slice(0,20);
  for(const [id,i]of matches)box.append(button(`＋ ${i.name}`,()=>{
    if(preferred&&state.settings.excludedIngredients.includes(id))throw Error('この食材は除外中です。先に除外を取り消してください。');
    commit(next=>{if(preferred)next.settings.preferences.preferredIngredients.push(id);else{next.settings.excludedIngredients.push(id);next.settings.preferences.preferredIngredients=next.settings.preferences.preferredIngredients.filter(x=>x!==id);}});
    $(prefix+'-search').value='';renderIngredientSearch(preferred);
  }));
  if(!matches.length)box.append(node('p','field-note','一致する食材がありません。別の名前で探してください。'));
}
function isDiningEntry(entry){
  return entry.note==='外食'||(entry.items.length>0&&entry.items.every(item=>item.diningMatch));
}
function diningReference(item){
  const match=item.diningMatch;
  if(!match)return '';
  const reference=match.mode==='similar'?'「'+match.referenceName+'」から概算':'照合した料理：'+match.referenceName;
  return [match.storeName,reference].filter(Boolean).join(' ／ ');
}
function renderDinnerLink(){
  const link=$('dinner-from-record');
  link.hidden=!mealsBeforeDinner(state.entries,selectedDate).length;
  link.textContent=dateLabel(selectedDate)+'の食事記録から夕食を考える';
}
function renderCalendar(){
  renderDinnerLink();
  $('month-label').textContent=`${Number(month.slice(0,4))}年${Number(month.slice(5))}月`;
  $('calendar-date').value=selectedDate;$('selected-date').textContent=dateLabel(selectedDate);
  $('calendar-grid').replaceChildren();
  for(const cell of monthCells(month)){
    const records=entriesForDay(state.entries,cell.date),e=button('',()=>{setDate(cell.date);$('calendar-day-'+cell.date)?.focus();},`calendar-day${cell.inMonth?'':' outside'}${cell.date===selectedDate?' selected':''}${cell.date===dateKey()?' today':''}`);
    e.id='calendar-day-'+cell.date;e.disabled=!dateIsValid(cell.date);e.setAttribute('aria-pressed',String(cell.date===selectedDate));
    e.setAttribute('aria-label',`${cell.date} ${records.length?records.map(r=>`${MEALS[r.meal]} ${r.status==='eaten'?'食べた':'予定'}`).join('、'):'記録なし'}`);
    e.append(node('span','day-number',String(Number(cell.date.slice(8)))));
    const badges=node('span','day-meals');
    for(const [meal,label]of Object.entries(MEALS)){
      const meals=records.filter(r=>r.meal===meal);if(!meals.length)continue;
      const b=node('span',`meal-count ${meals.some(r=>r.status==='eaten')?'eaten':'planned'}`,`${label.slice(0,1)}${meals.some(r=>r.status==='planned')?' ◇':''}`);badges.append(b);
    }e.append(badges);$('calendar-grid').append(e);
  }
  $('calendar-entry-list').replaceChildren();
  for(const [meal,label]of Object.entries(MEALS)){
    const section=node('section','meal-entry-group');section.append(node('h4','',label));
    const entries=entriesForDay(state.entries,selectedDate).filter(e=>e.meal===meal);
    if(!entries.length)section.append(node('p','field-note','まだ記録がありません。'));
    for(const entry of entries){
      const card=node('div','entry-card'),heading=node('div','entry-heading');
      heading.append(node('span',`status-badge ${entry.status}`,entry.status==='eaten'?'食べた':'これからの予定'),button(entry.status==='eaten'?'予定に戻す':'食べたにする',()=>commit(next=>{next.entries.find(e=>e.id===entry.id).status=entry.status==='eaten'?'planned':'eaten';},{invalidate:false,message:'記録の種類を更新しました。'})));
      card.append(heading);if(entry.shoppingServings)card.append(node('p','field-note',`栄養は1人分 ／ 買い物は${entry.shoppingServings}人分`));const items=node('div','entry-items');
      for(const item of entry.items){const row=node('div','entry-item'),name=button(item.name,()=>openSnapshot(item),'recipe-name');
        const portion=item.portion??{amount:1,unit:'人分'};const qty=node('input');qty.type='number';qty.min='0.001';qty.max='1000000';qty.step='any';qty.value=Number((item.quantity*portion.amount).toFixed(4));configureQuantityInput(qty);qty.setAttribute('aria-label',`${item.name}の量（${portion.unit}）`);
        qty.addEventListener('change',guard(()=>commit(next=>{next.entries.find(e=>e.id===entry.id).items.find(i=>i.id===item.id).quantity=readQuantityInput(qty)/portion.amount;},{invalidate:false})));
        row.append(name,qty,node('span','unit-label',portion.unit));
        if(!item.batchId&&!item.diningMatch&&!isDiningEntry(entry))row.append(button('編集',()=>editItem(entry,item)));
        row.append(button('削除',()=>commit(next=>{const e=next.entries.find(e=>e.id===entry.id);e.items=e.items.filter(i=>i.id!==item.id);if(!e.items.length&&(!e.note||isDiningEntry(entry)))next.entries=next.entries.filter(x=>x.id!==entry.id);},{invalidate:false})));items.append(row,nutritionBasisBadge(item,data(),{snapshot:true}));
        if(item.diningMatch)items.append(node('p','dining-origin',diningReference(item)));
      }card.append(items);if(entry.note)card.append(node('p','entry-note',entry.note));
      const actions=node('div','entry-actions');
      if(entry.status==='planned')actions.append(button('この予定を外食に変更',()=>openDiningLog({date:entry.date,meal:entry.meal,replaceEntry:entry})));
      if(entry.status==='eaten'&&isDiningEntry(entry))actions.append(button('外食の料理や量を変更',()=>openDiningLog({date:entry.date,meal:entry.meal,editEntry:entry})));
      actions.append(button('この記録を削除',()=>{if(confirm('この食事の記録を削除しますか？'))commit(next=>{next.entries=next.entries.filter(e=>e.id!==entry.id);},{invalidate:false});}));card.append(actions);section.append(card);
    }$('calendar-entry-list').append(section);
  }
  renderRecordTools();
  $('day-complete').checked=state.completedDays.includes(selectedDate);
  renderRecordPicker();
}

function renderNutrition(){
  const date=$('nutrition-date').value||selectedDate,days=Number($('nutrition-period').value||1);
  const actual=summariseEntries(state.entries,{from:date,to:date}),planned=summariseEntries(state.entries,{from:date,to:date,status:'planned'});
  const period=analyseIntake(state.entries,{to:date,days,completedDays:state.completedDays});
  const reference=state.profile.mode==='reference'?deriveReference(state.profile):null;
  const dayCompleted=state.completedDays.includes(date),hasDay=actual.entryCount>0||dayCompleted;
  const box=$('nutrition-view');box.replaceChildren();
  box.append(node('p','nutrition-caption',days===1?`${dateLabel(date)} · 食べた記録 ${actual.entryCount}件 / ${actual.recordedMeals}食分${planned.entryCount?` · 予定 ${planned.entryCount}件（集計外）`:''}`:`${period.from}〜${period.to} · 記録がそろった日の1日平均`));
  if(days===1&&!hasDay)box.append(node('p','empty-note','食べた記録がまだありません。未記録を食べていないものとは判断しません。'));
  const grid=node('div','nutrition-grid');
  for(const key of NUTRIENT_KEYS){
    const allUnknown=days===1&&hasDay&&!actual.complete[key]&&actual.knownCounts[key]===0;
    const value=days===1?(hasDay&&!allUnknown?actual.values[key]:null):period.mean[key];
    const known=days===1?actual.complete[key]:period.knownDays[key]===period.completedCount;
    const card=node('div','nutrition-metric');card.append(node('span','',NUTRIENT_LABELS[key]),node('strong','',value===null?(allUnknown?'不明':'—'):`${formatNutrient(value,key)} ${NUTRIENT_UNITS[key]}`));
    if(days===1&&hasDay&&!known&&!allUnknown)card.append(node('small','partial-note','＋不明分'));
    if(days>1)card.append(node('small','partial-note',`${period.knownDays[key]}/${period.completedCount}日分${known?'':'（不明の日を除外）'}`));
    const track=node('div','nutrient-track'),fill=node('span','nutrient-fill');fill.style.width=`${Math.min(100,(value??0)/(state.targets[key]||1)*100)}%`;track.append(fill);card.append(track,node('small','',goalLabel(key,reference)));
    if(value!==null){
      const comparison=days===1&&!dayCompleted?{kind:'pending',label:'記録の途中です'}:compareIntake(key,value,{target:state.targets[key],reference,complete:days===1?known:true});
      card.append(node('small',`comparison ${comparison.kind}`,comparison.label));
    }
    grid.append(card);
  }
  box.append(grid);
  if(days===1&&actual.unknownItems)box.append(node('p','field-note',`${actual.unknownItems}品に未入力の栄養があります。表示は分かっている量の合計です。`));
  $('period-summary').replaceChildren(node('p','',`${days}日間で${period.totals.recordedDays}日の記録があります。うち${period.completedCount}日を記録完了として登録しています。`),node('p','field-note',days===1?(dayCompleted?'この日の飲食は記録済みとして比較します。未入力の栄養は比較しません。':'飲食の記録がそろったら「記録」タブで完了にチェックできます。'):period.completedCount?'平均には記録がそろった日だけを使います。栄養が不明の日は成分ごとに除き、対象の日数を表示します。':'記録がそろった日がないため平均は表示していません。空白の日を0として計算しません。'));
  const refBox=$('nutrition-reference-note');refBox.replaceChildren();
  if(reference){refBox.append(node('strong','',`2025年版の目安 · ${reference.label}`),node('p','field-note','参照体位の一般成人に対する比較用です。体格、妊娠・授乳、治療用の調整は行いません。1日だけの数字で健康状態を判定するものではありません。'));
    const detail=node('details');detail.append(node('summary','','目安の種類と出典を見る'));
    detail.append(node('p','field-note',`たんぱく質は推奨量${reference.targets.protein}gを表示しています。目標エネルギー比率${reference.energyPercentRanges.protein.min}〜${reference.energyPercentRanges.protein.max}%（${fmt(reference.ranges.protein.min)}〜${fmt(reference.ranges.protein.max)}g）とは別の指標です。脂質と炭水化物のバーは公式範囲の中央を比較の便宜値にしています。`));
    for(const source of reference.references.slice(0,2)){const link=node('a','text-link',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);}refBox.append(detail);
  }else{refBox.append(node('strong','','手動で設定した比較値'),node('p','field-note','年代・基準表の性別・活動量に合わせた目安は「設定」タブで選べます。初期値は表示を試すための参考値です。'));}
  const chartDays=days===30?30:7,from=safeShift(date,1-chartDays),chart=node('div','week-chart');
  $('weekly-view').replaceChildren();
  for(let i=0;i<chartDays;i++){
    const d=safeShift(from,i);if(d>date)break;const daily=summariseEntries(state.entries,{from:d,to:d}),col=node('div','week-day'),bar=node('div','week-bar');
    bar.style.height=`${Math.max(2,Math.min(140,daily.values.kcal/(state.targets.kcal||1)*110))}px`;bar.setAttribute('aria-hidden','true');
    let energy='—';
    if(daily.entryCount)energy=daily.knownCounts.kcal?`${fmt(daily.values.kcal,0)}${daily.complete.kcal?'':'＋?'}`:'不明';
    col.append(node('span','',energy),bar,node('span','',d.slice(5).replace('-','/')),node('small','',`${daily.recordedMeals}食${state.completedDays.includes(d)?' ✓':''}`));chart.append(col);
  }
  $('weekly-view').append(chart,node('p','field-note',`直近${chartDays}日間のエネルギー（kcal）。✓は記録完了、＋?は不明分を含む日です。未完了の日も分かっている量を表示します。`));
  for(const key of NUTRIENT_KEYS){$('target-'+key).value=Number(state.targets[key].toFixed(3));$('target-'+key).step='any';}
}
function goalLabel(key,reference){
  const value=state.targets[key],unit=NUTRIENT_UNITS[key];
  if(!reference)return `比較値 ${`${formatNutrient(value,key)} ${unit}`}`;
  if(['fat','carbs'].includes(key)){const r=reference.ranges[key];return `目標範囲 ${fmt(r.min)}〜${fmt(r.max)} g`;}
  if(key==='salt')return `目標量 ${`${formatNutrient(value,key)} ${unit}`}未満`;
  if(key==='fiber')return `目標量 ${`${formatNutrient(value,key)} ${unit}`}以上`;
  if(key==='protein')return `推奨量 ${`${formatNutrient(value,key)} ${unit}`}`;
  return `参照体位の推定値 ${`${formatNutrient(value,key)} ${unit}`}`;
}
function renderProfile(){
  for(const [id,key]of [['profile-age','ageBand'],['profile-sex','sex'],['profile-activity','activity'],['profile-mode','mode']])$(id).value=state.profile[key];
  const reference=state.profile.mode==='reference'?deriveReference(state.profile):null;
  $('profile-summary').textContent=reference?`${reference.label}の比較値を使用しています。`:'手動の比較値を使用しています。プロフィールの入力は任意です。';
}
function natureLabel(recipe){return FOOD_NATURES.find(n=>n.id===recipeNature(recipe))?.label??'分類未設定';}
function familyLabel(recipe){
  const classification=dishClassification(recipe);
  if(['main','side'].includes(classification.section))return [ROLES[classification.section],FOOD_CATEGORIES.find(c=>c.id===classification.category)?.label,COOKING_METHODS.find(m=>m.id===classification.method)?.label].filter(Boolean).join(' / ');
  return CATALOG_CATEGORIES.find(f=>f.id===recipeFamily(recipe))?.label??ROLES[recipe.role];
}
function chooseFacet(id,items,allLabel){
  const element=$(id),selected=element.value||'all';
  const selectedLabel=element.selectedOptions[0]?.textContent.replace(/（[0-9]+）$/,'')??selected;
  const missing=selected!=='all'&&!items.some(item=>item.id===selected)?[[selected,`${selectedLabel}（0）`]]:[];
  selectOptions(element,[['all',allLabel],...items.map(item=>[item.id,`${item.label}（${item.count}）`]),...missing],selected);
  return element.value;
}
// 保存内容や除外条件が変わると state が入れ替わる。入力中だけ同じ検索用一覧を使う。
const recordSearchLists = new WeakMap();
const menuSearchLists = new WeakMap();

function searchableRecipes(catalogData, respectConditions) {
  const cache = respectConditions ? menuSearchLists : recordSearchLists;
  if (!cache.has(state)) {
    const recipes = respectConditions ? menuCandidates(catalogData) : catalogData.recipes;
    cache.set(state, recipes.map(recipe => ({
      ...recipe,
      searchAliases: menuSearchAliases(recipe, respectConditions, catalogData),
      ingredients: recipe.ingredients.map(part => ({...part, name: INGREDIENTS[part.id]?.name ?? part.id})),
    })));
  }
  return cache.get(state);
}

function renderRecordPicker(){
  const search=$('catalog-search')?.value.trim()??'',nature=$('catalog-nature').value,section=$('catalog-section').value;
  const all=searchableRecipes(data(),false);
  const hierarchical=['main','side'].includes(section);
  $('catalog-family-field').hidden=hierarchical;$('catalog-food-category-field').hidden=!hierarchical;$('catalog-method-field').hidden=!hierarchical;
  let variants;
  if(hierarchical){
    const matching=browseDishes(all,{section,query:search,nature});
    const category=chooseFacet('catalog-food-category',availableDishCategories(matching),'すべての食材');
    const method=chooseFacet('catalog-method',availableCookingMethods(matching,{category}),'すべての調理法');
    variants=browseDishes(matching,{category,method});
  }else{
    const families=catalogFamilies(all,{role:section,query:search,nature});
    const previousFamily=$('catalog-family').value||activeFamily;
    activeFamily=families.some(f=>f.id===previousFamily)?previousFamily:families[0]?.id??'';
    selectOptions($('catalog-family'),families.map(f=>[f.id,`${f.label}（${f.count}）`]),activeFamily);
    variants=catalogVariants(all,activeFamily,{query:search,nature});
  }
  const previous=$('catalog-item').value,previousVariant=$('catalog-variant').value;
  const menus=groupMenuRecipes(variants,{allRecipes:all,query:search});
  const previousMenu=menus.find(menu=>menu.selectedRecipeId===previous)??menus.find(menu=>menu.recipes.some(r=>r.id===previousVariant));
  selectOptions($('catalog-item'),menus.map(menu=>[menu.selectedRecipeId,menu.label]),previousMenu?.selectedRecipeId??previous);
  const chosen=menus.find(menu=>menu.selectedRecipeId===$('catalog-item').value);
  selectOptions($('catalog-variant'),(chosen?.recipes??[]).map(r=>[r.id,variantLabel(r)]),previousVariant);
  $('catalog-variant-field').hidden=(chosen?.recipes.length??0)<2||!!foodComposerFor(chosen?.selectedRecipeId);
  const id=recordPickerRecipeId(),r=recipeById(id),composable=isComposableRecipe(id)||!!soupIntakeFor(r,data());$('add-catalog-item').disabled=!r;$('add-catalog-item').textContent=composable?'内容を選んで記録':'記録に追加';$('catalog-amount').disabled=composable;
  if(!r){recordSelectionId='';$('catalog-type-note').textContent='';$('catalog-unit').textContent='';$('catalog-serving-label').textContent='一致するメニューがありません。区分や絞り込みを見直してください。';quantityPresets($('catalog-amount'),null,null);recordPickerSummary?.refresh();return;}
  const described=describeRecipe(r.id,data());$('catalog-type-note').textContent=[familyLabel(r),natureLabel(r),composable?'':r.sourceNote,described.allergensKnown===false?'商品の原材料を確認してください。未確認のメニューは自動提案には使いません。':''].filter(Boolean).join(' / ');
  const portion=recipePortion(r,data());$('catalog-unit').textContent=portion.unit;$('catalog-serving-label').textContent=composable?'材料と量は次の画面で選べます。':portion.label;
  $('catalog-amount').min='0.001';$('catalog-amount').max='1000000';configureQuantityInput($('catalog-amount'));
  if(recordSelectionId!==id){$('catalog-amount').value=portion.amount;recordSelectionId=id;}
  quantityPresets($('catalog-amount'),r,portion);recordPickerSummary?.refresh();
}
function draftEntries(sourcePlan=plan,ids=draftShoppingIds){
  if(!sourcePlan?.ok)return [];
  const entries=[];
  for(const day of sourcePlan.days){
    const items=activeRecipeIds(day).map(id=>{
      const item=snapshot(id,day.quantities?.[id]??1);
      const key=JSON.stringify([day.date,day.meal,id]);
      if(!ids.has(key))ids.set(key,uid());
      item.id=ids.get(key);
      return item;
    });
    if(items.length)entries.push({id:`draft-${day.date}-${day.meal}`,date:day.date,meal:day.meal,status:'planned',note:'',items});
  }
  return entries;
}
function renderPlan(){
  $('plan-day-navigation').hidden=!plan?.ok;
  $('plan-save-calendar').disabled=!plan?.ok;$('plan-output').replaceChildren();
  if(!plan){$('plan-date-label').textContent='条件を選んで提案を作成';const e=node('div','empty-plan');e.append(node('span','empty-mark','◒'),node('h3','','次のごはんをここから。'),node('p','','条件を選んで「献立を作る」を押してください。食べた記録があれば、その内容も参考にします。'));$('plan-output').append(e);return;}
  if(!plan.ok){
    $('plan-date-label').textContent='献立の条件を確認してください';
    const missing=(plan.missingRoles??[]).map(role=>ROLES[role]??role);
    const warnings=plan.warnings?.length?plan.warnings:['条件に合う献立を作れませんでした。'];
    $('plan-output').append(node('p','notice error',warnings[0]));
    for(const warning of warnings.slice(1))$('plan-output').append(node('p','field-note',warning));
    if(missing.length)$('plan-output').append(node('p','field-note',missing.join('・')+'の候補を確認してください。'));
    return;
  }
  const dates=[...new Set(plan.days.map(day=>day.date))];
  if(visiblePlanDate!=='all'&&!dates.includes(visiblePlanDate))visiblePlanDate=dates[0];
  $('plan-visible-day-field').hidden=dates.length<2;
  selectOptions($('plan-visible-day'),[...dates.map(date=>[date,dateLabel(date)]),['all','すべての日']],visiblePlanDate);
  $('plan-open-shopping').textContent=visiblePlanDate==='all'?'買い物する期間と食材を選ぶ':'この日の食材を選ぶ';
  $('plan-save-calendar').textContent=dates.length>1?'全日程をカレンダーに保存':'予定としてカレンダーへ';
  let stapleChoices;
  const getStapleChoices=()=>stapleChoices??=eligibleRecipes(state.settings,data()).filter(r=>(r.staple||r.role==='staple')&&!isCompleteMeal(r));
  const planMeals=[...new Set(plan.days.map(day=>MEALS[day.meal]))];
  $('plan-date-label').textContent=`${dateLabel(plan.days[0].date)}から${plan.settings.days}日分 / ${planMeals.join('・')}の${plan.days.length}食`;
  let previousDate='';
  for(const [index,day]of plan.days.entries()){
    if(visiblePlanDate!=='all'&&day.date!==visiblePlanDate)continue;
    if(previousDate!==day.date){$('plan-output').append(node('h3','plan-date-group',dateLabel(day.date)));previousDate=day.date;}
    const card=node('article','day-card'),head=node('div','day-card-heading');
    const editButton=button('料理を替える',()=>openPlanMealEditor(index));
    editButton.id=`plan-edit-${day.date}-${day.meal}`;
    head.append(node('h3','',`${dateLabel(day.date)}の${MEALS[day.meal]}`),editButton);card.append(head);
    for(const id of day.recipeIds){const r=recipeById(id),row=node('div','dish-row'),included=!day.omittedRecipeIds?.includes(id);row.classList.toggle('omitted',!included);
      const inclusionId=`plan-include-${day.date}-${day.meal}-${id}`;
      const inclusion=check(id,CATALOG_CATEGORIES.find(f=>f.id===recipeFamily(r))?.role==='staple'?'主食':ROLES[r.role],included,yes=>{applyEditedPlan(toggleDish(plan,{dayIndex:index,recipeId:id,included:yes},data()),yes?'料理を献立に戻しました。':'料理を献立から外しました。');$(inclusionId)?.focus();});
      inclusion.querySelector('input').id=inclusionId;
      inclusion.querySelector('input').setAttribute('aria-label',`${day.date} ${MEALS[day.meal]}の${r.name}を献立に含める`);
      row.append(inclusion,button(r.name,()=>openSnapshot(snapshot(id,day.quantities?.[id]??1),r.custom?undefined:r.minutes),'recipe-name'),node('span','dish-amount',planAmountText(day,id)));card.append(row);
    }
    const actions=node('div','plan-edit-actions'),addButton=button('＋ 料理を追加',()=>openPlanDishPicker(index),'button-secondary compact');
    addButton.id=`plan-add-${day.date}-${day.meal}`;actions.append(addButton);
    if(day.meal==='dinner'){
      const save=button('家族の定番に保存',()=>openFamilyDinners(index),'button-secondary compact');
      save.disabled=!activeRecipeIds(day).length;
      actions.append(save);
    }
    card.append(actions);
    appendPlanStapleControls(card,day,index,getStapleChoices);
    const total=sumNutrition(activeRecipeIds(day).map(id=>snapshot(id,day.quantities?.[id]??1)));
    card.append(node('p','field-note',`1人分の目安：${NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${formatNutrient(total.values[k],k)} ${NUTRIENT_UNITS[k]}${total.complete[k]?'':'＋不明分'}`).join(' / ')}`));
    const details=node('details','plan-reasons');details.append(node('summary','','この献立を選んだ理由'));for(const message of [...(day.reasons??[]),...(day.warnings??[])])details.append(node('p','field-note',message));card.append(details);$('plan-output').append(card);
  }
  for(const warning of plan.warnings??[])$('plan-output').append(node('p','field-note',warning));
}
/** 下書きの変更は、買い物に取り込む献立にも反映します。 */
function syncDraftShoppingCatalog(nextPlan,ids){
  if(recovery)throw Error('献立を変更する前に保存データを復旧してください。');
  const entries=draftEntries(nextPlan,ids),from=nextPlan.days[0].date,to=nextPlan.days.at(-1).date;
  const shoppingCatalog=shoppingMenusFromEntries(entries,data(),{from,to,servings:nextPlan.settings.servings})
    .map(menu=>({...menu,origin:'plan'}));
  state=validateJournal({...state,shoppingCatalog},builtin);draftShoppingIds=ids;persist();
}
function applyEditedPlan(next,message,{newDraft=false}={}){
  if(!next?.ok)throw Error((next?.warnings??['条件に合う料理がありません。']).join(' '));
  syncDraftShoppingCatalog(next,newDraft?new Map():new Map(draftShoppingIds));
  if(newDraft){
    shoppingSelection={};
    $('shopping-from').value=next.days[0].date;
    $('shopping-days').value=String(Math.min(3,next.settings.days));
    $('shopping-source').value='draft';
  }
  plan=next;renderPlan();renderShopping();tell(message);
}
function openFamilyDinners(dayIndex, selectedId, initialDate=selectedDate){
  const day=Number.isInteger(dayIndex)?plan?.days[dayIndex]:null;
  const proposedItems=day?activeRecipeIds(day).map(id=>snapshot(id,day.quantities?.[id]??1)):null;
  const dialog=$('recipe-dialog'),date=day?.date??initialDate;
  $('dialog-title').textContent=day?'この夕飯を家族の定番に保存':'家族の夕飯レパートリー';
  $('dialog-meta').textContent=day?dateLabel(day.date)+'の夕食':'';
  const panel=mountFamilyDinners({
    state,data:data(),date,proposedItems,selectedId,
    onSave:set=>{
      if(commit(next=>next.mealSets.push(set),{invalidate:false,message:'「'+set.name+'」を家族の定番に保存しました。'}))openFamilyDinners(null,set.id,date);
    },
    onRename:(id,name)=>{
      if(commit(next=>{next.mealSets.find(set=>set.id===id).name=name;},{invalidate:false,message:'定番の名前を変更しました。'}))openFamilyDinners(null,id,date);
    },
    onDelete:(id,name)=>{
      if(!confirm('「'+name+'」を家族の定番から削除しますか？'))return;
      if(commit(next=>{next.mealSets=next.mealSets.filter(set=>set.id!==id);},{invalidate:false,message:'家族の定番から削除しました。'}))openFamilyDinners();
    },
    onSchedule:entry=>{
      if(!commit(next=>next.entries.push(entry),{invalidate:false,message:dateLabel(entry.date)+'の夕食予定に「'+entry.note+'」を追加しました。'}))return;
      $('calendar-meal').value='dinner';$('calendar-status').value='planned';
      setDate(entry.date);dialog.close();activateTab('record',{focus:true});
    },
    onBrowse:()=>{dialog.close();activateTab('catalog',{focus:true});},
    describeItem:item=>{
      const box=node('div'),pictured=snapshotArtworkRecipe(item,data());
      if(pictured)box.append(...recipeArtworkNodes(pictured,{detail:true,standard:true}));
      box.append(snapshotDetails(item,{showNutritionBasis:true}));
      return box;
    }
  });
  $('dialog-content').replaceChildren(panel);
  if(!dialog.open)dialog.showModal();
  (panel.querySelector('select')??panel.querySelector('input')??panel.querySelector('button'))?.focus();
}

function openPlanMealEditor(index){
  const day=plan?.days[index];if(!day)throw Error('変更する献立を選んでください。');
  $('dialog-title').textContent=`${dateLabel(day.date)}の${MEALS[day.meal]}を替える`;
  $('dialog-meta').textContent='この食事だけ条件を変えて提案します。';
  $('dialog-content').replaceChildren(mountPlanMealEditor({settings:plan.settings,data:data(),day,mealPreference:planMealPreference(plan,index),
    onApply:({mealPreference,genre})=>{applyEditedPlan(regeneratePlanMeal(plan,{dayIndex:index,mealPreference,genre,entries:state.entries,pantry:state.pantry,targets:state.targets,completedDays:state.completedDays},data()),'この食事の献立を更新しました。');$('recipe-dialog').close();$(`plan-edit-${day.date}-${day.meal}`)?.focus();},onError:message=>tell(message,true)}));
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function openPlanDishPicker(index){
  const day=plan?.days[index];if(!day)throw Error('追加する献立を選んでください。');
  $('dialog-title').textContent=`${dateLabel(day.date)}の${MEALS[day.meal]}に追加`;
  $('dialog-meta').textContent='この食事に付けたい料理を選びます。';
  $('dialog-content').replaceChildren(mountPlanDishPicker({settings:plan.settings,data:data(),day,
    onAdd:({recipeId,quantity})=>{applyEditedPlan(addPlanDish(plan,{dayIndex:index,recipeId,quantity},data()),'この食事に料理を追加しました。');$('recipe-dialog').close();$(`plan-add-${day.date}-${day.meal}`)?.focus();},onError:message=>tell(message,true)}));
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function planAmountText(day,id){return planPortionLabel(recipeById(id),day.quantities?.[id]??1,data());}
function renderPantry(){
  $('pantry-tools').replaceChildren(mountPantry({data:data(),pantry:state.pantry,initialFilter:pantryFilter,onFilterChange:filter=>{pantryFilter=filter;},onSave:(id,quantity)=>commit(next=>{const old=next.pantry.find(p=>p.id===id);if(old)old.amount=quantity;else next.pantry.push({id,amount:quantity});},{invalidate:false,message:'手持ちの量を保存しました。'}),onDelete:id=>commit(next=>{next.pantry=next.pantry.filter(p=>p.id!==id);},{invalidate:false}),onError:message=>tell(message,true)}));
}
function setKitchenTab(key,{focus=false}={}){
  kitchenTab=['checklist','menus','purchased','pantry','settings','help'].includes(key)?key:'checklist';
  for(const control of $('kitchen-tabs').querySelectorAll('[data-kitchen-tab]')){const active=control.dataset.kitchenTab===kitchenTab;control.setAttribute('aria-selected',String(active));control.tabIndex=active?0:-1;$(control.getAttribute('aria-controls')).hidden=!active;}
  if(focus)$('kitchen-tab-'+kitchenTab).focus();
}
function shoppingReceipts(){
  const saved=state.shoppingReceipts,ids=new Set(saved.map(x=>x.id));return [...saved,...migrateLegacyReceipts(state.shoppingList,state.shoppingChecks,data()).filter(x=>!ids.has(x.id))];
}
function renderShoppingOmissions(){
  const common=commonPantryIds(data()),omitted=state.settings.shoppingOmittedIds;
  $('shopping-omit-common').checked=common.length>0&&common.every(id=>omitted.includes(id));
  $('shopping-omit-common').indeterminate=common.some(id=>omitted.includes(id))&&!$('shopping-omit-common').checked;
  $('shopping-omitted-choices').replaceChildren(...common.map(id=>check(id,INGREDIENTS[id].name,omitted.includes(id),yes=>commit(next=>{next.settings.shoppingOmittedIds=yes?[...new Set([...next.settings.shoppingOmittedIds,id])]:next.settings.shoppingOmittedIds.filter(x=>x!==id);},{invalidate:false}))));
  $('shopping-omitted-selections').replaceChildren(...omitted.map(id=>button(`${INGREDIENTS[id].name} ×`,()=>commit(next=>{next.settings.shoppingOmittedIds=next.settings.shoppingOmittedIds.filter(x=>x!==id);},{invalidate:false}))));
  const query=$('shopping-omit-search').value.trim(),options=$('shopping-omit-options');options.replaceChildren();if(!query)return;
  for(const id of Object.keys(INGREDIENTS).filter(id=>!omitted.includes(id)&&matchesJapaneseQuery([INGREDIENTS[id].name,id],query)).slice(0,20))options.append(button(`＋ ${INGREDIENTS[id].name}`,()=>commit(next=>{next.settings.shoppingOmittedIds.push(id);},{invalidate:false})));
}
function refreshShoppingAction(container, rows, action, id, fallback) {
  const list=$(container),previous=[...list.querySelectorAll(rows)];
  const index=previous.findIndex(row=>row.dataset.ingredientId===id||row.dataset.receiptId===id);
  renderShopping();
  const next=[...list.querySelectorAll(rows)];
  const target=next[Math.min(Math.max(index,0),next.length-1)]?.querySelector(action)??$(fallback);
  target.focus({preventScroll:true});
}
function renderShopping(){
  renderShoppingOmissions();
  const source=$('shopping-source').value,from=$('shopping-from').value||state.settings.startDate,to=safeShift(from,Number($('shopping-days').value)-1);
  const {menus,catalog,reviewCatalog}=shoppingMenuContext(state,data(),{source,from,to}),receipts=shoppingReceipts();
  $('shopping-status').textContent=source==='menu'?`メニューから選んだ料理 ${menus.length}品`:`${from}〜${to}・${menus.length}品`;
  $('shopping-from').closest('.field-pair').hidden=source==='menu';$('shopping-prev-range').parentElement.hidden=source==='menu';
  const common={catalog,data:data(),pantry:state.pantry,omittedIds:state.settings.shoppingOmittedIds,prepared:state.shoppingList,receipts,purchaseSettings:state.purchaseSettings,selection:shoppingSelection,
    onSelectionChange:next=>{shoppingSelection=next;},onOpenMenu:menu=>openSnapshot(menu.item),
    onPrepare:selections=>{if(!selections.length){tell('追加する食材を選んでください。');return false;}const okay=commit(next=>{next.shoppingReceipts=receipts;next.shoppingChecks=[];const merged=new Map((next.shoppingList??[]).map(m=>[m.id,m]));for(const menu of selections){const prior=merged.get(menu.id);merged.set(menu.id,{...menu,ingredientIds:[...new Set([...(prior?.ingredientIds??[]),...menu.ingredientIds])]});}next.shoppingList=[...merged.values()];},{invalidate:false,message:'選んだ食材をチェックリストへ追加しました。'});if(okay)setKitchenTab('checklist',{focus:true});return okay;},
    onPurchase:id=>{const receipt=createShoppingReceipt(state.shoppingList??[],id,data(),{pantry:state.pantry,omittedIds:state.settings.shoppingOmittedIds,receipts,catalog});if(!receipt)return false;const okay=commit(next=>{next.shoppingReceipts=[...receipts,receipt];next.shoppingChecks=[];},{invalidate:false,render:false});if(okay)refreshShoppingAction('shopping-list','.shopping-check-row','input[type=checkbox]',id,'shopping-add-more');return okay;},
    onRemoveIngredient:(id,menuIds)=>{
      const okay=commit(next=>{
        next.shoppingReceipts=receipts;next.shoppingChecks=[];
        next.shoppingList=removeShoppingIngredient(next.shoppingList,id,menuIds,receipts);
      },{invalidate:false,render:false,message:'今回の買い物リストから外しました。'});
      if(okay)refreshShoppingAction('shopping-list','.shopping-check-row','input[type=checkbox]',id,'shopping-add-more');
      return okay;
    },
    onUndoPurchase:id=>{const okay=commit(next=>{next.shoppingReceipts=receipts.filter(r=>r.id!==id);next.shoppingChecks=[];},{invalidate:false,render:false,message:'購入チェックを取り消しました。'});if(okay)refreshShoppingAction('shopping-purchased-list','.shopping-receipt-row','.shopping-undo-purchase',id,'kitchen-tab-purchased');return okay;},
    onPurchaseSettings:settings=>commit(next=>{next.purchaseSettings=settings;},{invalidate:false,message:'購入量と包装の設定を保存しました。'}),
    onRemoveExtra:id=>commit(next=>{next.shoppingExtras=next.shoppingExtras.filter(x=>x.id!==id);delete shoppingSelection[id];},{invalidate:false,message:'追加候補から外しました。'}),onError:message=>{if(message)tell(message,true);}};
  $('shopping-list').replaceChildren(mountShoppingWorkflow({...common,view:'checklist'}));
  $('shopping-review-list').replaceChildren(mountShoppingWorkflow({...common,menus,catalog:reviewCatalog,view:'review'}));
  $('shopping-purchased-list').replaceChildren(mountShoppingWorkflow({...common,view:'purchased'}));
  shoppingText=shoppingChecklistText(state.shoppingList,data(),{pantry:state.pantry,omittedIds:state.settings.shoppingOmittedIds,receipts,purchaseSettings:state.purchaseSettings,catalog});$('copy-shopping').disabled=!shoppingText;setKitchenTab(kitchenTab);
}
function queueShoppingItem(item,servings){
  if(item.batchId||item.restaurant||item.diningMatch)throw Error('作り置きと店で食べる料理は、材料の買い物に追加しません。');
  if(!item.ingredients.length)throw Error('この料理の材料は未登録です。材料を登録してから追加してください。');
  const exists=state.shoppingExtras.some(saved=>favouriteKey(saved.item)===favouriteKey(item)&&saved.item.quantity===item.quantity&&saved.servings===servings);
  if(!exists){if(!commit(next=>next.shoppingExtras.push({id:uid(),item:structuredClone(item),servings}),{invalidate:false,message:`${item.name}を買い物の確認欄に追加しました。必要な食材を選んでリストを作成してください。`}))return;}
  else tell('同じ量と人数の料理は買い物の確認欄に追加済みです。');
  $('shopping-source').value='menu';renderShopping();setKitchenTab('menus');$('recipe-dialog').close();activateTab('kitchen',{focus:true});
}
function shoppingAction(getItem){
  const box=node('div','menu-shopping-action'),label=node('label','','買い物の人数'),select=node('select');select.setAttribute('aria-label','この料理を買い物に追加する人数');selectOptions(select,Array.from({length:8},(_,i)=>[String(i+1),`${i+1}人分`]),String(state.settings.servings));label.append(select);
  const add=button('食材を買い物に追加',()=>{const item=getItem();if(!item)throw Error('先に料理と量を確認してください。');queueShoppingItem(item,Number(select.value));},'button-secondary');box.append(label,add);return box;
}
function openShoppingRegistration(item){
  $('dialog-title').textContent='買い物に追加';$('dialog-meta').textContent=item.name;const box=$('dialog-content');box.replaceChildren(node('p','field-note',`保存した料理の量：${portionLabel(item,data())}。この量に下の人数を掛けて材料を用意します。`),shoppingAction(()=>item),snapshotDetails(item,{showNutritionBasis:true}));if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function removeCatalogFavourite(id){
  const container=$('catalog-favourites');
  const position=Array.from(container.querySelectorAll('.catalog-favourite-remove')).indexOf(document.activeElement);
  const removed=commit(next=>{next.favourites=next.favourites.filter(favourite=>favourite.id!==id);},{invalidate:false,message:'お気に入りから外しました。'});
  if(removed&&position>=0){
    const remaining=container.querySelectorAll('.catalog-favourite-open');
    const target=remaining[Math.min(position,remaining.length-1)]??(state.favourites.length?container.querySelector('.catalog-favourites-search'):$('catalog-favourites-panel').querySelector('summary'));
    target?.focus();
  }
}
let catalogFavouriteFilters={};
function renderCatalog(){
  $('catalog-favourites').replaceChildren(mountCatalogFavourites({favourites:state.favourites,data:data(),settings:state.settings,viewState:catalogFavouriteFilters,onOpen:item=>openSnapshot(item),onAddShopping:item=>openShoppingRegistration(item),onDelete:removeCatalogFavourite,onError:message=>tell(message,true)}));
  $('catalog-count').textContent=String(groupMenuRecipes(data().recipes).length);
  $('catalog-variant-count').textContent=`${data().recipes.length}種類の内訳を収録`;
  for(const b of $('role-filters').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.role===roleFilter));
  const query=$('recipe-search').value.trim();
  const catalogData=data(),constraints=state.settings.allergens.length>0||state.settings.excludedIngredients.length>0;
  const available=searchableRecipes(catalogData,true);
  const nature=$('recipe-nature').value,genre=$('recipe-genre').value;
  const eveningOnly=$('recipe-evening-only').checked;
  const all=available.filter(r=>(!eveningOnly||isBanshakuDish(r))&&(nature==='all'||recipeNature(r)===nature)&&(genre==='all'||r.genre===genre));
  const hierarchical=['all','main','side'].includes(roleFilter);
  $('recipe-family-field').hidden=hierarchical;$('recipe-food-category-field').hidden=!hierarchical;$('recipe-method-field').hidden=!hierarchical;
  let candidates,variationScope;
  if(hierarchical){
    const matching=browseDishes(all,{section:roleFilter,query});
    const category=chooseFacet('recipe-food-category',availableDishCategories(matching),'すべての食材');
    const method=chooseFacet('recipe-method',availableCookingMethods(matching,{category}),'すべての調理法');
    candidates=browseDishes(matching,{category,method});
    variationScope=query?browseDishes(all,{section:roleFilter,category,method}):candidates;
  }else{
    const families=catalogFamilies(all,{role:roleFilter,query});
    const family=chooseFacet('recipe-family',families,'すべての種類');
    candidates=family==='all'?browseDishes(all,{section:roleFilter,query}):catalogVariants(all,family,{query});
    variationScope=family==='all'?browseDishes(all,{section:roleFilter}):catalogVariants(all,family);
  }
  $('catalog-safety-note').textContent=constraints?'アレルギーなどの除外条件があるため、原材料未確認の市販品は一覧に表示していません。食べたものは記録タブから登録できます。':'市販品は代表的な栄養の目安です。原材料未確認のメニューも記録できますが、自動提案の対象にはしません。商品の表示を優先してください。';
  const illustrationsHidden=state.settings.hideRecipeIllustrations,illustrationFilter=$('recipe-illustrated-only');
  illustrationFilter.disabled=illustrationsHidden;
  if(illustrationsHidden)illustrationFilter.checked=false;
  $('recipe-illustration-coverage').hidden=illustrationsHidden;
  const illustratedOnly=illustrationFilter.checked;
  const hiddenIllustrations=illustratedOnly?candidates.filter(recipe=>!recipeArtwork(recipe)).length:0;
  if(illustratedOnly)candidates=candidates.filter(recipe=>recipeArtwork(recipe));
  const illustrationFilterNote=$('recipe-illustration-filter-note');
  illustrationFilterNote.hidden=!illustratedOnly&&!illustrationsHidden;
  illustrationFilterNote.replaceChildren();
  if(illustrationsHidden)illustrationFilterNote.append(node('span','','設定で料理イラストを非表示にしています。すべての料理を検索できます。'));
  if(illustratedOnly)illustrationFilterNote.append(node('span','',hiddenIllustrations?`イラスト限定中です。画像のない${hiddenIllustrations}種類は表示していません。`:'イラストのある料理に絞っています。'),button('イラスト限定を解除',()=>{$('recipe-illustrated-only').checked=false;recipeLimit=12;renderCatalog();},'button-secondary'));
  const menus=groupMenuRecipes(candidates,{allRecipes:variationScope,query});
  $('recipe-results-count').textContent=`${menus.length}件のメニュー / ${candidates.length}種類が見つかりました`;
  const activeFilters=[];
  const removable=(id,label,remove)=>activeFilters.push({id,label,onRemove:()=>{remove();recipeLimit=12;renderCatalog();}});
  if(query)removable('query',`検索：${query}`,()=>$('recipe-search').value='');
  if(roleFilter!=='all')removable('section',`区分：${ROLES[roleFilter]??roleFilter}`,()=>{roleFilter='all';$('recipe-family').value='all';$('recipe-food-category').value='all';$('recipe-method').value='all';});
  for(const [id,key,label,field]of [['category','recipe-food-category','食材','recipe-food-category-field'],['method','recipe-method','調理法','recipe-method-field'],['family','recipe-family','種類','recipe-family-field'],['genre','recipe-genre','ジャンル',null],['nature','recipe-nature','形態',null]]){
    const element=$(key);if((field&&$(field).hidden)||element.value==='all')continue;
    const selected=element.selectedOptions[0]?.textContent.replace(/（[0-9]+）$/,'')??element.value;
    removable(id,`${label}：${selected}`,()=>{element.value='all';if(id==='category')$('recipe-method').value='all';});
  }
  if(eveningOnly)removable('evening','晩酌のおかず',()=>$('recipe-evening-only').checked=false);
  if(illustratedOnly)removable('illustrated','完成イラスト付き',()=>illustrationFilter.checked=false);
  const protectedLabels=[...state.settings.allergens.map(id=>`アレルギー：${ALLERGENS.find(item=>item.id===id)?.label??id}`),...state.settings.excludedIngredients.map(id=>`避ける食材：${INGREDIENTS[id]?.name??id}`)];
  $('catalog-active-filters').replaceChildren(renderCatalogFilters({filters:activeFilters,protectedLabels,resultCount:menus.length,onClear:()=>{
    roleFilter='all';$('recipe-search').value='';for(const id of ['recipe-food-category','recipe-method','recipe-family','recipe-genre','recipe-nature'])$(id).value='all';illustrationFilter.checked=false;$('recipe-evening-only').checked=false;recipeLimit=12;renderCatalog();
  }}));
  const grid=$('recipe-grid');grid.replaceChildren();
  for(const menu of menus.slice(0,recipeLimit)){
    const r=menu.recipe,customiser=dishCustomiserFor(r.id),foodComposer=foodComposerFor(r.id),meatChoice=meatChoiceFor(r.id),noodle=noodleComposerFor(r.id),curry=curryRiceFor(r.id,data());
    const card=button('',()=>openRecipe(menu.selectedRecipeId,{variationRecipes:variationScope,query}),'recipe-card');
    const heading=node('div','recipe-card-heading'),titles=node('div','recipe-card-titles');
    titles.append(node('span','recipe-meta',`${familyLabel(r)} / ${r.genre}`),node('h3','',menu.label));heading.append(titles);
    const artwork=recipeIllustrationElement(all.find(recipe=>recipe.id===menu.selectedRecipeId),{hidden:illustrationsHidden});
    if(artwork){card.classList.add('has-recipe-art');card.append(artwork);}card.append(heading);
    if(noodle){
      card.append(node('p','',noodle.soup.length?'トッピングと飲んだスープの量を選べます':'麺の量とトッピングを選べます'),node('span','food-customisation',noodle.soup.length?'麺・具・スープを分けて栄養を計算':'麺・たれ・具の栄養を合計'));
    }else if(curry){
      card.append(node('p','','ご飯の量を0gから指定できます'),node('span','food-customisation','ルーのみ・ナンとの組み合わせにも'));
    }else if(foodComposer){
      card.append(node('p','',foodComposer.description??'種類と量を自由に組み合わせる'),node('span','food-customisation','組み合わせる · 栄養と材料を自動計算'));
    }else if(customiser){
      card.append(node('p','',customiser.kind==='nikujaga'?'牛肉・豚肉を選べます':'種類と具材を選べます'),node('span','food-customisation','材料・栄養・作り方が切り替わります'));
    }else if(meatChoice){
      card.append(node('p','','お肉の種類を選べます'),node('span','food-customisation','選んだお肉で材料と栄養を計算'));
    }else if(menu.isGroup){
      const total=getVariationGroup(menu.selectedRecipeId,variationScope)?.recipes.length??menu.variantCount;
      card.append(node('p','',`${total}種類から選択${query&&total>menu.variantCount?`（検索一致 ${menu.variantCount}種類）`:''}`),node('small','',menu.recipes.slice(0,3).map(variantLabel).join(' / ')+(menu.recipes.length>3?' ほか':'')));
    }else{
      card.append(node('p','',`${natureLabel(r)}${r.custom?' · 自分のメニュー':recipeNature(r)==='home-cooked'?` · ${r.minutes}分`:''}`));
      const n=recipeNutrition(r,data());card.append(node('small','',n.kcal===null?'エネルギー未入力':`${fmt(n.kcal,0)} kcal / ${amount(recipePortion(r,data()).amount,recipePortion(r,data()).unit)}`));
    }
    if(r.id==='familiar-side-raw-vegetable')card.append(node('span','food-customisation','材料とドレッシングを選べます'));
    if(r.allergensKnown===false)card.append(node('span','food-confirmation','商品・原材料を確認'));
    card.append(nutritionBasisBadge(r,catalogData));
    if(!isComposableRecipe(r.id)){const wrapper=node('div','menu-card-entry');wrapper.append(card,favouriteAction(()=>snapshot(r.id)));grid.append(wrapper);}else grid.append(card);
  }
  if(!menus.length)grid.append(node('p','empty-note',hiddenIllustrations?'イラスト付きの候補がありません。「イラスト限定を解除」で画像のない料理も表示できます。':'条件に合うメニューがありません。検索や避ける食材の設定を確認してください。'));
  $('more-recipes').hidden=menus.length<=recipeLimit;
  $('custom-catalog-list').replaceChildren();if(!state.customRecipes.length)$('custom-catalog-list').append(node('p','field-note','「オリジナルレシピを作る」から材料を選んで保存できます。既存の料理をアレンジして保存することもできます。'));
  for(const r of state.customRecipes){const row=node('div','custom-recipe-row');row.append(button(r.name,()=>openRecipe(r.id)),node('small','',r.allergensKnown?'アレルギー情報を確認済み':'アレルギー情報は未確認'),button('削除',()=>{if(!confirm(`「${r.name}」を自分のデータベースから削除しますか？記録済みの食事は残ります。`))return;commit(next=>{next.customRecipes=next.customRecipes.filter(c=>c.id!==r.id);if(next.settings.stapleId===r.id){next.settings.stapleId='auto';next.settings.stapleMode='adaptive';next.settings.stapleAmount=null;}if(next.settings.drinkId===r.id)next.settings.drinkId='none';reconcileMealSelections(next,[...RECIPES,...next.customRecipes]);},{message:'メニューを削除しました。過去の記録は残しています。'});}));if(r.restaurant)row.append(button('表示値・提供量を編集',()=>openRestaurantRegistration(null,{editingRecipe:r})));$('custom-catalog-list').append(row);}
}
/** 元の肉が除外されても、条件に合う別の具材があれば料理の入口を残します。 */
function menuSearchAliases(recipe,respectConditions,catalogData){
  const aliases=[...(recipe.searchAliases??[]),...variationSearchAliases(recipe)],definition=dishCustomiserFor(recipe.id);
  if(isBanshakuDish(recipe))aliases.push('晩酌','ばんしゃく','居酒屋','いざかや','おつまみ');
  if(recipe.id==='mapo-tofu-chen-style')aliases.push(...MAPO_SEARCH_ALIASES);
  const noodle=noodleComposerFor(recipe.id);if(noodle)aliases.push(noodle.label,...NOODLE_TOPPINGS.map(topping=>topping.label));
  const composer=foodComposerFor(recipe.id);
  if(composer){aliases.push(composer.label);if(recipe.id.startsWith('palette-')&&composer.recipeIds.length===1)for(const part of composer.components)aliases.push(part.label,`${part.label}${composer.label}`,`${composer.label}${part.label}`);}
  if(meatChoiceFor(recipe.id))for(const choice of eligibleMeatSelections(recipe.id,respectConditions?state.settings:{allergens:[],excludedIngredients:[]},catalogData))aliases.push(choice.recipe.name);
  if(!definition)return aliases;
  const settings=respectConditions?state.settings:{allergens:[],excludedIngredients:[]};
  for(const choice of eligibleDishSelections(definition.kind,settings,catalogData)){
    aliases.push(choice.recipe.name);
    if(definition.kind==='nikujaga')aliases.push(`${choice.config.meat==='pork'?'豚肉':'牛肉'}の肉じゃが`);
    const preset=definition.presets?.find(item=>item.id===choice.config.presetId);if(preset)aliases.push(preset.label);
  }
  return [...new Set(aliases)];
}
function menuCandidates(catalogData){
  const constraints=state.settings.allergens.length||state.settings.excludedIngredients.length;
  if(!constraints)return catalogData.recipes.map(r=>describeRecipe(r.id,catalogData));
  const allowed=new Map(eligibleRecipes(state.settings,catalogData).map(recipe=>[recipe.id,recipe]));
  for(const definition of DISH_CUSTOMISERS){
    const option=eligibleDishSelections(definition.kind,state.settings,catalogData)[0];
    for(const id of definition.recipeIds){
      const base=catalogData.recipes.find(recipe=>recipe.id===id);
      if(!base)continue;
      if(!option){allowed.delete(id);continue;}
      const r=option.recipe;
      allowed.set(id,{...base,servings:r.servings,portion:r.portion,ingredients:r.ingredients,manualNutrition:r.manualNutrition,
        allergens:r.allergens,allergensKnown:r.allergensKnown,ingredientsKnown:r.ingredientsKnown,groups:r.groups,proteinSources:r.proteinSources});
    }
  }
  for(const base of catalogData.recipes.filter(recipe=>meatChoiceFor(recipe.id))){
    const option=eligibleMeatSelections(base.id,state.settings,catalogData)[0];
    if(!option){allowed.delete(base.id);continue;}
    const r=option.recipe;
    allowed.set(base.id,{...base,name:r.name,servings:r.servings,portion:r.portion,ingredients:r.ingredients,manualNutrition:r.manualNutrition,
      allergens:r.allergens,allergensKnown:r.allergensKnown,ingredientsKnown:r.ingredientsKnown,groups:r.groups,proteinSources:r.proteinSources});
  }
  for(const base of catalogData.recipes){
    const noodle=noodleComposerFor(base.id),curry=curryRiceFor(base.id,catalogData);
    if(!noodle&&!curry)continue;
    const choices=noodle?eligibleNoodleSelections(base.id,state.settings,catalogData):eligibleCurryRiceSelections(base.id,state.settings,catalogData);
    if(!choices.length){allowed.delete(base.id);continue;}
    const r=choices[0].recipe;
    allowed.set(base.id,{...base,ingredients:r.ingredients,manualNutrition:r.manualNutrition,servings:r.servings,portion:r.portion,
      allergens:r.allergens,allergensKnown:r.allergensKnown,ingredientsKnown:r.ingredientsKnown,groups:r.groups,proteinSources:r.proteinSources});
  }
  // 特定の魚や肉の名を別の具へ置き換えず、汎用の組立て入口だけを残します。
  const anchors=new Set(['palette-oden','familiar-side-pot-au-feu','palette-bagel','palette-waffle','palette-muffin','palette-english-muffin','palette-sandwich','bread-hot-sandwich-custom','bread-toast-custom','classic-sushi-assorted','classic-sashimi-assorted','familiar-tempura-assorted']);
  for(const definition of FOOD_COMPOSERS){
    const choice=eligibleFoodSelection(definition.kind,state.settings,catalogData);
    for(const id of definition.recipeIds.filter(id=>anchors.has(id))){
      const base=catalogData.recipes.find(recipe=>recipe.id===id);
      if(!base)continue;
      if(!choice){allowed.delete(id);continue;}
      const r=choice.recipe;
      allowed.set(id,{...base,servings:r.servings,portion:r.portion,ingredients:r.ingredients,manualNutrition:r.manualNutrition,
        allergens:r.allergens,allergensKnown:r.allergensKnown,ingredientsKnown:r.ingredientsKnown,groups:r.groups,proteinSources:r.proteinSources});
    }
  }
  return catalogData.recipes.flatMap(recipe=>allowed.has(recipe.id)?[allowed.get(recipe.id)]:[]);
}
function dishCustomiserFor(id){return DISH_CUSTOMISERS.find(definition=>definition.recipeIds.includes(id));}
function isComposableRecipe(id){return id==='familiar-side-raw-vegetable'||!!dishCustomiserFor(id)||!!foodComposerFor(id)||!!meatChoiceFor(id)||!!noodleComposerFor(id)||!!curryRiceFor(id,data());}
function recordPickerRecipeId(){return $('catalog-variant').value||$('catalog-item').value;}
function arrangementAction(getBase,{respectConditions=true}={}){
  return button('材料を編集・追加してアレンジ',()=>{
    const base=getBase();if(!base)throw Error('先に料理の材料と量を確認してください。');
    openRecipeArrangement(base,{respectConditions});
  },'button-secondary arrangement-open');
}
function openRecipeArrangement(baseRecipe=null,{respectConditions=false}={}){
  const box=$('dialog-content');box.replaceChildren();
  $('dialog-title').textContent=baseRecipe?'材料を編集・追加してアレンジ':'オリジナルレシピを作る';
  $('dialog-meta').textContent='1人分の材料から栄養を概算';
  let currentRecipe=null;
  const form=catalogRecordForm(null,{getCustomRecipe:()=>currentRecipe,saveLabelText:'このレシピをマイメニューにも保存'});
  const saveOnly=button('レシピだけ保存',()=>{
    if(!currentRecipe)throw Error('料理名と材料の量を確認してください。');
    commit(next=>next.customRecipes.push(currentRecipe),{message:'マイメニューに保存しました。メニュー一覧から選べます。'});
    $('recipe-dialog').close();
  },'button-primary');saveOnly.disabled=true;
  const saveArea=node('div','arrangement-save-area');saveArea.append(saveOnly,node('p','field-note','食事を記録せず、このブラウザーのマイメニューに保存します。'));
  const constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const notice=node('p','notice error');notice.hidden=true;
  const builder=mountRecipeArrangement({baseRecipe,data:data(),onChange:recipe=>{
    if(recipe){const baseKind=baseRecipe?deriveRecipeBasis(baseRecipe,data()):'ingredients';recipe.nutritionBasis=['official','mixed'].includes(baseKind)?'mixed':['manual','estimate'].includes(baseKind)?'estimate':deriveRecipeBasis(recipe,data());}
    const allowed=!recipe||!constraints||eligibleRecipes(state.settings,{...data(),recipes:[recipe]}).length>0;
    currentRecipe=allowed?recipe:null;notice.hidden=allowed;
    notice.textContent=allowed?'':'避ける食材の設定に合わないか、原材料が未確認です。追加する食材を変更してください。実際に食べた内容は「記録」タブから残せます。';
    saveOnly.disabled=!currentRecipe;form.querySelector('button[type="submit"]').disabled=!currentRecipe;
  },onError:()=>{}});
  box.append(builder,notice,saveArea,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function openDrinkLog(){
  const catalog=data(), drinks=catalog.recipes.filter(recipe=>recipeFamily(recipe)==='alcohol');
  const dialog=$('recipe-dialog'), body=$('dialog-content');
  $('dialog-title').textContent='晩酌の飲み物を記録';
  $('dialog-meta').textContent='飲んだ分を夕食の栄養に加えます。';
  const form=node('form','catalog-record-form'), drink=node('select'), date=node('input'), qty=node('input');
  const field=(title,input)=>{const label=node('label','',title);label.append(input);return label;};
  drink.id='drink-log-choice';
  selectOptions(drink,[['','飲み物を選ぶ'],...drinks.map(recipe=>[recipe.id,recipe.name])],'');
  drink.required=true;date.id='drink-log-date';date.type='date';date.value=selectedDate;date.min='2000-01-01';date.max='2100-12-31';date.required=true;
  qty.id='drink-log-amount';qty.type='number';qty.min='0.001';qty.max=100000;qty.step='any';qty.required=true;qty.disabled=true;
  configureQuantityInput(qty);
  const amountField=field('飲んだ量',qty), unit=node('span','unit-label'), note=node('p','field-note');
  amountField.append(unit);
  const getEntry=()=>createCatalogEntry({recipeId:drink.value,date:date.value,meal:'dinner',status:'eaten',amount:readQuantityInput(qty)},catalog);
  const summary=createRecordSummary({data:catalog,getEntry});
  const save=node('button','button-primary','夕食に飲んだ量を記録');save.type='submit';save.disabled=true;
  drink.addEventListener('change',()=>{
    const recipe=drinks.find(item=>item.id===drink.value),portion=recipe?recipePortion(recipe,catalog):null;
    qty.disabled=!portion;qty.value='';unit.textContent=portion?.unit??'';note.textContent=portion?.label??'';
    qty.setAttribute('aria-label',portion?'飲んだ量（'+portion.unit+'）':'飲んだ量');
    save.disabled=!portion;quantityPresets(qty,recipe,portion??{unit:'',amount:0});summary.refresh();
  });
  form.addEventListener('input',()=>summary.refresh());
  form.addEventListener('submit',guard(event=>{
    event.preventDefault();
    const entry=getEntry();
    if(!commit(next=>next.entries.push(entry),{invalidate:false,message:'飲んだ量を夕食に記録しました。'}))return;
    $('calendar-meal').value='dinner';$('calendar-status').value='eaten';setDate(entry.date);
    dialog.close();activateTab('record',{focus:true});
  }));
  form.append(field('飲み物',drink),field('飲んだ日',date),amountField,note,summary.element,save);
  body.replaceChildren(form);if(!dialog.open)dialog.showModal();
}
function openDiningLog({date=selectedDate,meal='lunch',editEntry=null,replaceEntry=null}={}){
  const dialog=$('recipe-dialog'),previous=editEntry??replaceEntry;
  $('dialog-title').textContent=editEntry?'外食の料理や量を変更':replaceEntry?'この予定を外食に変更':'外食を料理から記録';
  $('dialog-meta').textContent=replaceEntry?dateLabel(date)+'の'+MEALS[meal]+'の予定を、実際に食べた内容に更新します。':'';
  $('dialog-content').replaceChildren(mountDiningLog({data:data(),entries:state.entries,date,meal,initialEntry:editEntry,onSave:entry=>{
    const saved=commit(next=>{
      if(!previous){next.entries.push(entry);return;}
      const index=next.entries.findIndex(old=>old.id===previous.id);
      if(index<0)throw Error('変更する食事が見つかりません。');
      next.entries[index]={...entry,id:previous.id};
    },{invalidate:false,message:dateLabel(entry.date)+'の'+MEALS[entry.meal]+'を食事記録と栄養に反映しました。'});
    if(!saved)return false;
    $('calendar-meal').value=entry.meal;
    $('calendar-status').value='eaten';
    setDate(entry.date);
    dialog.close();
    activateTab('record',{focus:true});
    return true;
  }}));
  if(!dialog.open)dialog.showModal();
  if(!editEntry)$('dining-search')?.focus();
}
function openDinnerFromRecord(){
  const date=selectedDate,dialog=$('recipe-dialog'),catalog=data();
  const {earlier,proposal,day,inDraft}=previewRecordedDinner(state,date,plan,catalog,Math.floor(Math.random()*2147483647));
  const items=activeRecipeIds(day).map(id=>snapshot(id,day.quantities?.[id]??1));
  const box=$('dialog-content'),list=node('ul','ingredient-list'),reasons=node('details','plan-reasons');
  $('dialog-title').textContent=dateLabel(date)+'の夕食案';
  $('dialog-meta').textContent='朝食・昼食の実績を使った献立';
  const previous=node('p','field-note',earlier.map(entry=>MEALS[entry.meal]+'：'+entry.items.map(item=>item.name).join('・')).join(' ／ '));
  const actual=sumNutrition(earlier.flatMap(entry=>entry.items));
  const intake=['kcal','protein','fiber','salt'].map(key=>{
    const amount=actual.knownCounts[key]?`${formatNutrient(actual.values[key],key)} ${NUTRIENT_UNITS[key]}${actual.complete[key]?'':'＋不明分'}`:'不明';
    return (key==='kcal'?'':NUTRIENT_LABELS[key]+' ')+amount;
  }).join(' ／ ');
  for(const item of items)list.append(node('li','',item.name+'　'+portionLabel(item,catalog)));
  reasons.append(node('summary','','この献立を選んだ理由'));
  for(const reason of [...day.reasons,...(day.warnings??[])])reasons.append(node('p','field-note',reason));
  const actions=node('div','dinner-preview-actions');
  box.replaceChildren(previous,node('p','field-note','記録した分の合計　'+intake),list,reasons);
  const planned=state.entries.filter(entry=>entry.date===date&&entry.meal==='dinner'&&entry.status==='planned');
  if(inDraft||!plan?.ok){
    actions.append(button(inDraft?'この日の夕食案に反映':'献立でこの夕食を調整',()=>{
      visiblePlanDate=date;
      applyEditedPlan(proposal,'食事記録を参考にした夕食案を開きました。',{newDraft:!inDraft});
      dialog.close();activateTab('planner');$('plan-result-title').focus();$('plan-result-title').scrollIntoView({block:'start'});
    },'button-secondary'));
  }
  const target=node('select');
  if(planned.length){
    const label=node('label','','入れ替える夕食予定');
    const choices=planned.map(entry=>[entry.id,entry.items.map(item=>item.name).join('・')||entry.note]);
    selectOptions(target,planned.length===1?choices:[['','予定を選ぶ'],...choices],planned.length===1?planned[0].id:'');
    label.append(target);box.append(label);
  }
  actions.append(button(planned.length?'選んだ夕食予定を入れ替える':'この夕食を予定に追加',()=>{
    const prior=planned.find(entry=>entry.id===target.value);
    if(planned.length&&!prior)throw Error('入れ替える夕食予定を選んでください。');
    const saved=commit(next=>{
      if(prior){
        const entry=next.entries.find(old=>old.id===prior.id);
        if(!entry||entry.status!=='planned')throw Error('夕食予定が変わりました。記録を開き直してください。');
        entry.items=items.map(item=>({...item,id:entry.items.find(old=>old.recipeId===item.recipeId)?.id??item.id}));
      }else next.entries.push({id:uid(),date,meal:'dinner',status:'planned',note:'',items});
    },{invalidate:false,message:'夕食の予定を保存しました。'});
    if(saved){dialog.close();setDate(date);}
  },'button-primary'));
  box.append(actions);
  if(!dialog.open)dialog.showModal();
}
function openRestaurantRegistration(baseRecipe=null,{editingRecipe=null}={}){
  const box=$('dialog-content');box.replaceChildren();
  $('dialog-title').textContent='店別・サイズ別メニューを登録';
  $('dialog-meta').textContent='公式の表示値と提供量を記録';
  let currentRecipe=null;
  const form=catalogRecordForm(null,{getCustomRecipe:()=>currentRecipe,saveLabelText:'この店・サイズをマイメニューにも保存'});
  const saveOnly=button('メニューだけ保存',()=>{
    if(!currentRecipe)throw Error('店名・提供量・栄養値を確認してください。');
    commit(next=>{const index=next.customRecipes.findIndex(r=>r.id===currentRecipe.id);if(index<0)next.customRecipes.push(currentRecipe);else next.customRecipes[index]=currentRecipe;},{message:'店別・サイズ別メニューを保存しました。過去の記録はそのままです。'});$('recipe-dialog').close();
  },'button-primary');saveOnly.disabled=true;
  const builder=mountRestaurantMenu({baseRecipe,data:data(),recipe:editingRecipe,onChange:recipe=>{
    currentRecipe=recipe;saveOnly.disabled=!recipe;form.querySelector('button[type="submit"]').disabled=!recipe;
    if(recipe){const p=recipePortion(recipe,data()),qty=form.querySelector('#menu-entry-amount');qty.value=p.amount;qty.dataset.unit=p.unit;qty.dataset.edited='false';qty.closest('label').firstChild.textContent=`量（${p.unit}）`;}
  },onError:()=>{}});
  box.append(builder,saveOnly,form);if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function restaurantVariantLinks(recipeId){
  const box=node('div','restaurant-variant-links'),variants=restaurantVariantsFor(recipeId,data().recipes);
  if(variants.length){box.append(node('h3','','登録した店・サイズ'));for(const variant of variants)box.append(button(`${variant.restaurant.storeName} · ${variant.restaurant.sizeName}`,()=>openRecipe(variant.id,{respectConditions:false})))}
  return box;
}
function renderRecordTools(){
  const simple=state.settings.recordView==='simple';
  $('quick-record-tools').hidden=!simple;$('detailed-record-tools').hidden=simple;
  for(const mode of ['simple','detailed'])$('record-view-'+mode).setAttribute('aria-pressed',String(state.settings.recordView===mode));
  $('quick-record-tools').replaceChildren(mountQuickRecord({data:data(),settings:state.settings,entries:state.entries,favourites:state.favourites,date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,
    onContextChange:context=>{selectedDate=context.date;month=context.date.slice(0,7);$('calendar-date').value=context.date;$('nutrition-date').value=context.date;$('calendar-meal').value=context.meal;$('calendar-status').value=context.status;renderDinnerLink();renderNutrition();renderReset();recordPickerSummary?.refresh();},
    onOpenRecipe:(id,context)=>openRecipe(id,{respectConditions:false,recordInitial:context}),
    onAddEntry:entry=>addQuickEntry(entry),onOpenItem:item=>openSnapshot(item),onError:message=>tell(message,true)}));
  const sets=$('meal-sets-tools'),batches=$('batch-cooking-tools');
  $('favourites-tools')?.replaceChildren(mountFavourites({favourites:state.favourites,entries:state.entries,data:data(),settings:state.settings,date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,
    onAdd:entry=>addQuickEntry(entry),onSave:favourite=>saveFavourite(favourite.item),onDelete:id=>commit(next=>{next.favourites=next.favourites.filter(saved=>saved.id!==id);},{invalidate:false,message:'お気に入りから外しました。'}),onError:message=>tell(message,true)}));
  $('text-log-tools')?.replaceChildren(mountTextLog({data:data(),settings:state.settings,date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,
    canConfigure:recipeId=>canConfigureTextRecipe(recipeId,data()),onConfigure:openTextRecipeConfiguration,
    onAdd:entry=>addQuickEntry(entry,'文章で選んだ料理をまとめて記録しました。'),onError:message=>tell(message,true)}));
  if(sets)sets.replaceChildren(mountMealSets({state,data:data(),date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,
    onSave:set=>commit(next=>next.mealSets.push(set),{message:'定番セットを保存しました。'}),
    onDelete:id=>commit(next=>{next.mealSets=next.mealSets.filter(s=>s.id!==id);},{message:'定番セットを削除しました。食事の記録は残ります。'}),
    onAdd:entry=>addQuickEntry(entry,'食事をコピーして記録しました。'),onError:message=>tell(message,true)}));
  if(batches)batches.replaceChildren(mountBatchCooking({batches:state.batches,entries:state.entries,data:data(),selectedDate,
    onCreate:batch=>commit(next=>next.batches.push(batch),{message:'作り置きを登録しました。食べた量をgで記録できます。'}),
    onRecord:entry=>addQuickEntry(entry,'作り置きから取り分けた量を記録しました。'),
    onArchive:id=>commit(next=>{next.batches.find(b=>b.id===id).archived=true;},{message:'作り置きを一覧から片付けました。過去の記録は残ります。'}),onError:message=>tell(message,true)}));
}
/** 文章の下書きへ内訳を返し、一括登録するまでは記録を保存しません。 */
function openTextRecipeConfiguration({recipeId,initialRecipe,onConfirm}){
  if(typeof onConfirm!=='function'||!canConfigureTextRecipe(recipeId,data()))throw Error('内訳を選べる料理を選んでください。');
  const box=$('dialog-content');box.replaceChildren();
  $('dialog-title').textContent='文章の料理の内訳を選ぶ';
  $('dialog-meta').textContent='具材と数量を選び、この行へ反映';
  let currentRecipe=null;
  const confirm=button('この行に反映',()=>{
    if(!currentRecipe)throw Error('具材と量を確認してください。');
    if(onConfirm(currentRecipe)!==false)$('recipe-dialog').close();
  },'button-primary');confirm.disabled=true;
  const notice=node('p','notice error');notice.hidden=true;
  const builder=mountTextRecipeConfigurator({recipeId,data:data(),initialRecipe,
    onChange:recipe=>{currentRecipe=recipe;confirm.disabled=!recipe;},
    onError:message=>{notice.textContent=message;notice.hidden=!message;}});
  box.append(node('p','field-note','ここでは1皿・1組分の内訳を選びます。食べた全体量と記録する日は元の行で確認し、一括登録します。'),builder,notice,confirm);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function openRecipe(id,{variationRecipes=null,respectConditions=true,query='',recordInitial={}}={}){
  if(noodleComposerFor(id)){openMealComposer(id,{type:'noodle',respectConditions,recordInitial});return;}
  if(curryRiceFor(id,data())){openMealComposer(id,{type:'curry',respectConditions,recordInitial});return;}
  if(foodComposerFor(id)){openFoodComposer(id,{respectConditions,recordInitial,variationRecipes});return;}
  if(id==='familiar-side-raw-vegetable'){openSaladComposer(id,{recordInitial});return;}
  if(dishCustomiserFor(id)){openDishComposer(id,{respectConditions,query,recordInitial});return;}
  if(meatChoiceFor(id)){openMeatComposer(id,{respectConditions,recordInitial});return;}
  const catalogData=data(),constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const scope=variationRecipes??(constraints?eligibleRecipes(state.settings,catalogData):catalogData.recipes);
  const group=getVariationGroup(id,scope);
  if(group&&group.recipes.length>1){openVariationRecipe(id,group,{respectConditions,recordInitial});return;}
  const r=describeRecipe(id,catalogData);if(!r)throw Error('このレシピは見つかりませんでした。');
  openSnapshot(snapshot(id),r.custom?undefined:r.minutes,id,{respectConditions,recordInitial});
}
/** 麺やカレーの1皿を組み立て、食べた栄養と準備する材料を記録します。 */
function openMealComposer(recipeId,{type,respectConditions=true,recordInitial={}}={}){
  const box=$('dialog-content');box.replaceChildren();
  $('dialog-title').textContent=recipeById(recipeId).name;
  $('dialog-meta').textContent=type==='curry'?'カレー1人分とご飯の量':noodleComposerFor(recipeId).soup.length?'麺・トッピング・飲んだスープ量':'麺の量とトッピング';
  const constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const settings=constraints?state.settings:{allergens:[],excludedIngredients:[]};
  const choices=type==='curry'?eligibleCurryRiceSelections(recipeId,settings,data()):eligibleNoodleSelections(recipeId,settings,data());
  if(!choices.length)throw Error('現在の除外条件に合う組み合わせがありません。');
  const standard=type==='curry'?defaultCurryRiceSelection(recipeId,data()):defaultNoodleSelection(recipeId);
  const initial=choices.find(choice=>JSON.stringify(choice.config)===JSON.stringify(standard))?.config??choices[0].config;
  const scope=constraints?menuCandidates(data()):data().recipes,group=getVariationGroup(recipeId,scope);
  if(group&&group.recipes.length>1){
    const label=node('label','detail-variation-label','料理の種類'),select=node('select');select.id='meal-detail-variant';label.htmlFor=select.id;
    selectOptions(select,group.recipes.map(r=>[r.id,variantLabel(r)]),recipeId);
    select.addEventListener('change',guard(()=>{
      const qty=box.querySelector('#menu-entry-amount');
      const initial={date:box.querySelector('#menu-entry-date')?.value,meal:box.querySelector('#menu-entry-meal')?.value,status:box.querySelector('#menu-entry-status')?.value,amount:qty?.value,unit:qty?.dataset.unit,edited:qty?.dataset.edited==='true'};
      openRecipe(select.value,{respectConditions,variationRecipes:scope,recordInitial:initial});
    }));label.append(select);box.append(label);
  }
  let currentRecipe=null;
  const form=catalogRecordForm(recipeId,{getCustomRecipe:()=>currentRecipe,initial:recordInitial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions});arrange.disabled=true;
  const notice=node('p','notice error');notice.hidden=true;
  const onChange=recipe=>{
    if(recipe){const baseKind=deriveRecipeBasis(recipeById(recipeId),data());recipe.nutritionBasis=type==='noodle'||baseKind==='estimate'?'estimate':['official','mixed'].includes(baseKind)?'mixed':deriveRecipeBasis(recipe,data());}
    const allowed=!recipe||!constraints||eligibleRecipes(state.settings,{...data(),recipes:[recipe]}).length>0;
    currentRecipe=allowed?recipe:null;arrange.disabled=!currentRecipe;
    notice.hidden=allowed;notice.textContent=allowed?'':'避ける食材の設定に合わない組み合わせです。種類や具材を変更してください。';
    form.querySelector('button[type="submit"]').disabled=!currentRecipe;
  };
  const mount=type==='curry'?mountCurryRice:mountNoodleComposer;
  const builder=mount({recipeId,data:data(),initial,onChange,onError:()=>{}});
  box.append(...recipeArtworkNodes(recipeById(recipeId),{detail:true,standard:true}),builder,notice,arrange,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
/** 複数の料理・具材を選び、そのまま一皿として記録します。 */
function openFoodComposer(recipeId,{respectConditions=true,recordInitial={},variationRecipes=null}={}){
  const definition=foodComposerFor(recipeId),box=$('dialog-content');
  if(!definition)throw Error('組み合わせる料理が見つかりません。');
  $('dialog-title').textContent=`${definition.label}を組み合わせる`;
  $('dialog-meta').textContent='選んだ種類と量で1皿分';
  box.replaceChildren();let currentRecipe=null,latestBase=null,intakeWidget=null;
  const artwork=node('div'),base=recipeById(recipeId);
  const breadKind=['english-muffin','sandwich','hot-sandwich','toast'].includes(definition.kind);
  const refreshArtwork=recipe=>{
    const illustratedRecipe=breadKind?liveBreadArtworkRecipe(recipe,definition):base;
    artwork.replaceChildren(...(illustratedRecipe?recipeArtworkNodes(illustratedRecipe,{detail:true,standard:true}):[]));
  };
  const form=catalogRecordForm(recipeId,{getCustomRecipe:()=>currentRecipe,initial:recordInitial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions});arrange.disabled=true;
  const constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const conditionNotice=node('p','notice error');conditionNotice.hidden=true;
  const scope=variationRecipes??(constraints?menuCandidates(data()):data().recipes);
  const group=getVariationGroup(recipeId,scope);
  const switcher=foodRecipeSwitch(definition,group,guard(id=>{
    openRecipe(id,{respectConditions,variationRecipes:group.recipes,recordInitial:currentRecordFields(form,recordInitial)});
  }));
  if(switcher)box.append(switcher);
  const safe=constraints?eligibleFoodSelection(definition.kind,state.settings,data(),{recipeId}):null;
  if(constraints&&!safe)throw Error('現在の除外条件に合う組み合わせがありません。');
  const initial=safe?.config??defaultFoodSelection(definition.kind,{recipeId});
  const acceptRecipe=recipe=>{
      const allowed=!recipe||!constraints||eligibleRecipes(state.settings,{...data(),recipes:[recipe]}).length>0;
      currentRecipe=allowed?recipe:null;
      refreshArtwork(currentRecipe);
      arrange.disabled=!currentRecipe;
      conditionNotice.hidden=allowed;
      conditionNotice.textContent=allowed?'':'避ける食材の設定に合わないか、原材料が未確認の組み合わせです。選ぶ材料を変更してください。実際に食べた内容は「記録」タブから残せます。';
      form.querySelector('button[type="submit"]').disabled=!currentRecipe;
  };
  const builder=mountFoodComposer({kind:definition.kind,data:data(),initial,
    onChange:recipe=>{latestBase=recipe;if(intakeWidget&&recipe){intakeWidget.hidden=false;intakeWidget.setBaseRecipe(recipe);}else{if(intakeWidget)intakeWidget.hidden=true;acceptRecipe(recipe);}},onError:()=>{}});
  if(latestBase&&soupIntakeFor(latestBase,data()))intakeWidget=mountSoupIntake({baseRecipe:latestBase,data:data(),onChange:acceptRecipe,onError:()=>{}});
  box.append(artwork,builder,...(intakeWidget?[intakeWidget]:[]),conditionNotice,arrange,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function openDishComposer(recipeId,{respectConditions=true,query='',recordInitial={}}={}){
  const definition=dishCustomiserFor(recipeId),box=$('dialog-content');
  if(!definition)throw Error('具材を選べるメニューが見つかりません。');
  $('dialog-title').textContent=`${definition.label}の具材を選ぶ`;
  $('dialog-meta').textContent=`${ROLES[recipeById(recipeId).role]} / 1皿`;
  box.replaceChildren();let currentRecipe=null;
  const form=catalogRecordForm(recipeId,{getCustomRecipe:()=>currentRecipe,initial:recordInitial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions});arrange.disabled=true;
  const constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const conditionNotice=node('p','notice error');conditionNotice.hidden=true;
  const choiceSettings=constraints?state.settings:{allergens:[],excludedIngredients:[]};
  const choices=eligibleDishSelections(definition.kind,choiceSettings,data());
  if(!choices.length)throw Error('現在の除外条件に合う組み合わせがありません。');
  const preferred=choices.find(choice=>matchesJapaneseQuery([choice.recipe.name,
    definition.presets?.find(item=>item.id===choice.config.presetId)?.label??'',
    definition.kind==='nikujaga'?`${choice.config.meat==='pork'?'豚肉':'牛肉'}の肉じゃが`:''],query))??choices[0];
  const initial=Object.fromEntries(Object.entries(preferred.config).filter(([key])=>key!=='id'));
  const builder=mountDishCustomiser({kind:definition.kind,data:data(),initial,
    onChange:recipe=>{
      const allowed=!recipe||!constraints||eligibleRecipes(state.settings,{...data(),recipes:[recipe]}).length>0;
      currentRecipe=allowed?recipe:null;
      arrange.disabled=!currentRecipe;
      conditionNotice.hidden=allowed;
      conditionNotice.textContent=allowed?'':'設定で避けている食材を含みます。具材やソースを変更してください。実際に食べた内容の記録は「記録」タブから入力できます。';
      form.querySelector('button[type="submit"]').disabled=!currentRecipe;
    },onError:()=>{}});
  box.append(...recipeArtworkNodes(recipeById(recipeId),{detail:true,standard:true}),builder,conditionNotice,arrange,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function openMeatComposer(recipeId,{respectConditions=true,recordInitial={}}={}){
  const definition=meatChoiceFor(recipeId),box=$('dialog-content');
  if(!definition)throw Error('お肉を選べる料理が見つかりません。');
  box.replaceChildren();$('dialog-title').textContent=recipeById(recipeId).name;
  $('dialog-meta').textContent='肉の種類に合わせて材料と栄養を概算';
  const constraints=respectConditions&&(state.settings.allergens.length||state.settings.excludedIngredients.length);
  const settings=constraints?state.settings:{allergens:[],excludedIngredients:[]};
  const choices=eligibleMeatSelections(recipeId,settings,data());
  if(!choices.length)throw Error('現在の除外条件に合うお肉の組み合わせがありません。');
  const standard=defaultMeatSelection(recipeId),initial=choices.find(choice=>choice.config.meatId===standard.meatId)?.config??choices[0].config;
  const scope=constraints?menuCandidates(data()):data().recipes,group=getVariationGroup(recipeId,scope);
  if(group&&group.recipes.length>1){
    const label=node('label','detail-variation-label','料理の種類'),select=node('select');
    select.id='meat-detail-variant';label.htmlFor=select.id;selectOptions(select,group.recipes.map(r=>[r.id,variantLabel(r)]),recipeId);
    select.addEventListener('change',guard(()=>openRecipe(select.value,{respectConditions,variationRecipes:scope})));label.append(select);box.append(label);
  }
  let currentRecipe=null;
  const form=catalogRecordForm(recipeId,{getCustomRecipe:()=>currentRecipe,initial:recordInitial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions});arrange.disabled=true;
  const notice=node('p','notice error');notice.hidden=true;
  const builder=mountMeatChoice({recipeId,data:data(),initial,onChange:recipe=>{
    const allowed=!recipe||!constraints||eligibleRecipes(state.settings,{...data(),recipes:[recipe]}).length>0;
    currentRecipe=allowed?recipe:null;arrange.disabled=!currentRecipe;if(recipe)$('dialog-title').textContent=recipe.name;
    notice.hidden=allowed;notice.textContent=allowed?'':'避ける食材の設定に合わないお肉です。別の種類を選んでください。';
    form.querySelector('button[type="submit"]').disabled=!currentRecipe;
  },onError:()=>{}});
  box.append(...recipeArtworkNodes(recipeById(recipeId),{detail:true,standard:true}),builder,notice,arrange,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}
function currentRecordFields(container,fallback){
  const quantity=container.querySelector('#menu-entry-amount');
  if(!quantity)return fallback;
  return {date:container.querySelector('#menu-entry-date')?.value,meal:container.querySelector('#menu-entry-meal')?.value,
    status:container.querySelector('#menu-entry-status')?.value,amount:quantity.value,unit:quantity.dataset.unit,edited:quantity.dataset.edited==='true'};
}
function openVariationRecipe(recipeId,group,{respectConditions=true,recordInitial={}}={}){
  const box=$('dialog-content');box.replaceChildren();
  $('dialog-title').textContent=group.label;
  const label=node('label','detail-variation-label','種類を選ぶ'),select=node('select'),content=node('div','detail-variation-content');
  select.id='detail-variant';label.htmlFor=select.id;selectOptions(select,group.recipes.map(r=>[r.id,variantLabel(r)]),recipeId);label.append(select);box.append(label,content);
  const redraw=()=>{
    const initial=currentRecordFields(content,recordInitial);
    if(isComposableRecipe(select.value)){openRecipe(select.value,{respectConditions,variationRecipes:group.recipes,recordInitial:initial});return;}
    const r=describeRecipe(select.value,data()),item=snapshot(select.value);
    $('dialog-meta').textContent=`${familyLabel(r)} / ${amount(recipePortion(r,data()).amount,recipePortion(r,data()).unit)}`;
    const soup=soupIntakeFor(r,data());
    content.replaceChildren(...catalogDetailNodes(r,item,soup,respectConditions,initial));
  };
  select.addEventListener('change',guard(redraw));redraw();
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}

/** 生野菜サラダはその場で材料を選び、記録には確定した内容を残します。 */
function openSaladComposer(recipeId,{recordInitial={}}={}){
  const base=recipeById(recipeId),box=$('dialog-content');
  $('dialog-title').textContent='野菜サラダを組み立てる';
  $('dialog-meta').textContent='副菜 / 野菜・いも / サラダ / 1皿';
  box.replaceChildren();
  let currentRecipe=null;
  const form=catalogRecordForm(recipeId,{getCustomRecipe:()=>currentRecipe,initial:recordInitial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions:false});arrange.disabled=true;
  const initial={components:base.ingredients.map(part=>({id:SALAD_COMPONENTS.find(component=>component.ingredientId===part.id)?.id,amount:part.amount/base.servings})).filter(part=>part.id),dressingId:'none',dressingAmount:0};
  const builder=mountSaladBuilder({data:data(),initial,
    onChange:recipe=>{currentRecipe=recipe;arrange.disabled=!recipe;form.querySelector('button[type="submit"]').disabled=!recipe;},
    onError:()=>{}});
  box.append(...recipeArtworkNodes(base,{detail:true,standard:true}),builder,arrange,form);
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}

function snapshotDetails(item,{showNutritionBasis=false}={}){
  const purchased=['instant','retort','fast-food','ready-to-eat'].includes(item.nature),custom=recipeById(item.recipeId)?.custom===true;
  const box=node('div','recipe-detail-content');
  box.append(nutritionBasisBadge(item,data(),{snapshot:true}));
  if(item.diningMatch)box.append(node('p','dining-origin',diningReference(item)));
  if(!item.batchId&&!showNutritionBasis)box.append(favouriteAction(()=>item));
  if(!showNutritionBasis&&!item.batchId&&!item.restaurant&&!item.diningMatch)box.append(shoppingAction(()=>item));
  if(item.nature)box.append(node('p','food-nature',FOOD_NATURES.find(n=>n.id===item.nature)?.label??item.nature));if(item.sourceNote){
    const sources=node('details','recipe-sources'),note=node('p','source-note');
    sources.append(node('summary','','参考資料と栄養値の根拠'));
    const parts=item.sourceNote.split(/(https?:\/\/[^\s　<>「」]+)/g);
    for(const part of parts){
      if(/^https?:\/\//.test(part)){
        const link=node('a','',part);link.href=part;link.target='_blank';link.rel='noopener noreferrer';note.append(link);
      }else note.append(document.createTextNode(part));
    }
    sources.append(note);box.append(sources);
  }
  const n=itemNutrition(item);box.append(node('p','field-note',NUTRIENT_KEYS.map(k=>`${NUTRIENT_LABELS[k]} ${n[k]===null?'未入力':`${formatNutrient(n[k],k)} ${NUTRIENT_UNITS[k]}`}`).join(' / ')));
  box.append(node('h3','',`${item.diningMatch?'照合した料理の材料':purchased?'商品・食品の量':item.ingredientsKnown?'材料':'商品・材料の代表例'}（${portionLabel(item,data())}）`));const ul=node('ul','ingredient-list');for(const part of item.ingredients)ul.append(node('li','',`${formatCookingIngredient(part.id,part.amount*item.quantity,data())}`));box.append(ul);
  if(!item.ingredientsKnown&&!item.diningMatch)box.append(node('p','field-note','原材料の詳細は未確認です。市販品は実際の商品表示を確認してください。買う商品の構成が登録済みの場合は、その商品量を買い物リストに反映します。'));
  if(showNutritionBasis&&recipeById(item.recipeId)?.manualNutrition===undefined&&item.ingredients.length){
    const basis=node('details','nutrition-basis'),sources=node('ul','ingredient-list');
    basis.append(node('summary','','栄養の見積もりに使う食材・部位'));
    basis.append(node('p','field-note','材料の代表的な栄養値に使用量を掛け、人数で割った概算です。肉は記載の部位と皮・脂身の状態を使います。微量や未登録の成分は、食品ごとに根拠を示して補っています。油や煮汁を残す量、加熱で落ちる脂は補正していません。'));
    for(const part of item.ingredients){const ingredient=INGREDIENTS[part.id];if(ingredient)sources.append(node('li','',`${ingredient.name}：${ingredient.nutritionSource}`));}
    basis.append(sources);box.append(basis);
  }
  if(item.steps.length&&(!purchased||custom)){box.append(node('h3','',item.diningMatch?'照合した料理の作り方':'作り方'));const ol=node('ol','recipe-steps');for(const s of item.steps)ol.append(node('li','',s));box.append(ol);}
  else if(purchased)box.append(node('p','field-note','調理や温めが必要な場合は商品の表示に従ってください。'));
  else box.append(node('p','field-note','作り方は未登録です。'));
  box.append(node('p','allergy-note',item.diningMatch?'実際のお店の原材料とアレルギー情報は、お店の案内で確認してください。':item.allergensKnown?`含まれる登録アレルゲン：${item.allergens.length?item.allergens.map(id=>ALLERGENS.find(a=>a.id===id)?.label??id).join('、'):'登録なし'}。加工品や調味料は商品表示も確認してください。`:'アレルギー情報は未確認です。自動提案の対象にはしません。'));
  return box;
}
function openSnapshot(item,minutes,catalogId=null,{respectConditions=true,recordInitial={}}={}){
  const purchased=['instant','retort','fast-food','ready-to-eat'].includes(item.nature);
  $('dialog-title').textContent=item.name;
  $('dialog-meta').textContent=`${item.recipeId&&recipeById(item.recipeId)?familyLabel(recipeById(item.recipeId)):ROLES[item.role]} / ${portionLabel(item,data())}${minutes&&!purchased?` / 約${minutes}分`:''}`;
  const box=$('dialog-content');box.replaceChildren();
  if(!catalogId){const pictured=snapshotArtworkRecipe(item,data());if(pictured)box.append(...recipeArtworkNodes(pictured,{detail:true,standard:true}));}
  const base=catalogId?recipeById(catalogId):null,soup=base&&soupIntakeFor(base,data());
  if(catalogId)box.append(...catalogDetailNodes(base,item,soup,respectConditions,recordInitial));
  else box.append(snapshotDetails(item));
  if(!$('recipe-dialog').open)$('recipe-dialog').showModal();
}

function catalogDetailNodes(recipe,item,soup,respectConditions,initial){
  const picture=recipeArtworkNodes(recipe,{detail:true,standard:!!soup});
  const recipeDetails=soup?standardSoupDetails(item):snapshotDetails(item,{showNutritionBasis:true});
  const record=soup?[soupRecipeContent(recipe,{respectConditions,initial})]:
    [catalogRecordForm(recipe.id,{initial}),arrangementAction(()=>recipe,{respectConditions})];
  const store=[button('店別・サイズ別に登録',()=>openRestaurantRegistration(recipe)),restaurantVariantLinks(recipe.id)];
  if(document.body.dataset.activeTab==='catalog'&&recipeNature(recipe)==='home-cooked'&&!soup){
    return [...picture,recipeDetails,...record,...store];
  }
  return [...picture,...record,...store,recipeDetails];
}

function recipeArtworkNodes(recipe,options){const artwork=recipeIllustrationElement(recipe,{...options,hidden:state.settings.hideRecipeIllustrations});return artwork?[artwork]:[];}

function standardSoupDetails(item){const details=node('details','soup-standard-recipe');details.append(node('summary','','標準レシピの材料・栄養・作り方（全量）'),snapshotDetails(item,{showNutritionBasis:true}));return details;}

/** 食べた栄養と調理に必要な材料を別々に保持する記録フォーム。 */
function soupRecipeContent(baseRecipe,{respectConditions=true,initial={}}={}){
  const box=node('div','soup-record-content');let currentRecipe=null;
  const form=catalogRecordForm(null,{getCustomRecipe:()=>currentRecipe,customPortion:recipePortion(baseRecipe,data()),initial});
  const arrange=arrangementAction(()=>currentRecipe,{respectConditions});arrange.disabled=true;
  const widget=mountSoupIntake({baseRecipe,data:data(),onChange:recipe=>{currentRecipe=recipe;arrange.disabled=!recipe;form.querySelector('button[type="submit"]').disabled=!recipe;},onError:()=>{}});
  box.append(widget,arrange,form);return box;
}

function appendPlanStapleControls(card,day,index,getStapleChoices){
  if(day.meal==='snack')return;
  const selected=activeRecipeIds(day).map(recipeById);
  if(selected.some(isCompleteMeal)||!selected.some(r=>r.role==='main'&&!r.staple))return;
  const choices=getStapleChoices();
  const current=selected.find(r=>r.staple||r.role==='staple');
  const details=node('details','plan-staple-controls'),form=node('form'),select=node('select'),qty=node('input'),unit=node('span','unit-label');
  details.append(node('summary','','この食事の主食を調整'));
  const label=node('label','','主食'),amountLabel=node('label','','1人分の量');
  select.setAttribute('aria-label',`${day.date} ${MEALS[day.meal]}の主食`);selectOptions(select,[['none','別の主食は付けない'],...choices.map(r=>[r.id,r.name])],current?.id??'none');label.append(select);
  qty.type='number';qty.min='0.001';qty.max=1000000;qty.step='any';qty.required=true;
  const sync=()=>{const r=recipeById(select.value),portion=r?recipePortion(r,data()):null;qty.disabled=!r;qty.value=portion?.amount??'';unit.textContent=portion?.unit??'';qty.setAttribute('aria-label',`${day.date} ${MEALS[day.meal]}の主食量${portion?`（${portion.unit}）`:''}`);configureQuantityInput(qty);};sync();if(current)qty.value=recipePortion(current,data()).amount*(day.quantities?.[current.id]??1);
  select.addEventListener('change',sync);const wrap=node('span','input-unit');wrap.append(qty,unit);amountLabel.append(wrap);
  const apply=node('button','button-secondary compact','この食事に反映');apply.type='submit';form.append(label,amountLabel,apply);
  form.addEventListener('submit',guard(event=>{event.preventDefault();applyEditedPlan(updatePlanStaple(plan,{dayIndex:index,stapleId:select.value,amount:select.value==='none'?null:readQuantityInput(qty)},data()),'この食事の主食と量を更新しました。');}));details.append(form);card.append(details);
}
function catalogRecordForm(recipeId,{getCustomRecipe=null,customPortion=null,initial={},saveLabelText='この組み合わせをマイメニューにも保存'}={}){
  const r=recipeById(recipeId),portion=getCustomRecipe?(customPortion??{amount:1,unit:'皿'}):recipePortion(r,data()),form=node('form','catalog-record-form');form.id='catalog-record-form';form.append(node('h3','','カレンダーに追加'));
  const field=(title,id,type,value)=>{const label=node('label','',title),input=node('input');input.id=id;input.type=type;input.value=value;input.required=true;label.htmlFor=id;label.append(input);form.append(label);return input;};
  const date=field('記録する日付','menu-entry-date','date',initial.date??selectedDate);
  const mealLabel=node('label','','食事'),meal=node('select');meal.id='menu-entry-meal';mealLabel.htmlFor=meal.id;selectOptions(meal,Object.entries(MEALS),initial.meal??$('calendar-meal').value);mealLabel.append(meal);form.append(mealLabel);
  const statusLabel=node('label','','記録の種類'),status=node('select');status.id='menu-entry-status';statusLabel.htmlFor=status.id;selectOptions(status,[['eaten','食べた'],['planned','これからの予定']],initial.status??$('calendar-status').value);statusLabel.append(status);form.append(statusLabel);
  const preserveAmount=initial.edited&&initial.unit===portion.unit;
  const qty=field(`量（${portion.unit}）`,'menu-entry-amount','number',preserveAmount?initial.amount:String(portion.amount));qty.min='0.001';qty.max=100000;configureQuantityInput(qty);
  qty.dataset.unit=portion.unit;qty.dataset.edited=String(!!preserveAmount);qty.addEventListener('input',()=>qty.dataset.edited='true');
  const saveLabel=getCustomRecipe?check('salad-save-db',saveLabelText,false):null;
  if(saveLabel){saveLabel.querySelector('input').id='salad-save-db';form.append(saveLabel);}
  quantityPresets(qty,getCustomRecipe?null:r,portion);
  const summary=createRecordSummary({data,getEntry:()=>{
    const recipe=getCustomRecipe?getCustomRecipe():r;if(!recipe)return null;
    const catalogData=getCustomRecipe?{...data(),recipes:[...data().recipes.filter(candidate=>candidate.id!==recipe.id),recipe]}:data();
    return createCatalogEntry({recipeId:recipe.id,date:date.value,meal:meal.value,status:status.value,amount:readQuantityInput(qty),note:''},catalogData);
  }});
  form.refreshRegistration=()=>{const recipe=getCustomRecipe?getCustomRecipe():r;quantityPresets(qty,recipe,portion);summary.refresh();};
  form.append(summary.element);form.refreshRegistration();
  const submit=node('button','button-primary','この料理を記録に追加');submit.type='submit';submit.disabled=!!getCustomRecipe;form.append(submit);
  const favourite=favouriteAction(()=>{const recipe=getCustomRecipe?getCustomRecipe():r;if(!recipe)return null;const item=itemFromRecipe(recipe,data(),quantityFromAmount(recipe,data(),readQuantityInput(qty)));item.portion=recipePortion(recipe,data());return item;},()=>getCustomRecipe?getCustomRecipe()?.genre:r?.genre);favourite.disabled=submit.disabled;form.append(favourite);
  const shopping=shoppingAction(()=>{const recipe=getCustomRecipe?getCustomRecipe():r;if(!recipe)return null;const item=itemFromRecipe(recipe,data(),quantityFromAmount(recipe,data(),readQuantityInput(qty)));item.portion=recipePortion(recipe,data());return item;});form.append(shopping);
  const shoppingButton=shopping.querySelector('button');shoppingButton.disabled=submit.disabled;
  if(getCustomRecipe)new MutationObserver(()=>{favourite.disabled=submit.disabled;shoppingButton.disabled=submit.disabled;form.refreshRegistration();}).observe(submit,{attributes:true,attributeFilter:['disabled']});
  form.addEventListener('submit',guard(event=>{
    event.preventDefault();
    const composed=getCustomRecipe?getCustomRecipe():null;
    if(getCustomRecipe&&!composed)throw Error('材料と量を確認してください。');
    const save=saveLabel?.querySelector('input')?.checked===true;
    const catalogData=composed?{...data(),recipes:[...data().recipes.filter(recipe=>recipe.id!==composed.id),composed]}:data();
    const entry=createCatalogEntry({recipeId:composed?.id??recipeId,date:date.value,meal:meal.value,status:status.value,amount:readQuantityInput(qty),note:''},catalogData);
    // マイメニューを作らない場合も、その時の材料・量・栄養を記録へ残します。
    if(composed&&!save)entry.items[0].recipeId=null;
    if(!commit(next=>{if(composed&&save){const index=next.customRecipes.findIndex(r=>r.id===composed.id);if(index<0)next.customRecipes.push(composed);else next.customRecipes[index]=composed;}next.entries.push(entry);},{invalidate:!!(composed&&save&&state.customRecipes.some(r=>r.id===composed.id)),message:`${dateLabel(entry.date)}の${MEALS[entry.meal]}に追加しました。`}))return;selectedDate=entry.date;month=entry.date.slice(0,7);$('calendar-meal').value=entry.meal;$('calendar-status').value=entry.status;setDate(entry.date);$('recipe-dialog').close();activateTab('record',{focus:true});}));
  return form;
}
function resetFilter(from=$('reset-from').value,to=$('reset-to').value,status=$('reset-status').value){return {from,to,status,meals:Object.keys(MEALS)};}
function renderReset(){
  if(resetDateAnchor!==selectedDate){$('reset-from').value=selectedDate;$('reset-to').value=selectedDate;resetDateAnchor=selectedDate;}
  $('undo-reset').hidden=!undoReset;
  try{const preview=previewReset(state,resetFilter());$('reset-preview').textContent=`食事 ${preview.entryCount}件 / 料理 ${preview.itemCount}品 / 完了チェック ${preview.completedDayCount}日`;$('reset-range').disabled=preview.entryCount+preview.completedDayCount===0;}catch(e){$('reset-preview').textContent=e.message;$('reset-range').disabled=true;}
}
function performReset(filter){
  const preview=previewReset(state,filter);
  if(!preview.entryCount&&!preview.completedDayCount){tell('リセットする記録がありません。');return;}
  const scope=filter.from===filter.to?filter.from:`${filter.from}〜${filter.to}`;
  if(!confirm(`${scope}の食事${preview.entryCount}件（料理${preview.itemCount}品）をリセットしますか？${preview.completedDayCount?` 記録完了のチェックも${preview.completedDayCount}日分解除します。`:''} 自分のメニューや手持ちの食材は残ります。`))return;
  const previous=structuredClone(state),next=resetEntriesRange(state,filter);commit(draft=>Object.assign(draft,next),{message:'指定した記録をリセットしました。直後なら元に戻せます。'});undoReset=previous;resetManual();renderReset();
}
function ingredientRow(part){
  const row=node('div','pantry-row'),select=node('select');select.setAttribute('aria-label','手入力メニューの材料');selectOptions(select,[['','材料を選ぶ'],...Object.entries(INGREDIENTS).map(([id,i])=>[id,`${i.name}（${i.unit}）`])],part?.id??'');
  const qty=node('input');qty.type='number';qty.min='0.001';qty.max=1000000;qty.step='any';qty.value=part?.amount??'';configureQuantityInput(qty);qty.placeholder='基準量に含まれる分量';qty.setAttribute('aria-label','基準量に含まれる材料の分量');row.append(select,qty,button('削除',()=>{row.remove();manualBasis='manual';}));$('manual-ingredients').append(row);
}
function readManual(){
  const ingredients=[...$('manual-ingredients').children].map(row=>({id:row.querySelector('select').value,amount:readQuantityInput(row.querySelector('input'))}));
  if(ingredients.some(i=>!i.id||!Number.isFinite(i.amount)||i.amount<=0))throw Error('材料を選んで基準量に含まれる分量を入力してください。不要な行は削除できます。');
  const manualNutrition=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,readQuantityInput($('manual-'+k),{label:NUTRIENT_LABELS[k],allowEmpty:true})]));
  return {id:`custom-${uid()}`,name:$('manual-name').value.trim(),role:$('manual-role').value,genre:'その他',minutes:1,servings:1,staple:$('manual-role').value==='staple',ingredients,
    steps:$('manual-steps').value.split('\n').map(s=>s.trim()).filter(Boolean),manualNutrition,
    allergens:[...$('manual-allergens').querySelectorAll('input:checked')].map(i=>i.value),allergensKnown:$('manual-allergens-known').checked,ingredientsKnown:$('manual-ingredients-known').checked,
    groups:[],proteinSources:[],custom:true,nutritionBasis:manualBasis,nature:$('manual-nature').value,sourceNote:$('manual-source-note').value.trim(),shoppingKnown:$('manual-shopping-known').checked,portion:{amount:readQuantityInput($('manual-base-amount')),unit:$('manual-base-unit').value}};
}
function resetManual(){editing=null;manualBasis='manual';$('manual-form').reset();$('manual-ingredients').replaceChildren();$('manual-edit-note').hidden=true;}
function editItem(entry,item){
  resetManual();manualBasis=item.nutritionBasis??'unknown';editing={entryId:entry.id,itemId:item.id};setDate(entry.date);$('calendar-meal').value=entry.meal;$('calendar-status').value=entry.status;
  $('manual-nature').value=item.nature??'unspecified';$('manual-source-note').value=item.sourceNote??'';$('manual-shopping-known').checked=item.shoppingKnown===true;
  $('manual-base-amount').value=item.portion?.amount??1;$('manual-base-unit').value=item.portion?.unit??'人分';
  $('manual-name').value=item.name;$('manual-role').value=item.role;$('manual-quantity').value=item.quantity;$('manual-note').value=entry.note;
  for(const key of NUTRIENT_KEYS)$('manual-'+key).value=item.nutrition[key]??'';
  $('manual-allergens-known').checked=item.allergensKnown;$('manual-ingredients-known').checked=item.ingredientsKnown&&!item.ingredients.some(p=>!INGREDIENTS[p.id]);if(item.ingredients.some(p=>!INGREDIENTS[p.id]))tell('現在のDBにない材料があります。編集する場合は材料を確認して登録し直してください。',true);
  for(const input of $('manual-allergens').querySelectorAll('input'))input.checked=item.allergens.includes(input.value);
  for(const p of item.ingredients)if(INGREDIENTS[p.id])ingredientRow(p);
  $('manual-steps').value=item.steps.join('\n');$('manual-edit-note').hidden=false;$('manual-form').closest('details').open=true;$('manual-name').focus();
}
function renderAll(){renderReset();renderProfile();renderSettings();renderCalendar();renderNutrition();renderPlan();renderPantry();renderShopping();renderCatalog();renderPersistenceStatus();renderHistory();}

// 材料を並べただけでは全材料が分かるとは限らないため、確認欄を別に設けます。
const catalogSearchLabel=node('label','','メニューを探す'),catalogSearch=node('input');catalogSearch.id='catalog-search';catalogSearch.type='search';catalogSearch.placeholder='料理名や材料で絞り込み';catalogSearch.autocomplete='off';catalogSearchLabel.htmlFor='catalog-search';catalogSearchLabel.append(catalogSearch);$('catalog-item').closest('label').before(catalogSearchLabel);catalogSearch.addEventListener('input',renderRecordPicker);
const manualNature=node('label','','調理・提供形態'),manualNatureSelect=node('select');manualNatureSelect.id='manual-nature';manualNature.htmlFor='manual-nature';selectOptions(manualNatureSelect,FOOD_NATURES.map(n=>[n.id,n.label]),'unspecified');manualNature.append(manualNatureSelect);$('manual-note').closest('label').before(manualNature);
const sourceLabel=node('label','','栄養や商品のメモ（任意）'),sourceInput=node('textarea');sourceInput.id='manual-source-note';sourceInput.rows=2;sourceInput.maxLength=2000;sourceInput.placeholder='例：商品ラベルの1食分の値を入力';sourceLabel.htmlFor='manual-source-note';sourceLabel.append(sourceInput);$('manual-note').closest('label').after(sourceLabel);
const purchaseLabel=check('manual-shopping-known','買い物に必要な商品の種類と分量はそろっている',false);purchaseLabel.querySelector('input').id='manual-shopping-known';$('manual-ingredients').after(purchaseLabel);
const completeLabel=check('manual-ingredients-known','すべての材料と分量を登録した',false);completeLabel.querySelector('input').id='manual-ingredients-known';$('manual-ingredients').after(completeLabel);
const estimate=button('材料から栄養の概算を入力する',()=>{if(!$('manual-ingredients-known').checked)throw Error('すべての材料と分量を登録したら確認欄にチェックしてください。');const r=readManual();if(!r.ingredients.length)throw Error('材料を登録してください。');const values=recipeNutrition({servings:1,ingredients:r.ingredients},builtin);for(const key of NUTRIENT_KEYS)$('manual-'+key).value=values[key]===null?'':Math.round(values[key]*100)/100;manualBasis='ingredients';tell('材料から栄養を概算しました。商品表示が分かる場合は修正してください。');},'button-secondary');estimate.id='manual-estimate-nutrition';$('manual-ingredients').after(estimate);
const editNote=node('div','notice','食事の記録を編集中です。保存すると選んだ日付・食事・種類に更新します。');editNote.id='manual-edit-note';editNote.hidden=true;editNote.append(button('編集をやめる',resetManual));$('manual-form').prepend(editNote);
selectOptions($('catalog-nature'),[['all','すべての形態'],...FOOD_NATURES.map(n=>[n.id,n.label])],'all');
selectOptions($('recipe-nature'),[['all','すべての形態'],...FOOD_NATURES.map(n=>[n.id,n.label])],'all');
selectOptions($('recipe-genre'),[['all','すべてのジャンル'],...GENRES.map(g=>[g,g])],'all');
for(const key of NUTRIENT_KEYS)$('manual-'+key).step='any';
$('manual-quantity').step='any';$('manual-quantity').min='0.001';$('manual-quantity').max='1000';
for(const id of ['catalog-amount','manual-quantity','manual-base-amount'])configureQuantityInput($(id));
for(const key of NUTRIENT_KEYS){configureQuantityInput($('manual-'+key),{step:key==='kcal'?1:key==='salt'?.01:.1});configureQuantityInput($('target-'+key),{step:key==='kcal'?1:.1});}
for(const a of ALLERGENS)$('manual-allergens').append(check(a.id,a.label,false));
$('calendar-date').value=selectedDate;$('nutrition-date').value=selectedDate;$('shopping-source').value=state.shoppingCatalog.length?'draft':state.entries.some(e=>e.status==='planned')?'calendar':state.shoppingExtras.length?'menu':'draft';$('shopping-from').value=state.settings.startDate;$('shopping-days').value=String(Math.min(3,state.settings.days));
for(const id of ['calendar-date','nutrition-date','start-date','shopping-from']){$(id).min='2000-01-01';$(id).max='2100-12-31';}
bind('month-prev','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()-1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-next','click',()=>{const date=new Date(`${month}-15T12:00:00`);date.setMonth(date.getMonth()+1);if(!dateIsValid(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`))return;month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;renderCalendar();});
bind('month-today','click',()=>setDate(dateKey()));bind('calendar-date','change',()=>setDate($('calendar-date').value));bind('nutrition-date','change',()=>{if(!dateIsValid($('nutrition-date').value))throw Error('集計する日付を確認してください。');renderNutrition();});
bind('add-catalog-item','click',()=>{const id=recordPickerRecipeId();if(!id)throw Error('記録するメニューを選んでください。');if(isComposableRecipe(id)||soupIntakeFor(recipeById(id),data())){openRecipe(id,{respectConditions:false,query:$('catalog-search').value});return;}const item=snapshot(id,quantityFromAmount(recipeById(id),data(),readQuantityInput($('catalog-amount'))));commit(next=>next.entries.push(selectedEntry([item])),{invalidate:false,message:'食事をカレンダーに追加しました。'});});
bind('manual-add-ingredient','click',()=>ingredientRow());
bind('create-original-recipe','click',()=>openRecipeArrangement());
bind('create-restaurant-menu','click',()=>openRestaurantRegistration());
bind('open-dining-log','click',()=>openDiningLog());
for(const id of ['calendar-meal','calendar-status'])bind(id,'change',renderRecordTools);
bind('manual-form','input',event=>{if(NUTRIENT_KEYS.some(key=>event.target.id===`manual-${key}`)||event.target.closest('#manual-ingredients')||['manual-ingredients-known','manual-base-amount','manual-base-unit'].includes(event.target.id))manualBasis='manual';});
bind('manual-form','submit',event=>{event.preventDefault();const r=readManual(),save=$('manual-save-db').checked,quantity=readQuantityInput($('manual-quantity')),note=$('manual-note').value.trim();
  if(!commit(next=>{if(save)next.customRecipes.push(r);const clean=validateJournal(next,builtin),full=save?clean.customRecipes.find(c=>c.id===r.id):validateJournal({...next,customRecipes:[...next.customRecipes,r]},builtin).customRecipes.at(-1);
    const item=itemFromRecipe(full,{...builtin,recipes:[...RECIPES,...clean.customRecipes]},quantity);item.portion=recipePortion(full,builtin);if(!save)item.recipeId=null;
    if(editing){const old=next.entries.find(e=>e.id===editing.entryId);if(!old)throw Error('編集する記録が見つかりません。');const at=old.items.findIndex(i=>i.id===editing.itemId);if(at<0)throw Error('編集する料理が見つかりません。');old.items.splice(at,1);if(old.items.length&&note===old.note)old.note='';if(!old.items.length)next.entries=next.entries.filter(e=>e.id!==old.id);next.entries.push(selectedEntry([item],note));}else next.entries.push(selectedEntry([item],note));
  },{invalidate:false,message:save?'食事を記録し、自分のデータベースにも保存しました。':'食事をカレンダーに記録しました。'}))return;resetManual();
});
for(const [id,key]of [['start-date','startDate'],['plan-days','days'],['servings','servings']])bind(id,'change',()=>commit(next=>{next.settings[key]=['days','servings'].includes(key)?Number($(id).value):$(id).value;}));
bind('start-tab','change',()=>commit(next=>{next.settings.startTab=$('start-tab').value;},{invalidate:false}));
bind('hide-recipe-illustrations','change',()=>{recipeLimit=12;commit(next=>{next.settings.hideRecipeIllustrations=$('hide-recipe-illustrations').checked;},{invalidate:false,message:$('hide-recipe-illustrations').checked?'料理イラストを非表示にしました。':'料理イラストを表示します。'});});
for(const input of document.querySelectorAll('input[name="text-size"]'))input.addEventListener('change',guard(()=>{
  if(input.checked)commit(next=>{next.settings.textSize=input.value;},{invalidate:false});
}));
for(const id of ['genre-mode','single-genre'])bind(id,'change',()=>commit(next=>{next.settings.preferences.genreMode=$('genre-mode').value;next.settings.preferences.genre=$('genre-mode').value==='single'?$('single-genre').value:'all';}));
bind('ratio-equal','click',()=>commit(next=>next.settings.preferences.genreRatios=Object.fromEntries(GENRES.map(g=>[g,20]))));bind('ratio-japanese','click',()=>commit(next=>next.settings.preferences.genreRatios={和食:50,洋食:20,中華:20,エスニック:10,その他:0}));
bind('ingredient-search','input',()=>renderIngredientSearch(false));bind('preferred-search','input',()=>renderIngredientSearch(true));
function generateMeals(meal='all'){
  if(recovery)throw Error('献立を作る前に保存データを復旧してください。');
  if(shiftDate(state.settings.startDate,state.settings.days-1)>'2100-12-31')throw Error('献立の期間は2100年内で指定してください。');
  undoReset=null;renderReset();
  const settings={...state.settings,meal,seed:Math.floor(Math.random()*2147483647)};
  if(meal==='dinner')settings.mealPreferences={...settings.mealPreferences,dinner:{...settings.mealPreferences.dinner,enabled:true}};
  const next=generateCalendarPlan(settings,data(),{entries:state.entries,targets:state.targets,meal,pantry:state.pantry,completedDays:state.completedDays});
  if(next.ok){
    syncDraftShoppingCatalog(next,new Map());
    shoppingSelection={};
    $('shopping-from').value=settings.startDate;
    $('shopping-days').value=String(Math.min(3,settings.days));
    $('shopping-source').value='draft';
  }
  plan=next;visiblePlanDate='';renderPlan();renderShopping();
  $('plan-result-title').focus();
  $('plan-result-title').scrollIntoView({block:'start'});
  tell(plan.ok?(meal==='dinner'?'夕食の献立を作成しました。':'献立を作成しました。'):'献立の条件を確認してください。',!plan.ok);
}
bind('plan-form','submit',event=>{event.preventDefault();generateMeals();});
bind('dinner-from-record','click',openDinnerFromRecord);
bind('make-dinners','click',()=>generateMeals('dinner'));
bind('browse-family-dinners','click',()=>openFamilyDinners());
bind('browse-recipes','click',()=>{activateTab('catalog');$('recipe-search').focus();});
bind('open-drink-log','click',()=>openDrinkLog());
bind('recipe-evening-only','change',()=>{recipeLimit=12;renderCatalog();});
bind('plan-visible-day','change',()=>{visiblePlanDate=$('plan-visible-day').value;renderPlan();});
bind('plan-back-settings','click',()=>{$('settings-title').focus();$('settings-title').scrollIntoView({block:'start'});});
bind('plan-open-shopping','click',()=>{
  if(!plan?.ok)return;
  const wholePeriod=visiblePlanDate==='all';
  $('shopping-source').value='draft';
  $('shopping-from').value=wholePeriod?plan.days[0].date:visiblePlanDate;
  $('shopping-days').value=String(wholePeriod?Math.min(plan.settings.days,3):1);
  renderShopping();activateTab('kitchen');setKitchenTab('menus',{focus:true});
});
bind('plan-save-calendar','click',()=>{const entries=draftEntries().filter(e=>e.items.length).map(e=>({...e,id:uid()}));if(!entries.length)throw Error('料理を1品以上含む献立を作成してください。');if(!commit(next=>next.entries.push(...entries),{message:'献立を予定としてカレンダーに登録しました。食べたら記録を切り替えてください。'}))return;$('shopping-source').value='calendar';setDate(entries[0].date);renderShopping();activateTab('record',{focus:true});});
bind('targets-form','submit',event=>{event.preventDefault();commit(next=>{next.targets=Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,readQuantityInput($('target-'+k),{label:NUTRIENT_LABELS[k]})]));next.profile.mode='manual';},{message:'比較用の目標値を保存しました。'});});
bind('shopping-omit-search','input',renderShoppingOmissions);
bind('shopping-omit-common','change',()=>{const checked=$('shopping-omit-common').checked,ids=commonPantryIds(data());commit(next=>{next.settings.shoppingOmittedIds=checked?[...new Set([...next.settings.shoppingOmittedIds,...ids])]:next.settings.shoppingOmittedIds.filter(id=>!ids.includes(id));},{invalidate:false});});
bind('kitchen-tabs','click',event=>{const tab=event.target.closest('[data-kitchen-tab]');if(tab)setKitchenTab(tab.dataset.kitchenTab);});
bind('kitchen-tabs','keydown',event=>{const tabs=[...$('kitchen-tabs').querySelectorAll('[data-kitchen-tab]')],index=tabs.indexOf(document.activeElement);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();setKitchenTab(tabs[next].dataset.kitchenTab);tabs[next].focus();});
bind('shopping-add-more','click',()=>setKitchenTab('menus',{focus:true}));
bind('open-app-help','click',()=>{activateTab('kitchen');setKitchenTab('help',{focus:true});});
for(const [id,direction]of [['shopping-prev-range',-1],['shopping-next-range',1]])bind(id,'click',()=>{$('shopping-from').value=safeShift($('shopping-from').value,Number($('shopping-days').value)*direction);renderShopping();});
for(const id of ['shopping-from','shopping-days','shopping-source'])bind(id,'change',renderShopping);
bind('copy-shopping','click',async()=>{if(!shoppingText)return;try{await navigator.clipboard.writeText(shoppingText);tell('買い物リストをコピーしました。');}catch{const textarea=node('textarea');textarea.value=shoppingText;textarea.readOnly=true;$('shopping-list').prepend(textarea);textarea.select();tell('コピーできない場合は、表示されたテキストを選んでコピーしてください。');}});
bind('role-filters','click',event=>{const b=event.target.closest('button[data-role]');if(!b)return;roleFilter=b.dataset.role;$('recipe-food-category').value='all';$('recipe-method').value='all';$('recipe-family').value='all';recipeLimit=12;renderCatalog();});bind('recipe-search','input',()=>{recipeLimit=12;renderCatalog();});bind('recipe-illustrated-only','change',()=>{recipeLimit=12;renderCatalog();});bind('more-recipes','click',()=>{recipeLimit+=24;renderCatalog();});
bind('close-dialog','click',()=>$('recipe-dialog').close());bind('recipe-dialog','click',event=>{if(event.target===$('recipe-dialog')){const r=$('recipe-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('recipe-dialog').close();}});
bind('export-records','click',()=>{
  if(recovery){downloadText(recovery.raw,`meal-palette_original_${dateKey()}.json`);tell('保護中の元データを書き出しました。ファイルが端末に保存されたことを確認してください。');return;}
  downloadText(JSON.stringify(validateJournal(state,builtin)),`meal-palette_${dateKey()}.json`);
  const marked=markJournalExport(storage);renderPersistenceStatus();tell(`食事の記録と設定を書き出しました。ファイルの保存を確認してください。${marked?'':'書き出し日時は保存できませんでした。'}`);
});
bind('import-records','click',()=>$('import-file').click());bind('import-file','change',async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;if(file.size>MAX_IMPORT_BYTES)throw Error('保存ファイルが大きすぎます。記録本体の上限は2 MBです。');const imported=parseJournal(await file.text(),builtin);if(!confirm('現在の記録と設定を読み込んだデータに置き換えますか？必要なら先に書き出してください。'))return;replaceSavedJournal(imported,'データを読み込みました。変更前の内容は端末内に退避しました。アレルギーと除外食材の設定も確認してください。');});
bind('clear-history','click',()=>{if(!confirm('食事の記録をすべて削除しますか？自分のメニューや設定は残ります。'))return;commit(next=>{next.entries=[];next.completedDays=[];},{message:'食事の記録を削除しました。'});resetManual();});
bind('catalog-family','change',()=>{activeFamily=$('catalog-family').value;recordSelectionId='';renderRecordPicker();});
bind('catalog-item','change',renderRecordPicker);
bind('catalog-variant','change',renderRecordPicker);
bind('day-complete','change',()=>commit(next=>{next.completedDays=$('day-complete').checked?[...new Set([...next.completedDays,selectedDate])]:next.completedDays.filter(date=>date!==selectedDate);},{message:'記録の完了状態を更新しました。'}));
bind('nutrition-period','change',renderNutrition);
for(const id of ['recipe-family','recipe-nature','recipe-genre','recipe-method'])bind(id,'change',()=>{recipeLimit=12;renderCatalog();});
bind('recipe-food-category','change',()=>{$('recipe-method').value='all';recipeLimit=12;renderCatalog();});
bind('catalog-section','change',()=>{$('catalog-food-category').value='all';$('catalog-method').value='all';activeFamily='';$('catalog-family').value='';recordSelectionId='';renderRecordPicker();});
bind('catalog-food-category','change',()=>{$('catalog-method').value='all';recordSelectionId='';renderRecordPicker();});
bind('catalog-method','change',()=>{recordSelectionId='';renderRecordPicker();});
bind('catalog-nature','change',()=>{recordSelectionId='';renderRecordPicker();});
bind('profile-form','submit',event=>{event.preventDefault();const profile={ageBand:$('profile-age').value,sex:$('profile-sex').value,activity:$('profile-activity').value,mode:$('profile-mode').value};const reference=deriveReference(profile);if(profile.mode==='reference'&&!reference)throw Error('年代・基準表の性別・活動量を選んでください。75歳以上の「高い」活動量は参照値がないため手動で設定できます。');commit(next=>{next.profile=profile;if(profile.mode==='reference')next.targets={...reference.targets};},{message:'栄養の比較方法を保存しました。'});});
for(const id of ['catalog-food-category','recipe-food-category'])selectOptions($(id),[['all','すべての食材']],'all');
for(const id of ['catalog-method','recipe-method'])selectOptions($(id),[['all','すべての調理法']],'all');

bind('reset-selected-day','click',()=>performReset(resetFilter(selectedDate,selectedDate,'all')));
bind('reset-range-form','submit',event=>{event.preventDefault();performReset(resetFilter());});
for(const id of ['reset-from','reset-to','reset-status'])bind(id,'change',renderReset);
bind('undo-reset','click',()=>{if(undoReset)performUndo();});
for(const mode of ['simple','detailed'])bind('record-view-'+mode,'click',()=>commit(next=>{next.settings.recordView=mode;},{invalidate:false}));
bind('undo-last-action','click',performUndo);bind('undo-notice-action','click',performUndo);
bind('recovery-export','click',()=>{if(recovery){downloadText(recovery.raw,`meal-palette_original_${dateKey()}.json`);tell('保護中の元データを書き出しました。ファイルの保存を確認してください。');}});
bind('recovery-import','click',()=>$('import-file').click());
bind('recovery-restart','click',()=>{if(!recovery)return;if(!confirm('読み込めない元データを端末内へ退避して、新しい記録を始めますか？元データは復旧前にファイルへ書き出しておくことをお勧めします。'))return;replaceSavedJournal(defaultJournal(),'元データを退避して、新しい記録を始めました。退避データは設定画面から書き出せます。');});
bind('download-journal-backup','click',()=>{const backup=readJournalBackup(storage);if(!backup)throw Error('退避したデータがありません。');downloadText(backup.raw,`meal-palette_before_change_${backup.savedAt.slice(0,10)}.json`);tell('変更前の退避データを書き出しました。ファイルの保存を確認してください。');});
bind('restore-journal-backup','click',()=>{const backup=readJournalBackup(storage);if(!backup)throw Error('退避したデータがありません。');const previous=parseJournal(backup.raw,builtin);if(!confirm('変更前のデータへ戻しますか？現在の内容も端末内に退避してから置き換えます。'))return;replaceSavedJournal(previous,'変更前のデータへ戻しました。アレルギーと除外食材の設定も確認してください。');});
recordPickerSummary=createRecordSummary({data,getEntry:()=>{
  const id=recordPickerRecipeId(),recipe=recipeById(id);if(!recipe||isComposableRecipe(id)||soupIntakeFor(recipe,data()))return null;
  return createCatalogEntry({recipeId:id,date:selectedDate,meal:$('calendar-meal').value,status:$('calendar-status').value,amount:readQuantityInput($('catalog-amount')),note:''},data());
}});$('record-picker-summary').append(recordPickerSummary.element);
for(const eventName of ['input','change'])document.addEventListener(eventName,()=>{
  if(summaryRefreshQueued)return;summaryRefreshQueued=true;queueMicrotask(()=>{summaryRefreshQueued=false;recordPickerSummary?.refresh();for(const form of document.querySelectorAll('.catalog-record-form'))form.refreshRegistration?.();});
});
const activateTab=setupTabs({onKitchenRoute:setKitchenTab,startTab:()=>state.settings.startTab});
renderAll();if(loaded.message)tell(loaded.message,/読み込めません|元の保存データ/.test(loaded.message));
