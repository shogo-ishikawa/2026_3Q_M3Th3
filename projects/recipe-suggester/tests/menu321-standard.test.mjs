import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {MENU_VARIATION_GROUPS, groupMenuRecipes, getVariationGroup} from '../menu-variations.js';

const standards = MENU_VARIATION_GROUPS.filter(group => !['drink','snack'].includes(group.role));
const groupFor = (id, recipes=RECIPES, query='') => groupMenuRecipes(recipes,{query}).find(group => group.groupId===id);

test('飲み物と間食を除いた61の選択式入口は、並び順に左右されない標準レシピを持つ',()=>{
  const before=JSON.stringify(RECIPES);
  assert.equal(standards.length,61);
  for(const definition of standards){
    assert.ok(definition.recipeIds.includes(definition.defaultRecipeId),definition.id);
    assert.equal(groupFor(definition.id).selectedRecipeId,definition.defaultRecipeId,definition.id);
    assert.equal(groupFor(definition.id,[...RECIPES].reverse()).selectedRecipeId,definition.defaultRecipeId,definition.id);
  }
  assert.equal(JSON.stringify(RECIPES),before);
});

test('一般名で開く標準は、ご飯・かけ麺・ポークカレー・盛り合わせ・パンのみのトースト',()=>{
  for(const [id,query,expected] of [
    ['rice','ご飯','plain-rice'],['udon','うどん','daily-udon-plain'],['soba','そば','daily-soba-plain'],
    ['curry','カレー','daily-curry-pork'],['nigiri','にぎり寿司','classic-sushi-assorted'],
    ['sashimi','刺身','classic-sashimi-assorted'],['toast','トースト','bread-toast-custom'],
    ['hamburg','ハンバーグ','classic-hamburg'],['karaage','唐揚げ','classic-karaage-thigh'],
  ])assert.equal(groupFor(id,RECIPES,query).selectedRecipeId,expected,query);
});

test('具材や味を指定した検索と、詳細で開いた元の種類を標準値で上書きしない',()=>{
  for(const [id,query,expected] of [
    ['toast','バタートースト','staple-butter-toast'],['toast','ピザトースト','bread-toast-pizza'],
    ['curry','チキンカレー','daily-curry-chicken'],['pasta','カルボナーラ','daily-pasta-carbonara'],
    ['sashimi','まぐろ赤身の刺身','classic-sashimi-tuna'],['nigiri','サーモンのにぎり寿司','classic-sushi-salmon'],
  ]){
    assert.equal(groupFor(id,RECIPES,query).selectedRecipeId,expected,query);
    assert.equal(getVariationGroup(expected,RECIPES).selectedRecipeId,expected,expected);
  }
});

test('標準が除外された候補だけの一覧へ、標準料理や他の候補を復元しない',()=>{
  for(const definition of standards.filter(group=>group.recipeIds.length>1)){
    const candidates=RECIPES.filter(recipe=>definition.recipeIds.includes(recipe.id)&&recipe.id!==definition.defaultRecipeId);
    const group=groupFor(definition.id,candidates);
    assert.ok(group,definition.id);
    assert.equal(group.selectedRecipeId,candidates[0].id,definition.id);
    assert.deepEqual(group.recipes,candidates,definition.id);
  }
});
