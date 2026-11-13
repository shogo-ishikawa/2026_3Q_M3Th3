import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {eligibleRecipes,generateCalendarPlan,describeRecipe} from '../planner.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {itemNutrition,summariseEntries} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {recipePortion} from '../catalog.js';
import {CONFECTIONERY_RECIPES,CONFECTIONERY_INGREDIENTS} from '../confectionery-foods.js';
import {DESSERT_RECIPES,DESSERT_INGREDIENTS} from '../dessert-foods.js';
import {COMFORT_RECIPES,COMFORT_INGREDIENTS} from '../comfort-foods.js';
import {ACCOMPANIMENT_RECIPES,ACCOMPANIMENT_INGREDIENTS} from '../accompaniment-foods.js';
import {SALAD_INGREDIENTS} from '../salad-builder.js';
import {DISH_CUSTOM_INGREDIENTS} from '../dish-customisation.js';

const reclassifiedSides = new Set(['classic-boiled-egg', 'classic-natto-plain', 'classic-natto-grated-daikon']);
// v3.6で副菜へ移した3品だけを旧roleへ戻し、歴史的な固定ハッシュを保ちます。
// 別の料理のrole変更や、3品の材料・量・栄養変更を許容する投影ではありません。
const historicalRole = recipe => reclassifiedSides.has(recipe.id) ? {...recipe, role: 'main'} : recipe;

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const newRecipePrefixes=['confectionery-','dessert-','comfort-','acmp-'];
// v3.4.0の公開DBの303食材。今回追加する素材と混ぜず、栄養や原料情報を照合します。
const legacyIngredientIds=`
chicken chicken_breast chicken_minced pork pork_minced beef beef_minced salmon
mackerel cod horse_mackerel sardine tuna shrimp squid crab
scallop clam egg tofu silken_tofu aburaage natto soybeans
edamame milk yogurt cheese butter rice pasta udon
soba bread flour rice_flour starch breadcrumbs onion carrot
potato sweet_potato cabbage chinese_cabbage spinach komatsuna broccoli cucumber
tomato canned_tomato daikon pumpkin aubergine pepper paprika zucchini
lettuce bean_sprout green_beans lotus_root burdock turnip okra celery
asparagus negi mushroom shimeji enoki shiitake corn wakame
hijiki apple orange kiwi banana peach grape ginger
garlic scallion_garnish shiso lemon parsley kombu bonito dried_sardine
salt sugar oil olive_oil sesame_oil sesame soy_sauce miso
vinegar mirin sake water black_pepper curry_powder paprika_powder chilli
dried_basil mayonnaise tomato_paste cashew peanut walnut almond yam
cauliflower beet green_pea kiriboshi_daikon taro red_cabbage chive nameko
avocado raisin lentil_cooked chickpea_cooked white_bean_cooked kidney_bean_cooked mozzarella soy_milk
coconut_milk ground_sesame lemon_slice ume turmeric cumin cornstarch tofu_dried
okara daikon_leaf barley winter_melon bitter_melon dried_shiitake mung_vermicelli brown_rice
cooked_barley wholegrain_bread oatmeal somen green_tea roasted_tea barley_tea oolong_tea
black_tea coffee cocoa_powder orange_juice apple_juice tomato_juice strawberry blueberry
yakisoba_noodles ramen_noodles bacon nori tuna_canned carbonated_water worcestershire_sauce oyster_sauce
pizza_base chocolate potato_chips rice_cracker biscuit vanilla_ice_cream kimchi shrimp_tempura
pine_nuts cola sports_drink fresh_basil uncooked_rice octopus steamed_pork_bun tuna_lean_sashimi
tuna_mediumfat_sashimi salmon_sashimi yellowtail_sashimi seabream_sashimi bonito_sashimi horse_mackerel_sashimi squid_sashimi scallop_sashimi
atka_mackerel_dried saury shishamo pork_loin dumpling_wrappers macaroni shirasu_dried mozuku
mekabu konjac bamboo_shoot_cooked cup_ramen_soy_dry cup_ramen_salt_dry cup_ramen_nonfried_dry cup_udon_dry cup_soba_dry
cup_yakisoba_dry bag_fried_noodles_dry bag_nonfried_noodles_dry retort_beef_curry retort_pork_curry retort_chicken_curry retort_oyakodon_topping retort_mapo_topping
hamburger_bun burger_meat_patty burger_chicken_patty ready_breaded_fish ready_sliced_ham retort_vegetable_curry_model retort_keema_curry_model retort_gyudon_model
retort_chukadon_model prepared_item_burger_plain prepared_item_burger_cheese prepared_item_burger_teriyaki prepared_item_burger_chicken prepared_item_burger_fish prepared_item_burger_double prepared_item_sandwich_egg
prepared_item_sandwich_ham prepared_item_sandwich_tuna prepared_item_sandwich_vegetable flounder yellowtail beef_stew_cut pork_belly shirataki
parmesan_cheese ikura_salted perf_beer perf_black_beer perf_sake perf_wine_red perf_wine_white perf_shochu
perf_whisky perf_umeshu perf_chuhai perf_soy_powder perf_whey_powder perf_milk_protein perf_cola_zero perf_ion_water
perf_energy perf_energy_zero perf_ginger_ale perf_bar_baked_choco perf_bar_baked_bitter perf_bar_manzoku perf_chicken_plain perf_chicken_herb
perf_chicken_smoke perf_calorie_block_choco perf_calorie_block_cheese perf_calorie_jelly_apple takeaway_harusame_wonton takeaway_harusame_egg takeaway_harusame_tantan takeaway_harusame_wakame_vegetable
takeaway_harusame_wakame_gomtang takeaway_knorr_corn takeaway_knorr_potage takeaway_knorr_mushroom takeaway_knorr_spinach takeaway_knorr_pumpkin takeaway_knorr_tomato takeaway_tomato_unsalted
takeaway_tomato_low_salt takeaway_yakitori_momo_tare takeaway_yakitori_momo_salt takeaway_yakitori_negima_tare takeaway_yakitori_tsukune_tare takeaway_yakitori_kawa_tare takeaway_yakitori_sunagimo_salt takeaway_eel_kabayaki
takeaway_unaju takeaway_shumai takeaway_frozen_suigyoza takeaway_spring_roll takeaway_tempura_shrimp takeaway_tempura_squid takeaway_tempura_maitake takeaway_beef_karubi
spring_roll_wrappers green_chilli fish_sauce eel_shirayaki beef_short_rib beef_tongue chicken_skin
`.trim().split(/\s+/u);
const recipeCore=recipe=>{
  recipe=historicalRole(recipe);
  const{name,variantLabel,sourceNote,family,...rest}=recipe;
  return {...rest,...(recipe.portion?{portion:Object.fromEntries(Object.entries(recipe.portion).filter(([key])=>key!=='label'))}:{})};
};

test('旧784品は名称・間食分類と3品の副菜への移動以外の量・材料・栄養・確認状況を保つ',()=>{
  const original=RECIPES.filter(recipe=>!newRecipePrefixes.some(prefix=>recipe.id.startsWith(prefix)));
  assert.equal(original.length,784);
  assert.equal(hash(original.map(recipeCore)),'bd9bedc6bcef769141bb69ed7fece27de47f513ec9707246961019c515a060de');
  const portions=original.map(recipe=>{const p=recipePortion(recipe,data);return{id:recipe.id,amount:p.amount,unit:p.unit};});
  assert.equal(hash(portions),'e040b0df1e816e804480fc58319d7cbe9738b25719482f5518c090ecf724c916');
  const ingredients=Object.fromEntries(legacyIngredientIds.map(id=>{
    assert.ok(INGREDIENTS[id],id);
    const{name,note,...rest}=INGREDIENTS[id];return[id,rest];
  }));
  assert.equal(Object.keys(ingredients).length,303);
  assert.equal(hash(ingredients),'50950b4afa3d853957a845a0d4b68542c09b86498e027f408597e69bf318fa2f');
  const profiles=Object.fromEntries(legacyIngredientIds.map(id=>[id,{nutritionPerUnit:INGREDIENTS[id].nutritionPerUnit,nutritionSource:INGREDIENTS[id].nutritionSource}]));
  assert.equal(hash(profiles),'2a7c214bd54f7d9d3943735d03fdab4d01833111670a97c7f2a3c30bd980aafa');
});

test('既存の購入品を料理名で表示しても、記録済みの店舗名と当時の栄養を置き換えない',()=>{
  const current=createCatalogEntry({recipeId:'takeaway-yakitori-momo-tare',date:'2026-11-13',meal:'dinner',status:'eaten',amount:3},data);
  const old=structuredClone(current);old.id='legacy-store-meal';old.items[0].id='legacy-store-item';
  old.items[0].name='焼鳥日本一 もも串（たれ）';
  old.items[0].sourceNote='過去の商品表示を記録したものです。出典: https://www.nihonichi.jp/products/component';
  const state=defaultJournal('2026-11-13');state.entries=[old,current];
  const loaded=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(loaded.entries,state.entries);
  assert.equal(loaded.entries[0].items[0].name,'焼鳥日本一 もも串（たれ）');
  assert.equal(itemNutrition(loaded.entries[0].items[0]).kcal,282);
  assert.equal(itemNutrition(loaded.entries[1].items[0]).kcal,282);
  const shopping=shoppingForEntries([{...current,status:'planned'}],data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  assert.equal(shopping.items.find(item=>item.id==='takeaway_yakitori_momo_tare').required,6);
});

test('確認済みのマイメニューなら購入形態だけで禁止せず、アレルギーと除外は優先する',()=>{
  for(const nature of ['ready-to-eat','instant','retort','fast-food']){
    const recipe={id:'custom-confirmed-product',name:'確認した購入品',role:'snack',family:'sweets',nature,
      servings:1,minutes:3,staple:false,custom:true,ingredients:[{id:'milk',amount:100}],steps:[],
      allergensKnown:true,ingredientsKnown:true,allergens:[],groups:[],proteinSources:[],
      manualNutrition:{kcal:60,protein:3,fat:3,carbs:4,fiber:0,salt:.1}};
    const customData={...data,recipes:[recipe]};
    assert.deepEqual(eligibleRecipes({},customData).map(item=>item.id),[recipe.id],nature);
    assert.deepEqual(eligibleRecipes({allergens:['milk']},customData),[],nature);
    assert.deepEqual(eligibleRecipes({excludedIngredients:['milk']},customData),[],nature);
    const plan=generateCalendarPlan({startDate:'2026-11-13',days:1,servings:1,meal:'snack',seed:7},customData);
    assert.equal(plan.ok,true,nature);assert.deepEqual(plan.days[0].recipeIds,[recipe.id],nature);
    for(const field of ['allergensKnown','ingredientsKnown']){
      const unknown={...recipe,[field]:false},unknownData={...data,recipes:[unknown]};
      const settings=field==='ingredientsKnown'?{excludedIngredients:['soy_sauce']}:{};
      assert.deepEqual(eligibleRecipes(settings,unknownData),[],nature+'/'+field);
    }
  }
});

test('追加63品を実際の公開DBへ統合し、未確認の購入品だけを自動提案から外す',()=>{
  const products=[...CONFECTIONERY_RECIPES,...DESSERT_RECIPES];
  const additions=[...products,...COMFORT_RECIPES];
  assert.equal(additions.length,63);
  assert.equal(RECIPES.length,847+ACCOMPANIMENT_RECIPES.length);
  assert.equal(Object.keys(INGREDIENTS).length,363+Object.keys(ACCOMPANIMENT_INGREDIENTS).length+Object.keys(SALAD_INGREDIENTS).length+Object.keys(DISH_CUSTOM_INGREDIENTS).length);
  assert.equal(new Set(RECIPES.map(recipe=>recipe.id)).size,RECIPES.length);
  assert.equal(new Set(RECIPES.map(recipe=>recipe.name)).size,RECIPES.length);
  for(const recipe of additions)assert.ok(RECIPES.some(integrated=>integrated.id===recipe.id),recipe.id);
  for(const id of Object.keys({...CONFECTIONERY_INGREDIENTS,...DESSERT_INGREDIENTS,...COMFORT_INGREDIENTS})){
    assert.ok(INGREDIENTS[id],id);assert.ok(INGREDIENTS[id].nutritionPerUnit,id);
  }
  const choices=new Set(eligibleRecipes({},data).map(recipe=>recipe.id));
  for(const recipe of products)assert.ok(!choices.has(recipe.id),recipe.id);
  for(const recipe of COMFORT_RECIPES)assert.ok(choices.has(recipe.id),recipe.id);
  const productOnly={...data,recipes:RECIPES.filter(recipe=>products.some(product=>product.id===recipe.id))};
  const plan=generateCalendarPlan({startDate:'2026-11-13',days:1,servings:1,meal:'snack',seed:7},productOnly);
  assert.equal(plan.ok,false);
});

test('異なる表示単位の間食をまとめて記録し、実食栄養と購入数を別々に正しく集計する',()=>{
  const inputs=[['confectionery-pocky',14.5],['confectionery-golden-milk-candy',3],
    ['dessert-strawberry-shortcake',.5],['dessert-grape-ice-bites',6]];
  const entries=inputs.map(([recipeId,amount])=>createCatalogEntry({recipeId,amount,date:'2026-11-13',meal:'snack',status:'eaten'},data));
  const state=defaultJournal('2026-11-13');state.entries=entries;state.completedDays=['2026-11-13'];
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored.entries,entries);
  assert.deepEqual(restored.entries.map(entry=>entry.items[0].quantity),[.5,3,.5,.5]);
  const summary=summariseEntries(restored.entries,{from:'2026-11-13',to:'2026-11-13'});
  assert.ok(Math.abs(summary.values.kcal-345.4)<1e-8);
  assert.ok(Math.abs(summary.values.protein-3.67)<1e-8);
  assert.ok(Math.abs(summary.values.salt-.2092)<1e-8);
  assert.equal(summary.complete.fiber,false);
  for(const record of restored.entries){
    const item=record.items[0];assert.equal(item.allergensKnown,false);assert.equal(item.ingredientsKnown,false);
    assert.equal(item.shoppingKnown,true);assert.deepEqual(item.steps,[]);assert.match(item.sourceNote,/https:\/\//);
  }
  const settings={from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[{id:'confectionery_pocky',amount:.25}]};
  assert.equal(shoppingForEntries(restored.entries,data,settings).items.length,0);
  const shopping=shoppingForEntries(restored.entries.map(entry=>({...entry,status:'planned'})),data,settings);
  assert.deepEqual(Object.fromEntries(shopping.items.map(item=>[item.id,{required:item.required,unit:item.unit}])),{
    confectionery_pocky:{required:1,unit:'袋'},confectionery_golden_milk_candy:{required:6,unit:'個'},
    dessert_strawberry_shortcake:{required:1,unit:'個'},dessert_grape_ice_bites:{required:1,unit:'袋'},
  });
  assert.equal(shopping.items.find(item=>item.id==='confectionery_pocky').buy,.75);
  assert.equal(shopping.missingMenus.length,4);
});

