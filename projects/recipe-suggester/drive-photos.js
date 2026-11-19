// 写真本体と料理の対応情報の保存先は、ログイン中の本人のマイドライブ。
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const API = 'https://www.googleapis.com';
const PROPERTY = 'mealPaletteRecipeV1';
const fileId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);

export async function driveRecipeKey(projectId, uid, recipeId) {
  if (![projectId, uid, recipeId].every(part => typeof part === 'string' && part.length)) throw Error('写真を保存する料理とアカウントを確認してください。');
  const input = new TextEncoder().encode(JSON.stringify([projectId, uid, recipeId]));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createDrivePhotos({auth, sdk, uid, projectId, isCurrent, request = fetch, now = Date.now}) {
  let token = '', until = 0, stopped = false, controller = new AbortController();
  const current = () => !stopped && isCurrent() && auth.currentUser?.uid === uid;
  const connected = () => current() && Boolean(token) && now() < until;
  function disconnect() {
    token = ''; until = 0;
    controller.abort(); controller = new AbortController();
  }
  function check(signal) {
    if (!current() || signal?.aborted) throw Error('写真の操作を終了しました。');
  }
  async function connect() {
    const signal = controller.signal;
    check(signal);
    const provider = new sdk.GoogleAuthProvider();
    provider.addScope(DRIVE_FILE_SCOPE);
    provider.setCustomParameters({login_hint: auth.currentUser.email});
    try {
      const result = await sdk.reauthenticateWithPopup(auth.currentUser, provider);
      check(signal);
      if (result.user.uid !== uid) throw Error('同じGoogleアカウントを選んでください。');
      const access = sdk.GoogleAuthProvider.credentialFromResult(result)?.accessToken;
      if (!access) throw Error('写真を保存する権限を確認できません。もう一度接続してください。');
      token = access; until = now() + 50 * 60 * 1000;
    } catch (error) {
      if (['auth/popup-closed-by-user','auth/cancelled-popup-request','auth/user-cancelled','auth/unauthorized-domain','auth/popup-blocked','auth/user-mismatch','auth/access-denied'].includes(error.code)) {
        const messages = {'auth/popup-blocked':'ポップアップを許可して、もう一度接続してください。',
          'auth/user-mismatch':'Meal PaletteにログインしたGoogleアカウントを選んでください。',
          'auth/unauthorized-domain':'このサイトからDriveへの接続が許可されていません。「Driveのリンクを登録」も使えます。'};
        throw Error(messages[error.code] ?? 'Driveへの接続を取り消しました。');
      }
      if (error.code) throw Error('Google Driveに接続できません。通信を確認して再度お試しください。');
      throw error;
    }
  }
  async function call(path, options = {}) {
    const signal = controller.signal, credential = token;
    check(signal);
    if (!connected()) throw Error('Google Driveにもう一度接続してください。');
    let response;
    try {
      response = await request(API + path, {...options, signal, credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',
        headers:{...options.headers, Authorization:'Bearer ' + credential}});
    } catch {
      check(signal);
      throw Error('Driveとの通信を確認できません。オンラインで再度お試しください。');
    }
    check(signal);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      check(signal);
      const details = payload?.error;
      const reasons = [...(details?.errors ?? []), ...(details?.details ?? [])].map(item => item.reason);
      if (response.status === 401 || reasons.includes('insufficientPermissions') || reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
        if (token === credential) disconnect();
        throw Error('写真へのアクセス許可が必要です。Google Driveに再接続してください。');
      }
      if (response.status === 403 && (reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED'))) throw Error('このアプリのGoogle Drive APIが有効になっていません。「Driveのリンクを登録」を利用できます。');
      if (response.status === 404) throw Error('写真が移動または削除されています。一覧を更新してください。');
      if (response.status === 403 && reasons.includes('storageQuotaExceeded')) throw Error('Google Driveの空き容量を確認してください。');
      const error = Error('Google Driveで操作を完了できませんでした。再度試すか、「Driveのリンクを登録」を利用してください。');
      error.status = response.status;
      throw error;
    }
    return response;
  }
  const key = id => driveRecipeKey(projectId, uid, id);
  async function list(recipeId, pageToken) {
    const lookup = await key(recipeId);
    const params = new URLSearchParams({q:"trashed = false and 'me' in owners and mimeType = 'image/jpeg' and appProperties has { key = '" + PROPERTY + "' and value = '" + lookup + "' }",
      spaces:'drive', corpora:'user', pageSize:'12', orderBy:'createdTime desc', fields:'nextPageToken,files(id,name,createdTime,size)'});
    if (pageToken) params.set('pageToken', pageToken);
    const signal = controller.signal;
    const result = await (await call('/drive/v3/files?' + params)).json();
    check(signal);
    const files = result.files.filter(file => fileId(file.id) && typeof file.name === 'string' && Number(file.size) <= PHOTO_MAX_BYTES);
    return {files, next:result.nextPageToken ?? null};
  }
  async function allocate() {
    const signal = controller.signal;
    const result = await (await call('/drive/v3/files/generateIds?count=1&space=drive')).json();
    check(signal);
    if (!fileId(result.ids?.[0])) throw Error('Driveの保存先を作成できませんでした。');
    return result.ids[0];
  }
  async function upload(recipeId, name, blob, id) {
    if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || !blob.size || blob.size > PHOTO_MAX_BYTES || !fileId(id)) throw Error('保存する写真を選び直してください。');
    const signal = controller.signal, lookup = await key(recipeId);
    check(signal);
    const metadata = {id, name:'Meal Palette - ' + String(name).slice(0,80) + '.jpg', mimeType:'image/jpeg', appProperties:{[PROPERTY]:lookup}};
    const boundary = 'meal-palette-' + crypto.randomUUID();
    const body = new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),
      '\r\n--'+boundary+'\r\nContent-Type: image/jpeg\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
    try {
      await call('/upload/drive/v3/files?uploadType=multipart&fields=id', {method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
    } catch (error) {
      if (error.status !== 409) throw error;
      // 応答だけが途切れた保存を再試行した場合、同じIDの写真を二重に作らない。
      const stored = await (await call('/drive/v3/files/'+id+'?fields=appProperties,trashed')).json();
      if (stored.trashed || stored.appProperties?.[PROPERTY] !== lookup) throw error;
    }
    check(signal);
  }
  async function read(id) {
    if (!fileId(id)) throw Error('Driveの写真を選び直してください。');
    const signal = controller.signal;
    const response = await call('/drive/v3/files/'+id+'?alt=media');
    if (Number(response.headers.get('Content-Length')) > PHOTO_MAX_BYTES || response.headers.get('Content-Type')?.split(';')[0] !== 'image/jpeg') throw Error('この写真の形式または大きさを表示できません。');
    const blob = await response.blob();
    check(signal);
    if (blob.size > PHOTO_MAX_BYTES || !blob.size) throw Error('この写真の大きさを表示できません。');
    return blob;
  }
  return {connected, connect, list, allocate, upload, read, disconnect, stop(){stopped = true; disconnect();}};
}
