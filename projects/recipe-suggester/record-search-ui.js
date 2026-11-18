/** 記録する料理を直接探すか、選んだ分類の中で探します。 */
import {CATALOG_CATEGORIES, FOOD_NATURES, catalogFamilies, catalogVariants, grilledFishAliases, recipeFamily} from './catalog.js';
import {availableCookingMethods, availableDishCategories, browseDishes} from './dish-hierarchy.js';
import {groupMenuRecipes, variationSearchAliases, variantLabel} from './menu-variations.js';

const sections = [['staple','主食'],['main','主菜'],['side','副菜'],['soup','汁物'],['drink','飲み物'],['snack','間食']];
const isDish = section => section === 'main' || section === 'side';
const families = new Map(CATALOG_CATEGORIES.map(category => [category.id, category.label]));
let serial = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function action(text, className, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
function options(select, choices, value) {
  select.replaceChildren(...choices.map(([id, text]) => {
    const option = element('option', '', text);
    option.value = id;
    return option;
  }));
  select.value = value;
}

/** 追加の別名を渡した場合も元の料理や履歴の材料は書き換えません。 */
export function recordSearchRecipes(data) {
  return data.recipes.map(recipe => ({...recipe,
    searchAliases:[...new Set([...(recipe.searchAliases ?? []), ...variationSearchAliases(recipe), ...grilledFishAliases(recipe),
      recipe.restaurant?.storeName, recipe.restaurant?.sizeName].filter(Boolean))],
    ingredients:(recipe.ingredients ?? []).map(part => ({...part, name:part.name ?? data.ingredients?.[part.id]?.name ?? part.id})),
  }));
}

function filteredMenus(recipes, scope, query) {
  if (!scope) return query.trim() ? groupMenuRecipes(browseDishes(recipes, {query}), {query}) : [];
  // 分類を先に適用します。検索結果が0件でも別の分類に移りません。
  const {section, category, method, nature, family} = scope;
  const subset = browseDishes(recipes, {section, category, method, nature});
  const matched = !isDish(section) && family !== 'all'
    ? catalogVariants(subset, family, {query}) : browseDishes(subset, {query});
  return groupMenuRecipes(matched, {query});
}

/** 既存の簡易検索API用。新しい画面では同じ一覧を入力のたびに作り直しません。 */
export function quickRecipeChoices(data, query, {limit=6}={}) {
  if (!Array.isArray(data?.recipes) || typeof query !== 'string' || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw Error('検索する料理名を確認してください。');
  }
  return filteredMenus(recordSearchRecipes(data), null, query).slice(0, limit).map(group => ({
    recipeId:group.selectedRecipeId, label:group.label, selectedName:group.recipe.name, variantCount:group.variantCount,
  }));
}

/** 一覧から明示的に選んだ料理だけを onSelect に渡します。 */
export function mountRecordSearch({data, mode='keyword', guidedOnly=false, prefix=`record-search-${++serial}`,
  initialState={}, onStateChange=()=>{}, onResultsChange=()=>{}, onSelect}={}) {
  const state = {mode, section:'staple', family:'all', category:'all', method:'all', nature:'all',
    keyword:'', scopedQuery:'', ...initialState};
  if (guidedOnly) state.mode='guided';
  const root = element('section','record-search-picker');
  root.setAttribute('aria-label','記録する料理を探す');
  const switcher = element('div','record-search-modes');
  switcher.setAttribute('role','group');
  switcher.setAttribute('aria-label','料理の探し方');
  const guided = element('div','record-search-facets');
  const query = element('input','record-search-query quick-record-search');
  query.id=prefix+'-query'; query.type='search'; query.maxLength=200; query.autocomplete='off';
  query.placeholder='例：焼き魚、トースト、きのこ';
  const queryLabel=element('label','record-search-input-label');
  const queryText=element('span',''); queryLabel.htmlFor=query.id; queryLabel.append(queryText,query);
  const count=element('p','record-search-count field-note'); count.setAttribute('role','status');
  const results=element('div','record-search-results');
  let recipes, limit=6;
  // 「記録」を開くだけでは1000品の検索用一覧を作りません。
  const catalog=()=>recipes??=recordSearchRecipes(data);
  const changed=()=>onStateChange({...state});
  const scope=()=>state.mode==='guided'?state:null;
  const searchText=()=>state.mode==='guided'?state.scopedQuery:state.keyword;
  const facets={};
  for(const [id,title] of [['section','区分'],['category','食材の分類'],['method','調理法'],['family','料理の種類'],['nature','調理・提供形態']]) {
    const label=element('label','record-search-facet',title), select=element('select','record-search-'+id);
    select.id=prefix+'-'+id; label.htmlFor=select.id; label.append(select); guided.append(label);
    facets[id]={select,label};
    select.addEventListener('change',()=>{
      state[id]=select.value;
      if (id==='section') Object.assign(state,{family:'all',category:'all',method:'all'});
      if (id==='category') state.method='all';
      limit=6; renderFacets(); renderResults(); changed();
    });
  }
  if (!guidedOnly) {
    for (const [id,label] of [['keyword','キーワードで検索'],['guided','順に選ぶ']]) {
      const button=action(label,'button-secondary record-search-mode',()=>{
        if(state.mode===id)return;
        state.mode=id; limit=6; renderMode(); changed();
      });
      button.dataset.mode=id; switcher.append(button);
    }
    root.append(switcher);
  }
  root.append(guided,queryLabel,count,results);
  function renderFacets() {
    if (state.mode!=='guided') return;
    options(facets.section.select,sections,state.section);
    options(facets.nature.select,[['all','すべての形態'],...FOOD_NATURES.map(({id,label})=>[id,label])],state.nature);
    const hierarchical=isDish(state.section);
    facets.category.label.hidden=!hierarchical; facets.method.label.hidden=!hierarchical; facets.family.label.hidden=hierarchical;
    const subset=browseDishes(catalog(),{section:state.section});
    const choices=(all,items)=>[['all',all],...items.map(({id,label})=>[id,label])];
    // 選択肢は上位の分類だけで決めます。キーワードや提供形態で消さないようにします。
    if(hierarchical) {
      options(facets.category.select,choices('すべての食材',availableDishCategories(subset)),state.category);
      options(facets.method.select,choices('すべての調理法',availableCookingMethods(subset,{category:state.category})),state.method);
    } else {
      options(facets.family.select,choices('すべての種類',catalogFamilies(subset,{role:state.section})),state.family);
    }
  }
  function renderMode() {
    guided.hidden=state.mode!=='guided';
    for (const button of switcher.children) button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode));
    queryText.textContent=state.mode==='guided'?'選んだ条件の中で検索':'料理名・材料で検索';
    query.value=searchText(); renderFacets(); renderResults();
  }
  function resultCard(group,ids) {
    const card=element('div','record-search-result');
    const chosen=action(group.label,'button-secondary record-search-choice quick-record-choice',()=>{
      state.selectedId=chosen.dataset.recipeId; changed();
      onSelect(chosen.dataset.recipeId,searchText(),ids);
    });
    chosen.dataset.recipeId=group.selectedRecipeId;
    const caption=element('small','record-search-choice-detail'); chosen.append(caption);
    const nameChoice=recipe=>{
      chosen.dataset.recipeId=recipe.id;
      caption.textContent=group.label===recipe.name ? (families.get(recipeFamily(recipe))??'') : recipe.name;
      chosen.setAttribute('aria-label',group.label===recipe.name?recipe.name:`${group.label}・${recipe.name}`);
    };
    nameChoice(group.recipe); card.append(chosen);
    if (group.recipes.length>1) {
      const select=element('select','record-search-variant');
      select.setAttribute('aria-label',`${group.label}のバリエーション`);
      options(select,group.recipes.map(recipe=>[recipe.id,variantLabel(recipe)]),group.selectedRecipeId);
      select.addEventListener('change',()=>{const recipe=group.recipes.find(r=>r.id===select.value);if(recipe)nameChoice(recipe);});
      card.append(select);
    }
    return card;
  }
  function renderResults() {
    const text=searchText();
    const needsQuery=state.mode==='keyword'&&!text.trim();
    const matches=needsQuery?[]:filteredMenus(catalog(),scope(),text);
    const ids=matches.flatMap(group=>group.recipes.map(recipe=>recipe.id));
    results.replaceChildren(...matches.slice(0,limit).map(group=>resultCard(group,ids)));
    if(state.selectedId&&!ids.includes(state.selectedId))delete state.selectedId;
    onResultsChange(ids);
    count.hidden=needsQuery;
    count.textContent=needsQuery?'':matches.length?`${ids.length}種類の料理`:'条件に合う料理がありません。';
    if(matches.length>limit)results.append(action('候補をもっと見る','button-text record-search-more',()=>{limit+=6;renderResults();}));
  }
  query.addEventListener('input',()=>{
    if(state.mode==='guided')state.scopedQuery=query.value;else state.keyword=query.value;
    limit=6; renderResults(); changed();
  });
  query.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||event.keyCode===229)return;
    event.preventDefault();
    results.children[0]?.querySelector?.('.record-search-choice')?.focus();
  });
  renderMode();
  return root;
}
