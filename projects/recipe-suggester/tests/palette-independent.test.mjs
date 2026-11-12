import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {analyseIntake, compareIntake} from '../intake.js';
import {recipeFamily, recipePortion, quantityFromAmount, catalogVariants, isCompleteMeal} from '../catalog.js';
import {itemFromRecipe, itemNutrition, summariseEntries} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {generateCalendarPlan, activeRecipeIds} from '../planner.js';
const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const six=(kcal=0,protein=0,fat=0,carbs=0,fiber=0,salt=0)=>({kcal,protein,fat,carbs,fiber,salt});
const food=(id,nutrition,quantity=1)=>({id,recipeId:null,name:id,quantity,nutrition,ingredients:[],ingredientsKnown:false,allergens:[],allergensKnown:false,groups:[],proteinSources:[],steps:[],role:'main'});
const entry=(id,date,items,status='eaten',note='')=>({id,date,meal:'dinner',status,note,items});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

test('独立確認：平均の分母は記録完了かつその成分が既知の日だけにする',()=>{
  const entries=[entry('known','2026-11-10',[food('a',six(120,4))]),entry('partial','2026-11-11',[food('b',{...six(200),protein:null})]),entry('incomplete','2026-11-12',[food('c',six(500,50))]),entry('planned','2026-11-12',[food('p',six(9999,9999))],'planned'),entry('future','2026-11-13',[food('f',six(9999,9999))])];
  const r=analyseIntake(entries,{to:'2026-11-12',days:7,completedDays:['2026-11-10','2026-11-11']});
  assert.equal(r.totals.values.kcal,820);assert.equal(r.totals.values.protein,54);
  assert.equal(r.mean.kcal,160);assert.equal(r.knownDays.kcal,2);
  assert.equal(r.mean.protein,4);assert.equal(r.knownDays.protein,1);
  assert.equal(r.completedCount,2);
});

test('独立確認：未完了の記録だけでは平均0を作らずnullにする',()=>{
  const r=analyseIntake([entry('only','2026-11-12',[food('meal',six(800,30))])],{to:'2026-11-12',days:7,completedDays:[]});
  assert.equal(r.totals.values.kcal,800);assert.equal(r.mean.kcal,null);assert.equal(r.knownDays.kcal,0);
});

test('独立確認：メモだけの実食は全成分不明で平均の既知日数に含めない',()=>{
  const entries=[entry('note','2026-11-12',[],'eaten','外食（内容不明）')];
  const day=summariseEntries(entries,{from:'2026-11-12',to:'2026-11-12'});
  assert.equal(day.unknownItems,1);assert.equal(day.complete.kcal,false);assert.equal(day.complete.protein,false);
  const r=analyseIntake(entries,{to:'2026-11-12',days:7,completedDays:['2026-11-12']});
  assert.equal(r.mean.kcal,null);assert.equal(r.knownDays.kcal,0);assert.equal(r.completedCount,1);
});

test('独立確認：飲食なしと完了確認した空の日は明示的な0として扱える',()=>{
  const r=analyseIntake([],{to:'2026-11-12',days:1,completedDays:['2026-11-12']});
  assert.equal(r.mean.kcal,0);assert.equal(r.knownDays.kcal,1);
});

test('独立確認：食塩は未満で食物繊維は以上、不明分は比較しない',()=>{
  const reference={ranges:{fat:{min:50,max:75}}};
  assert.equal(compareIntake('salt',7.5,{target:7.5,reference}).kind,'above');
  assert.equal(compareIntake('salt',7.49,{target:7.5,reference}).kind,'within');
  assert.equal(compareIntake('fiber',20,{target:20,reference}).kind,'within');
  assert.equal(compareIntake('fat',50,{target:62.5,reference}).kind,'within');
  assert.equal(compareIntake('salt',1,{target:7.5,reference,complete:false}).kind,'unknown');
});

test('独立確認：ご飯200gを1人分に記録して2人の買物へ一度だけ倍率を掛ける',()=>{
  const recipe=RECIPES.find(r=>r.id==='plain-rice');
  assert.equal(recipePortion(recipe,data).amount,150);
  const item=itemFromRecipe(recipe,data,quantityFromAmount(recipe,data,200));
  close(itemNutrition(item).kcal,312);
  const r=shoppingForEntries([entry('rice','2026-11-12',[item],'planned')],data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[{id:'rice',amount:175}]});
  const rice=r.items.find(i=>i.id==='rice');close(rice.required,400);close(rice.buy,225);
});

test('独立確認：ご飯とおにぎりは別分類、個数の記録は主食gと取り違えない',()=>{
  const rice=RECIPES.find(r=>r.id==='plain-rice'),onigiri=RECIPES.find(r=>r.id==='staple-salt-onigiri');
  assert.equal(recipeFamily(rice),'rice');assert.equal(recipeFamily(onigiri),'onigiri');
  assert.equal(recipePortion(onigiri,data).unit,'個');assert.equal(quantityFromAmount(onigiri,data,2),2);
  assert.ok(!catalogVariants(RECIPES,'rice').some(r=>r.id===onigiri.id));
  assert.ok(isCompleteMeal({id:'review-udon',name:'たぬきうどん',role:'staple',staple:true}));
});

test('独立確認：メモだけの予定は買い物不要ではなく材料未確認と知らせる',()=>{
  const r=shoppingForEntries([entry('note','2026-11-12',[],'planned','外食か持ち帰りを予定')],data,{from:'2026-11-12',to:'2026-11-12'});
  assert.equal(r.items.length,0);assert.deepEqual(r.missingMenus,[{entryId:'note',name:'外食か持ち帰りを予定'}]);
});

test('独立確認：手入力の人分単位は保存とカタログで同じように扱える',()=>{
  const state=defaultJournal('2026-11-12');state.customRecipes=[{id:'custom-independent',name:'手入力の料理',role:'main',portion:{amount:1,unit:'人分'}}];
  const recipe=validateJournal(state,data).customRecipes[0];assert.equal(recipePortion(recipe,data).unit,'人分');
});

test('独立確認：未登録の大分類を含むマイDBは表示前に拒否する',()=>{
  const state=defaultJournal('2026-11-12');state.customRecipes=[{id:'custom-independent',name:'手入力の料理',role:'main',family:'not-a-registered-family'}];
  assert.throws(()=>validateJournal(state,data),/種類|分類|登録|メニュー/);
});

test('独立確認：間食の提案に夕食の主菜や別の主食を重ねない',()=>{
  const plan=generateCalendarPlan({startDate:'2026-11-12',days:1,servings:2,meal:'snack',stapleId:'plain-rice',drinkId:'drink-water',seed:20},data,{meal:'snack',entries:[],completedDays:[]});
  assert.equal(plan.ok,true);const recipes=activeRecipeIds(plan.days[0]).map(id=>RECIPES.find(r=>r.id===id));
  assert.equal(recipes.filter(r=>r.role==='snack').length,1);assert.equal(recipes.filter(r=>r.role==='drink').length,1);
  assert.equal(recipes.length,2);
});

test('独立確認：提案と栄養タブは完了済みの飲食ゼロ日も同じ平均分母に含める',()=>{
  const entries=[{...entry('known','2026-11-11',[food('meal',six(200,10))]),meal:'breakfast'}],completedDays=['2026-11-10','2026-11-11'];
  const intake=analyseIntake(entries,{to:'2026-11-11',days:7,completedDays});
  const plan=generateCalendarPlan({startDate:'2026-11-12',days:1,meal:'dinner',seed:19},data,{entries,completedDays});
  assert.equal(plan.ok,true);assert.equal(intake.mean.kcal,100);
  assert.equal(plan.days[0].nutritionBasis.completedDayCount,2);
  assert.equal(plan.days[0].nutritionBasis.dailyMeans.kcal,intake.mean.kcal);
});

test('独立確認：完了日に既知の食事と内容不明のメモが混じる場合は提案でも全日既知にしない',()=>{
  const entries=[{...entry('known','2026-11-11',[food('meal',six(200,10))]),meal:'breakfast'},entry('unknown','2026-11-11',[],'eaten','外食の内容は不明')],completedDays=['2026-11-11'];
  const intake=analyseIntake(entries,{to:'2026-11-11',days:7,completedDays});
  const plan=generateCalendarPlan({startDate:'2026-11-12',days:1,meal:'dinner',seed:29},data,{entries,completedDays});
  assert.equal(intake.mean.kcal,null);assert.equal(plan.ok,true);
  assert.equal(plan.days[0].nutritionBasis.dailyMeans.kcal,null);
  assert.equal(plan.days[0].nutritionBasis.complete.kcal,false);
});

test('独立確認：参照モードのJSONに任意の数値を紛れ込ませても公式値として表示させない',async()=>{
  const {deriveReference}=await import('../dietary-reference.js');
  const state=defaultJournal('2026-11-12');state.profile={ageBand:'18-29',sex:'male',activity:'moderate',mode:'reference'};state.targets=deriveReference(state.profile).targets;
  assert.equal(validateJournal(state,data).targets.kcal,2600);
  state.targets.kcal=1000;assert.throws(()=>validateJournal(state,data),/比較値|一致|プロフィール/);
  state.profile.ageBand='75-plus';state.profile.activity='high';assert.throws(()=>validateJournal(state,data),/比較値|基準|プロフィール/);
});

test('独立確認：主食への再分類は指定した料理のアレルゲン除外を回避しない',()=>{
  const recipe=RECIPES.find(r=>recipeFamily(r)==='pasta'&&r.ingredients.some(part=>INGREDIENTS[part.id].allergens.includes('milk')));
  assert.ok(recipe,'乳を含むパスタを実データから選ぶ');
  const plan=generateCalendarPlan({startDate:'2026-11-12',days:1,meal:'dinner',stapleId:recipe.id,allergens:['milk'],seed:41},data,{entries:[],completedDays:[]});
  assert.equal(plan.ok,false);assert.ok(plan.missingRoles.includes('staple'));
});
