import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {MENU_VARIATION_GROUPS, validateVariationDefinitions, groupMenuRecipes, getVariationGroup, variantLabel, variationSearchAliases} from '../menu-variations.js';
import {catalogVariants, recipeNature, recipePortion} from '../catalog.js';
import {eligibleRecipes} from '../planner.js';
import {recipeNutrition, itemNutrition} from '../nutrition.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {shoppingForEntries} from '../shopping.js';
import {matchesJapaneseQuery} from '../japanese-search.js';
import {browseDishes} from '../dish-hierarchy.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const byId = new Map(RECIPES.map(recipe => [recipe.id, recipe]));
const date = '2026-11-13';
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('料理を変更せず65の見出しへ種類をまとめ、全料理を重複なく1回ずつ残す', () => {
  const before = JSON.stringify(RECIPES);
  const groups = groupMenuRecipes(RECIPES);
  assert.ok(groups.length < RECIPES.length - 200, '一覧を整理し、詳細で選べる種類を増やす');
  assert.equal(groups.filter(group => group.isGroup).length, 65);
  assert.ok(groups.filter(group => group.isGroup).reduce((sum,group) => sum+group.variantCount,0) >= 300);
  const ids = groups.flatMap(group => group.recipes.map(recipe => recipe.id));
  assert.equal(new Set(ids).size, RECIPES.length);
  assert.deepEqual(new Set(ids), new Set(RECIPES.map(recipe => recipe.id)));
  for (const definition of MENU_VARIATION_GROUPS) {
    const group = groups.find(candidate => candidate.groupId===definition.id);
    assert.ok(group, definition.id);
    assert.equal(group.label, definition.label);
    assert.equal(group.variantCount, definition.recipeIds.length);
    assert.equal(group.recipe.id, group.selectedRecipeId);
    assert.deepEqual(new Set(group.recipes.map(recipe=>recipe.id)),new Set(definition.recipeIds));
    for (const recipe of group.recipes) {
      assert.equal(recipe.role, definition.role);
      assert.equal(recipeNature(recipe), definition.nature);
      assert.equal(recipe.staple, definition.staple);
      assert.equal(recipe.mealBase, definition.mealBase);
    }
  }
  assert.equal(JSON.stringify(RECIPES), before);
});

test('手作りと購入形態、主食の有無、主菜と主食を分け、寿司の元の量単位を保つ', () => {
  const curry = getVariationGroup('daily-curry-beef',RECIPES);
  const retort = getVariationGroup('prepared-retort-beef-curry',RECIPES);
  assert.notEqual(curry.key, retort.key);
  assert.ok(curry.recipes.every(recipe => recipe.nature==='home-cooked'));
  assert.ok(retort.recipes.every(recipe => recipe.nature==='retort'));
  assert.equal(getVariationGroup('pasta-meat',RECIPES), null, '古いmain-roleパスタをstaple-roleへ混ぜない');
  assert.equal(getVariationGroup('classic-sushi-assorted',RECIPES).groupId,'nigiri');
  assert.equal(recipePortion(byId.get('classic-sushi-assorted'),data).unit,'皿');
  assert.equal(recipePortion(byId.get('classic-sushi-tuna'),data).unit,'貫');
  assert.equal(getVariationGroup('staple-rice-porridge',RECIPES), null);
  assert.equal(getVariationGroup('classic-sushi-tuna',RECIPES).groupId,'nigiri');
  assert.equal(getVariationGroup('sushi-hosomaki-kappa',RECIPES).groupId,'hosomaki');
  assert.equal(getVariationGroup('sushi-gunkan-natto',RECIPES).groupId,'gunkan');
  const source=byId.get('daily-curry-beef');
  for (const changed of [{...source,role:'main'},{...source,nature:'ready-to-eat'},{...source,mealBase:false},{...source,staple:false}]) {
    assert.equal(groupMenuRecipes([changed])[0].isGroup,false);
  }
});

test('握り11種と既存の盛り合わせを同じ入口にまとめても単品の種類数を水増ししない', () => {
  const group=getVariationGroup('classic-sushi-assorted',RECIPES);
  assert.equal(group.recipe.id,'classic-sushi-assorted');
  assert.equal(group.variantCount,12,'11種の単品と既存の盛り合わせ1レシピ');
  assert.equal(group.recipes.filter(recipe=>recipe.id!=='classic-sushi-assorted').length,11);
  const groups=groupMenuRecipes(RECIPES.filter(recipe=>group.recipes.some(member=>member.id===recipe.id)),{query:'にぎり寿司'});
  assert.equal(groups.length,1);
  assert.equal(groups[0].label,'にぎり寿司');
  assert.equal(groups[0].variantCount,12);
  assert.deepEqual(new Set(groups[0].recipes.map(recipe=>recipe.id)),new Set(group.recipes.map(recipe=>recipe.id)));
});

test('検索と除外で絞った候補を補完せず、代表は候補内の料理名一致から選ぶ', () => {
  const matching = catalogVariants(RECIPES,'pasta',{query:'カルボナーラ'});
  const groups = groupMenuRecipes(matching,{allRecipes:RECIPES,query:'カルボナーラ'});
  assert.equal(groups.length,1);
  assert.equal(groups[0].label,'パスタ');
  assert.equal(groups[0].variantCount,1);
  assert.equal(groups[0].selectedRecipeId,'daily-pasta-carbonara');
  assert.deepEqual(groups[0].recipes.map(recipe=>recipe.id),matching.map(recipe=>recipe.id));
  const wide = getVariationGroup('daily-pasta-carbonara',RECIPES).recipes;
  const ranked = groupMenuRecipes(wide,{query:'カルボナーラ'})[0];
  assert.equal(ranked.selectedRecipeId,'daily-pasta-carbonara');
  assert.deepEqual(ranked.recipes,wide,'代表を選び直しても選択肢の順を変えない');
  const settings=defaultJournal(date).settings; settings.allergens=['milk'];
  const allowed=eligibleRecipes(settings,data);
  const pasta=getVariationGroup('daily-pasta-peperoncino',allowed);
  assert.ok(pasta);
  assert.ok(!pasta.recipes.some(recipe=>recipe.id==='daily-pasta-carbonara'));
  assert.equal(getVariationGroup('daily-pasta-carbonara',allowed),null);
  assert.ok(!groupMenuRecipes(allowed,{allRecipes:RECIPES}).some(group=>group.groupId==='cup-ramen'));
});

test('検索がなければ候補の初出順と選択肢の順を保ち、未知・自作メニューも残す', () => {
  const rows=[byId.get('daily-pasta-carbonara'),byId.get('pork-ginger'),byId.get('daily-pasta-bolognese')];
  const groups=groupMenuRecipes(rows);
  assert.equal(groups[0].groupId,'pasta');
  assert.equal(groups[1].recipe.id,'pork-ginger');
  assert.equal(groups[0].selectedRecipeId,'daily-pasta-carbonara');
  assert.deepEqual(groups[0].recipes.map(recipe=>recipe.id),['daily-pasta-carbonara','daily-pasta-bolognese']);
  const custom={...rows[0],id:'custom-pasta-carbonara',name:'自分のパスタ',custom:true};
  const unknown={...rows[0],id:'future-pasta'};
  const all=groupMenuRecipes([...rows,custom,unknown]);
  assert.equal(all.at(-2).label,'自分のパスタ');
  assert.equal(all.at(-2).isGroup,false);
  assert.equal(all.at(-1).recipe.id,'future-pasta');
  assert.equal(all.at(-1).isGroup,false);
});

test('選んだバリエーションの材料・単位・栄養・買い物をそのレシピの量で記録する', () => {
  const group=getVariationGroup('daily-onigiri-salmon',RECIPES);
  const selected=group.recipe, portion=recipePortion(selected,data);
  const entry=createCatalogEntry({recipeId:group.selectedRecipeId,date,meal:'lunch',status:'planned',amount:portion.amount*2,note:''},data);
  assert.equal(entry.items[0].recipeId,selected.id);
  assert.equal(entry.items[0].name,selected.name);
  assert.equal(entry.items[0].quantity,2);
  assert.equal(entry.items[0].portion.unit,'個');
  const expected=recipeNutrition(selected,data),actual=itemNutrition(entry.items[0]);
  for(const key of Object.keys(expected)) expected[key]===null?assert.equal(actual[key],null):near(actual[key],expected[key]*2);
  const shopping=shoppingForEntries([entry],data,{from:date,to:date,servings:3});
  for(const part of selected.ingredients)near(shopping.items.find(item=>item.id===part.id).required,part.amount/selected.servings*2*3);
  const state=defaultJournal(date);state.entries=[entry];
  const loaded=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(loaded.entries[0],entry);
  assert.equal(groupMenuRecipes(RECIPES).find(row=>row.groupId==='onigiri').label,'おにぎり');
  assert.equal(loaded.entries[0].items[0].name,selected.name,'表示のグループ名で過去の料理名を書き換えない');
});

test('肉じゃがとお好み焼きはカスタマイズ入口として一般名へまとめる', () => {
  const nikujaga=getVariationGroup('beef-potato',RECIPES),okonomi=getVariationGroup('seafood-okonomiyaki',RECIPES);
  assert.equal(nikujaga.label,'肉じゃが');
  assert.equal(nikujaga.customiserKind,'nikujaga');
  assert.equal(nikujaga.variantCount,1);
  assert.equal(nikujaga.recipe.name,'牛肉の肉じゃが');
  assert.equal(okonomi.label,'お好み焼き');
  assert.equal(okonomi.customiserKind,'okonomiyaki');
  assert.equal(okonomi.recipe.name,'海鮮とキャベツのお好み焼き');
});

test('重複所属と不正入力を拒否し、対象外のIDにはグループを作らない', () => {
  assert.equal(validateVariationDefinitions(),true);
  assert.throws(()=>validateVariationDefinitions([{id:'a',label:'A',recipeIds:['same']},{id:'b',label:'B',recipeIds:['same']}]),/複数/);
  assert.throws(()=>validateVariationDefinitions([{id:'a',label:'A',recipeIds:['a','a']}]),/複数/);
  assert.throws(()=>validateVariationDefinitions([{id:'a',label:'A',recipeIds:['a']},{id:'a',label:'B',recipeIds:['b']}]),/名前と識別子/);
  assert.throws(()=>groupMenuRecipes(null),/一覧/);
  assert.throws(()=>groupMenuRecipes([byId.get('beef-potato'),byId.get('beef-potato')]),/識別子/);
  assert.throws(()=>groupMenuRecipes(RECIPES,{query:1}),/検索/);
  assert.equal(getVariationGroup('missing',RECIPES),null);
  assert.equal(getVariationGroup('acmp-egg-raw',RECIPES),null);
  assert.deepEqual(groupMenuRecipes([]),[]);
  assert.equal(variantLabel({name:'保存した料理',variantLabel:'具の種類'}),'具の種類');
  assert.equal(variantLabel({name:'保存した料理'}),'保存した料理');
});


test('グループの表示名も検索用の複製へ足せるが、元の料理名は書き換えない', () => {
  for(const [id,query] of [['prepared-cup-udon-kitsune','カップうどん'],['prepared-retort-beef-curry','レトルトカレーライス'],['sushi-gunkan-ikura','軍艦巻き']]) {
    const recipe=byId.get(id),before=JSON.stringify(recipe);
    assert.ok(matchesJapaneseQuery([recipe.name,...variationSearchAliases(recipe)],query));
    assert.equal(JSON.stringify(recipe),before);
  }
  assert.deepEqual(variationSearchAliases(byId.get('acmp-egg-raw')),[]);
  assert.deepEqual(variationSearchAliases({...byId.get('daily-pasta-carbonara'),custom:true}),[]);
});


test('実際のメニュー検索でもグループ見出しから定義済みの内訳へ到達し、元DBを変更しない', () => {
  const before=JSON.stringify(RECIPES);
  const view=RECIPES.map(recipe=>({...recipe,searchAliases:[...(recipe.searchAliases??[]),...variationSearchAliases(recipe)]}));
  const definedIds=id=>new Set(MENU_VARIATION_GROUPS.find(group=>group.id===id).recipeIds);
  assert.deepEqual(new Set(browseDishes(view,{query:'カップうどん'}).map(recipe=>recipe.id)),definedIds('cup-udon'));
  assert.deepEqual(new Set(browseDishes(view,{query:'軍艦巻き'}).map(recipe=>recipe.id)),definedIds('gunkan'));
  assert.deepEqual(new Set(catalogVariants(view,'curry',{query:'レトルトカレーライス'}).map(recipe=>recipe.id)),definedIds('retort-curry'));
  assert.equal(JSON.stringify(RECIPES),before);
  for(const recipe of RECIPES)assert.ok(!Object.hasOwn(recipe,'searchAliases'),'検索用の見出しを元DBへ書き戻さない');
});

test('見出し検索を使っても区分・提供形態・アレルギーで除外した内訳を戻さない', () => {
  const viewCopy=recipes=>recipes.map(recipe=>({...recipe,searchAliases:[...(recipe.searchAliases??[]),...variationSearchAliases(recipe)]}));
  const view=viewCopy(RECIPES);
  assert.deepEqual(browseDishes(view,{query:'カップうどん',nature:'home-cooked'}),[]);
  assert.deepEqual(browseDishes(view,{query:'軍艦巻き',section:'main'}),[]);
  assert.deepEqual(catalogVariants(view,'curry',{query:'レトルトカレーライス',nature:'home-cooked'}),[]);
  const settings=defaultJournal(date).settings;settings.allergens=['milk'];
  const allowed=eligibleRecipes(settings,data);
  const gunkanIds=new Set(MENU_VARIATION_GROUPS.find(group=>group.id==='gunkan').recipeIds);
  const expected=allowed.filter(recipe=>gunkanIds.has(recipe.id));
  assert.ok(expected.length>0&&expected.length<gunkanIds.size,'乳を含まない軍艦だけを選択肢へ残す');
  const found=browseDishes(viewCopy(allowed),{query:'軍艦巻き'});
  assert.deepEqual(new Set(found.map(recipe=>recipe.id)),new Set(expected.map(recipe=>recipe.id)));
  assert.ok(found.every(recipe=>!recipe.allergens.includes('milk')));
});


test('追加した見出しは実際の同じ料理の種類へ到達し、別の料理を取り込まない', () => {
  for (const [id, groupId, label, expectedIds] of [
    ['daily-pizza-margherita','pizza','ピザ',['daily-pizza-margherita','daily-pizza-mixed','daily-pizza-teriyaki','daily-pizza-seafood']],
    ['daily-fried-rice-egg','fried-rice','チャーハン',['daily-fried-rice-egg','daily-fried-rice-gomoku','daily-fried-rice-kimchi','daily-fried-rice-shrimp']],
    ['daily-ramen-soy','ramen','ラーメン',['daily-ramen-soy','daily-ramen-salt','daily-ramen-miso','daily-ramen-tanmen']],
    ['classic-croquette-potato','croquette','コロッケ',['classic-croquette-potato','classic-croquette-pumpkin','classic-croquette-cream']],
    ['drink-milk','milk','牛乳・豆乳',['drink-milk','drink-soy-milk']],
    ['drink-orange-juice','juice','果汁・野菜ジュース',['drink-orange-juice','drink-apple-juice','drink-tomato-juice']],
  ]) {
    const group = getVariationGroup(id, RECIPES);
    assert.ok(group, id);
    assert.equal(group.groupId, groupId);
    assert.equal(group.label, label);
    assert.deepEqual(group.recipes.map(recipe=>recipe.id),expectedIds);
  }
  assert.ok(!getVariationGroup('daily-fried-rice-egg',RECIPES).recipes.some(recipe=>recipe.id==='comfort-sobameshi'));
  assert.ok(!getVariationGroup('classic-karaage-thigh',RECIPES).recipes.some(recipe=>recipe.id==='familiar-yurinchi'));
  assert.ok(!getVariationGroup('daily-donburi-pork',RECIPES).recipes.some(recipe=>['varied-bibimbap','varied-gapao-rice','familiar-loco-moco'].includes(recipe.id)));
});

test('組み合わせ料理の入口を保ちながら手作り・購入品と主菜・副菜の条件を分ける', () => {
  const home = getVariationGroup('varied-yakitori-thigh-tare',RECIPES);
  const takeaway = getVariationGroup('takeaway-yakitori-momo-tare',RECIPES);
  assert.equal(home.groupId,'yakitori');
  assert.equal(takeaway.groupId,'takeaway-yakitori');
  assert.ok(home.recipes.every(recipe=>recipe.nature==='home-cooked'));
  assert.ok(takeaway.recipes.every(recipe=>recipe.nature==='ready-to-eat'));
  const mainTempura=getVariationGroup('varied-shrimp-tempura',RECIPES);
  const sideTempura=getVariationGroup('varied-shimeji-tempura',RECIPES);
  assert.notEqual(mainTempura.key,sideTempura.key);
  assert.ok(mainTempura.recipes.every(recipe=>recipe.role==='main'));
  assert.ok(sideTempura.recipes.every(recipe=>recipe.role==='side'));
  const sandwich=getVariationGroup('prepared-sandwich-egg',RECIPES);
  assert.ok(sandwich.recipes.every(recipe=>recipe.nature==='ready-to-eat'));
  assert.ok(!sandwich.recipes.some(recipe=>recipe.id==='palette-sandwich'));
  assert.equal(getVariationGroup('classic-sashimi-tuna',RECIPES).groupId,'sashimi');
});

test('魚介やアレルギー条件で絞った追加グループは対象外の種類を再導入しない', () => {
  const fishGyoza=browseDishes(RECIPES,{section:'main',category:'fish',query:'餃子'});
  const groups=groupMenuRecipes(fishGyoza,{query:'餃子'});
  const groupedIds=groups.flatMap(group=>group.recipes.map(recipe=>recipe.id));
  assert.deepEqual(new Set(groupedIds),new Set(fishGyoza.map(recipe=>recipe.id)));
  assert.ok(!groupedIds.includes('classic-gyoza'));
  const settings=defaultJournal(date).settings;settings.allergens=['milk'];
  const allowed=eligibleRecipes(settings,data);
  const hamburg=getVariationGroup('beef-hamburg',allowed);
  assert.ok(hamburg);
  assert.ok(!hamburg.recipes.some(recipe=>recipe.id==='familiar-hamburg-cheese'));
  const subset=homeSubset();
  const selected=getVariationGroup('varied-yakitori-thigh-salt',subset);
  assert.deepEqual(selected.recipes.map(recipe=>recipe.id),['varied-yakitori-thigh-salt']);
  function homeSubset(){return RECIPES.filter(recipe=>recipe.id==='varied-yakitori-thigh-salt');}
});
