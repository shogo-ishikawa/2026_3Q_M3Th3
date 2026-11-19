import {pre331Recipes, pre331Ingredients, recipesAddedSince330, added331IngredientIds} from './helpers/meal331-contract.mjs';
import {EVENING_RECIPES} from './helpers/evening-additions.mjs';
import {BREAKFAST_RECIPES,BREAKFAST_INGREDIENTS} from '../breakfast-recipes.js';
import {PANTRY_V325_INGREDIENT_IDS,withoutPantryV325Ingredients} from './helpers/pantry-v325-additions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RECIPES,INGREDIENTS} from '../data.js';
import {MENU_VARIATION_GROUPS,getVariationGroup,groupMenuRecipes} from '../menu-variations.js';
import {FOOD_COMPOSERS} from '../food-composer.js';
import {DISH_CUSTOMISERS} from '../dish-customisation.js';
import {MEAT_CHOICES} from '../meat-choices.js';
import {NOODLE_STYLES} from '../noodle-foods.js';
import {curryRiceFor} from '../curry-rice.js';
import {recipeArtwork} from '../recipe-illustration.js';
import {RECIPE_ARTWORK} from '../recipe-artwork-manifest.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const source=read('./fixtures/meal320-data-contract.json');
const oldArt=read('./fixtures/meal320-artwork-contract.json');
const audit=read('../docs/selectable-artwork.json');
const prompts=read('../docs/recipe-artwork-prompts.json');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>digest(JSON.stringify(canonical(value)));
const data={recipes:RECIPES,ingredients:INGREDIENTS};
const visible=recipe=>!['drink','snack'].includes(recipe.role);

test('v3.30の全1045料理・463食材を意図しただしと市販品の改訂以外は維持する', () => {
  assert.equal(pre331Recipes.length, 1045);
  assert.equal(Object.keys(pre331Ingredients).length, 463);
  assert.equal(digest(JSON.stringify(pre331Recipes)), '68e922177de75e3483a5f98ec7a86ac3eec465a005063d1c94630cc8ae52b397');
  assert.equal(digest(JSON.stringify(pre331Ingredients)), '45ece7cd02bbf57d85c5967555b9c4ec5b39f7d420ab32f895af47d277a160af');
});

test('v3.27の全1021料理と463食材の全項目と順序を保持する', () => {
  const eveningIds = new Set(EVENING_RECIPES.map(recipe => recipe.id));
  const previousRecipes = pre331Recipes.filter(recipe => !eveningIds.has(recipe.id));
  assert.equal(previousRecipes.length, 1021);
  assert.equal(Object.keys(pre331Ingredients).length, 463);
  assert.equal(digest(JSON.stringify(previousRecipes)), 'e1d46533267d5c0095305657176907d5eae0682bfdb1cff0cb4a1829c3b3d870');
  assert.equal(digest(JSON.stringify(pre331Ingredients)), '45ece7cd02bbf57d85c5967555b9c4ec5b39f7d420ab32f895af47d277a160af');
});

test('公開済みv3.20の全1013料理・456食材を全項目と順序まで保持する',()=>{
  assert.equal(RECIPES.length,1013+BREAKFAST_RECIPES.length+EVENING_RECIPES.length + recipesAddedSince330.length);assert.equal(Object.keys(INGREDIENTS).length,456+PANTRY_V325_INGREDIENT_IDS.length+Object.keys(BREAKFAST_INGREDIENTS).length + added331IngredientIds.size);
  const addedIds=new Set([...BREAKFAST_RECIPES,...EVENING_RECIPES].map(recipe=>recipe.id));
  const previousRecipes=pre331Recipes.filter(recipe=>!addedIds.has(recipe.id));
  const previousIngredients=withoutPantryV325Ingredients(Object.fromEntries(Object.entries(pre331Ingredients).filter(([id])=>!Object.hasOwn(BREAKFAST_INGREDIENTS,id))));
  assert.deepEqual(previousRecipes.map(recipe=>recipe.id),source.recipeIds);
  assert.deepEqual(Object.keys(previousIngredients),source.ingredientIds);
  assert.equal(hash(previousRecipes),source.recipesHash);assert.equal(hash(previousIngredients),source.ingredientsHash);
});

test('v3.21で点検した全122入口の104標準料理とピザトーストの絵を保持する',()=>{
  assert.equal(audit.release,'3.21.0');
  const auditedGroups=audit.entries.filter(row=>row.kind==='menu-variation');
  const baselineIds=new Set(auditedGroups.map(row=>row.group));
  assert.equal(baselineIds.size,61);
  // v3.33から「具だくさんの丼」の個別料理は「丼もの」の中で選びます。
  const retained=MENU_VARIATION_GROUPS.filter(row=>visible(row)&&baselineIds.has(row.id));
  const previousBowl=auditedGroups.find(row=>row.group==='rice-bowls');
  const bowlGroup=getVariationGroup(previousBowl.defaultRecipeId,RECIPES);
  assert.equal(bowlGroup.groupId,'donburi');
  assert.equal(bowlGroup.selectedRecipeId,previousBowl.defaultRecipeId);
  const expected=[
    ...retained.map(row=>`menu-variation:${row.id}`),
    'menu-variation:rice-bowls',
    ...FOOD_COMPOSERS.filter(visible).map(row=>`food-composer:${row.kind}`),
    ...DISH_CUSTOMISERS.map(row=>`dish-customiser:${row.kind}`),
    ...MEAT_CHOICES.map(row=>`meat:${row.recipeId}`),
    ...NOODLE_STYLES.map(row=>`noodle:${row.recipeId}`),
    ...RECIPES.filter(recipe=>curryRiceFor(recipe.id,data)).map(row=>`curry:${row.id}`),
    'salad:salad',
  ].sort();
  assert.equal(expected.length,122);
  assert.deepEqual(audit.entries.map(row=>`${row.kind}:${row.group}`).sort(),expected);
  const targets=new Set(audit.entries.map(row=>row.defaultRecipeId));
  assert.equal(targets.size,104);targets.add('bread-toast-pizza');
  for(const definition of retained){
    const entry=audit.entries.find(row=>row.kind==='menu-variation'&&row.group===definition.id);
    assert.equal(entry.defaultRecipeId,definition.defaultRecipeId,definition.id);
  }
  for(const id of targets){const recipe=RECIPES.find(row=>row.id===id);assert.ok(recipe,id);assert.ok(recipeArtwork(recipe),id);}
});

test('イラスト限定のメニューには対応画像を持つ全種類だけが残り、各入口から正しい代表画像を解決する',()=>{
  const illustrated=RECIPES.filter(recipe=>recipeArtwork(recipe));
  const menus=groupMenuRecipes(illustrated);
  const ids=menus.flatMap(menu=>menu.recipes.map(recipe=>recipe.id));
  assert.deepEqual(ids.sort(),Object.keys(RECIPE_ARTWORK).sort());
  for(const menu of menus){
    assert.ok(menu.recipes.some(recipe=>recipe.id===menu.selectedRecipeId),menu.key);
    assert.equal(recipeArtwork(menu.recipe)?.recipeId,menu.selectedRecipeId,menu.key);
  }
});

test('旧版150品とv3.21でそろえた選択式メニューを含む全223品の画像を保持する',()=>{
  const previousIds=new Set([...oldArt.ids,...audit.entries.map(row=>row.defaultRecipeId),'bread-toast-pizza']);
  assert.equal(oldArt.ids.length,150);
  assert.equal(previousIds.size,223);
  for(const id of previousIds)assert.ok(RECIPE_ARTWORK[id],id);
  assert.equal(hash(Object.fromEntries(oldArt.ids.map(id=>[id,RECIPE_ARTWORK[id]]))),oldArt.artworkHash);
  const oldIds=new Set(oldArt.ids);assert.equal(hash(prompts.images.filter(row=>oldIds.has(row.id))),oldArt.promptsHash);
  for(const [path,expected] of Object.entries(oldArt.files))assert.equal(digest(readFileSync(new URL(`../${path}`,import.meta.url))),expected,path);
});

test('画像台帳と生成記録の料理ID・大小の画像ファイル・記録された容量が一致する',()=>{
  assert.deepEqual(prompts.images.map(row=>row.id).sort(),Object.keys(RECIPE_ARTWORK).sort());
  const imageHashes=new Set();
  for(const [id,art] of Object.entries(RECIPE_ARTWORK)){
    const row=prompts.images.find(row=>row.id===id);assert.ok(row,id);
    for(const key of ['src','largeSrc']){
      const bytes=readFileSync(new URL(`../${art[key]}`,import.meta.url));
      assert.equal(bytes.toString('ascii',0,4),'RIFF',art[key]);assert.equal(bytes.toString('ascii',8,12),'WEBP',art[key]);
      assert.equal(bytes.length,row[key==='src'?'bytes':'largeBytes'],art[key]);
    }
    const bytes=readFileSync(new URL(`../${art.src}`,import.meta.url));
    const value=digest(bytes);assert.ok(!imageHashes.has(value),`別料理の画像を流用しない: ${id}`);imageHashes.add(value);
  }
});
