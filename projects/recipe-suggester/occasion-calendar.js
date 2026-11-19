import {isBirthdayOnDate} from './personal-nutrition.js';

export const OCCASION_LABELS = Object.freeze({
  anniversary: '記念日', birthday: '誕生日', 'new-year': 'お正月', 'coming-of-age': '成人の日',
  setsubun: '節分', valentine: 'バレンタイン', hinamatsuri: 'ひな祭り', 'white-day': 'ホワイトデー',
  'spring-equinox': '春分の日', graduation: '卒業祝い', 'school-entry': '入学祝い', 'childrens-day': 'こどもの日',
  tanabata: '七夕', 'marine-day': '海の日', 'mountain-day': '山の日', obon: 'お盆', 'harvest-moon': '十五夜',
  'respect-for-aged': '敬老の日', 'autumn-equinox': '秋分の日', halloween: 'ハロウィン', christmas: 'クリスマス',
});
export const RECIPE_TAG_LABELS = Object.freeze({...OCCASION_LABELS, spring: '春', summer: '夏', autumn: '秋', winter: '冬',
  'child-friendly': '子ども向け', 'senior-friendly': 'やわらかいおかず'});
export const MANUAL_OCCASIONS = Object.freeze(Object.keys(OCCASION_LABELS).filter(id => id !== 'birthday'));
const fixed = {
  '01-01': 'new-year', '01-02': 'new-year', '01-03': 'new-year', '02-14': 'valentine', '03-03': 'hinamatsuri',
  '03-14': 'white-day', '05-05': 'childrens-day', '07-07': 'tanabata', '08-13': 'obon', '08-14': 'obon',
  '08-15': 'obon', '08-16': 'obon', '10-31': 'halloween', '12-24': 'christmas', '12-25': 'christmas',
};
// 日本標準時。順に節分（2月）、春分（3月）、秋分（9月）、中秋の名月。出典は docs/occasion-calendar.md。
const variable = {
  2020:[3,20,22,'10-01'], 2021:[2,20,23,'09-21'], 2022:[3,21,23,'09-10'], 2023:[3,21,23,'09-29'],
  2024:[3,20,22,'09-17'], 2025:[2,20,23,'10-06'], 2026:[3,20,23,'09-25'], 2027:[3,21,23,'09-15'],
  2028:[3,20,22,'10-03'], 2029:[2,20,23,'09-22'], 2030:[3,20,23,'09-12'], 2031:[3,21,23,'10-01'],
  2032:[3,20,22,'09-19'], 2033:[2,20,23,null], 2034:[3,20,23,'09-27'], 2035:[3,21,23,'09-16'], 2036:[3,20,22,'10-04'],
};

export function calendarSeason(date) {
  const month = Number(date?.slice(5, 7));
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor((month % 12) / 3)];
}

export function schoolSeason(date) {
  const monthDay = date?.slice(5);
  if (monthDay >= '03-01' && monthDay <= '03-31') return 'graduation';
  if (monthDay >= '04-01' && monthDay <= '04-15') return 'school-entry';
  return null;
}

export function menuOccasions(date, birthDate, familyCalendar = []) {
  if (typeof date !== 'string') return [];
  const year = Number(date.slice(0, 4)), monthDay = date.slice(5);
  const month = Number(date.slice(5, 7)), day = Number(date.slice(8));
  const monday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
  const secondMonday = monday && day >= 8 && day <= 14, thirdMonday = monday && day >= 15 && day <= 21;
  const result = familyCalendar.filter(item => item.date === date ||
    (item.annual && item.date <= date && item.date.slice(5) === monthDay)).map(item => item.occasion);
  if (birthDate && isBirthdayOnDate(birthDate, date)) result.push('birthday');
  if (fixed[monthDay]) result.push(fixed[monthDay]);
  if (month === 1 && secondMonday) result.push('coming-of-age');
  const marine = year === 2020 ? monthDay === '07-23' : year === 2021 ? monthDay === '07-22' :
    year < 2003 ? monthDay === '07-20' : month === 7 && thirdMonday;
  if (marine) result.push('marine-day');
  const mountain = year === 2020 ? '08-10' : year === 2021 ? '08-08' : '08-11';
  if (year >= 2016 && monthDay === mountain) result.push('mountain-day');
  if (year < 2003 ? monthDay === '09-15' : month === 9 && thirdMonday) result.push('respect-for-aged');
  const dates = variable[year];
  if (dates) {
    if (month === 2 && day === dates[0]) result.push('setsubun');
    if (month === 3 && day === dates[1]) result.push('spring-equinox');
    if (month === 9 && day === dates[2]) result.push('autumn-equinox');
    if (monthDay === dates[3]) result.push('harvest-moon');
  }
  return [...new Set(result)];
}
