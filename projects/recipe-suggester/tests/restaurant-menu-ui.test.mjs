import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountRestaurantMenu} from '../restaurant-menu-ui.js';
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};this.value='';}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS},base=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const all=root=>[root,...root.children.flatMap(all)];const find=(root,name)=>{const value=all(root).find(node=>node.className.split(' ').includes(name));assert.ok(value,name);return value;};
function withDocument(fn){const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
function set(root,name,value,event='input'){const field=find(root,name);field.value=String(value);field.emit(event);}
const initial={storeName:'表示確認用の店',sizeName:'普通',inclusion:'チキンと付け合わせ。ご飯は別。',riceIncluded:false,sidesIncluded:true,basis:'portion',portionAmount:1,portionUnit:'食',sourceUrl:'https://example.com/menu',checkedDate:'2026-11-13',nutrition:{kcal:450,protein:30,fat:20,carbs:35,salt:2.5}};

test('既存料理から店舗の表示値を登録し、不正入力では古い結果で保存させない',()=>withDocument(()=>{
  const outputs=[],root=mountRestaurantMenu({baseRecipe:base,data,initial,onChange:value=>outputs.push(value)});assert.ok(outputs[0]);assert.ok(!all(root).some(node=>node.tagName==='FORM'));
  const id=outputs[0].id;assert.equal(outputs[0].manualNutrition.fiber,null);set(root,'restaurant-nutrient-kcal','');assert.equal(outputs.at(-1),null);assert.equal(find(root,'restaurant-preview').hidden,true);
  set(root,'restaurant-nutrient-kcal','500');assert.equal(outputs.at(-1).manualNutrition.kcal,500);assert.equal(outputs.at(-1).id,id);
  set(root,'restaurant-url','javascript:alert(1)');assert.equal(outputs.at(-1),null);set(root,'restaurant-url','https://example.com/menu');assert.ok(outputs.at(-1));
}));

test('100g表示に切り替えたら測定重量を求め、提供量へ一度だけ反映する',()=>withDocument(()=>{
  let recipe;const root=mountRestaurantMenu({baseRecipe:base,data,initial,onChange:value=>{recipe=value;}});
  set(root,'restaurant-basis','per100g','change');assert.equal(recipe,null);assert.equal(find(root,'restaurant-portion').value,'');assert.equal(find(root,'restaurant-unit').value,'g');assert.equal(find(root,'restaurant-unit').disabled,true);
  set(root,'restaurant-portion',250);assert.equal(recipe.manualNutrition.kcal,1125);assert.equal(recipe.portion.amount,250);
  set(root,'restaurant-nutrient-kcal',200);assert.equal(recipe.manualNutrition.kcal,500);assert.equal(recipe.restaurant.basisAmount,100);
}));

test('マイデータベースから一般料理を検索・選択し、店とサイズを紐づける',()=>withDocument(()=>{
  let recipe;const root=mountRestaurantMenu({data,initial:{...initial,menuName:'店のチキン'},onChange:value=>{recipe=value;}});assert.equal(recipe,null);
  set(root,'restaurant-generic-search','てりやき');const picker=find(root,'restaurant-generic-select');assert.ok(picker.children.some(option=>option.value===base.id));
  set(root,'restaurant-generic-select',base.id,'change');assert.ok(recipe);assert.equal(recipe.restaurant.genericRecipeId,base.id);
  const selectedId=recipe.id;set(root,'restaurant-generic-search','該当しない言葉');assert.ok(picker.children.some(option=>option.value===base.id));assert.equal(picker.value,base.id);assert.equal(recipe.id,selectedId);
  const rice=find(root,'restaurant-rice');rice.checked=true;rice.emit('change');assert.equal(recipe.role,'staple');assert.equal(recipe.mealBase,true);
}));

test('提供量は1単位ずつ変わり小数を保持し、未掲載成分と不正な数値入力を区別する',()=>withDocument(()=>{
  let recipe;const root=mountRestaurantMenu({baseRecipe:base,data,initial:{...initial,basis:'per100g',portionAmount:250.5,portionUnit:'g',nutrition:{...initial.nutrition,kcal:200}},onChange:value=>{recipe=value;}});
  const portion=find(root,'restaurant-portion');portion.emit('keydown',{key:'ArrowUp'});assert.equal(Number(portion.value),251.5);assert.equal(recipe.manualNutrition.kcal,503);
  set(root,'restaurant-portion','12.25');assert.equal(recipe.portion.amount,12.25);assert.equal(recipe.manualNutrition.kcal,24.5);
  const fiber=find(root,'restaurant-nutrient-fiber');fiber.value='';fiber.validity={badInput:true};fiber.emit('input');assert.equal(recipe,null);
  fiber.validity={badInput:false};fiber.emit('input');assert.ok(recipe);assert.equal(recipe.manualNutrition.fiber,null);
  set(root,'restaurant-portion','0x10');assert.equal(recipe,null);
}));
