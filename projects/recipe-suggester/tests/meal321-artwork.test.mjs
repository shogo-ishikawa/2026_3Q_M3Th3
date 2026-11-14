import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RECIPES,INGREDIENTS} from '../data.js';
import {MENU_VARIATION_GROUPS} from '../menu-variations.js';
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

test('公開済みv3.20の全1013料理・456食材を全項目と順序まで保持する',()=>{
  assert.equal(RECIPES.length,1013);assert.equal(Object.keys(INGREDIENTS).length,456);
  assert.deepEqual(RECIPES.map(recipe=>recipe.id),source.recipeIds);
  assert.deepEqual(Object.keys(INGREDIENTS),source.ingredientIds);
  assert.equal(hash(RECIPES),source.recipesHash);assert.equal(hash(INGREDIENTS),source.ingredientsHash);
});

test('選択式メニューの点検記録が全操作系統を覆い、全104標準料理とピザトーストに絵がある',()=>{
  const expected=[
    ...MENU_VARIATION_GROUPS.filter(visible).map(row=>`menu-variation:${row.id}`),
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
  for(const definition of MENU_VARIATION_GROUPS.filter(visible)){
    const entry=audit.entries.find(row=>row.kind==='menu-variation'&&row.group===definition.id);
    assert.equal(entry.defaultRecipeId,definition.defaultRecipeId,definition.id);
  }
  for(const id of targets){const recipe=RECIPES.find(row=>row.id===id);assert.ok(recipe,id);assert.ok(recipeArtwork(recipe),id);}
});

test('以前の150品の絵・生成記録・大小300ファイルを変更せず、新しい73品を個別に追加する',()=>{
  assert.equal(oldArt.ids.length,150);assert.equal(Object.keys(RECIPE_ARTWORK).length,223);
  assert.equal(hash(Object.fromEntries(oldArt.ids.map(id=>[id,RECIPE_ARTWORK[id]]))),oldArt.artworkHash);
  const oldIds=new Set(oldArt.ids);assert.equal(hash(prompts.images.filter(row=>oldIds.has(row.id))),oldArt.promptsHash);
  for(const [path,expected] of Object.entries(oldArt.files))assert.equal(digest(readFileSync(new URL(`../${path}`,import.meta.url))),expected,path);
  assert.equal(prompts.images.length,223);assert.equal(new Set(prompts.images.map(row=>row.id)).size,223);
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
