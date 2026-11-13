import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RECIPES,INGREDIENTS} from '../data.js';
import {normaliseJapaneseSearch,matchesJapaneseQuery} from '../japanese-search.js';

const oldIds=JSON.parse(readFileSync(new URL('./fixtures/meal310-data-contract.json',import.meta.url),'utf8'));

test('v3.10公開済み1346名称の検索共通形を変えず、新しい読みを足す',()=>{
  const rows=[...oldIds.recipeIds.map(id=>{const r=RECIPES.find(recipe=>recipe.id===id);assert.ok(r,id);return{id,name:r.name,normalised:normaliseJapaneseSearch(r.name)};}),
    ...oldIds.ingredientIds.map(id=>({id,name:INGREDIENTS[id].name,normalised:normaliseJapaneseSearch(INGREDIENTS[id].name)}))];
  assert.equal(rows.length,1346);
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'3019ee04a0eef1a685214645c28854ccbe989cd1faf240d52f0de79a90f03e26');
});

test('追加した鍋・柚子胡椒・主副菜・お吸い物を自然な全文のかなで検索する',()=>{
  for(const [id,query]of[
    ['simmered-chicken-yuzu-kosho-nabe','とりにくとみずなのゆずこしょうなべ'],
    ['simmered-ishikari-nabe','さけとじゃがいものいしかりなべ'],
    ['simmered-duck-negi-nabe','あいがもとやきねぎのなべ'],
    ['simmered-pork-spinach-joya-nabe','ぶたにくとほうれんそうのじょうやなべ'],
    ['canteen-chicken-yuzu-grill','とりももにくのゆずこしょうやき'],
    ['canteen-chicken-mushroom-yuzu-steam','とりむねにくときのこのねぎゆずこしょうむし'],
    ['canteen-pork-aubergine-spicy-miso','ぶたにくとなすのさんしゅのじゃんいため'],
    ['canteen-chikuwa-isobe','ちくわのいそべあげ'],
    ['tavern-fluffy-yam-pan','だしかおるながいものふんわりてっぱんやき'],
    ['tavern-chicken-mentaiko-mayo','とりむねにくのめんたいまよやき'],
    ['bistro-mussel-garlic-bake','むーるがいのがーりっくぱんこやき'],
    ['bistro-escargot-herb-butter','えすかるごのこうそうばたーやき'],
    ['soup311-osuimono-tofu-wakame','とうふとわかめのおすいもの'],
    ['soup311-osuimono-asari','あさりのおすいもの'],
  ]){
    const recipe=RECIPES.find(item=>item.id===id);assert.ok(recipe,id);
    assert.ok(matchesJapaneseQuery([recipe.name],query),`${recipe.name} / ${query}`);
    assert.ok(matchesJapaneseQuery([query],recipe.name),`${query} / ${recipe.name}`);
  }
  for(const [id,query]of[['tavern_pork_liver','かんぞう'],['tavern_chicken_heart','しんぞう'],['tavern_onsen_egg','ひょうじゅん'],['soup311_consomme','こんそめすーぷのもと こけい']]){
    assert.ok(INGREDIENTS[id],id);assert.ok(matchesJapaneseQuery([INGREDIENTS[id].name],query));
  }
});
