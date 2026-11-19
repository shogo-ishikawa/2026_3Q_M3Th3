// 普段の料理からも、行事の食材や祝い膳に合うものを選べるようにする。
import {RECIPE_TAG_LABELS} from './occasion-calendar.js';

const recipesByOccasion = {
  'new-year': ['familiar-buri-teriyaki', 'beef-burdock', 'classic-side-namasu', 'side-011', 'soup-018', 'soup-030'],
  'coming-of-age': ['bistro-beef-cut-steak','familiar-tempura-assorted','classic-sushi-chirashi','side-037','classic-side-namasu','soup-020','soup311-osuimono-asari'],
  setsubun: ['sardine-ginger','evening-main-iwashi-kabayaki','soy-hijiki-patty','side-029','classic-side-lotus-soy-curry','soup-027','soup-010'],
  valentine: ['familiar-beef-stew','bistro-chicken-mushroom-cream','classic-side-paprika-bean-marinade','side-018','soup-011','soup-007','daily-snack-chocolate-cookie','daily-snack-chocolate-cake'],
  hinamatsuri: ['classic-sushi-chirashi','classic-shrimp-tofu-dumpling','scallop-broccoli','classic-side-bamboo-tosa','side-037','soup311-osuimono-asari','soup-013'],
  'white-day': ['bistro-cod-shrimp-butter','familiar-beef-stew','familiar-side-shrimp-salad','side-022','soup-006','familiar-side-clam-chowder','daily-snack-custard-pudding'],
  'spring-equinox': ['tofu-steak','classic-tofu-negi-miso','classic-side-bamboo-tosa','side-024','soup-027','soup311-osuimono-tofu-wakame'],
  graduation: ['familiar-tempura-assorted','classic-beef-tofu-sukini','classic-sushi-chirashi','classic-side-asparagus-enoki','side-037','soup-018','soup-033'],
  'school-entry': ['rice-egg-omelette','familiar-hamburg-stew','scallop-broccoli','familiar-side-asparagus-butter','classic-side-potato-salad','soup-009','soup311-consomme-vegetable'],
  'childrens-day': ['rice-egg-omelette','classic-chicken-nanban','familiar-hamburg-stew','classic-side-potato-salad','carrot-pumpkin-mash','soup-009','varied-chinese-corn-soup'],
  tanabata: ['classic-sushi-chirashi','scallop-broccoli','varied-kanitama-sauce','calendar-side-okra-corn','familiar-side-okra-ohitashi','soup-036','soup-013'],
  'marine-day': ['familiar-white-fish-fry','bistro-cod-shrimp-butter','scallop-broccoli','familiar-side-tofu-seaweed-salad','familiar-side-shrimp-salad','soup311-clam-chowder-tomato','soup-036'],
  'mountain-day': ['salmon-foil','classic-pork-mushroom-steam','tofu-steak','familiar-side-mushroom-foil','classic-side-burdock-konjac','soup-012','soup-039'],
  obon: ['classic-tofu-negi-miso','tofu-steak','classic-side-tofu-dengaku','side-013','soup-027','soup-040'],
  'harvest-moon': ['salmon-foil','evening-main-chicken-jibuni','classic-side-taro-simmered','classic-side-taro-mushroom-miso','soup-033','soup-039'],
  'respect-for-aged': ['classic-beef-tofu-sukini','classic-shrimp-tofu-dumpling','evening-main-chicken-jibuni','side-037','classic-side-taro-simmered','soup-030','soup-033'],
  'autumn-equinox': ['classic-tofu-negi-miso','soy-hijiki-patty','classic-side-taro-mushroom-miso','classic-side-pumpkin-soboro','soup-027','soup-023'],
  halloween: ['classic-croquette-pumpkin','classic-chicken-pumpkin-sesame','bistro-pumpkin-meat-gratin','side-057','soup-004','soup-021'],
  christmas: ['familiar-beef-stew','bistro-chicken-mushroom-cream','bistro-cod-shrimp-butter','familiar-side-roast-vegetables','familiar-side-shrimp-salad','familiar-side-minestrone','familiar-side-clam-chowder','daily-snack-chocolate-cake'],
  birthday: ['bistro-beef-cut-steak','familiar-hamburg-stew','classic-sushi-chirashi','classic-side-potato-salad','side-018','soup-009','soup-012','daily-snack-chocolate-cake'],
  anniversary: ['familiar-beef-stew','bistro-cod-shrimp-butter','bistro-beef-cut-steak','familiar-side-roast-vegetables','side-022','soup-011','familiar-side-clam-chowder','daily-snack-custard-pudding'],
};
const tagsByRecipe = new Map();
for (const [occasion, ids] of Object.entries(recipesByOccasion)) {
  for (const id of ids) {
    if (!tagsByRecipe.has(id)) tagsByRecipe.set(id, []);
    tagsByRecipe.get(id).push(occasion);
  }
}

const noOccasions = Object.freeze([]);
export function existingOccasionIds(recipe) { return tagsByRecipe.get(recipe?.id) ?? noOccasions; }
export function existingOccasionLabels(recipe) { return existingOccasionIds(recipe).map(id => RECIPE_TAG_LABELS[id]); }
