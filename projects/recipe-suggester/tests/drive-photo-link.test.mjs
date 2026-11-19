import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseDrivePhotoLink,validateDrivePhotoLinks} from '../drive-photo-link.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';

const root = 'https://drive.google.com';
const url = root + '/file/d/photo_0123456789/view';
const recipeId = RECIPES[0].id;
const data = {recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
test('Drive link preserves resource keys and strips tracking parameters',()=>{
  assert.equal(normaliseDrivePhotoLink(url+'?usp=sharing'),url);
  assert.equal(normaliseDrivePhotoLink(root+'/open?id=photo_0123456789&resourcekey=0-example'),url+'?resourcekey=0-example');
  for (const input of [root+'/drive/folders/photo_0123456789','https://another.example/file/d/photo_0123456789/view','http://drive.google.com/open?id=photo_0123456789',url.replace('drive.google.com','drive.google.com.example'),url.replace('https://','https://other@'),url+'?resourcekey=a%2Fb','javascript:alert(1)']) {
    assert.throws(()=>normaliseDrivePhotoLink(input));
  }
});
test('Private journal preserves links with no effect on existing data or drafts',()=>{
  const existing = defaultJournal('2026-11-19');
  assert.deepEqual(validateJournal(existing,data), existing);
  const link = {recipeId,url};
  const copy = validateJournal({...existing,drivePhotoLinks:[link]},data);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)).drivePhotoLinks,[link]);
  assert.throws(()=>validateJournal({...copy,drivePhotoLinks:[{recipeId:'unknown',url}]},data));
  assert.throws(()=>validateDrivePhotoLinks([link,{...link,url:url+'?usp=sharing'}],new Set([recipeId])));
});
