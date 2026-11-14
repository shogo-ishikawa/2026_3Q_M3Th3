/** メニュー画面から、保存済みの単品をジャンルごとに呼び出します。 */
import {matchesJapaneseQuery} from './japanese-search.js';
import {mealSetWarnings} from './meal-sets.js';
import {GENRES as KNOWN_GENRES} from './storage.js';

const GENRES=[...KNOWN_GENRES,'未分類'];
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const formatAmount=value=>Number(value.toFixed(3)).toLocaleString('ja-JP');
const action=(label,fn,className='button-secondary')=>{const button=make('button',className,label);button.type='button';button.addEventListener('click',fn);return button;};

/** 保存したジャンルを優先し、旧データでは残っている元メニューの分類だけを使います。 */
export function favouriteGenre(item,data,savedGenre){
  if(KNOWN_GENRES.includes(savedGenre))return savedGenre;
  const genre=data?.recipes?.find(recipe=>recipe.id===item?.recipeId)?.genre;
  return GENRES.includes(genre)&&genre!=='未分類'?genre:'未分類';
}

export function mountCatalogFavourites({favourites=[],data,settings={},onOpen=()=>{},onAddShopping=()=>{},onDelete=()=>{},onError=()=>{}}={}){
  if(!Array.isArray(favourites)||!data||!Array.isArray(data.recipes)||[onOpen,onAddShopping,onDelete,onError].some(fn=>typeof fn!=='function'))throw Error('お気に入りの一覧を確認してください。');
  const root=make('section','catalog-favourites');root.setAttribute('aria-label','お気に入りのメニュー');
  const heading=make('div','catalog-favourites-heading');heading.append(make('h3','','お気に入りのメニュー'),make('p','field-note','ジャンルからいつもの料理を探せます。保存した量・材料・栄養を保ったまま開きます。'));
  root.append(heading);
  const controls=make('div','catalog-favourites-controls'),genres=make('div','catalog-favourites-genres');genres.setAttribute('role','group');genres.setAttribute('aria-label','お気に入りのジャンル');
  const searchLabel=make('label','catalog-favourites-search-label','お気に入りを検索'),search=make('input','catalog-favourites-search');search.type='search';search.placeholder='料理名で検索';search.setAttribute('aria-label','お気に入りを検索');searchLabel.append(search);
  controls.append(genres,searchLabel);root.append(controls);
  const status=make('p','field-note catalog-favourites-status');status.setAttribute('role','status');
  const results=make('div','catalog-favourites-results'),error=make('p','notice error catalog-favourites-error');error.hidden=true;error.setAttribute('role','alert');
  root.append(status,results,error);
  let selectedGenre='all';
  const records=favourites.map(favourite=>({favourite,genre:favouriteGenre(favourite.item,data,favourite.genre)}));
  const act=fn=>()=>{try{fn();error.hidden=true;error.textContent='';}catch(cause){const message=cause?.message??'操作を完了できませんでした。';error.textContent=message;error.hidden=false;onError(message);}};
  const cloneItem=favourite=>structuredClone(favourite.item);
  function card(favourite){
    const article=make('article','catalog-favourite-card'),title=make('h5','catalog-favourite-title');
    title.append(action(favourite.name,act(()=>onOpen(cloneItem(favourite))),'catalog-favourite-open'));
    const item=favourite.item,portion=item.portion??{amount:1,unit:'人分'};
    article.append(title);
    if(favourite.name!==item.name)article.append(make('p','catalog-favourite-original',item.name));
    article.append(make('p','catalog-favourite-amount',`保存した量：${formatAmount(item.quantity*portion.amount)}${portion.unit}`));
    for(const warning of mealSetWarnings({items:[item]},settings,data))article.append(make('p','catalog-favourite-warning',warning));
    const actions=make('div','catalog-favourite-actions');
    actions.append(action('保存した内容を開く',act(()=>onOpen(cloneItem(favourite))),'button-secondary catalog-favourite-details'),action('買い物に追加',act(()=>onAddShopping(cloneItem(favourite))),'button-primary catalog-favourite-shopping'),action('お気に入りから外す',act(()=>onDelete(favourite.id)),'button-text catalog-favourite-remove'));
    article.append(actions);return article;
  }
  function render(){
    genres.replaceChildren();
    for(const [id,label,total]of [['all','すべて',records.length],...GENRES.map(genre=>[genre,genre,records.filter(record=>record.genre===genre).length])]){
      const button=action(`${label} ${total}件`,()=>{selectedGenre=id;render();},'button-secondary catalog-favourites-genre');button.dataset.genre=id;button.setAttribute('aria-pressed',String(selectedGenre===id));genres.append(button);
    }
    const query=search.value?.trim()??'',matching=records.filter(record=>(selectedGenre==='all'||record.genre===selectedGenre)&&matchesJapaneseQuery([record.favourite.name,record.favourite.item.name],query));
    status.textContent=`お気に入り ${matching.length}件 / 全${records.length}件`;
    results.replaceChildren();
    if(!matching.length){
      results.append(make('p','catalog-favourites-empty field-note',records.length?'このジャンルや検索語に一致するお気に入りがありません。':'料理の詳細や記録画面でお気に入りに保存すると、ここから呼び出せます。'));
      return;
    }
    for(const genre of GENRES){
      const group=matching.filter(record=>record.genre===genre);if(!group.length)continue;
      const section=make('section','catalog-favourites-group');section.setAttribute('aria-label',`${genre}のお気に入り`);section.append(make('h4','catalog-favourites-group-title',`${genre} · ${group.length}件`));
      if(genre==='未分類')section.append(make('p','field-note catalog-favourites-unclassified','ジャンルを保存しておらず元メニューもない料理は、推測せず未分類に表示します。'));
      const grid=make('div','catalog-favourites-grid');for(const {favourite}of group)grid.append(card(favourite));section.append(grid);results.append(section);
    }
  }
  search.addEventListener('input',render);render();return root;
}
