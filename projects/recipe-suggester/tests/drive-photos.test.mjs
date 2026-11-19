import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivePhotos, driveRecipeKey, DRIVE_FILE_SCOPE} from '../drive-photos.js';
import {photoDimensions, prepareRecipePhoto, rasterType} from '../recipe-photo-image.js';

const uid = 'account-a', projectId = 'project';
const jpeg = new Blob([new Uint8Array([255,216,255,217])], {type:'image/jpeg'});
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function fixture(handle = () => json({files:[]})) {
  let ms = 0;
  const auth = {currentUser:{uid,email:'a@example.test'}};
  const log = [], providers = [];
  class GoogleAuthProvider {
    scopes = [];
    addScope(scope) { this.scopes.push(scope); }
    setCustomParameters(parameters) { this.parameters = parameters; }
    static credentialFromResult(result) { return result.credential; }
  }
  const sdk = {GoogleAuthProvider, async reauthenticateWithPopup(user, provider) {
    assert.equal(user,auth.currentUser); providers.push(provider);
    return {user,credential:{accessToken:'private-test-token'}};
  }};
  const drive = createDrivePhotos({sdk,auth,uid,projectId,isCurrent:()=>true,now:()=>ms,request:(url,options)=>{
    log.push({url:new URL(url),options}); return handle(new URL(url),options);
  }});
  return {drive, log, sdk, auth, providers, advance:()=>{ms += 51*60*1000;}};
}

test('明示的な同一ユーザの再認証でdrive.fileだけを要求し、再読み込みと期限切れで再接続を求める', async () => {
  const {drive,log,providers,advance} = fixture();
  await assert.rejects(drive.list('dish')); assert.equal(log.length,0);
  await drive.connect(); assert.deepEqual(providers[0].scopes,[DRIVE_FILE_SCOPE]);
  assert.equal(providers[0].parameters.login_hint,'a@example.test');
  await drive.list('dish','next'); assert.equal(log[0].options.headers.Authorization,'Bearer private-test-token');
  assert.equal(log[0].options.credentials,'omit'); assert.equal(log[0].options.cache,'no-store');
  assert.ok(!log[0].url.href.includes('private-test-token'));
  assert.equal(log[0].url.searchParams.get('pageToken'),'next');
  assert.match(log[0].url.searchParams.get('q'), /'me' in owners/);
  assert.match(log[0].url.searchParams.get('q'), /appProperties has/);
  assert.notEqual(await driveRecipeKey(projectId,uid,'dish'),await driveRecipeKey(projectId,'account-b','dish'));
  assert.equal(fixture().drive.connected(),false);
  advance(); await assert.rejects(drive.list('dish')); assert.equal(log.length,1);
});

test('別人の認証・キャンセル・退室直前の遅い応答では写真が開かない', async () => {
  const {drive,sdk} = fixture();
  sdk.reauthenticateWithPopup=async () => ({user:{uid:'other'},credential:{accessToken:'other-token'}});
  await assert.rejects(drive.connect(),/同じGoogle/);
  sdk.reauthenticateWithPopup=async () => {throw Object.assign(Error(),{code:'auth/popup-closed-by-user'});};
  await assert.rejects(drive.connect(),/取り消し/); assert.equal(drive.connected(),false);
  let done, started;
  const active = new Promise(resolve=>{started=resolve;});
  const second = fixture(()=>{started(); return new Promise(resolve=>{done=resolve;});});
  await second.drive.connect();
  const waiting = second.drive.list('dish'); await active;
  second.drive.stop(); done(json({files:[{id:'abc',name:'old',size:'4'}]}));
  await assert.rejects(waiting,/終了/); assert.equal(second.drive.connected(),false);
});

test('保存先は本人のマイドライブで料理IDを秘匿し、通信不明時の再試行は同じIDを確認する',async () => {
  const lookup = await driveRecipeKey(projectId,uid,'custom-1');
  let received, uploads=0;
  const {drive,log} = fixture(async (url,options)=>{
    if (url.pathname.endsWith('/generateIds')) return json({ids:['abc_-']});
    if (url.pathname.includes('/upload/')) {
      received=await options.body.text(); uploads++;
      return uploads===1 ? json({id:'abc_-'}) : json({error:{}},409);
    }
    if (url.searchParams.get('alt') === 'media') return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}});
    return json({appProperties:{mealPaletteRecipeV1:lookup}});
  });
  await drive.connect(); const id=await drive.allocate();
  await drive.upload('custom-1','自分のスープ',jpeg,id);
  assert.match(received,/multipart|Content-Type: application\/json/);
  assert.ok(received.includes(lookup) && !received.includes('custom-1') && !received.includes('a@example.test'));
  assert.ok(!received.includes('"permissions"') && !received.includes('"parents"'));
  await drive.upload('custom-1','自分のスープ',jpeg,id); assert.equal(uploads,2);
  assert.ok((await drive.read(id)).size===jpeg.size);
  await assert.rejects(drive.read('../x'));
  assert.ok(log.every(call=>call.url.origin==='https://www.googleapis.com'));
});

test('許可切れ、API未有効、形式の違うファイルを区別する', async () => {
  const expired=fixture(()=>json({error:{}},401));
  await expired.drive.connect(); await assert.rejects(expired.drive.list('dish'),/再接続/);
  assert.equal(expired.drive.connected(),false);
  const disabled=fixture(()=>json({error:{details:[{reason:'SERVICE_DISABLED'}]}},403));
  await disabled.drive.connect(); await assert.rejects(disabled.drive.list('dish'),/Driveのリンクを登録/);
  const incorrect=fixture(()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}));
  await incorrect.drive.connect(); await assert.rejects(incorrect.drive.read('abc'),/形式/);
});

test('画像入力はラスター3形式に限り、縦横比を維持しながら縮小する', async () => {
  assert.equal(rasterType(new Uint8Array([255,216,255])),'image/jpeg');
  assert.equal(rasterType(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(rasterType(new TextEncoder().encode('RIFF....WEBP')),'image/webp');
  assert.equal(rasterType(new TextEncoder().encode('<svg>')),null);
  await assert.rejects(prepareRecipePhoto(new Blob(['<svg>'],{type:'image/jpeg'})),/JPEG/);
  assert.deepEqual(photoDimensions(4000,3000),{width:1600,height:1200});
  assert.deepEqual(photoDimensions(600,900),{width:600,height:900});
  assert.throws(()=>photoDimensions(100_000,100_000));
});
