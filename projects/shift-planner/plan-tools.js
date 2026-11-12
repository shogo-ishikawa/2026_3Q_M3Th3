/** Small, immutable edits to a validated plan. The scheduler remains authoritative. */
import {validateSchedule} from './solver.js';

function requireValidPlan(data, schedule) {
  const errors = validateSchedule(data, schedule);
  if (errors.length) {
    throw new Error(`現在の入力に合う完成シフトがありません。再作成してから担当を固定してください。\n${errors.join('\n')}`);
  }
}

/**
 * Apply only explicitly changed slot locks. Untouched partial fixed assignments
 * remain intact. A lock uses the current validated plan, never a partial result.
 */
export function applyPlanLocks(data, schedule, changes = new Map()) {
  requireValidPlan(data, schedule);
  if (!(changes instanceof Map)) throw new Error('固定の変更は、枠IDとオン・オフの組で指定してください。');

  const slots = new Set(data.slots.map(slot => slot.id));
  for (const [slotId, locked] of changes) {
    if (typeof slotId !== 'string' || !slots.has(slotId)) {
      throw new Error('固定の変更に未登録のシフト枠があります。');
    }
    if (typeof locked !== 'boolean') throw new Error('担当の固定はオンまたはオフで指定してください。');
  }

  const assignments = new Map(schedule.map(row => [row.slotId, row.staffIds]));
  const next = structuredClone(data);
  for (const slot of next.slots) {
    if (!changes.has(slot.id)) continue;
    slot.fixed = changes.get(slot.id) ? assignments.get(slot.id).join(',') : '';
  }
  requireValidPlan(next, schedule);
  return next;
}

/** Explicitly remove all fixed assignments, including those in an unfinished draft. */
export function clearPlanLocks(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.slots)
      || data.slots.some(slot => !slot || typeof slot !== 'object' || Array.isArray(slot))) {
    throw new Error('シフト枠の形式が正しくありません。');
  }
  const next = structuredClone(data);
  for (const slot of next.slots) slot.fixed = '';
  return next;
}

/** Display only: return copied rows without changing the canonical full plan. */
export function filterSchedule(schedule, staffId = '') {
  if (!Array.isArray(schedule) || schedule.some(row => !row || typeof row !== 'object'
      || typeof row.slotId !== 'string' || !Array.isArray(row.staffIds)
      || row.staffIds.some(id => typeof id !== 'string'))) {
    throw new Error('勤務表の形式が正しくありません。');
  }
  if (typeof staffId !== 'string') throw new Error('表示するスタッフIDは文字列で指定してください。');
  return schedule.filter(row => !staffId || row.staffIds.includes(staffId))
    .map(row => ({...row, staffIds: [...row.staffIds]}));
}
