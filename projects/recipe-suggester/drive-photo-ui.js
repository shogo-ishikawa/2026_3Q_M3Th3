import {prepareRecipePhoto} from './recipe-photo-image.js';

function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function action(text, className = 'button-secondary') {
  const button = element('button', text, className); button.type = 'button'; return button;
}

// 写真の表示が閉じたときや、バリエーション・アカウントが変わったときに画像URLを破棄する。
export function mountDrivePhotos({drive, recipeId, recipeName}) {
  if (!customElements.get('meal-drive-photos')) customElements.define('meal-drive-photos',class extends HTMLElement {
    disconnectedCallback() { this.cleanup?.(); }
  });
  const host = document.createElement('meal-drive-photos'), panel = element('details');
  host.append(panel); panel.className = 'drive-photo-panel';
  const summary = element('summary','自分の料理写真');
  const note = element('p','この料理の写真を、自分のGoogle Driveに保存して見返せます。','field-note');
  const connect = action('Google Driveに接続'), disconnect = action('接続を終了','button-text');
  const tools = element('div'), picker = element('input'), label = element('label','料理写真を選ぶ');
  picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; label.append(picker);
  const help = element('p','JPEG・PNG・WebPに対応しています。撮影場所などの情報を除き、長辺1,600ピクセル以内にして保存します。','field-note');
  const save = action('この写真をDriveに保存','button-primary'), reload = action('写真の一覧を更新','button-text');
  const more = action('以前の写真をさらに表示','button-text'), list = element('ul'), status = element('p','','field-note');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const preview = element('img'); preview.className='drive-photo-preview'; preview.hidden = true;
  tools.append(label,help,save,reload,list,more,preview,disconnect);
  panel.append(summary,note,connect,tools,status);
  let alive = true, busy = false, localImage = null, uploadId, imageUrl, page, loaded = false;

  function releaseImage() {
    preview.hidden = true; preview.removeAttribute('src');
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  }
  function showImage(blob, alt) {
    releaseImage(); imageUrl = URL.createObjectURL(blob);
    preview.src = imageUrl; preview.alt = alt; preview.hidden = false;
  }
  function resetSelection() { picker.value = ''; localImage = null; uploadId = null; }
  function refresh() {
    const ready = drive.connected();
    connect.hidden = ready; connect.disabled = busy;
    tools.hidden = !ready;
    for (const button of tools.querySelectorAll('button,input')) button.disabled = busy;
    save.disabled = busy || !localImage;
    more.hidden = !page;
    if (!ready) { list.replaceChildren(); page = null; loaded = false; releaseImage(); }
  }
  async function run(message, operation) {
    if (busy || !alive) return;
    busy = true; status.textContent = message; refresh();
    try { await operation(); }
    catch (error) { if (alive) status.textContent = error.message || '写真の操作を完了できませんでした。'; }
    finally { if (alive) {busy = false; refresh();} }
  }
  async function fetchPage(next) {
    const result = await drive.list(recipeId,next);
    if (!alive) return;
    if (!next) list.replaceChildren();
    for (const file of result.files) {
      const li = element('li');
      const date = file.createdTime && new Date(file.createdTime);
      const description = date && Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP') + '　' + file.name : file.name;
      const view = action(description,'text-link');
      view.addEventListener('click', () => run('写真を読み込んでいます…',async () => {
        const blob = await drive.read(file.id);
        if (!alive) return;
        showImage(blob,recipeName+'の料理写真'); status.textContent = '選んだ写真を表示しました。';
      }));
      li.append(view); list.append(li);
    }
    page = result.next; loaded = true;
    status.textContent = list.children.length ? '保存した写真を選ぶと表示できます。' : 'この料理の写真はまだ保存されていません。';
  }
  connect.addEventListener('click', () => run('Googleアカウントを確認しています…',async () => {
    await drive.connect(); if (alive) await fetchPage();
  }));
  disconnect.addEventListener('click',() => {
    drive.disconnect(); resetSelection(); refresh();
    status.textContent = 'この端末での写真の接続を終了しました。';
  });
  picker.addEventListener('change',() => {
    const file = picker.files?.[0]; localImage = null; uploadId = null; releaseImage(); refresh(); if (!file) return;
    run('写真を準備しています…',async () => {
      const blob = await prepareRecipePhoto(file); if (!alive) return;
      localImage = blob; showImage(blob,recipeName+'に追加する写真');
      status.textContent = '写真を確認して、保存ボタンを押してください。';
    });
  });
  save.addEventListener('click',() => run('Google Driveに保存しています…',async () => {
    if (!localImage) return;
    if (!uploadId) uploadId = await drive.allocate();
    if (!alive) return;
    await drive.upload(recipeId, recipeName, localImage, uploadId);
    if (!alive) return;
    resetSelection(); loaded = false;
    try { await fetchPage(); if (alive) status.textContent = '写真をGoogle Driveに保存しました。'; }
    catch { if (alive) status.textContent = '写真を保存しました。一覧を更新して確認してください。'; }
  }));
  reload.addEventListener('click',() => run('一覧を更新しています…',()=>fetchPage()));
  more.addEventListener('click',() => run('以前の写真を読み込んでいます…',()=>fetchPage(page)));
  const dialog = document.getElementById('recipe-dialog');
  const close = () => host.remove();
  dialog?.addEventListener('close',close);
  host.cleanup = () => {alive = false; resetSelection(); releaseImage(); dialog?.removeEventListener('close',close);};
  panel.addEventListener('toggle',()=>{ if (alive && panel.open && !loaded && drive.connected()) run('写真の一覧を読み込んでいます…',()=>fetchPage()); });
  refresh();
  return host;
}
