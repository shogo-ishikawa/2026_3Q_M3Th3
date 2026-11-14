/** 栄養の表示桁だけをそろえます。計算や保存する値は変えません。 */
const KEYS = new Set(['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt']);
const formatters = [0, 1].map(digits => new Intl.NumberFormat('ja-JP', {maximumFractionDigits: digits}));

export function formatNutrient(value, key) {
  if (!KEYS.has(key)) throw Error('表示する栄養成分を確認してください。');
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = formatters[key === 'kcal' ? 0 : 1].format(value);
  // 差がごく小さなマイナスのときも、丸めた「0」に符号を残しません。
  return text === '-0' ? '0' : text;
}
