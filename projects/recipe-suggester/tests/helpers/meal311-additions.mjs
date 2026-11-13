// v3.11 additions stay outside the immutable historical data projections.
import {SIMMERED_INGREDIENTS,SIMMERED_RECIPES} from '../../simmered-foods.js';
import {CANTEEN_INGREDIENTS,CANTEEN_RECIPES} from '../../canteen-foods.js';
import {TAVERN_INGREDIENTS,TAVERN_RECIPES} from '../../tavern-foods.js';
import {BISTRO_INGREDIENTS,BISTRO_RECIPES} from '../../bistro-foods.js';
import {SOUP311_INGREDIENTS,SOUP311_RECIPES} from '../../soup311-foods.js';
export const ADDED_311_RECIPES=[...SIMMERED_RECIPES,...CANTEEN_RECIPES,...TAVERN_RECIPES,...BISTRO_RECIPES,...SOUP311_RECIPES];
export const ADDED_311_INGREDIENTS={...SIMMERED_INGREDIENTS,...CANTEEN_INGREDIENTS,...TAVERN_INGREDIENTS,...BISTRO_INGREDIENTS,...SOUP311_INGREDIENTS};
