/** 一覧に置く短い根拠表示。詳しい出典は既存の料理詳細へ残します。 */
import {classifyNutritionBasis} from './nutrition-basis.js';

export function nutritionBasisBadge(value,data,options={}){
  const basis=classifyNutritionBasis(value,data,options),badge=document.createElement('span');
  badge.className=`nutrition-basis-badge nutrition-basis-${basis.kind}`;
  badge.textContent=basis.label;
  badge.title=[basis.description,basis.unknownNote].filter(Boolean).join(' ');
  badge.setAttribute('data-nutrition-basis',basis.kind);
  badge.setAttribute('aria-label',`${basis.label}${basis.unknownKeys.length?'・未入力の成分あり':''}`);
  return badge;
}
