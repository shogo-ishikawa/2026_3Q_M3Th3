/**
 * SHIFT STUDIO scheduler. All hard constraints must hold before a plan is returned.
 * timeToMin/fmtTime adapt the corresponding helpers in the submitted weekly
 * shift application. The dated constraint search and fairness objective are new.
 */
const EPS = 1e-7;
const DAY = 1440;
const DEFAULTS = { includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000 };

// Adapted from the student's timeToMin / fmtTime helpers.
export function timeToMin(t, allowMidnight = false) {
  if (allowMidnight && t === '24:00') return 1440;
  if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function fmtTime(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function num(n, min = 0, max = 100000) { return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max; }
function integer(n, min, max) { return num(n, min, max) && Number.isInteger(n); }
function dateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms / 60000 / DAY;
}
function monday(day) { return day - ((day + 3) % 7 + 7) % 7; }
function list(value) { return (typeof value === 'string' ? value : '').split(',').map(s => s.trim()).filter(Boolean); }
function describe(value) {
  if (typeof value === 'string') return value.slice(0, 100);
  try { return (JSON.stringify(value) ?? typeof value).slice(0, 100); } catch { return typeof value; }
}
function label(p) { return `${p.name}（${p.id}）`; }
function slotLabel(s) { return `${s.date} ${s.start}–${s.end}（${s.id}）`; }
function makeModel(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['入力データの形式が正しくありません。'] };
  for (const [key, max] of [['staff', 100], ['slots', 500], ['availability', 50000], ['history', 10000]]) {
    if (!Array.isArray(data[key])) errors.push(`${key} はリストで指定してください。`);
    else if (data[key].length > max) errors.push(`${key} は ${max} 件以内にしてください。`);
  }
  if (errors.length) return { errors };
  if (!data.staff.length) errors.push('スタッフを1人以上登録してください。');
  if (!data.slots.length) errors.push('シフト枠を1つ以上登録してください。');
  if (data.settings != null && (typeof data.settings !== 'object' || Array.isArray(data.settings))) errors.push('設定の形式が正しくありません。');
  const settings = { ...DEFAULTS, ...data.settings };
  if (typeof settings.includeHistory !== 'boolean') errors.push('過去実績を均等化に含める設定は true / false にしてください。');
  if (!num(settings.minRestHours, 0, 168)) errors.push('勤務間の休息時間は0〜168時間にしてください。');
  if (!integer(settings.maxConsecutiveDays, 1, 366)) errors.push('最大連勤日数は1〜366日の整数にしてください。');
  if (!num(settings.maxDailyHours, 0, 24)) errors.push('1日の勤務上限は0〜24時間にしてください。');
  if (!integer(settings.timeLimitMs, 1, 60000)) errors.push('探索時間は1〜60000ミリ秒にしてください。');
  const ids = new Map();
  const staff = data.staff.map((p, i) => {
    const prefix = `スタッフ ${i + 1} 行目`;
    if (!p || typeof p !== 'object') { errors.push(`${prefix}の形式が正しくありません。`); return {}; }
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!id || id.includes(',')) errors.push(`${prefix}のIDは空欄・カンマを含まない文字列にしてください。`);
    else if (id !== p.id) errors.push(`${prefix}のIDの前後に空白を入れないでください。`);
    else if (ids.has(id)) errors.push(`スタッフID「${id}」が重複しています。`);
    else ids.set(id, i);
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`${prefix}の名前を入力してください。`);
    if (!num(p.weight, 0.01, 100)) errors.push(`${prefix}の勤務比率は0.01〜100にしてください。`);
    if (!num(p.minHours) || !num(p.maxHours) || p.minHours > p.maxHours) errors.push(`${prefix}の勤務時間は0以上で、最低時間≦上限時間にしてください。`);
    if (!integer(p.maxDays, 0, 7)) errors.push(`${prefix}の週上限日数は0〜7日の整数にしてください。`);
    if (p.skills != null && typeof p.skills !== 'string') errors.push(`${prefix}のスキルはカンマ区切りの文字列にしてください。`);
    return { ...p, id, name: typeof p.name === 'string' ? p.name.trim() : '', skillsSet: new Set(list(p.skills)), minMinutes: num(p.minHours) ? p.minHours * 60 : 0, maxMinutes: num(p.maxHours) ? p.maxHours * 60 : 0, index: i };
  });
  const slotIds = new Map();
  const slots = data.slots.map((s, i) => {
    const prefix = `シフト枠 ${i + 1} 行目`;
    if (!s || typeof s !== 'object') { errors.push(`${prefix}の形式が正しくありません。`); return {}; }
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    if (!id || id.includes(',')) errors.push(`${prefix}のIDは空欄・カンマを含まない文字列にしてください。`);
    else if (id !== s.id) errors.push(`${prefix}のIDの前後に空白を入れないでください。`);
    else if (slotIds.has(id)) errors.push(`シフト枠ID「${id}」が重複しています。`);
    else slotIds.set(id, i);
    const day = dateDay(s.date), begin = timeToMin(s.start), end = timeToMin(s.end, true);
    if (day == null) errors.push(`${prefix}の日付を YYYY-MM-DD で入力してください。`);
    if (begin == null || end == null || end <= begin) errors.push(`${prefix}の終了時刻は同日の開始時刻より後にしてください（日をまたぐ勤務は日付ごとに分割）。`);
    if (!integer(s.required, 1, 1000)) errors.push(`${prefix}の必要人数は1〜1000人の整数にしてください。`);
    if (s.skill != null && typeof s.skill !== 'string') errors.push(`${prefix}の必要スキルは文字列にしてください。`);
    if (s.fixed != null && typeof s.fixed !== 'string') errors.push(`${prefix}の固定担当はスタッフIDのカンマ区切りにしてください。`);
    const fixedIds = list(s.fixed);
    if (new Set(fixedIds).size !== fixedIds.length) errors.push(`${prefix}の固定担当IDが重複しています。`);
    if (num(s.required) && fixedIds.length > s.required) errors.push(`${prefix}の固定担当が必要人数を超えています。`);
    for (const f of fixedIds) if (!ids.has(f)) errors.push(`${prefix}の固定担当ID「${f}」は未登録です。`);
    return { ...s, id, skill: typeof s.skill === 'string' ? s.skill.trim() : '', fixedIds, fixedIndices: fixedIds.map(f => ids.get(f)), index: i, day, week: day == null ? null : monday(day), begin: day * DAY + begin, finish: day * DAY + end, duration: end - begin, candidates: [], prefs: new Map() };
  });
  const pairs = new Set();
  data.availability.forEach((a, i) => {
    const prefix = `勤務可能 ${i + 1} 行目`;
    if (!a || typeof a !== 'object') { errors.push(`${prefix}の形式が正しくありません。`); return; }
    if (!ids.has(a.staffId)) errors.push(`${prefix}のスタッフID「${describe(a.staffId)}」は未登録です。`);
    if (!slotIds.has(a.slotId)) errors.push(`${prefix}のシフト枠ID「${describe(a.slotId)}」は未登録です。`);
    if (a.preference !== 1 && a.preference !== 2) errors.push(`${prefix}の希望は1（勤務可能）または2（希望）にしてください。`);
    const key = JSON.stringify([describe(a.staffId), describe(a.slotId)]);
    if (pairs.has(key)) errors.push(`${prefix}のスタッフ・シフト枠の組が重複しています。`);
    pairs.add(key);
    if (ids.has(a.staffId) && slotIds.has(a.slotId)) {
      const pi = ids.get(a.staffId), slot = slots[slotIds.get(a.slotId)];
      if (!slot.skill || staff[pi].skillsSet.has(slot.skill)) { slot.candidates.push(pi); slot.prefs.set(pi, a.preference); }
    }
  });
  const history = staff.map(() => []), historyKeys = new Set();
  const firstStart = Math.min(...slots.map(s => s.begin));
  data.history.forEach((h, i) => {
    const prefix = `過去実績 ${i + 1} 行目`;
    if (!h || typeof h !== 'object') { errors.push(`${prefix}の形式が正しくありません。`); return; }
    if (!ids.has(h.staffId)) errors.push(`${prefix}のスタッフID「${describe(h.staffId)}」は未登録です。`);
    const day = dateDay(h.date), begin = timeToMin(h.start), end = timeToMin(h.end, true);
    if (day == null || begin == null || end == null || end <= begin) { errors.push(`${prefix}の日付・開始・終了時刻を正しく入力してください。`); return; }
    const interval = { day, week: monday(day), begin: day * DAY + begin, finish: day * DAY + end, duration: end - begin, historical: true, date: h.date };
    if (interval.finish > firstStart) errors.push(`${prefix}は今回の最初のシフト開始以前に終了する実績にしてください。`);
    const key = JSON.stringify([h.staffId, day, begin, end]);
    if (historyKeys.has(key)) errors.push(`${prefix}の実績が重複しています。`);
    historyKeys.add(key);
    if (ids.has(h.staffId)) history[ids.get(h.staffId)].push(interval);
  });
  history.forEach((items, i) => {
    items.sort((a, b) => a.begin - b.begin);
    for (let j = 1; j < items.length; j++) if (items[j - 1].finish > items[j].begin) errors.push(`${label(staff[i])}の過去実績に時間の重複があります。`);
  });
  return { errors, settings, staff, slots, ids, slotIds, history };
}
export function validateInput(data) { return makeModel(data).errors; }

/** Independent whole-plan verification. The search never uses this as its candidate filter. */
export function validateSchedule(data, schedule) {
  const m = makeModel(data), errors = [...m.errors];
  if (errors.length) return errors;
  if (!Array.isArray(schedule)) return ['勤務表はリストで指定してください。'];
  const bySlot = new Map(), intervals = m.history.map(items => [...items]);
  for (const row of schedule) {
    if (!row || !m.slotIds.has(row.slotId)) { errors.push('勤務表に未登録のシフト枠があります。'); continue; }
    if (bySlot.has(row.slotId)) { errors.push(`勤務表の枠「${row.slotId}」が重複しています。`); continue; }
    bySlot.set(row.slotId, row);
    if (!Array.isArray(row.staffIds)) { errors.push(`枠「${row.slotId}」の担当者がリストではありません。`); continue; }
    const slot = m.slots[m.slotIds.get(row.slotId)];
    if (row.staffIds.length !== slot.required) errors.push(`${slotLabel(slot)}の必要人数を満たしていません。`);
    if (new Set(row.staffIds).size !== row.staffIds.length) errors.push(`${slotLabel(slot)}の担当者が重複しています。`);
    for (const f of slot.fixedIds) if (!row.staffIds.includes(f)) errors.push(`${slotLabel(slot)}に固定担当「${f}」がいません。`);
    for (const id of new Set(row.staffIds)) {
      if (!m.ids.has(id)) { errors.push(`未登録スタッフ「${describe(id)}」が割り当てられています。`); continue; }
      const pi = m.ids.get(id);
      if (!slot.prefs.has(pi)) errors.push(`${label(m.staff[pi])}は${slotLabel(slot)}に勤務できません（勤務可能・必要スキル）。`);
      intervals[pi].push({ ...slot, historical: false });
    }
  }
  for (const slot of m.slots) if (!bySlot.has(slot.id)) errors.push(`${slotLabel(slot)}が勤務表にありません。`);
  for (const [pi, items] of intervals.entries()) {
    const p = m.staff[pi], current = items.filter(s => !s.historical);
    const minutes = current.reduce((n, s) => n + s.duration, 0);
    if (minutes + EPS < p.minMinutes || minutes > p.maxMinutes + EPS) errors.push(`${label(p)}の今回の勤務時間が最低・上限時間の範囲外です。`);
    items.sort((a, b) => a.begin - b.begin);
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      if (a.historical && b.historical) continue;
      if (a.finish > b.begin) errors.push(`${label(p)}の勤務時間が重複しています。`);
      else if (b.begin - a.finish + EPS < m.settings.minRestHours * 60) errors.push(`${label(p)}の勤務間の休息時間が不足しています。`);
    }
    const dates = new Set(items.map(s => s.day));
    for (const day of new Set(current.map(s => s.day))) {
      const daily = items.filter(s => s.day === day).reduce((n, s) => n + s.duration, 0);
      if (daily > m.settings.maxDailyHours * 60 + EPS) errors.push(`${label(p)}の1日上限時間を超えています。`);
      let run = 1;
      for (let d = day - 1; dates.has(d); d--) run++;
      for (let d = day + 1; dates.has(d); d++) run++;
      if (run > m.settings.maxConsecutiveDays) errors.push(`${label(p)}の最大連勤日数を超えています。`);
    }
    for (const week of new Set(current.map(s => s.week))) {
      const days = new Set(items.filter(s => s.week === week).map(s => s.day));
      if (days.size > p.maxDays) errors.push(`${label(p)}の週上限日数を超えています。`);
    }
  }
  return [...new Set(errors)];
}

function lowerPosition(items, begin) {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid].begin < begin) lo = mid + 1; else hi = mid; }
  return lo;
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function scoreOf(values, target, weights) {
  return values.reduce((n, v, i) => n + ((v - target[i]) / 60) ** 2 / weights[i], 0);
}
function discreteRootBound(model, target, historyMinutes, upper, totalMinutes) {
  const quantum = model.slots.reduce((n, s) => gcd(n, s.duration), 0);
  const units = totalMinutes / quantum;
  // Convex resource allocation on a relaxed common time grid. Availability,
  // overlap and skills can only shrink this domain, so its minimum is admissible.
  if (!quantum || units > 4000) return 0;
  const x = model.staff.map(p => Math.ceil((p.minMinutes - EPS) / quantum));
  const caps = upper.map(n => Math.floor((n + EPS) / quantum));
  if (x.some((n, i) => n > caps[i]) || x.reduce((a, b) => a + b, 0) > units) return Infinity;
  let remain = units - x.reduce((a, b) => a + b, 0);
  while (remain-- > 0) {
    let best = -1, delta = Infinity;
    for (let i = 0; i < x.length; i++) if (x[i] < caps[i]) {
      const v = historyMinutes[i] + x[i] * quantum - target[i];
      const d = (2 * v * quantum + quantum * quantum) / model.staff[i].weight;
      if (d < delta) { delta = d; best = i; }
    }
    if (best < 0) return Infinity;
    x[best]++;
  }
  return scoreOf(x.map((n, i) => n * quantum + historyMinutes[i]), target, model.staff.map(p => p.weight));
}

/**
 * Depth-first constraint search with constrained-slot ordering, lower-bound
 * pruning and a validated incumbent. A time/node limit never proves infeasibility.
 * minRestHours applies between every pair of separate slots, even on one day.
 */
export function solve(data, options = {}) {
  const started = performance.now();
  const result = { status: 'invalid', diagnostics: [], schedule: [], stats: [], objective: null, nodes: 0, elapsedMs: 0 };
  const finish = () => { result.elapsedMs = Math.round((performance.now() - started) * 10) / 10; return result; };
  const m = makeModel(data);
  if (m.errors.length) { result.diagnostics = m.errors; return finish(); }
  const requestedMs = options.timeLimitMs ?? m.settings.timeLimitMs;
  const maxNodes = options.maxNodes ?? Infinity;
  if (!num(requestedMs, 0, 60000) || !(maxNodes === Infinity || integer(maxNodes, 0, Number.MAX_SAFE_INTEGER))) {
    result.diagnostics = ['探索時間・ノード数の指定が正しくありません。']; return finish();
  }
  const deadline = started + requestedMs;
  const totalMinutes = m.slots.reduce((n, s) => n + s.duration * s.required, 0);
  const actualHistory = m.history.map(items => items.reduce((n, s) => n + s.duration, 0));
  const fairnessHistory = actualHistory.map(n => m.settings.includeHistory ? n : 0);
  const combined = totalMinutes + fairnessHistory.reduce((a, b) => a + b, 0);
  const weightTotal = m.staff.reduce((n, p) => n + p.weight, 0);
  const targets = m.staff.map(p => combined * p.weight / weightTotal);
  const upper = m.staff.map(p => Math.min(p.maxMinutes, m.slots.filter(s => s.prefs.has(p.index)).reduce((n, s) => n + s.duration, 0)));
  const state = m.staff.map((p, pi) => {
    const daily = new Map(), dayCounts = new Map(), weekDays = new Map();
    for (const h of m.history[pi]) {
      daily.set(h.day, (daily.get(h.day) || 0) + h.duration);
      dayCounts.set(h.day, (dayCounts.get(h.day) || 0) + 1);
      if (!weekDays.has(h.week)) weekDays.set(h.week, new Map());
      const week = weekDays.get(h.week); week.set(h.day, (week.get(h.day) || 0) + 1);
    }
    return { minutes: 0, current: [], daily, dayCounts, weekDays };
  });
  const assignments = m.slots.map(() => []);
  let preferred = 0, bestPreferred = -1, best = null, bestObjective = Infinity;
  let stopped = false, proof = false, deadEnd = null;
  const cut = () => {
    if (result.nodes >= maxNodes || performance.now() >= deadline) { stopped = true; return true; }
    return false;
  };
  function reason(pi, s) {
    const p = m.staff[pi], st = state[pi];
    if (!s.prefs.has(pi)) return '勤務可能時間または必要スキル';
    if (st.minutes + s.duration > p.maxMinutes + EPS) return '今回の勤務上限時間';
    if ((st.daily.get(s.day) || 0) + s.duration > m.settings.maxDailyHours * 60 + EPS) return '1日の勤務上限時間';
    const days = st.weekDays.get(s.week);
    if ((days?.size || 0) + (days?.has(s.day) ? 0 : 1) > p.maxDays) return '週の勤務上限日数';
    let run = 1;
    for (let d = s.day - 1; st.dayCounts.has(d) && run <= m.settings.maxConsecutiveDays; d--) run++;
    for (let d = s.day + 1; st.dayCounts.has(d) && run <= m.settings.maxConsecutiveDays; d++) run++;
    if (run > m.settings.maxConsecutiveDays) return '最大連勤日数';
    const rest = m.settings.minRestHours * 60;
    const collision = old => s.begin < old.finish && s.finish > old.begin ? '勤務時間の重複' : Math.max(s.begin - old.finish, old.begin - s.finish) + EPS < rest ? '勤務間の休息時間' : null;
    for (const old of st.current) { const r = collision(old); if (r) return r; }
    const hist = m.history[pi], at = lowerPosition(hist, s.begin);
    for (const i of [at - 1, at]) if (hist[i]) { const r = collision(hist[i]); if (r) return r; }
    return null;
  }
  function apply(pi, s, sign) {
    const st = state[pi];
    st.minutes += sign * s.duration;
    if (sign > 0) st.current.push(s); else st.current.pop();
    for (const [map, key, delta] of [[st.daily, s.day, s.duration], [st.dayCounts, s.day, 1]]) {
      const value = (map.get(key) || 0) + sign * delta;
      if (value) map.set(key, value); else map.delete(key);
    }
    if (!st.weekDays.has(s.week)) st.weekDays.set(s.week, new Map());
    const days = st.weekDays.get(s.week), count = (days.get(s.day) || 0) + sign;
    if (count) days.set(s.day, count); else days.delete(s.day);
    if (!days.size) st.weekDays.delete(s.week);
    if (sign > 0) assignments[s.index].push(pi); else assignments[s.index].pop();
    if (s.prefs.get(pi) === 2) preferred += sign;
  }
  const issues = [];
  for (const s of m.slots) {
    if (s.candidates.length < s.required) issues.push(`${slotLabel(s)}は必要${s.required}人に対し、勤務可能かつ必要スキルを持つ人が${s.candidates.length}人です。`);
    for (const pi of s.fixedIndices) if (!s.prefs.has(pi)) issues.push(`${slotLabel(s)}の固定担当 ${label(m.staff[pi])} は勤務可能・必要スキルの条件を満たしません。`);
  }
  for (const p of m.staff) if (upper[p.index] + EPS < p.minMinutes) issues.push(`${label(p)}は勤務可能な枠をすべて足しても最低${p.minHours}時間に届きません。`);
  if (totalMinutes + EPS < m.staff.reduce((n, p) => n + p.minMinutes, 0)) issues.push('必要な勤務時間の合計が、スタッフの最低勤務時間の合計より少なくなっています。');
  if (totalMinutes > upper.reduce((a, b) => a + b, 0) + EPS) issues.push('必要な勤務時間の合計が、勤務可能枠と上限時間から見たスタッフ全体の容量を超えています。');
  if (issues.length) { result.status = 'infeasible'; result.diagnostics = issues; return finish(); }
  // Fixed assignments cannot be silently relaxed. Apply chronologically so that
  // rest/weekly limits involving other fixed slots are checked before search.
  for (const s of [...m.slots].sort((a, b) => a.begin - b.begin)) for (const pi of s.fixedIndices) {
    const why = reason(pi, s);
    if (why) { result.status = 'infeasible'; result.diagnostics = [`${slotLabel(s)}の固定担当 ${label(m.staff[pi])} が「${why}」に反します。固定担当または条件を修正してください。`]; return finish(); }
    apply(pi, s, 1);
  }
  const rootBound = discreteRootBound(m, targets, fairnessHistory, upper, totalMinutes);
  if (!Number.isFinite(rootBound)) { result.status = 'infeasible'; result.diagnostics = ['勤務時間の上下限と必要人数を同時に満たす時間配分がありません。']; return finish(); }
  const preferredUpper = m.slots.reduce((n, s) => {
    const fixedPreferred = s.fixedIndices.filter(pi => s.prefs.get(pi) === 2).length;
    const nonFixedPreferred = s.candidates.filter(pi => !s.fixedIndices.includes(pi) && s.prefs.get(pi) === 2).length;
    return n + fixedPreferred + Math.min(s.required - s.fixedIndices.length, nonFixedPreferred);
  }, 0);
  function search() {
    if (proof || cut()) return;
    result.nodes++;
    let chosen = null, candidates = null, smallest = Infinity, remainingMinutes = 0;
    const possibleMinutes = state.map(() => 0);
    let nodePreferredUpper = preferred;
    for (const s of m.slots) {
      const missing = s.required - assignments[s.index].length;
      if (!missing) continue;
      remainingMinutes += missing * s.duration;
      const cand = s.candidates.filter(pi => !assignments[s.index].includes(pi) && !reason(pi, s));
      if (cand.length < missing) { if (!deadEnd) deadEnd = s; return; }
      for (const pi of cand) possibleMinutes[pi] += s.duration;
      nodePreferredUpper += Math.min(missing, cand.filter(pi => s.prefs.get(pi) === 2).length);
      // log(binomial) orders slots by the number of combinations without overflow.
      let ways = 0;
      for (let i = 1; i <= Math.min(missing, cand.length - missing); i++) ways += Math.log(cand.length - i + 1) - Math.log(i);
      if (ways < smallest || (ways === smallest && s.duration > chosen?.duration)) { smallest = ways; chosen = s; candidates = cand; }
    }
    let lower = 0;
    for (const p of m.staff) {
      const i = p.index, low = Math.max(state[i].minutes, p.minMinutes), high = Math.min(p.maxMinutes, state[i].minutes + possibleMinutes[i]);
      if (high + EPS < p.minMinutes) return;
      const bestMinute = Math.min(high + fairnessHistory[i], Math.max(low + fairnessHistory[i], targets[i]));
      lower += ((bestMinute - targets[i]) / 60) ** 2 / p.weight;
    }
    lower = Math.max(lower, rootBound);
    if (lower > bestObjective + EPS || (Math.abs(lower - bestObjective) <= EPS && nodePreferredUpper <= bestPreferred)) return;
    if (!chosen) {
      const values = state.map((st, i) => st.minutes + fairnessHistory[i]);
      const objective = scoreOf(values, targets, m.staff.map(p => p.weight));
      if (objective < bestObjective - EPS || (Math.abs(objective - bestObjective) <= EPS && preferred > bestPreferred)) {
        bestObjective = objective; bestPreferred = preferred; best = assignments.map(a => [...a]);
        if (objective <= rootBound + EPS && preferred === preferredUpper) proof = true;
      }
      return;
    }
    const duration = chosen.duration;
    candidates.sort((a, b) => {
      const delta = pi => {
        const before = state[pi].minutes + fairnessHistory[pi] - targets[pi];
        return (2 * before * duration + duration * duration) / m.staff[pi].weight;
      };
      return delta(a) - delta(b) || chosen.prefs.get(b) - chosen.prefs.get(a) || a - b;
    });
    const need = chosen.required - assignments[chosen.index].length;
    function combinations(at, left) {
      if (proof || stopped || cut()) return;
      if (!left) { search(); return; }
      for (let i = at; i <= candidates.length - left; i++) {
        const pi = candidates[i];
        apply(pi, chosen, 1);
        combinations(i + 1, left - 1);
        apply(pi, chosen, -1);
        if (proof || stopped) return;
      }
    }
    combinations(0, need);
  }
  search();
  if (!best) {
    result.status = stopped ? 'unknown' : 'infeasible';
    result.diagnostics = stopped
      ? ['探索上限に達しました。条件を満たす案はまだ見つかっておらず、不可能と判定したわけではありません。探索時間を延ばすか、期間・枠を分けて再実行してください。']
      : ['勤務可能枠、時間の上下限、週上限日数、休息・連勤、固定担当の組合せを同時に満たす配置がありません。条件を修正して再実行してください。', ...(deadEnd ? [`探索中に配置が詰まった枠の一例：${slotLabel(deadEnd)}。この枠だけが原因とは限りません。`] : [])];
    return finish();
  }
  const schedule = m.slots.map(s => ({ slotId: s.id, staffIds: best[s.index].map(pi => m.staff[pi].id) }));
  const failures = validateSchedule(data, schedule);
  if (failures.length) {
    result.status = 'unknown'; result.diagnostics = ['内部検証で条件違反を検出したため、勤務表は表示しません。', ...failures]; return finish();
  }
  result.status = stopped && !proof ? 'feasible' : 'optimal';
  result.schedule = schedule;
  result.objective = bestObjective;
  result.stats = m.staff.map((p, pi) => {
    const assigned = m.slots.filter(s => best[s.index].includes(pi));
    const minutes = assigned.reduce((n, s) => n + s.duration, 0);
    return { staffId: p.id, hours: minutes / 60, historyHours: actualHistory[pi] / 60, totalHours: (minutes + actualHistory[pi]) / 60, days: new Set(assigned.map(s => s.day)).size, targetHours: targets[pi] / 60 };
  });
  result.diagnostics = result.status === 'optimal'
    ? ['すべての必須条件を満たしています。勤務時間の比率と希望枠について、探索の範囲全体で最良であることを確認しました。']
    : ['すべての必須条件を満たす案が見つかりました。探索上限に達したため、勤務時間の均等さ・希望枠について最良であることは未確認です。'];
  return finish();
}
