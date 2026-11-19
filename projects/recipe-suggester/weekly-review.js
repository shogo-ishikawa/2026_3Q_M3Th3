import {analyseIntake} from './intake.js';
import {shiftDate} from './journal.js';
import {formatNutrient} from './nutrient-format.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';

/** 選択日を含む7日間と、重ならない直前の7日間を比べる。完了日の判定は通常の栄養集計と共通。 */
export function weeklyReview(entries, completedDays, to) {
  const weekEnding = date => analyseIntake(entries, {completedDays, to: date, days: 7});
  const recent = weekEnding(to);
  // 記録可能な最初の週には前の期間が存在しない。
  const previous = to >= '2000-01-08' ? weekEnding(shiftDate(to, -7)) : null;
  const rows = NUTRIENT_KEYS.map(key => {
    const current = recent.mean[key];
    const prior = previous?.mean[key] ?? null;
    return {
      key, current, prior, currentDays: recent.knownDays[key], priorDays: previous?.knownDays[key] ?? 0,
      difference: current === null || prior === null ? null : current - prior,
    };
  });
  return {recent, previous, rows};
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function weekRange(week) {
  return week.from.replaceAll('-', '/') + ' 〜 ' + week.to.replaceAll('-', '/');
}

function averageCell(value, key, days) {
  const cell = element('td', formatNutrient(value, key));
  cell.append(element('small', days + '日分'));
  return cell;
}

export function renderWeeklyReview(container, entries, completedDays, to) {
  const {recent, previous, rows} = weeklyReview(entries, completedDays, to);
  container.replaceChildren(element('h3', '1週間ごとの栄養の変化'));
  const dates = element('div', undefined, 'week-review-dates');
  dates.append(element('p', '今回　' + weekRange(recent)));
  dates.append(element('p', previous ? '前回　' + weekRange(previous) : '前回　記録できる期間より前です。'));
  container.append(dates);
  if (!recent.completedCount && !previous?.completedCount) {
    container.append(element('p', 'この期間には記録を完了した日がありません。', 'field-note'));
    return;
  }
  if (rows.every(row => row.current === null && row.prior === null)) {
    container.append(element('p', '記録を完了した日の栄養量が不明なため、平均を表示できません。', 'field-note'));
    return;
  }

  const table = element('table');
  const caption = element('caption', '完了日の1日平均');
  const head = table.createTHead().insertRow();
  for (const title of ['栄養成分', '今回', '前回', '差']) {
    const cell = element('th', title);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const {key, current, prior, currentDays, priorDays, difference} of rows) {
    const tr = body.insertRow();
    const heading = element('th', NUTRIENT_LABELS[key]);
    heading.scope = 'row';
    heading.append(element('small', NUTRIENT_UNITS[key] + ' / 日'));
    const diffText = formatNutrient(difference, key);
    const sign = difference > 0 && diffText !== '0' ? '+' : '';
    tr.append(heading, averageCell(current, key, currentDays), averageCell(prior, key, priorDays), element('td', sign + diffText));
  }
  table.prepend(caption);
  container.append(table, element('p', '量が不明な日は成分ごとに除きます。', 'field-note'));
}
