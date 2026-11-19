/** 当日の実食を反映した夕食を試算する。採用するまでは下書きと予定を変更しない。 */
import {generateCalendarPlan, regeneratePlanMeal} from './planner.js';
import {personalPlanOptions} from './planner-personalization.js';

export function mealsBeforeDinner(entries,date) {
  return entries.filter(entry => entry.date === date && entry.status === 'eaten' &&
    (entry.meal === 'breakfast' || entry.meal === 'lunch') && entry.items.length);
}

export function previewRecordedDinner(state,date,draft,data,seed) {
  const earlier=mealsBeforeDinner(state.entries,date);
  if (!earlier.length) throw Error('先にこの日の朝食か昼食を記録してください。');
  const index=draft?.ok ? draft.days.findIndex(day=>day.date===date && day.meal==='dinner') : -1;
  const context={entries:state.entries,pantry:state.pantry,targets:state.targets,completedDays:state.completedDays,personalization:personalPlanOptions(state)};
  if (index>=0) {
    const proposal=regeneratePlanMeal(draft,{...context,dayIndex:index,seed},data);
    return {earlier,proposal,day:proposal.days[index],inDraft:true};
  }
  const preferences=state.settings.mealPreferences;
  const settings={...state.settings,startDate:date,days:1,meal:'dinner',seed,
    mealPreferences:{...preferences,dinner:{...preferences.dinner,enabled:true}}};
  const proposal=generateCalendarPlan(settings,data,{...context,meal:'dinner'});
  if (!proposal.ok) throw Error(proposal.warnings.join(' ') || '夕食の条件に合う料理がありません。');
  return {earlier,proposal,day:proposal.days[0],inDraft:false};
}
