import {isBirthdayOnDate} from './personal-nutrition.js';
import {recipeOccasionIds} from './celebration-recipes.js';
import {dishClassification, COOKING_METHODS} from './dish-hierarchy.js';
import {ingredientGroup} from './shopping-categories.js';
import {seasonalIngredientPreference} from './seasonal-preference.js';

export const OCCASION_LABELS = Object.freeze({birthday: '誕生日', christmas: 'クリスマス', 'new-year': 'お正月'});

export function birthdayGreeting(name, birthDate, day) {
  return name && birthDate && isBirthdayOnDate(birthDate, day) ? name + 'さん、お誕生日おめでとうございます！' : '';
}

export function menuOccasions(date, birthDate) {
  const occasions = [];
  if (birthDate && isBirthdayOnDate(birthDate, date)) occasions.push('birthday');
  const monthDay = date.slice(5);
  if (['12-24', '12-25'].includes(monthDay)) occasions.push('christmas');
  if (['01-01', '01-02', '01-03'].includes(monthDay)) occasions.push('new-year');
  return occasions;
}

export const UNAVAILABLE_OCCASION_REASON = '希望した食事の条件に合う行事料理がなかったため、通常の料理を選びました。';

/** 献立と編集内容を保ち、以前の誕生日を示す自動生成ラベルだけを除く。 */
export function removeStaleBirthdayReasons(plan, birthDate) {
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
    if (typeof day.date === 'string' && !menuOccasions(day.date).length) {
      for (const key of ['reasons', 'proposedReasons']) removeLabel(day, key, UNAVAILABLE_OCCASION_REASON);
    }
  }
  return changed;
}

export function isAvailableOnDate(recipe, occasions) {
  const themes = recipeOccasionIds(recipe);
  return !themes.length || occasions.some(id => themes.includes(id));
}

export function personalPlanOptions(journal) {
  const favourites = journal.favourites ?? [];
  return {
    birthDate: journal.birthDate,
    favouriteRecipeIds: favourites.map(favourite => favourite.item.recipeId).filter(Boolean),
    favourites: favourites.map(({item, genre}) => ({
      id: item.recipeId, genre, ingredientIds: item.ingredientsKnown === false ? [] : item.ingredients.map(part => part.id),
    })),
    counts: journal.settings.household?.counts,
    seasonal: journal.settings.occasionMenus !== false,
  };
}

export function personalRanking(settings, options, data) {
  const favoriteIds = new Set(options?.favouriteRecipeIds ?? []);
  const profiles = options?.favourites ?? [...favoriteIds].map(id => ({id}));
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
  return {favourites: favoriteIds, genres, methods, foods, total: profiles.length, counts: options?.counts ?? settings.household?.counts,
    seasonal: settings.occasionMenus !== false && (options?.seasonal ?? settings.occasionMenus === true)};
}

/** お気に入りと、家族で取り分けやすい調理形態を比較する。個人の栄養量には換算しない。 */
export function preferenceScore(recipe, personal, reasons, date) {
  if (!personal) return 0;
  let score = 0;
  const season = personal.seasonal ? seasonalIngredientPreference(recipe, date) : null;
  if (season) { score += season.score; reasons?.unshift(season.reason); }
  const method = (personal.total || personal.counts) ? dishClassification(recipe).method : 'other';
  if (personal.favourites.has(recipe.id)) {
    reasons?.unshift('お気に入りの料理');
    score += 22;
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
