import {isBirthdayOnDate} from './personal-nutrition.js';
import {recipeOccasionIds, recipeCollection} from './celebration-recipes.js';
import {existingOccasionIds} from './occasion-classics.js';
import {dishClassification, COOKING_METHODS} from './dish-hierarchy.js';
import {ingredientGroup} from './shopping-categories.js';
import {seasonalIngredientPreference} from './seasonal-preference.js';
import {eatenRecipeId} from './taste-history.js';

import {calendarSeason, schoolSeason, menuOccasions, OCCASION_LABELS, RECIPE_TAG_LABELS} from './occasion-calendar.js';
export {menuOccasions, OCCASION_LABELS};

export function birthdayGreeting(name, birthDate, day) {
  return name && birthDate && isBirthdayOnDate(birthDate, day) ? name + 'さん、お誕生日おめでとうございます！' : '';
}

export const UNAVAILABLE_OCCASION_REASON = '希望した食事の条件に合う行事料理がなかったため、通常の料理を選びました。';

/** 献立と編集内容を保ち、以前の誕生日を示す自動生成ラベルだけを除く。 */
export function removeStaleBirthdayReasons(plan, birthDate, familyCalendar) {
  if (!Array.isArray(plan?.days)) return false;
  let changed = false;
  function removeLabel(record, key, label) {
    const labels = record[key];
    if (!Array.isArray(labels) || !labels.includes(label)) return;
    record[key] = labels.filter(value => value !== label);
    changed = true;
  }
  for (const day of plan.days) {
    if (!day || typeof day !== 'object' || (birthDate && isBirthdayOnDate(birthDate, day.date))) continue;
    for (const id of Object.keys(day.dishReasons ?? {})) removeLabel(day.dishReasons, id, OCCASION_LABELS.birthday + 'の料理');
    if (typeof day.date === 'string' && !menuOccasions(day.date, undefined, familyCalendar).length) {
      for (const key of ['reasons', 'proposedReasons']) removeLabel(day, key, UNAVAILABLE_OCCASION_REASON);
    }
  }
  return changed;
}

function audienceTag(tags, counts) {
  if (counts?.senior && tags.includes('senior-friendly')) return 'senior-friendly';
  if ((counts?.preschool || counts?.child) && tags.includes('child-friendly')) return 'child-friendly';
  return null;
}

export function isAvailableOnDate(recipe, occasions, date, personal) {
  if (existingOccasionIds(recipe).length || recipeCollection(recipe)) return true;
  const tags = recipeOccasionIds(recipe);
  const events = tags.filter(id => Object.hasOwn(OCCASION_LABELS, id));
  if (!events.length || events.some(id => occasions.includes(id))) return true;
  return Boolean(personal?.seasonal && tags.includes(schoolSeason(date)));
}

// 記録と過去に提案した料理IDだけを使い、誕生日や記念日の年月日を履歴に複製しない。
export function rememberSuggestions(previous = [], plan, recipes) {
  const offered = new Set(plan.days.flatMap(day => day.recipeIds.filter(id => !day.omittedRecipeIds?.includes(id))));
  const eligible = new Set(recipes.filter(recipe => ['main', 'side', 'soup'].includes(recipe.role) || recipeOccasionIds(recipe).length).map(recipe => recipe.id));
  const seen = [...offered].filter(id => eligible.has(id));
  return [...previous.filter(id => !offered.has(id)), ...seen].slice(-2048);
}

/** 同じ条件を満たす行事料理から、未提案を優先し、行き渡ったら古いものに戻る。 */
export function rotateOccasionRecipes(candidates, personal, date) {
  if (candidates.length < 2 || !personal) return candidates;
  if (!personal.rotations.has(date)) {
    const ordered = new Set();
    for (const entry of personal.priorEntries) {
      if (entry.date > date) break;
      // 行事料理は過去に本人が予定へ選んだ品も一巡の対象にする。
      for (const id of entry.items?.map(eatenRecipeId) ?? entry.recipeIds ?? []) {
        if (id) {ordered.delete(id); ordered.add(id);}
      }
    }
    for (const id of personal.suggested) {
      if (!personal.datedIds.has(id)) {ordered.delete(id); ordered.add(id);}
    }
    for (const day of personal.suggestionHistory) {
      if (day.date > date) continue;
      for (const id of day.recipeIds) {ordered.delete(id); ordered.add(id);}
    }
    personal.rotations.set(date, new Map([...ordered].map((id, i) => [id, i])));
  }
  const order = personal.rotations.get(date);
  const rank = recipe => order.get(recipe.id) ?? -1;
  const oldest = Math.min(...candidates.map(rank));
  return candidates.filter(recipe => rank(recipe) === oldest);
}

export function personalPlanOptions(journal) {
  const favourites = journal.favourites ?? [];
  return {
    birthDate: journal.birthDate, familyCalendar: journal.familyCalendar, suggested: journal.suggestedRecipeIds,
    suggestionHistory: journal.suggestionHistory ?? [],
    favouriteRecipeIds: favourites.map(favourite => favourite.item.recipeId).filter(Boolean),
    favourites: favourites.map(({item, genre}) => ({
      id: item.recipeId, genre, adjusted:Boolean(item.ingredientEdit || item.productLabel), ingredientIds: item.ingredientsKnown === false ? [] : item.ingredients.map(part => part.id),
    })),
    counts: journal.settings.household?.counts,
    seasonal: journal.settings.occasionMenus !== false,
  };
}

const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];

// 食べた記録は食事枠まで確認する。同日中の再提案には、その献立日で既に示した品も使う。
function recordFavouriteDate(history, ids, date, slot) {
  for (const id of ids) {
    const dates = history.get(id);
    if (dates) dates.set(date, Math.min(dates.get(date) ?? Infinity, slot));
  }
}

export function noteProposedFavourites(personal, ids, date) {
  if (personal?.favouriteDates.size) recordFavouriteDate(personal.favouriteDates, ids, date, -1);
}

export function favouriteScore(id, personal, date, meal, reasons, purchasedCategory = false) {
  const dates = personal?.favouriteDates.get(id);
  if (!dates) return 0;
  let last = '';
  const slot = mealOrder.indexOf(meal);
  for (const [previous, firstSlot] of dates) {
    if ((previous < date || (previous === date && firstSlot < slot)) && previous > last) last = previous;
  }
  const qualifier = purchasedCategory ? '（市販品の種類）' : personal.adjustedFavourites.has(id) ? '（元の料理）' : '';
  if (last) {
    const gap = (Date.parse(date) - Date.parse(last)) / 86400000;
    if (gap < 7) return -28;
    if (gap >= 14) {
      reasons?.unshift('久しぶりのお気に入り' + qualifier);
      return 38;
    }
  }
  reasons?.unshift('お気に入りの料理' + qualifier);
  return 22;
}

export function personalRanking(settings, options, data, entries = []) {
  const favoriteIds = new Set(options?.favouriteRecipeIds ?? []);
  const favouriteDates = new Map([...favoriteIds].map(id => [id, new Map()]));
  const suggestionHistory = options?.suggestionHistory ?? [];
  const datedIds = new Set(suggestionHistory.flatMap(day => day.recipeIds));
  if (favoriteIds.size) {
    for (const day of suggestionHistory) recordFavouriteDate(favouriteDates, day.recipeIds, day.date, -1);
    for (const entry of entries) {
      if (entry?.status !== 'eaten' || !mealOrder.includes(entry.meal)) continue;
      recordFavouriteDate(favouriteDates, entry.items?.map(eatenRecipeId) ?? entry.recipeIds ?? [], entry.date, mealOrder.indexOf(entry.meal));
    }
  }
  const profiles = options?.favourites ?? [...favoriteIds].map(id => ({id}));
  const adjustedFavourites = new Set(profiles.filter(profile => profile.adjusted).map(profile => profile.id));
  for (const profile of profiles) if (!profile.adjusted) adjustedFavourites.delete(profile.id);
  const genres = new Map(), methods = new Map(), foods = new Map();
  const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  if (profiles.length) {
    const byId = new Map(data.recipes.map(recipe => [recipe.id, recipe]));
    for (const profile of profiles) {
      const original = byId.get(profile.id);
      const genre = profile.genre ?? original?.genre;
      if (genre) increment(genres, genre);
      const method = original && dishClassification(original).method;
      if (method && method !== 'other') increment(methods, method);
      const ingredients = profile.ingredientIds ?? original?.ingredients?.map(part => part.id) ?? [];
      const mainFoods = [...new Set(ingredients)].filter(id => !['seasoning', 'water', 'other'].includes(ingredientGroup(id, data)));
      for (const id of mainFoods.slice(0, 3)) increment(foods, id);
    }
  }
  return {favourites: favoriteIds, favouriteDates, adjustedFavourites, genres, methods, foods, total: profiles.length, counts: options?.counts ?? settings.household?.counts,
    suggested: options?.suggested ?? [], suggestionHistory, datedIds, recentByDate: new Map(),
    recent: new Set(options?.suggested?.slice(-24).filter(id => !datedIds.has(id))), rotations: new Map(),
    priorEntries: [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    seasonal: settings.occasionMenus !== false && (options?.seasonal ?? settings.occasionMenus === true)};
}

/** お気に入りと、家族で取り分けやすい調理形態を比較する。個人の栄養量には換算しない。 */
export function preferenceScore(recipe, personal, reasons, date, meal) {
  if (!personal) return 0;
  let score = 0;
  const season = personal.seasonal ? seasonalIngredientPreference(recipe, date) : null;
  if (season) { score += season.score; reasons?.unshift(season.reason); }
  const tags = recipeOccasionIds(recipe);
  const audience = audienceTag(tags, personal.counts);
  if (audience) { score += 8; reasons?.unshift(RECIPE_TAG_LABELS[audience]); }
  const school = schoolSeason(date), seasonId = calendarSeason(date);
  if (personal.seasonal && school && tags.includes(school)) { score += 5; reasons?.unshift(OCCASION_LABELS[school] + 'の季節の料理'); }
  else if (personal.seasonal && tags.includes(seasonId)) { score += 5; reasons?.unshift(RECIPE_TAG_LABELS[seasonId] + 'の料理'); }
  if (!personal.recentByDate.has(date)) {
    const from = new Date(Date.parse(date) - 6 * 86400000).toISOString().slice(0, 10);
    const recent = new Set(personal.recent);
    for (const day of personal.suggestionHistory) {
      if (day.date >= from && day.date <= date) for (const id of day.recipeIds) recent.add(id);
    }
    personal.recentByDate.set(date, recent);
  }
  if (personal.recentByDate.get(date).has(recipe.id)) score -= 8;
  const method = (personal.total || personal.counts) ? dishClassification(recipe).method : 'other';
  if (personal.favourites.has(recipe.id)) {
    score += favouriteScore(recipe.id, personal, date, meal, reasons);
  } else if (personal.total) {
    const genreVotes = personal.genres.get(recipe.genre) ?? 0;
    const methodVotes = personal.methods.get(method) ?? 0;
    let food, foodVotes = 0;
    for (const part of recipe.ingredients) {
      const votes = personal.foods.get(part.id) ?? 0;
      if (votes > foodVotes) {food = part; foodVotes = votes;}
    }
    score += (4 * genreVotes + 6 * methodVotes + 8 * foodVotes) / personal.total;
    if (reasons) {
      if (foodVotes) reasons.unshift('お気に入りと同じ食材（' + food.name + '）');
      else if (methodVotes) reasons.unshift('お気に入りと同じ調理法（' + COOKING_METHODS.find(item => item.id === method).label + '）');
      else if (genreVotes) reasons.unshift('お気に入りと同じジャンル（' + recipe.genre + '）');
    }
  }
  const counts = personal.counts;
  if (counts && recipe.role === 'main' && (counts.preschool || counts.child || counts.senior) && ['stew', 'simmer', 'steam', 'hotpot'].includes(method)) {
    reasons?.push('家族構成に合わせ、取り分けやすい調理法を優先');
    score += 5;
  } else if (counts?.teen && recipe.role === 'main' && ['stir-fry','grill'].includes(method)) {
    reasons?.push('家族構成に合わせ、各自の量を盛り分けやすいおかずを優先');
    score += 4;
  }
  return score;
}
