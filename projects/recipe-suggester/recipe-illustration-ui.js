/** 小さな分類イラスト。実物の具材・分量・盛り付けを示す写真ではありません。 */
import {recipeIllustration} from './recipe-illustration.js';

// アプリ専用のベクター図形です。外部画像・フォント・通信は使いません。
const plate='<ellipse cx="54" cy="57" rx="39" ry="18" fill="#fffdf6"/><ellipse cx="54" cy="57" rx="30" ry="12" fill="none" stroke="#d6dfcd"/>';
const bowl='<path d="M20 45h68c-3 19-15 28-34 28S23 64 20 45Z" fill="#dce5d2"/><path d="M44 73h20"/>';
const leaf='<path d="M43 56c-14-1-23-12-19-24 14-1 24 10 19 24Z" fill="#aabd91"/><path d="m28 36 15 20"/>';
const ART=Object.freeze({
  rice:`${bowl}<path d="M23 44c1-11 11-19 22-17 8-9 22-5 26 2 10 0 16 6 15 15Z" fill="#fffdf4"/><path d="m36 36 2-2m13 3 2-2m13 1 2 1" stroke="#c4ceba"/>`,
  onigiri:`${plate}<path d="m32 48 16-25c3-4 8-4 11 0l17 25c5 8 0 13-8 13H40c-8 0-13-5-8-13Z" fill="#fffdf4"/><path d="M45 45h19v17H45Z" fill="#71836c" stroke="#71836c"/>`,
  bread:`${plate}<path d="M27 39c-6-13 7-22 20-16 10-8 26-3 27 8 11 1 13 16 4 20v17H31V50c-3-2-4-6-4-11Z" fill="#e8c99d"/><path d="M39 38c7-5 20-5 28-1M41 47v10m12-12v12m12-12v12" stroke="#af8967"/>`,
  noodles:`${bowl}<ellipse cx="54" cy="44" rx="34" ry="8" fill="#e9d8b4"/><path d="M35 41c1-8 10-10 11-2s10 8 10-1 11-8 11 1 7 7 9 1" fill="none" stroke="#b8a16e"/><path d="m61 23 34-8m-33 13 34-8" stroke="#9a7c61" stroke-width="3"/>`,
  curry:`${plate}<path d="M26 55c0-11 14-18 29-15 10-7 27 0 28 12 2 13-16 20-34 17-16 1-25-6-23-14Z" fill="#cfaa70"/><path d="M27 55c0-12 15-19 27-16 6 7 3 18-3 28-16 2-25-3-24-12Z" fill="#fffdf4"/><path d="m62 48 8 2m-7 9 9-2" stroke="#af8655"/>`,
  pizza:`${plate}<path d="m29 31 53 7-30 33Z" fill="#e8ce94"/><path d="m34 38 39 5-22 23Z" fill="#f1dba9" stroke="none"/><path d="m28 30 56 7" stroke="#b38c62" stroke-width="8"/><path d="m44 46 9 2m10-1 5 2m-17 9 4-1" stroke="#b87965" stroke-width="5"/><path d="m39 41 3 4m17 10 4 1" stroke="#8ca277"/>`,
  sushi:`${plate}<path d="M24 48q0-9 13-9t13 9v10H24Zm34-1q0-9 13-9t13 9v10H58Z" fill="#fffdf4"/><path d="M21 40q14-11 30 0v9H21Z" fill="#dba48b"/><path d="M56 39q15-11 31 0v9H56Z" fill="#cf937e"/><path d="m31 37 6 9m30-10 7 9" stroke="#efc8b2"/>`,
  burger:`${plate}<path d="M25 44c1-17 13-23 29-23s28 6 29 23Z" fill="#dfbd88"/><path d="m24 48 9 5 10-5 11 5 10-5 10 5 11-5" fill="none" stroke="#8ca477" stroke-width="4"/><path d="M27 57h54" stroke="#9d8068" stroke-width="8"/><path d="M25 63h58q-2 10-14 10H39q-12 0-14-10Z" fill="#dfbd88"/><path d="m42 32 2-1m13-2 2 1m10 4 2 1" stroke="#fff7df"/>`,
  hotpot:`<path d="M18 47h72v14c0 11-14 16-36 16S18 72 18 61Z" fill="#d5dfca"/><path d="M18 50H9v9h9m72-9h9v9h-9" fill="none"/><path d="M18 44c9-20 62-20 72 0Z" fill="#e9eddc"/><path d="M46 28v-5h16v5M24 44h60" fill="none"/><path d="M41 17c-6-4 3-8 0-12m25 12c-6-4 3-8 0-12" fill="none" stroke="#abb99c"/>`,
  soup:`${bowl}<ellipse cx="54" cy="44" rx="34" ry="8" fill="#dec3a0"/><path d="M42 26c-7-7 5-10 0-17m17 17c-7-7 5-10 0-17" fill="none" stroke="#abb99c"/><path d="M72 36 92 19" stroke="#8d9c7b" stroke-width="3"/>`,
  sashimi:`${plate}<path d="m27 44 16-5 12 10-17 7Zm18 9 18-7 11 11-18 7Zm17-15 16-5 11 10-16 7Z" fill="#d8a58f"/><path d="m34 43 10 8m9 1 11 8m6-22 10 8" stroke="#efd0bd"/><path d="m27 57-8 6 12 4" fill="#aabd91" stroke="#aabd91"/>`,
  grill:`<path d="M25 32h53v34c0 6-6 10-13 10H38c-8 0-13-4-13-10Z" fill="#d9e3d0"/><path d="M78 44h23v9H78M33 42h37m-37 9h37m-37 9h37m-37 9h37" fill="none"/><path d="M38 23c-6-5 3-8 0-13m15 13c-6-5 3-8 0-13m15 13c-6-5 3-8 0-13" fill="none" stroke="#b7b28e"/>`,
  skewer:`${plate}<path d="m22 70 61-43m-52 46 61-43" stroke="#af936c" stroke-width="2.5"/><path d="m28 51 12-9 10 14-12 9Zm20-14 12-9 10 14-12 9Zm-7 25 12-9 9 13-12 9Zm20-14 12-9 9 13-12 9Z" fill="#cfb38a"/>`,
  'stir-fry':`<path d="M19 49c4 18 20 26 40 23 12-2 21-9 25-23Z" fill="#d4dfcd"/><path d="m83 48 18-12" stroke-width="6"/><ellipse cx="51" cy="48" rx="32" ry="8" fill="#f0e1bf"/><path d="m31 42 13 6m4-9 9 10m7-9 6 8" stroke="#9bae84" stroke-width="5"/><path d="m38 51 10-1m11 2 11-3" stroke="#cb9b7e" stroke-width="4"/>`,
  fried:`${plate}<path d="M27 51c0-8 6-15 15-13 9-2 16 8 12 16-1 10-13 15-20 8-4-2-7-6-7-11Zm33-8c4-8 17-8 22-1 7 7 4 19-5 22-9 3-20-4-20-12 0-4 1-6 3-9Z" fill="#d6b27c"/><path d="m35 46 2 1m8 9 2-1m19-10 2 1m9 9 2-1" stroke="#aa8c63"/>`,
  salad:`${plate}${leaf}<path d="M47 55c-9-17 0-31 15-30 7 14-1 27-15 30Z" fill="#b5c79c"/><path d="M57 59c-1-15 13-23 26-17 0 14-14 23-26 17Z" fill="#95ae85"/><path d="m59 31-12 24m29-9-19 13" fill="none"/><path d="m36 62 12 5m20-4 9-5" stroke="#d5a585" stroke-width="5"/>`,
  egg:`${plate}<path d="M29 53c-4-11 5-21 16-20 9-6 24-3 28 7 12 3 16 18 5 24-8 8-22 6-29 3-11 3-22-5-20-14Z" fill="#fffaf0"/><ellipse cx="57" cy="49" rx="13" ry="11" fill="#e7c77b" stroke="#c9ab6c"/>`,
  tofu:`${plate}<path d="m31 40 27-9 25 11-27 10Z" fill="#fffdf2"/><path d="M31 40v20l25 11V52Zm25 12v19l27-10V42Z" fill="#e9e9d8"/><path d="m45 36 25 11m-2-12L43 46m0 0v19m27-18v19" stroke="#cad0bb"/><path d="m53 29 7 3m-4-8 5 2" stroke="#8da779" stroke-width="3"/>`,
  vegetables:`${plate}${leaf}<path d="m52 39 15 3-8 27c-2 4-6 4-7-1Z" fill="#d5b085"/><path d="m58 39-4-13m6 13 7-12" stroke="#91a77b"/><path d="M71 59c-1-12 8-20 19-16-1 11-8 18-19 16Z" fill="#b5c79e"/>`,
  fruit:`${plate}<path d="M53 36c-21-13-32 3-25 20 5 15 14 20 24 14 11 6 22 0 27-14 7-17-6-33-26-20Z" fill="#cf9c85"/><path d="m53 36 2-13m1 3c8-9 18-7 20-6-2 9-11 12-20 6Z" fill="#a5b891"/><path d="M37 44c-4 5-2 12 1 15" stroke="#eac5ae" fill="none"/>`,
  dessert:`${plate}<path d="M30 42h49v23H30Z" fill="#e6c7a4"/><path d="M30 50h49v7H30Z" fill="#fff9e9" stroke="none"/><path d="M30 42c0-7 7-12 13-10 3-8 17-8 20-1 9-2 16 4 16 11Z" fill="#fff9e9"/><path d="M51 30c-4-7 0-13 6-10 7-1 8 7 3 12Z" fill="#cc9a86"/><path d="m54 20 4-4" stroke="#8fa67b"/>`,
  drink:`<ellipse cx="54" cy="72" rx="35" ry="6" fill="#e7ecdc" stroke="none"/><path d="M28 30h48v28c0 12-12 17-24 17S28 70 28 58Z" fill="#e1e8d7"/><path d="M76 36h9c15 0 15 23-1 23h-8" fill="none" stroke-width="3"/><ellipse cx="52" cy="30" rx="24" ry="6" fill="#c9b293"/><path d="M44 19c-6-5 4-8 0-13m16 13c-6-5 4-8 0-13" fill="none" stroke="#abb99c"/>`,
  cheese:`${plate}<path d="m30 50 42-20 14 24-56 13Z" fill="#e8d29c"/><path d="m30 50 43-5 13 9-56 13Z" fill="#ddc18b"/><circle cx="50" cy="56" r="3" fill="#c9ac77" stroke="none"/><circle cx="70" cy="54" r="2.5" fill="#c9ac77" stroke="none"/>`,
  nuts:`${plate}<path d="M35 32c-20 6-21 26-7 31 16-2 22-20 7-31Zm32 5c-19 7-19 28-4 31 15-4 20-22 4-31Z" fill="#ccae88"/><path d="m34 38-6 19m39-14-4 18" stroke="#a68c6e"/><path d="M83 38c-10 1-11 12-5 15 8 3 14-8 5-15Z" fill="#dbc5a4"/>`,
  plate:`${plate}<path d="M21 26v18m7-18v18m-14-18v18m0 0q7 8 14 0m-7 6v27M91 26c-9 4-10 18-3 23h3v28m0-51v23" fill="none" stroke="#8da17c" stroke-width="2.5"/><path d="m44 48 10 6 10-6m-20 9 10 6 10-6" fill="none" stroke="#c5b28d"/>`,
});

export function recipeIllustrationElement(recipe){
  const {kind}=recipeIllustration(recipe),wrapper=document.createElement('span');
  wrapper.className='recipe-illustration';wrapper.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 108 88');svg.setAttribute('width','108');svg.setAttribute('height','88');svg.setAttribute('focusable','false');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','#718168');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  svg.innerHTML=ART[kind]??ART.plate;wrapper.append(svg);return wrapper;
}
