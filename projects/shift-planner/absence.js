/** Absence edits and plan differences. Inputs remain unchanged until adoption. */
import {validateSchedule} from './solver.js';

function pairKey(staffId, slotId) { return JSON.stringify([staffId, slotId]); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/**
 * Prepare new hard availability constraints from a validated original plan.
 * Each absence covers either an entire date or one slot. Releasing a fixed
 * assignment affects only the absent person in the covered slots.
 */
export function prepareAbsence(data, baselineSchedule, absences, options = {}) {
  const errors = validateSchedule(data, baselineSchedule);
  if (errors.length) throw new Error(`元の勤務表を確認できません。シフトを作成し直してください。\n${errors.join('\n')}`);
  if (!Array.isArray(absences) || absences.length === 0) throw new Error('欠勤する人と日時を追加してください。');
  if (!isRecord(options)) throw new Error('欠勤時の固定解除の設定が正しくありません。');
  const releaseAbsentFixed = options.releaseAbsentFixed === undefined ? true : options.releaseAbsentFixed;
  if (typeof releaseAbsentFixed !== 'boolean') throw new Error('固定を解除する設定はオンかオフで指定してください。');

  const staffIds = new Set(data.staff.map(person => person.id));
  const slots = new Map(data.slots.map(slot => [slot.id, slot]));
  const blockedPairs = new Map();
  for (const [index, absence] of absences.entries()) {
    const prefix = `欠勤 ${index + 1}件目`;
    if (!isRecord(absence) || typeof absence.staffId !== 'string' || !staffIds.has(absence.staffId)) {
      throw new Error(`${prefix}のスタッフが登録されていません。`);
    }
    const hasDate = Object.hasOwn(absence, 'date');
    const hasSlot = Object.hasOwn(absence, 'slotId');
    if (hasDate === hasSlot) throw new Error(`${prefix}は日付か勤務枠のどちらか一方を指定してください。`);
    let covered;
    if (hasSlot) {
      if (typeof absence.slotId !== 'string' || !slots.has(absence.slotId)) {
        throw new Error(`${prefix}の勤務枠が登録されていません。`);
      }
      covered = [slots.get(absence.slotId)];
    } else {
      if (typeof absence.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(absence.date)) {
        throw new Error(`${prefix}の日付をYYYY-MM-DDで指定してください。`);
      }
      covered = data.slots.filter(slot => slot.date === absence.date);
      if (!covered.length) throw new Error(`${prefix}の日付には勤務枠がありません。`);
    }
    for (const slot of covered) {
      const pair = {staffId: absence.staffId, slotId: slot.id};
      blockedPairs.set(pairKey(pair.staffId, pair.slotId), pair);
    }
  }

  const next = structuredClone(data);
  next.availability = next.availability.filter(pair => !blockedPairs.has(pairKey(pair.staffId, pair.slotId)));
  const releasedFixed = [];
  if (releaseAbsentFixed) {
    for (const slot of next.slots) {
      const ids = typeof slot.fixed === 'string' ? slot.fixed.split(',').map(id => id.trim()).filter(Boolean) : [];
      const removed = ids.filter(staffId => blockedPairs.has(pairKey(staffId, slot.id)));
      if (!removed.length) continue;
      const removedIds = new Set(removed);
      slot.fixed = ids.filter(staffId => !removedIds.has(staffId)).join(',');
      releasedFixed.push(...removed.map(staffId => ({staffId, slotId: slot.id})));
    }
  }
  return {
    data: next,
    referenceSchedule: structuredClone(baselineSchedule),
    blocked: [...blockedPairs.values()],
    releasedFixed,
  };
}

function scheduleMap(schedule, name) {
  if (!Array.isArray(schedule) || !schedule.length) throw new Error(`${name}の勤務表がありません。`);
  const rows = new Map();
  for (const row of schedule) {
    if (!isRecord(row) || typeof row.slotId !== 'string' || !row.slotId.trim()
        || !Array.isArray(row.staffIds) || !row.staffIds.length
        || row.staffIds.some(id => typeof id !== 'string' || !id.trim())) {
      throw new Error(`${name}の勤務表の形式が正しくありません。`);
    }
    if (rows.has(row.slotId) || new Set(row.staffIds).size !== row.staffIds.length) {
      throw new Error(`${name}の勤務表に重複した枠や担当者があります。`);
    }
    rows.set(row.slotId, row);
  }
  return rows;
}

/** Compare assignment sets rather than row order or staff display order. */
export function compareSchedules(before, after) {
  const original = scheduleMap(before, '元');
  const alternative = scheduleMap(after, '代替案');
  if (original.size !== alternative.size || [...original.keys()].some(id => !alternative.has(id))) {
    throw new Error('元の勤務表と代替案の勤務枠が一致しません。');
  }
  const changes = [];
  for (const [slotId, row] of original) {
    const next = alternative.get(slotId);
    if (row.staffIds.length !== next.staffIds.length) throw new Error('元の勤務表と代替案の配置人数が一致しません。');
    const oldIds = new Set(row.staffIds), newIds = new Set(next.staffIds);
    const removed = row.staffIds.filter(id => !newIds.has(id));
    const added = next.staffIds.filter(id => !oldIds.has(id));
    if (removed.length) changes.push({slotId, removed, added});
  }
  return changes;
}
