// Fictional examples only. Staff IDs remain stable when names change.
export function createDemo(kind = 'balanced') {
  const staff = Array.from({length: 6}, (_, i) => ({id: `P${i + 1}`, name: `スタッフ${'ABCDEF'[i]}`, weight: 1, minHours: 0, maxHours: 32, maxDays: 5, skills: i < 3 ? 'リーダー' : ''}));
  const slots = [];
  for (let day = 16; day <= 20; day++) for (let part = 0; part < 2; part++) {
    slots.push({id: `S${slots.length + 1}`, date: `2026-11-${day}`, start: part ? '13:00' : '09:00', end: part ? '17:00' : '13:00', required: 2, skill: '', fixed: ''});
  }
  const availability = [];
  for (const p of staff) for (const s of slots) {
    if ((p.id === 'P1' && s.id === 'S1') || (p.id === 'P6' && s.id === 'S10')) continue;
    availability.push({staffId: p.id, slotId: s.id, preference: (Number(p.id.slice(1)) + Number(s.id.slice(1))) % 4 === 0 ? 2 : 1});
  }
  const history = [];
  if (kind === 'history') {
    staff[0].weight = 1.5; staff[5].weight = 0.5;
    for (let i = 0; i < 3; i++) history.push({staffId: 'P2', date: `2026-11-${String(9 + i).padStart(2, '0')}`, start: '09:00', end: '17:00'});
    history.push({staffId: 'P3', date: '2026-11-12', start: '09:00', end: '17:00'});
  }
  if (kind === 'impossible') slots[0].required = 6; // Only five are available for S1.
  return {staff, slots, availability, history, settings: {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000}};
}
