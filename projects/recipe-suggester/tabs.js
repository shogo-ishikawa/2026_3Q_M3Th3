/** URLを保ちながら、キーボードでも切り替えられるアプリ内タブ。 */
const ROUTES={calendar:'record',record:'record',nutrition:'nutrition',planner:'planner',shopping:'kitchen',pantry:'kitchen',kitchen:'kitchen',recipes:'catalog',catalog:'catalog',settings:'settings'};
const HASHES={record:'calendar',nutrition:'nutrition',planner:'planner',kitchen:'shopping',catalog:'recipes',settings:'settings'};

export function setupTabs({onKitchenRoute=()=>{}}={}){
  const buttons=[...document.querySelectorAll('[role="tab"][data-tab]')];
  const tablist=buttons[0].closest('[role="tablist"]');
  const compactLayout=window.matchMedia('(max-width:760px)');
  const updateOrientation=()=>tablist.setAttribute('aria-orientation',compactLayout.matches?'horizontal':'vertical');
  updateOrientation();
  compactLayout.addEventListener('change',updateOrientation);

  function activate(id,{focus=false,update=true,scroll=true}={}){
    if(!Object.hasOwn(HASHES,id))id='planner';
    for(const button of buttons){const active=button.dataset.tab===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;const panel=document.getElementById(button.getAttribute('aria-controls'));if(panel)panel.hidden=!active;}
    document.body.dataset.activeTab=id;
    if(update)history.replaceState(null,'',`#${HASHES[id]}`);
    if(focus)buttons.find(button=>button.dataset.tab===id)?.focus();
    if(scroll)window.scrollTo({top:0,behavior:'instant'});
  }
  function followRoute(hash){
    if(!Object.hasOwn(ROUTES,hash))return;
    activate(ROUTES[hash],{update:false,scroll:false});
    if(hash==='pantry')onKitchenRoute('pantry');
    if(hash==='shopping')onKitchenRoute('checklist');
  }
  for(const button of buttons){
    button.addEventListener('click',()=>activate(button.dataset.tab));
    button.addEventListener('keydown',event=>{
      const index=buttons.indexOf(button);let next;
      if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%buttons.length;
      else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index+buttons.length-1)%buttons.length;
      else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
      event.preventDefault();activate(buttons[next].dataset.tab,{focus:true});
    });
  }
  document.addEventListener('click',event=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest('a[href^="#"]');if(!link)return;
    const hash=link.getAttribute('href').slice(1);
    if(hash==='main'){
      event.preventDefault();
      document.getElementById('main').focus();
      return;
    }
    followRoute(hash);
  });
  window.addEventListener('hashchange',()=>followRoute(location.hash.slice(1)||'planner'));
  const initial=location.hash.slice(1);
  followRoute(Object.hasOwn(ROUTES,initial)?initial:'planner');
  return activate;
}
