import {prepareRecipePhoto} from './recipe-photo-image.js';

export function mobileDriveShare() {
  if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function' || typeof File !== 'function') return null;
  try {
    if (!navigator.canShare({files:[new File(['test'], 'photo.jpg', {type:'image/jpeg'})]})) return null;
  } catch { return null; }
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'スマホの共有からDriveに保存';
  const label = document.createElement('label');
  label.textContent = '料理写真を選ぶ';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  label.append(input);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '写真の共有先を選ぶ';
  button.disabled = true;
  const status = document.createElement('p');
  status.setAttribute('role','status');
  status.textContent = 'スマホにGoogle ドライブがあるときは、共有先からDriveを選べます。保存後にDriveでリンクをコピーしてください。';
  let prepared = null, revision = 0;
  input.addEventListener('change', async () => {
    const current = ++revision;
    prepared = null;
    button.disabled = true;
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = '写真を準備しています…';
    try {
      const image = await prepareRecipePhoto(file);
      if (revision !== current) return;
      const jpeg = new File([image], 'Meal-Palette-' + new Date().toISOString().slice(0,10) + '.jpg', {type:'image/jpeg'});
      if (!navigator.canShare({files:[jpeg]})) throw new Error('この端末ではこの写真を直接共有できません。Google ドライブからアップロードしてください。');
      prepared = jpeg;
      button.disabled = false;
      status.textContent = '共有先を選んでください。';
    } catch (error) { if (revision === current) status.textContent = error.message; }
  });
  button.addEventListener('click', async () => {
    if (!prepared) return;
    try {
      await navigator.share({files:[prepared]});
      status.textContent = 'Driveで保存した写真のリンクをコピーし、下の欄に貼り付けてください。';
    } catch (error) { status.textContent = error.name === 'AbortError' ? '共有を取り消しました。' : '共有先を開けませんでした。Google ドライブからアップロードできます。'; }
  });
  field.append(legend,label,button,status);
  return field;
}
