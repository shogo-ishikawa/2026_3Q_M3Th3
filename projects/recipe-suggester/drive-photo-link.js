import {mobileDriveShare} from './drive-photo-share.js';

// 「リンクをコピー」で取得した Drive のファイルだけを開く。公開設定の変更は不要。
export function normaliseDrivePhotoLink(value) {
  const invalid = () => new Error('Google ドライブで写真を選び「リンクをコピー」したURLを入力してください。');
  if (typeof value !== 'string' || value.length > 1500) throw invalid();
  let url;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (url.origin !== 'https://drive.google.com' || url.username || url.password) throw invalid();
  const path = /^\/file\/d\/([\w-]+)(?:\/view|\/preview)?\/?$/.exec(url.pathname);
  const id = path?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : '');
  if (!id || !/^[\w-]{8,200}$/.test(id)) throw invalid();
  const key = url.searchParams.get('resourcekey');
  if (key !== null && !/^[\w-]{1,200}$/.test(key)) throw invalid();
  return 'https://drive.google.com/file/d/' + id + '/view' + (key ? '?resourcekey=' + key : '');
}

export function validateDrivePhotoLinks(entries, recipeIds) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries) || entries.length > 5000) throw new Error('料理写真のリンク数を確認してください。');
  const links = [], seen = new Set();
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['recipeId','url'].includes(k)) ||
        !recipeIds.has(item.recipeId)) throw new Error('料理写真のレシピを確認してください。');
    const url = normaliseDrivePhotoLink(item.url);
    const key = JSON.stringify([item.recipeId, url.split('?')[0]]);
    if (seen.has(key)) throw new Error('同じ料理写真のリンクが重複しています。');
    seen.add(key);
    links.push({recipeId:item.recipeId, url});
  }
  return links;
}

export function mountDrivePhotoLink({recipeId, recipeName, state, getState = () => state, save}) {
  const make = (tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const section = make('details');
  section.className = 'drive-photo-links';
  section.append(make('summary', 'Driveのリンクを登録'));
  const guide = make('p', '自分のGoogle ドライブに写真をアップロードし、写真の「リンクをコピー」で取得したURLを登録します。共有設定は「制限付き」のまま使えます。');
  const openDrive = make('a','自分のGoogle ドライブを開く');
  openDrive.href = 'https://drive.google.com/drive/my-drive';
  openDrive.target = '_blank';
  openDrive.rel = 'noopener noreferrer';
  const label = make('label', '写真のリンク');
  const input = make('input');
  input.type = 'url';
  input.autocomplete = 'off';
  input.placeholder = 'https://drive.google.com/file/d/…';
  label.append(input);
  const add = make('button','このレシピにリンクを保存');
  add.type = 'button';
  const listing = make('ul'), status = make('p');
  status.setAttribute('role', 'status');
  function refresh() {
    listing.replaceChildren();
    const photos = (getState().drivePhotoLinks || []).filter(item => item.recipeId === recipeId);
    photos.forEach(({url}, index) => {
      const row = make('li'), link = make('a', recipeName + 'の写真 ' + (index + 1));
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const remove = make('button','リンクを外す');
      remove.type = 'button';
      remove.setAttribute('aria-label', '写真 ' + (index + 1) + ' のリンクを外す');
      remove.addEventListener('click', () => {
        try {
          save(next => {
            const kept = (next.drivePhotoLinks || []).filter(item => item.recipeId !== recipeId || item.url !== url);
            if (kept.length) next.drivePhotoLinks = kept;
            else delete next.drivePhotoLinks;
          });
          refresh();
          status.textContent = 'このレシピからリンクを外しました。写真はDriveに残ります。';
        } catch (error) { status.textContent = error.message; }
      });
      row.append(link, remove);
      listing.append(row);
    });
  }
  add.addEventListener('click', () => {
    try {
      const url = normaliseDrivePhotoLink(input.value);
      save(next => {
        const links = next.drivePhotoLinks ??= [];
        const previous = links.find(item => item.recipeId === recipeId && item.url.split('?')[0] === url.split('?')[0]);
        if (previous) { if (url.includes('?')) previous.url = url; }
        else links.push({recipeId,url});
      });
      input.value = '';
      refresh();
      status.textContent = '写真のリンクを保存しました。';
    } catch (error) { status.textContent = error.message; }
  });
  section.append(guide, openDrive);
  const share = mobileDriveShare();
  if (share) section.append(share);
  section.append(label, add, listing, status);
  refresh();
  if (listing.childElementCount) section.open = true;
  return section;
}
