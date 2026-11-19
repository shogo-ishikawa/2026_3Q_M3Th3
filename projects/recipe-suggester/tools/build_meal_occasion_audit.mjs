import {writeFileSync} from 'node:fs';
import {RECIPES} from '../data.js';
import {hasReviewedMealOccasions} from '../meal-occasions.js';
import {mealSuitabilityAudit} from '../meal-suitability.js';

const missing = RECIPES.filter(recipe => !hasReviewedMealOccasions(recipe));
if (missing.length) throw Error(`食事区分の確認が必要です：${missing.map(recipe => recipe.id).join('、')}`);
const rows = mealSuitabilityAudit(RECIPES).map(row => JSON.stringify(row));
const report = {version: 3, reviewed: '2026-11-19', scope: '収録メニューの食事区分と行事・シーン。晩酌の酒類は記録専用。'};
const json = JSON.stringify(report).slice(0, -1) + ',"recipes":[\n' + rows.join(',\n') + '\n]}\n';
writeFileSync(new URL('../docs/meal-suitability-audit.json', import.meta.url), json);
