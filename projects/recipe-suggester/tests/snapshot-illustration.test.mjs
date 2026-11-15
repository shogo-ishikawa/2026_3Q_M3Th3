import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {describeRecipe} from '../planner.js';
import {itemFromRecipe} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {createFavourite,validateFavourites} from '../favourites.js';
import {recipeArtwork,snapshotArtworkRecipe} from '../recipe-illustration.js';
import {recipeIllustrationElement} from '../recipe-illustration-ui.js';
import {BREAD_PRESETS} from '../bread-foods.js';
import {foodComposerDefinition,foodPresetSelection,buildFoodSelection} from '../food-composer.js';

const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const recipe=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const snapshot=(quantity=1)=>({...itemFromRecipe(describeRecipe(recipe.id,data),data,quantity),portion:recipePortion(recipe,data)});

test('献立の少なめ・普通・多めの保存内容から標準画像を表示し、材料と量を変えない',()=>{
  for(const quantity of [.5,1,1.5]){
    const item=snapshot(quantity),before=structuredClone(item),resolved=snapshotArtworkRecipe(item,data);
    assert.equal(recipeArtwork(item),null);
    assert.equal(resolved.id,recipe.id);
    assert.equal(recipeArtwork(resolved).src,'assets/recipe-art/chicken-teriyaki.webp');
    assert.deepEqual(item,before);
    resolved.ingredients[0].amount=999;
    assert.notEqual(recipe.ingredients[0].amount,999);
  }
});

test('お気に入りのJSON保存と再読込を経ても、元の料理に一致する完成イメージを返す',()=>{
  const favourite=createFavourite(snapshot(.5),data,{name:'また食べたい照り焼き'});
  const restored=validateFavourites(JSON.parse(JSON.stringify([favourite])),data)[0];
  assert.equal(snapshotArtworkRecipe(restored.item,data).id,recipe.id);
  restored.item.ingredients.reverse();restored.item.groups.reverse();
  assert.equal(snapshotArtworkRecipe(restored.item,data).id,recipe.id);
  assert.equal(snapshotArtworkRecipe({...restored.item,quantity:0},data),null);
});

test('似た料理・アレンジ・変更前の保存材料・栄養や手順に現在の画像を後付けしない',()=>{
  const changes=[
    item=>{item.recipeId='missing-recipe';},
    item=>{item.recipeId=null;},
    item=>{item.name+='（アレンジ）';},
    item=>{item.ingredients[0].amount+=10;},
    item=>{item.ingredients[0].id='soy-sauce';},
    item=>{item.nutrition.kcal+=10;},
    item=>{item.nutrition.protein=null;},
    item=>{item.steps[0]+=' 調理方法を変更';},
    item=>{item.allergensKnown=false;},
    item=>{item.portion.amount+=1;},
    item=>{item.portion.unit='個';},
  ];
  for(const change of changes){const item=snapshot();change(item);assert.equal(snapshotArtworkRecipe(item,data),null);}
  const item=snapshot(),customData={...data,recipes:data.recipes.map(row=>row.id===item.recipeId?{...row,custom:true}:row)};
  assert.equal(snapshotArtworkRecipe(item,customData),null);
  assert.equal(snapshotArtworkRecipe(item,{...data,recipes:[...data.recipes,recipe]}),null);
});

test('画像のある全標準レシピの1人分スナップショットを照合でき、画像のない料理は画像なしで残す',()=>{
  for(const base of RECIPES){
    const item=itemFromRecipe(describeRecipe(base.id,data),data,.5),before=structuredClone(item);
    assert.equal(Boolean(snapshotArtworkRecipe(item,data)),Boolean(recipeArtwork(base)),base.id);
    assert.deepEqual(item,before);
  }
  for(const item of [null,{},[],42,{recipeId:'chicken-teriyaki',quantity:1}])assert.equal(snapshotArtworkRecipe(item,data),null);
});

test('保存内容の画像も非表示設定を守り、表示時だけ正しい詳細画像を読み込む',()=>{
  const previous=globalThis.document,requests=[];
  globalThis.document={createElement(tag){return {tag,children:[],append(...children){this.children.push(...children);},addEventListener(){},set src(value){requests.push(value);}};}};
  try{
    const resolved=snapshotArtworkRecipe(snapshot(.5),data);
    assert.equal(recipeIllustrationElement(resolved,{detail:true,hidden:true}),null);
    assert.deepEqual(requests,[]);
    const figure=recipeIllustrationElement(resolved,{detail:true,standard:true});
    assert.ok(figure);
    assert.deepEqual(requests,['assets/recipe-art/chicken-teriyaki-large.webp']);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('パンの組み合わせをお気に入りへ保存した後も、標準プリセットに全内容が一致すれば同じ絵を表示する',()=>{
  for(const [kind,presets] of Object.entries(BREAD_PRESETS))for(const preset of presets){
    const definition=foodComposerDefinition(kind),config=foodPresetSelection(kind,preset.id),order=new Map(definition.components.map((part,index)=>[part.id,index]));
    const controlOrder=[...config.components].sort((a,b)=>order.get(a.id)-order.get(b.id));
    for(const components of [config.components,controlOrder]){
      const composed=buildFoodSelection({...config,components},data),item={...itemFromRecipe(composed,data,.5),portion:recipePortion(composed,data)};
      const favourite=createFavourite(item,data),restored=validateFavourites(JSON.parse(JSON.stringify([favourite])),data)[0],before=structuredClone(restored);
      const pictured=snapshotArtworkRecipe(restored.item,data);
      assert.equal(pictured?.id,recipeArtwork(RECIPES.find(recipe=>recipe.id===preset.recipeId))?preset.recipeId:undefined,`${kind}/${preset.id}`);
      assert.deepEqual(restored,before);
    }
  }
});

test('パンの名前だけ・材料だけが同じでも、変更した量・手順・出典の保存内容に標準の絵を付けない',()=>{
  const recipe=buildFoodSelection(foodPresetSelection('toast','pizza'),data),item={...itemFromRecipe(recipe,data),portion:recipePortion(recipe,data)};
  assert.equal(snapshotArtworkRecipe(item,data).id,'bread-toast-pizza');
  for(const change of [
    item=>{item.name='自分のピザトースト';},
    item=>{item.steps[0]='独自の方法で調理する';},
    item=>{item.ingredients.find(part=>part.id==='cheese').amount+=1;},
    item=>{item.sourceNote='具材や調理法を変更した料理';},
    item=>{item.nutrition.kcal+=1;},
    item=>{item.recipeId='custom-arbitrary-toast';},
  ]){const changed=structuredClone(item);change(changed);assert.equal(snapshotArtworkRecipe(changed,data),null);}
});
