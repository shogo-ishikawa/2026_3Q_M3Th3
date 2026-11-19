import {PHOTO_MAX_BYTES} from './drive-photos.js';

const MAX_SIDE = 1600;
export function photoDimensions(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width * height)) || width * height > 80_000_000) throw Error('写真が大きすぎます。端末で小さくしてから選んでください。');
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {width:Math.max(1,Math.round(width*scale)), height:Math.max(1,Math.round(height*scale))};
}
export function rasterType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value,i) => bytes[i] === value)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
export async function prepareRecipePhoto(file) {
  if (!(file instanceof Blob) || !file.size || file.size > 32*1024*1024) throw Error('32 MB以下の料理写真を選んでください。');
  const bytes = new Uint8Array(await file.slice(0,16).arrayBuffer());
  if (!rasterType(bytes)) throw Error('JPEG・PNG・WebPの写真を選んでください。');
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    try { await image.decode(); } catch { throw Error('写真を読み込めません。別の写真を選んでください。'); }
    const size = photoDimensions(image.naturalWidth, image.naturalHeight);
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d',{alpha:false});
    if (!context) throw Error('この端末で写真を準備できませんでした。');
    context.fillStyle = '#fff'; context.fillRect(0,0,size.width,size.height);
    context.drawImage(image,0,0,size.width,size.height);
    // 元のファイルの撮影場所やEXIFを引き継がず、描画した画素だけを再符号化する。
    for (const quality of [.82,.65]) {
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (jpeg?.type === 'image/jpeg' && jpeg.size > 0 && jpeg.size <= PHOTO_MAX_BYTES) return jpeg;
    }
    throw Error('写真を保存用の大きさにできませんでした。小さい写真を選んでください。');
  } finally {
    URL.revokeObjectURL(url); image.removeAttribute('src'); canvas.width = canvas.height = 0;
  }
}
