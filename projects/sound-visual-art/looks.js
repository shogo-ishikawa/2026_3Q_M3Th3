/**
 * 光の配合と共有リンクだけを扱います。
 * 音源・マイク・音の出力状態は共有しません。
 * リンクで再現するのは配色や動きの設定で、描いた軌跡や一瞬の画像ではありません。
 */
const SCENE_IDS = new Set(['garden', 'water', 'aurora']);
const PALETTE_IDS = new Set(['spectral', 'lagoon', 'dusk']);
const QUALITY_IDS = new Set(['auto', 'high', 'low']);
const HASH_KEYS = new Set(['lumen', 'scene', 'palette', 'density', 'motion', 'trails', 'quality', 'auto']);
const MAX_HASH_LENGTH = 768;
const INVALID_LINK = '共有リンクの設定を読み込めませんでした。別のリンクをお試しください。';

export const DEFAULT_LOOK = Object.freeze({
  scene: 'garden', palette: 'spectral', intensity: .65, motion: .55,
  trails: .7, quality: 'auto', autoDraw: true,
});

function look(id, label, description, settings) {
  return Object.freeze({id, label, description, settings: Object.freeze({...DEFAULT_LOOK, ...settings})});
}

export const LIGHT_LOOKS = Object.freeze([
  look('jade-garden', '翡翠の庭', '青緑の光が静かに花ひらく',
    {scene: 'garden', palette: 'lagoon', intensity: .68, motion: .38, trails: .78}),
  look('rose-garden', '花あかり', 'やわらかな夕映えを花に重ねる',
    {scene: 'garden', palette: 'dusk', intensity: .62, motion: .32, trails: .82}),
  look('moon-water', '月の水面', '穏やかな水面に小さな灯が漂う',
    {scene: 'water', palette: 'spectral', intensity: .42, motion: .23, trails: .88}),
  look('lagoon-water', '青い余白', '透きとおる波紋と光の余韻',
    {scene: 'water', palette: 'lagoon', intensity: .56, motion: .35, trails: .84}),
  look('silk-aurora', '光のヴェール', '薄い光の幕がゆっくりほどける',
    {scene: 'aurora', palette: 'lagoon', intensity: .6, motion: .28, trails: .8}),
  look('dusk-aurora', '夕暮れの幕', 'あたたかな色のゆらぎを眺める',
    {scene: 'aurora', palette: 'dusk', intensity: .7, motion: .42, trails: .76}),
]);

// 自分自身の普通の値だけを読みます。継承プロパティやgetterは設定に使いません。
function ownValue(input, key) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function boundedPercent(value, minimum, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.max(minimum, Math.min(1, value)) * 100) / 100;
}

/** 不明な項目を捨て、画面のスライダーと同じ百分率へそろえます。 */
export function normaliseLook(input) {
  const scene = ownValue(input, 'scene'), palette = ownValue(input, 'palette');
  const quality = ownValue(input, 'quality'), autoDraw = ownValue(input, 'autoDraw');
  return {
    scene: SCENE_IDS.has(scene) ? scene : DEFAULT_LOOK.scene,
    palette: PALETTE_IDS.has(palette) ? palette : DEFAULT_LOOK.palette,
    intensity: boundedPercent(ownValue(input, 'intensity'), .1, DEFAULT_LOOK.intensity),
    motion: boundedPercent(ownValue(input, 'motion'), 0, DEFAULT_LOOK.motion),
    trails: boundedPercent(ownValue(input, 'trails'), 0, DEFAULT_LOOK.trails),
    quality: QUALITY_IDS.has(quality) ? quality : DEFAULT_LOOK.quality,
    autoDraw: typeof autoDraw === 'boolean' ? autoDraw : DEFAULT_LOOK.autoDraw,
  };
}

/** 音源や端末の情報を含まない短い共有データを作ります。 */
export function makeLookHash(input) {
  const settings = normaliseLook(input);
  const params = new URLSearchParams({
    lumen: '1', scene: settings.scene, palette: settings.palette,
    density: String(Math.round(settings.intensity * 100)),
    motion: String(Math.round(settings.motion * 100)),
    trails: String(Math.round(settings.trails * 100)),
    quality: settings.quality, auto: settings.autoDraw ? '1' : '0',
  });
  return `#${params}`;
}

function readPercent(params, key, minimum = 0) {
  const text = params.get(key);
  if (!/^(?:0|[1-9]\d{0,2})$/.test(text ?? '')) return null;
  const value = Number(text);
  return value >= minimum && value <= 100 ? value / 100 : null;
}

/**
 * #labなど通常のアンカーならnull、正常なら{settings}、不正なら{error}を返します。
 * 不正な設定の一部だけを反映せず、全項目を確認してから画面へ渡します。
 */
export function parseLookHash(hash) {
  if (typeof hash !== 'string') return null;
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!/^lumen(?:=|&|$)/.test(text)) return null;
  if (hash.length > MAX_HASH_LENGTH) return {error: INVALID_LINK};
  let params;
  try { params = new URLSearchParams(text); }
  catch { return {error: INVALID_LINK}; }
  for (const key of params.keys()) {
    if (!HASH_KEYS.has(key) || params.getAll(key).length !== 1) return {error: INVALID_LINK};
  }
  if (params.get('lumen') !== '1') return {error: 'この共有リンクの形式には対応していません。'};
  if ([...HASH_KEYS].some(key => !params.has(key))) return {error: INVALID_LINK};
  const scene = params.get('scene'), palette = params.get('palette'), quality = params.get('quality');
  const intensity = readPercent(params, 'density', 10), motion = readPercent(params, 'motion'), trails = readPercent(params, 'trails');
  const auto = params.get('auto');
  if (!SCENE_IDS.has(scene) || !PALETTE_IDS.has(palette) || !QUALITY_IDS.has(quality)
    || intensity === null || motion === null || trails === null || !['0', '1'].includes(auto)) {
    return {error: INVALID_LINK};
  }
  return {settings: {scene, palette, intensity, motion, trails, quality, autoDraw: auto === '1'}};
}

/** 共有時には既存のクエリとアンカーを外し、公開設定だけを付け直します。 */
export function createShareUrl(baseUrl, settings) {
  if (typeof baseUrl !== 'string' || baseUrl.length > 8192) throw new Error('共有するページのURLを確認してください。');
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new Error('共有するページのURLを確認してください。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('共有できるのはHTTPまたはHTTPSのページです。認証情報を含むURLは使えません。');
  }
  url.search = '';
  url.hash = makeLookHash(settings);
  return url.href;
}
