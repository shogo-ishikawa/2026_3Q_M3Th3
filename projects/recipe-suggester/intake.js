import {NUTRIENT_KEYS,summariseEntries} from './nutrition.js';
import {dateIsValid,shiftDate} from './journal.js';

/** 完了を明示した日だけで平均する。未入力の栄養成分を0へ置き換えない。 */
export function analyseIntake(entries,{to,days=7,completedDays=[]}={}){
  if(!dateIsValid(to)||![1,7,30].includes(days)||!Array.isArray(completedDays)||completedDays.some(date=>!dateIsValid(date)))throw Error('集計する期間と記録の完了日を確認してください。');
  let from;try{from=shiftDate(to,1-days);}catch{from='2000-01-01';}
  const completeDates=[...new Set(completedDays.filter(date=>date>=from&&date<=to))].sort();
  const totals=summariseEntries(entries,{from,to});
  const completeSummaries=completeDates.map(date=>summariseEntries(entries,{from:date,to:date}));
  const mean={},knownDays={};
  for(const key of NUTRIENT_KEYS){const known=completeSummaries.filter(summary=>summary.complete[key]);knownDays[key]=known.length;mean[key]=known.length?known.reduce((sum,summary)=>sum+summary.values[key],0)/known.length:null;}
  return {from,to,days,totals,completeDates,completedCount:completeDates.length,mean,knownDays};
}

/** 表示の比較。健康状態や栄養欠乏症の判定には使わない。 */
export function compareIntake(key,value,{target,reference=null,complete=true}={}){
  if(!complete||value===null||!Number.isFinite(value))return {kind:'unknown',label:'不明分があるため比較できません'};
  if(!(target>=0)||!Number.isFinite(target))return {kind:'unknown',label:'比較する目安が未設定です'};
  if(!reference)return {kind:'comparison',label:`設定値との差 ${value-target>=0?'+':''}${Math.round((value-target)*10)/10}`};
  if(key==='kcal')return {kind:'comparison',label:`推定値との差 ${value-target>=0?'+':''}${Math.round(value-target)} kcal`};
  const range=reference.ranges?.[key];
  if(['fat','carbs'].includes(key)&&range){if(value<range.min)return {kind:'below',label:'記録分は目標範囲より少なめ'};if(value>range.max)return {kind:'above',label:'記録分は目標範囲より多め'};return {kind:'within',label:'記録分は目標範囲内'};}
  if(key==='salt')return value<target?{kind:'within',label:'記録分は目標量未満'}:{kind:'above',label:'記録分は目標量以上'};
  if(key==='protein')return value<target?{kind:'below',label:'記録分は推奨量未満'}:{kind:'within',label:'記録分は推奨量以上'};
  if(key==='fiber')return value<target?{kind:'below',label:'記録分は目標量未満'}:{kind:'within',label:'記録分は目標量以上'};
  return {kind:'comparison',label:'目安と比べて確認できます'};
}
