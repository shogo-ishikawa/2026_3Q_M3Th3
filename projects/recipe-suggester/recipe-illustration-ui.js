/** 色鉛筆・水彩で描いた、料理ごとの標準的な完成イメージ。 */
import {recipeArtwork} from './recipe-illustration.js?v=3.19.0';

export function recipeIllustrationElement(recipe,{detail=false,standard=false}={}){
  const artwork=recipeArtwork(recipe);if(!artwork)return null;
  const figure=document.createElement('figure');figure.className=`recipe-art ${detail?'recipe-art-detail':'recipe-art-card'}`;
  const frame=document.createElement('span');frame.className='recipe-art-image-frame';
  const image=document.createElement('img');image.src=detail?artwork.largeSrc:artwork.src;
  image.width=detail?960:artwork.width;image.height=detail?720:artwork.height;
  image.loading=detail?'eager':'lazy';image.decoding='async';image.alt=`${artwork.name}の完成イメージ`;
  image.addEventListener('error',()=>{figure.hidden=true;figure.closest('.recipe-card')?.classList.remove('has-recipe-art');});
  frame.append(image);
  const caption=document.createElement('figcaption');caption.textContent='AI生成・完成イメージ';
  figure.append(frame,caption);
  if(detail){
    const note=document.createElement('p');note.className='recipe-art-note';
    note.textContent=standard?'標準の組み合わせの完成イメージです。選択した具材や量で絵は変わりません。':'標準レシピをもとに描いた完成イメージです。実際の盛り付けや量は異なります。';
    figure.append(note);
  }
  return figure;
}
