/** 記録フォーム内へ追加する、具と汁の摂取割合の操作部。 */
import {SOUP_INTAKE_STAGES, buildSoupIntake, soupIntakeFor} from './soup-intake.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {recipePortion} from './catalog.js';

let sequence=0;
const make=(tag,className='',text='')=>{const element=document.createElement(tag);element.className=className;if(text)element.textContent=text;return element;};
const rounded=value=>Number(value.toFixed(2)).toLocaleString('ja-JP');
const percent=value=>Number((value*100).toFixed(6));
const labelFor=(text,input)=>{const label=make('label','soup-intake-label');label.htmlFor=input.id;label.append(make('span','soup-intake-label-text',text),input);return label;};

export function mountSoupIntake({baseRecipe,data,onChange=()=>{},onError=()=>{},onSelectionChange=()=>{},initial={}}={}){
  if(typeof onChange!=='function'||typeof onError!=='function'||typeof onSelectionChange!=='function')throw Error('汁の摂取量の表示処理を確認してください。');
  let base=baseRecipe,definition=soupIntakeFor(base,data);
  if(!definition)throw Error('この料理は汁の摂取割合に対応していません。');
  const first=buildSoupIntake({baseRecipe:base,brothRatio:initial.brothRatio??1,solidRatio:initial.solidRatio??1},data);
  const stableId=first.id,prefix=`soup-intake-${++sequence}`;
  const root=make('div','soup-intake');root.setAttribute('role','group');root.setAttribute('aria-label','汁と具を食べた割合');
  const title=make('h3','soup-intake-heading','汁と具を食べた割合'),intro=make('p','soup-intake-intro');
  const controls=make('div','soup-intake-controls'),broth=make('select','soup-intake-broth'),solids=make('select','soup-intake-solids');
  broth.id=`${prefix}-broth`;solids.id=`${prefix}-solids`;
  broth.setAttribute('aria-label','飲んだ汁の割合');solids.setAttribute('aria-label','食べた具の割合');
  for(const stage of SOUP_INTAKE_STAGES){const option=make('option','',`${stage.label}（${percent(stage.fraction)}%）`);option.value=String(stage.fraction);broth.append(option);}
  for(const [fraction,label] of [[0,'食べない'],[0.25,'4分の1'],[0.5,'半分'],[0.8,'ほとんど'],[1,'全量']]){const option=make('option','',`${label}（${percent(fraction)}%）`);option.value=String(fraction);solids.append(option);}
  const addInitial=(select,value)=>{if(![...select.children].some(option=>option.value===String(value))){const option=make('option','',`${percent(value)}%`);option.value=String(value);select.append(option);}select.value=String(value);};
  addInitial(broth,initial.brothRatio??1);addInitial(solids,initial.solidRatio??1);
  const brothLabel=labelFor('飲んだ汁の割合',broth),solidLabel=labelFor('食べた具の割合',solids);controls.append(brothLabel,solidLabel);
  const note=make('p','soup-intake-note'),error=make('p','soup-intake-error');error.hidden=true;error.setAttribute('role','status');error.setAttribute('aria-live','polite');
  const preview=make('div','soup-intake-preview'),previewTitle=make('p','soup-intake-preview-title'),nutrition=make('dl','soup-intake-nutrients'),values=new Map();
  for(const key of NUTRIENT_KEYS){const row=make('div','soup-intake-nutrient'),value=make('dd');row.append(make('dt','',NUTRIENT_LABELS[key]),value);nutrition.append(row);values.set(key,value);}
  const materials=make('details','soup-intake-materials'),parts=make('ul'),basis=make('details','soup-intake-basis'),source=make('p','soup-intake-note');
  materials.append(make('summary','','用意する1人分の材料（残す汁を含む）'),parts);basis.append(make('summary','','具と汁の配分・計算の仮定'),source);
  preview.append(previewTitle,nutrition,materials,basis);root.append(title,intro,controls,note,error,preview);
  function update(){
    try{
      definition=soupIntakeFor(base,data);
      if(!definition)throw Error('この組み合わせは汁と具の配分を確認できません。');
      if(String(broth.value).trim()===''||String(solids.value).trim()==='')throw Error('汁と具の割合を選んでください。');
      const config={brothRatio:Number(broth.value),solidRatio:Number(solids.value)};
      const recipe=buildSoupIntake({baseRecipe:base,id:stableId,...config},data);
      solidLabel.hidden=definition.homogeneous;
      brothLabel.children[0].textContent=definition.homogeneous?'食べたスープ全体の割合':'飲んだ汁の割合';
      broth.setAttribute('aria-label',definition.homogeneous?'食べたスープ全体の割合':'飲んだ汁の割合');
      intro.textContent=definition.homogeneous?'具をなめらかに混ぜたスープは、全体を食べた割合で計算します。':'具は全量を食べる設定が初期値です。汁を残した割合と、必要なら具を残した割合を選んでください。';
      note.textContent='買い物には、残す汁も含めて調理に必要な材料を使います。具に染みた汁や肉から溶け出す脂の移動は自動補正しない概算です。';
      previewTitle.textContent=`食べた分の栄養 / ${recipePortion(base).label}`;
      for(const key of NUTRIENT_KEYS)values.get(key).textContent=recipe.manualNutrition[key]===null?'未入力':`${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      parts.replaceChildren(...recipe.ingredients.map(part=>make('li','',`${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      const split=Object.entries(definition.ingredientFractions).filter(([id])=>recipe.ingredients.some(part=>part.id===id)).map(([id,fraction])=>`${data.ingredients[id].name}：${fraction===0?'具':fraction===1?'汁':`汁${percent(fraction)}%・具${percent(1-fraction)}%`}`).join('、');
      source.textContent=`${split}。${recipe.sourceNote}`;
      error.hidden=true;error.textContent='';preview.hidden=false;onError('');onSelectionChange(structuredClone(config));onChange(recipe);
    }catch(cause){error.hidden=false;error.textContent=cause.message;preview.hidden=true;onSelectionChange(null);onChange(null);onError(cause.message);}
  }
  broth.addEventListener('change',update);solids.addEventListener('change',update);
  root.setBaseRecipe=recipe=>{base=recipe;update();};
  root.getSelection=()=>({brothRatio:Number(broth.value),solidRatio:Number(solids.value)});
  update();return root;
}
