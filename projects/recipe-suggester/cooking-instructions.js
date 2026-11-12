/**
 * 公開レシピを、料理に必要な工程数で読めるように整える。
 * 元レシピの材料・量・栄養・IDは変更せず、新しく作る記録にだけ反映する。
 * 加熱の目安: 厚生労働省「家庭での食中毒予防」
 * https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/syokuchu/01_00008.html
 */
import {recipeFamily, recipeNature} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';

const purchased = new Set(['instant','retort','fast-food','ready-to-eat']);
const rawMeat = new Set(['chicken','chicken_breast','chicken_minced','pork','pork_minced','beef','beef_minced','pork_loin','pork_belly','beef_stew_cut']);
const rawFish = new Set(['salmon','mackerel','cod','horse_mackerel','sardine','tuna','shrimp','squid','scallop','yellowtail','flounder']);
const heatWords = /焼|炒|煮|蒸|揚|加熱|ゆで|茹で|温め/;
const plateWords = /盛|器に分|皿に分|いただく|切り分け/;
const plainSentences = recipe => (recipe.steps ?? []).flatMap(step => String(step).split(/(?<=。)/u).map(s => s.trim()).filter(Boolean));
const joinSentences = sentences => {
  const result=[];let pending='';
  for(const value of sentences.filter(Boolean)){
    const sentence=pending+(/[。！？]$/.test(value)?value:value+'。');pending='';
    if(sentence.length<10){if(result.length)result[result.length-1]+=sentence;else pending=sentence;}
    else result.push(sentence);
  }
  if(pending){if(result.length)result[result.length-1]+=pending;else result.push(pending);}
  return result;
};
const hasPart = (recipe,id) => recipe.ingredients?.some(part=>part.id===id);
const hasAny = (recipe,ids) => recipe.ingredients?.some(part=>ids.has(part.id));
const shortName = name => String(name ?? '').replace(/（[^）]*）/g,'');
const ingredientNames = (recipe,ingredients,ids) => recipe.ingredients.filter(p=>ids.includes(p.id)).map(p=>shortName(ingredients[p.id]?.name??p.id));
const safety = '温度計を使い、最も厚い部分の中心が75℃に達してから1分以上加熱する。焼き色や肉汁の色だけで加熱完了を判断しない。';

function hamburg(recipe) {
  const name=recipe.name, soy=hasPart(recipe,'tofu');
  const steps=[];
  if(soy)steps.push('豆腐を清潔なペーパーで包んで水切りし、崩しておく。余分な水が残ると肉だねがまとまりにくい。');
  steps.push('玉ねぎを細かいみじん切りにする。生肉を扱う前に、添える具やソースの材料も切って別にしておく。');
  if(hasPart(recipe,'breadcrumbs'))steps.push('パン粉に分量の牛乳を混ぜ、むらなく吸わせてしっとりさせる。');
  if(recipe.id==='beef-hamburg')steps.push('分量の油の半量で玉ねぎを弱めの中火で炒め、しんなりしたら清潔な器に広げて冷ます。');
  const components=[soy?'水切りした豆腐':'',hasPart(recipe,'egg')?'溶いた卵':'',hasPart(recipe,'breadcrumbs')?'牛乳で湿らせたパン粉':'',hasPart(recipe,'starch')?'片栗粉':'',hasPart(recipe,'salt')?'塩':'',hasPart(recipe,'black_pepper')?'こしょう':''].filter(Boolean);
  steps.push(`ボウルに冷たいひき肉、玉ねぎ${components.length?'、'+components.join('、'):''}を入れ、粘りが出て全体が一体になるまで練る。`);
  steps.push('手に取って空気を抜き、厚みをそろえた小判形にする。中央を少しくぼませると、中心だけが厚く膨らむのを抑えられる。');
  steps.push('分量の油をフライパンに広げて中火にかけ、肉だねを重ならないように並べる。底に焼き色が付いて形が固まってから裏返す。');
  if(/煮込み/.test(name))steps.push('きのこを切り、トマト缶、トマトペースト、ウスターソース、砂糖、水とともに加える。煮立ったら弱火にし、ふたをして時々ソースをかけながら煮込む。');
  else steps.push(hasPart(recipe,'water')?'弱火に落として分量の水の一部を加え、ふたをして蒸し焼きにする。水をソースにも使う料理では、その分を取り分けておく。':'弱火に落としてふたをし、焦げ付かないよう火加減を調整しながら中心まで加熱する。');
  steps.push(safety);
  if(/おろし/.test(name))steps.push('別の小鍋でしょうゆ、米酢、みりんをひと煮立ちさせる。大根をすりおろし、焼けたハンバーグとともに盛ってたれを添える。');
  else if(/チーズ/.test(name))steps.push('火が通った肉だねにチーズをのせ、ふたをして余熱で溶かす。トマトペースト、ウスターソース、水を別に温めたソースを添える。');
  else if(recipe.id==='classic-hamburg')steps.push('肉を清潔な皿へ取り出す。フライパンにトマトペースト、ウスターソース、残りの水を加えて弱火で混ぜ、ソースを肉へかける。');
  else if(soy)steps.push('ふたを外し、しょうゆとみりんを加えて弱めの中火で絡める。たれに照りが出たら火を止め、清潔な器具で盛り付ける。');
  else steps.push('中心まで加熱できたら火を止め、清潔な器具で皿へ移す。生肉に触れた皿や箸は盛り付けに使い回さない。');
  return steps;
}

function dumplings(recipe) {
  const text=recipe.name;
  if(!hasPart(recipe,'dumpling_wrappers'))return null;
  const parts=recipe.ingredients.map(p=>p.id);
  const mince=parts.find(id=>/_minced$/.test(id));
  if(!mince)return null;
  const shumai=/シュウマイ|焼売/.test(text),water=/水餃子/.test(text),spring=/春巻/.test(text);
  if(spring)return null;
  const steps=[];
  if(shumai){
    steps.push('玉ねぎを細かいみじん切りにする。皮を使う分だけ取り出し、乾燥しないよう清潔な布などをかけておく。');
    if(hasPart(recipe,'starch'))steps.push('玉ねぎに片栗粉をまぶす。切り口の水分を受け止め、蒸したときに肉だねから水が出にくくする。');
    steps.push('冷たいひき肉にしょうゆ、ごま油、砂糖を加え、粘りが出るまで練る。玉ねぎを加え、全体が均一になるまで混ぜる。');
    steps.push('親指と人差し指で輪を作って皮をのせ、肉だねを中央に入れる。側面を軽く押さえて円柱状にし、底を平らに整える。');
    steps.push('蒸し器にクッキングシートを敷き、蒸気の通り道を残してシュウマイを並べる。くっつかないよう間隔をあける。');
    steps.push('蒸気が十分に上がってからふたをする。蒸気が途切れない火加減を保ち、鍋の湯がなくならないよう確認しながら蒸す。');
    steps.push(safety);
    steps.push('皮が肉だねになじんだら、清潔な器具で崩さないように取り出す。蒸し器のふたを開けるときは熱い蒸気を顔や手に当てない。');
  }else{
    const veg=hasPart(recipe,'cabbage')?'キャベツ':hasPart(recipe,'chinese_cabbage')?'白菜':'野菜';
    steps.push(`${veg}${hasPart(recipe,'chive')?'、にら':''}${hasPart(recipe,'ginger')?'、しょうが':''}を細かく刻む。洗った野菜の水分はよく切り、肉だねが水っぽくならないようにする。`);
    steps.push('ひき肉と分量の調味料を先に練って粘りを出し、刻んだ野菜を加えて均一に混ぜる。包むまで冷蔵庫で冷やしておく。');
    steps.push('皮の中央に肉だねをのせ、縁を少し湿らせて空気を抜きながら閉じる。入れすぎると口が開くので、縁に具を付けないようにする。');
    if(water){
      steps.push('鍋の湯を十分に沸かし、包んだ餃子を重ならないように入れる。鍋底へ付かないよう、おたまでそっと動かす。');
      steps.push('再び煮立ったら静かに沸く火加減にする。浮き上がっただけでは加熱完了とせず、肉だねの中心まで火を通す。');
      steps.push(safety);
      steps.push('穴あきのおたまなどで皮を破らないように取り出し、湯を切って盛る。');
    }else{
      steps.push('ごま油を広げたフライパンへ、餃子をくっつけずに並べて中火にかける。底が軽く色付いたら、分量の水を鍋肌から注ぐ。');
      steps.push('すぐにふたをし、蒸気が保てる火加減で蒸し焼きにする。皮がしんなりしてから肉だねの中心を確認する。');
      steps.push(safety);
      steps.push('ふたを外して残った水分を飛ばす。底が香ばしくなったら火を止め、フライ返しで焼き面をはがして盛り付ける。');
    }
  }
  return steps;
}

function curry(recipe) {
  if(!hasPart(recipe,'curry_powder')||!hasPart(recipe,'flour')||!hasPart(recipe,'tomato_paste'))return null;
  const meat=hasAny(recipe,rawMeat);
  const steps=[
    '玉ねぎを薄切りにし、にんじんとじゃがいもを厚みのそろった一口大に切る。じゃがいもの芽と緑色の部分を取り除く。',
    meat?'肉を食べやすい大きさに切る。野菜を切る器具と分け、肉の厚みもなるべく均一にする。':'かぼちゃの種とわたを除いて薄めに切る。なすは食べやすく切り、水煮ひよこ豆は表示に合わせて用意する。',
    '厚手の鍋に分量の油を入れ、玉ねぎを弱めの中火で炒める。焦がさず、透き通ってやわらかくなるまで混ぜる。',
    meat?'肉を加えてほぐしながら炒め、続けてにんじんとじゃがいもを加えて表面に油をなじませる。':'にんじん、じゃがいも、かぼちゃ、なすを加え、表面に油が回るまで炒める。',
    '弱火にしてカレー粉と薄力粉を振り入れ、粉っぽさがなくなるまで炒める。香辛料は焦げやすいので強火にしない。',
    '分量の水を少しずつ加え、その都度鍋底から混ぜて粉をのばす。トマトペーストと塩を加えて煮立てる。',
    '煮立ったら弱火にし、時々鍋底を混ぜながら具がやわらかくなるまで煮る。じゃがいもやにんじんに竹串がすっと通るか確かめる。',
  ];
  if(meat)steps.push(safety);else steps.push('水煮ひよこ豆を加えて中心まで温める。とろみが均一になるように全体を軽く混ぜる。');
  steps.push('炊飯済みのご飯を十分に温める。カレーが好みの濃さになったら火を止め、ご飯とともに人数分の皿に盛る。');
  return steps;
}

function classicFried(recipe) {
  if(/^classic-karaage-/.test(recipe.id)){
    const flavour=[];
    if(hasPart(recipe,'ginger'))flavour.push('すりおろしたしょうが');
    if(hasPart(recipe,'garlic'))flavour.push('すりおろしたにんにく');
    if(hasPart(recipe,'soy_sauce'))flavour.push('しょうゆ');
    if(hasPart(recipe,'salt'))flavour.push('塩');
    if(hasPart(recipe,'sake'))flavour.push('清酒');
    if(hasPart(recipe,'sugar'))flavour.push('砂糖');
    return [
      '鶏肉の厚い部分を開き、厚みのそろった一口大に切る。表面の水気をペーパーで拭く。',
      `${flavour.join('、')}を肉へもみ込み、ふたをして冷蔵庫で味をなじませる。生肉に触れた漬け汁や器具を盛り付けに使わない。`,
      '肉の汁気を軽く切り、揚げる直前に片栗粉を薄くまぶす。粉が厚く固まった部分は軽く落とす。',
      'フライパンか揚げ鍋に、使う器具に適した量の油を熱する。材料欄の油は衣や肉に残る量の目安で、鍋に入れる全量とは異なる。',
      '鶏肉を重ならないよう少量ずつ入れ、衣が固まってから返す。表面だけが濃く色付く場合は火を弱め、内部まで加熱する。',
      safety,
      '清潔な網へ上げて油を切る。衣が蒸れないように重ねず、人数分の皿へ分けて盛る。',
      ...(hasPart(recipe,'lemon')?['レモン汁は食べる直前に添え、衣がふやけるのを防ぐ。']:[]),
    ];
  }
  if(['classic-tonkatsu','classic-chicken-katsu','classic-menchi'].includes(recipe.id)){
    const menchi=recipe.id==='classic-menchi';
    return [
      menchi?'玉ねぎを細かく刻む。冷たい牛ひき肉と豚ひき肉、塩を練り、粘りが出たら玉ねぎを加えて全体を混ぜる。':recipe.id==='classic-tonkatsu'?'豚ロースの赤身と脂身の境目に切り込みを入れ、筋を切る。軽くたたいて厚みを整え、水気を拭いて塩を振る。':'鶏むね肉の厚い部分を横に開き、厚みを均一にする。水気を拭いて塩を振る。',
      menchi?'肉だねを平たい小判形にし、手の間で軽く移しながら空気を抜く。中央を少しくぼませ、割れ目がないよう整える。':'衣を付けるための薄力粉、溶き卵、パン粉をそれぞれ浅い器へ用意する。',
      '薄力粉を薄くまぶして余分を落とし、溶き卵、パン粉の順に付ける。側面にも隙間なく衣を付け、パン粉を軽く押さえる。',
      '揚げ鍋に器具に適した量の油を用意して熱する。材料欄の油は食べる部分に残る量の目安なので、鍋に入れる全量とは分けて考える。',
      '衣が固まるまで触りすぎず、面を返しながら揚げる。厚い肉は表面の色だけで判断せず、火を調整して中心まで加熱する。',
      safety,
      '網へ立てるように置いて油を切り、清潔な包丁とまな板で切り分けて盛る。生肉を切った器具は洗浄してから使う。',
    ];
  }
  if(!['classic-croquette-potato','classic-croquette-pumpkin','classic-croquette-cream'].includes(recipe.id))return null;
  const potato=hasPart(recipe,'potato'),cream=hasPart(recipe,'milk');
  const steps=[];
  if(potato)steps.push('じゃがいもは芽と緑色の部分を十分に取り除き、皮をむいて大きさをそろえて切る。やわらかくゆで、水気を切って熱いうちにつぶす。');
  else if(!cream)steps.push('かぼちゃの種とわたを取り、硬い皮を必要に応じて除く。蒸して竹串がすっと通るまでやわらかくし、熱いうちにつぶす。');
  steps.push('玉ねぎを細かいみじん切りにする。衣用の卵は別の器で溶き、薄力粉とパン粉も浅い器へ用意する。');
  if(cream){
    steps.push('鍋でバターを弱めの中火で溶かし、玉ねぎが透き通るまで炒める。片栗粉を冷たい牛乳でむらなく溶いてから加える。');
    steps.push('コーンと塩を加え、鍋底から絶えず混ぜて加熱する。しっかりとろみが付いたら浅い容器へ広げ、粗熱を取って冷蔵庫で形を作れる硬さまで冷やす。');
  }else if(potato){
    steps.push('分量の油の一部で玉ねぎとひき肉を炒める。肉をほぐしながら十分に加熱し、中心75℃で1分以上を確認する。');
    steps.push('つぶしたじゃがいもへ炒めた具と塩を混ぜ、浅い器へ広げて粗熱を取る。温かくやわらかいまま成形せず、扱いやすい硬さまで冷ます。');
  }else{
    steps.push('バターで玉ねぎをしんなりするまで炒める。つぶしたかぼちゃと塩を混ぜ、浅い器に広げて粗熱を取る。');
  }
  steps.push('具を厚みのそろった形にまとめ、ひび割れをならす。薄力粉、溶き卵、パン粉の順に、隙間ができないよう衣を付ける。');
  steps.push('揚げ鍋に器具に適した量の油を熱し、少量ずつ入れる。材料欄の油は食べる部分に残る量の目安で、鍋の全量ではない。');
  steps.push('衣が固まるまで触らず、静かに返して全体を揚げる。長く触って衣を破らず、中心まで十分に温まったら網へ上げて油を切る。');
  return steps;
}

function breadedFish(recipe) {
  if(!['classic-aji-fry','familiar-shrimp-fry','familiar-white-fish-fry','familiar-squid-rings'].includes(recipe.id))return null;
  const prep=hasPart(recipe,'shrimp')?'えびの背わたを確認して取り、腹側へ浅く切り込みを入れて反りを抑える。':hasPart(recipe,'squid')?'いかの軟骨や残った内臓を確認し、胴を輪切りにする。':hasPart(recipe,'horse_mackerel')?'あじの小骨を確認して取り除く。':'たらの骨を確認し、厚みをそろえて食べやすく切る。';
  return [prep+'水気をペーパーで丁寧に拭き、分量の塩を振る。',
    '薄力粉、溶き卵、パン粉をそれぞれ別の浅い器に用意する。衣を付ける前に魚介の表面の水分をもう一度拭く。',
    '薄力粉を薄くまぶして余分を落とし、溶き卵、パン粉の順に付ける。パン粉は軽く押さえて密着させる。',
    '揚げ油を熱してから少量ずつ入れる。材料欄の油は食べる部分に残る量の目安で、揚げ鍋には器具に適した量を用意する。',
    '衣が固まるまで大きく動かさず、面を返しながら中まで十分に加熱する。色だけで判断せず、厚い部分の火通りを確かめる。',
    '清潔な網などに上げて油を切る。重ねると衣が蒸れるため、少し間隔をあけてから人数分の皿へ盛る。'];
}

function tempura(recipe) {
  if(recipe.id!=='familiar-tempura-assorted')return null;
  return [
    'えびの背わたを取り、腹側に浅い切り込みを入れて反りを抑える。かぼちゃは薄切り、なすといんげんは食べやすい大きさにそろえる。',
    '具材の水気をペーパーで十分に拭く。水滴が残ると油はねの原因になるので、衣を付ける前に確認する。',
    '卵を溶いて分量の冷水と混ぜ、薄力粉を加えて箸で切るように軽く混ぜる。粘りが出るまで練らず、少し粉が残る程度にする。',
    '揚げ鍋に器具に適した量の油を用意して熱する。材料欄の油は、揚げた具や衣に残る量の目安として扱う。',
    '具材を衣へくぐらせ、少量ずつ油に入れる。鍋へ一度に詰め込まず、衣が固まったら上下を返す。',
    'かぼちゃなど厚い具は中心までやわらかくなったか確かめる。えびも透明な部分がなくなるまで十分に加熱する。',
    '網などに広げて油を切り、衣がつぶれないように盛る。分量の塩を添え、温かいうちに食べる。',
  ];
}

function cookingType(recipe) {
  const family=recipeFamily(recipe),name=recipe.name??'',text=(recipe.steps??[]).join(' '),method=dishClassification(recipe).method;
  if(family==='sushi')return 'sushi';
  if(family==='pasta')return 'pasta';
  if(['udon','soba','somen','ramen'].includes(family))return 'noodle';
  if(family==='onigiri')return 'onigiri';
  if(family==='miso-soup')return 'miso-soup';
  if(recipe.role==='soup')return /ポタージュ|ミキサー|ブレンダー/.test(name+' '+text)?'potage':'soup';
  if(recipe.role==='drink')return 'drink';
  if(/プリン|カスタード/.test(name))return hasPart(recipe,'egg')?'custard':'starch-pudding';
  if(/オーブン|トースター/.test(text))return 'oven';
  if(method!=='other')return method;
  if(/ケーキ|クッキー|パンケーキ|クレープ/.test(name))return 'batter';
  if(/オートミール|がゆ|おかゆ|雑炊|リゾット/.test(name))return 'porridge';
  if(/炒め/.test(text))return 'stir-fry';
  if(/蒸し/.test(text))return 'steam';
  if(/煮/.test(text))return 'simmer';
  if(/焼/.test(text))return 'grill';
  if(/ゆで|茹で/.test(text))return 'boil';
  return 'mix';
}

function preparation(recipe,ingredients,type,text) {
  const tips=[];
  if(type==='sushi'){
    if(/巻き|巻（|巻\(/.test(recipe.name))tips.push('作る切れ数を先に決め、材料欄もその量に合わせる。巻物は巻き終えてから切るため、海苔と具を先にそろえておく。');
    else tips.push('作る量に合わせて酢飯と具を分けておく。生食用の具を使う場合は冷蔵庫で保ち、盛り付けの直前に取り出す。');
    return tips;
  }
  if(type==='onigiri')return ['炊飯済みのご飯を十分に温め、具と包むためのラップを用意する。生の材料を扱ったまな板や手で、温めたご飯を触らない。'];
  if(['pasta','noodle'].includes(type)){
    tips.push(type==='pasta'?'麺をゆで始める前に、ソース用の材料を切り、調味料をそろえる。麺がゆで上がる頃にソースも仕上がるよう準備する。':'薬味や具を先に切り、麺をゆでる鍋とつゆを温める鍋を用意する。つゆを作る場合の水と、麺をゆでる湯を混同しない。');
  }
  if(type==='drink')return [];
  if(['cold','salad','dressed','pickled','mix'].includes(type)){
    if(recipe.ingredients.some(p=>ingredients[p.id]?.groups?.includes('vegetable')&&!/乾燥|水煮|ゆで|缶|下ゆで/.test(ingredients[p.id]?.name??'')))tips.push('生で使う野菜は流水で洗い、水気をよく切る。和え衣やドレッシングを別に作っておくと、食べる直前に仕上げやすい。');
  }
  if(/食べやす[いく]|一口大/.test(text)&&!/(?:\d|半分|薄切|細切|小房|千切|みじん)/.test(text)){
    const names=ingredientNames(recipe,ingredients,['onion','carrot','potato','pumpkin','daikon','aubergine','cabbage','chinese_cabbage']).slice(0,3);
    if(names.length)tips.push(`${names.join('、')}は、同じ具の中で厚みがそろうように切る。根菜は薄めにすると加熱むらを抑えやすい。`);
  }
  if(hasPart(recipe,'tofu')&&/水切り|水気を切/.test(text))tips.push('豆腐は清潔なペーパーで包み、受け皿を敷いて余分な水分を取る。強く押しつぶさず、手順に合う形を残しておく。');
  if(/乾燥|干し/.test(recipe.ingredients.map(p=>ingredients[p.id]?.name??'').join(' '))&&/戻/.test(text))tips.push('乾物は各製品の戻し方に従って準備する。戻し時間の違う食材をまとめて扱わず、水気を切ってから分量の調味料と合わせる。');
  if(hasPart(recipe,'potato')&&!/芽|緑色/.test(text))tips.push('じゃがいもは芽と緑色の部分を十分に取り除く。皮を使う料理でも、この部分は残さない。');
  return tips;
}

function technique(recipe,type,text) {
  const tips=[];
  const cookedMeat=hasAny(recipe,rawMeat),cookedFish=hasAny(recipe,rawFish)&&type!=='sushi';
  if(type==='stir-fry')tips.push('炒め始めたら手を止めずに進められるよう、調味料を手元に置く。鍋に具を詰め込みすぎず、火の通りにくいものから順に加える。');
  else if(type==='grill')tips.push('焼き始めは動かしすぎず、底が固まってから裏返す。表面だけが焦げそうなときは火を弱め、中まで熱が伝わるようにする。');
  else if(type==='fried')tips.push(/コロッケ/.test(recipe.name)?'成形する具は十分に冷ましてから衣を付けると扱いやすい。揚げるときは衣が固まるまで触りすぎず、網に上げて油を切る。':'衣を付ける前に具の表面の水気を拭き、油へは少量ずつ入れる。揚げ始めは衣が固まるまで触りすぎず、返すときは油はねに注意する。');
  else if(type==='meuniere')tips.push('魚の水気を拭いて粉を薄くまぶし、余分な粉を落とす。焼き始めは魚を動かさず、焼き面が固まってからそっと返す。');
  else if(['simmer','stew','hotpot'].includes(type))tips.push('煮立った後は、煮汁が静かに動く火加減に落とす。煮汁が減りすぎていないか確かめ、固い具には竹串が通るまで加熱する。');
  else if(type==='steam')tips.push(/ホイル|包み/.test(text)?'包みの口をしっかり閉じ、火やフライパンの熱で中まで蒸す。開けるときは口を顔から離し、熱い蒸気に触れないようにする。':'蒸している間はふたを何度も開けず、蒸気が保てる火加減にする。蒸し器や鍋を空だきしないよう、途中の湯量にも気を配る。');
  else if(type==='oven')tips.push('使う器具を予熱し、具を重ならないように広げる。加熱時間は目安とし、表面が先に色付く場合は火力や焼く位置を調整する。');
  else if(type==='pasta')tips.push('麺は袋の表示時間を目安にゆで、途中でほぐしてくっつきを防ぐ。ゆで上がったら湯をよく切り、ソースへ加えて全体に絡める。');
  else if(type==='noodle')tips.push('乾麺・ゆで麺・冷凍麺は加熱方法が異なるため、使う麺の表示を優先する。ゆで上がった麺は湯を切り、つゆを薄めないようにする。');
  else if(type==='miso-soup')tips.push('みそは具に火が通ってから、煮汁で溶きのばして加える。長く煮立て続けず、全体が温まったら火を止める。');
  else if(type==='potage')tips.push('ミキサーを使う場合は、熱い液体で密閉容器に圧力がかからないよう十分に粗熱を取る。器具の容量を守り、少量ずつかくはんする。');
  else if(type==='soup')tips.push('根菜など硬い具から先に加え、火の通りやすい具は後にする。煮汁が減りすぎていないか確認し、具の中心までやわらかくする。');
  else if(type==='boil')tips.push('ゆで時間だけで決めず、厚い部分のやわらかさを確かめる。ざるへ上げたら水分を切り、和える料理は必要に応じて冷ましてから調味する。');
  else if(['salad','dressed','cold','pickled'].includes(type))tips.push('加熱した具を冷たい野菜と合わせる場合は、十分に冷まして水分を切る。味が薄まらないよう、和える直前にも余分な水気を取る。');
  else if(type==='porridge')tips.push('底が焦げやすいので弱火を保ち、底から静かに混ぜる。米や穀物がやわらかくなり、汁に均一なとろみが付いたら仕上げる。');
  else if(type==='custard')tips.push('卵液は強く泡立てず、表面の大きな泡を除いてから容器へ注ぐ。容器は重ねずに置き、中心まで固まったことを確かめてから冷ます。');
  else if(type==='starch-pudding')tips.push('でん粉が沈みやすいので加熱前によく混ぜる。鍋底から混ぜながら加熱し、全体に十分なとろみが付いたら容器へ移して冷ます。');
  else if(type==='batter')tips.push('粉を加えたら練りすぎず、粉のかたまりがなくなるまで混ぜる。表面の色だけで決めず、中心に生の生地が残らないまで加熱する。');
  if((cookedMeat||cookedFish)&&!/(?:75|７５)\s*℃/.test(text))tips.push(safety);
  if(hasPart(recipe,'egg')&&/卵を.*流|溶き卵|卵液/.test(text)&&!cookedMeat&&!/固ま|中心|十分.*火/.test(text))tips.push('卵は流し入れた後すぐにかき回さず、まとまり始めてから軽く動かす。全体が固まり、生の部分が残らないまで加熱する。');
  if((hasPart(recipe,'milk')||hasPart(recipe,'soy_milk'))&&/温め|煮/.test(text)&&['potage','soup','porridge'].includes(type))tips.push(`${hasPart(recipe,'milk')&&hasPart(recipe,'soy_milk')?'牛乳と豆乳':hasPart(recipe,'milk')?'牛乳':'豆乳'}を加えた後は弱火にして混ぜ、強く沸騰させ続けない。鍋底への焦げ付きやふきこぼれを防ぎながら全体を温める。`);
  return tips;
}

function generalSteps(recipe,ingredients) {
  const original=plainSentences(recipe),text=original.join(' '),type=cookingType(recipe);
  const before=preparation(recipe,ingredients,type,text),tips=technique(recipe,type,text);
  // もともと具体的な作り方がある新メニューは、工程数を増やすためだけに
  // 共通説明を挿入しない。購入品の判定はこの前に行う。
  if((recipe.steps?.length??0)>=6)return [...recipe.steps];
  if(type==='drink'){
    if(recipe.ingredients.length===1){
      const name=shortName(ingredients[recipe.ingredients[0].id]?.name??recipe.name);
      return [`抽出済みの${name}を分量に合わせて清潔なカップへ注ぐ。熱い飲み物は口にする前に飲みやすい温度か確かめる。`];
    }
    if(recipe.id==='drink-lemon-water')return ['清潔なピッチャーに飲用の水と分量のレモン汁を入れ、全体をよく混ぜる。','人数分のグラスに分ける。作った分は長く室温に置かず、飲まない分は冷蔵する。'];
    if(recipe.id==='daily-drink-lemon-sparkling')return ['冷やした炭酸水に分量のレモン汁を加える。炭酸が抜けないよう、底から一度だけ静かに混ぜる。','人数分のグラスへ分け、開封した飲料は表示に従って保存する。'];
    if(recipe.id==='daily-drink-lemonade')return ['分量の水の一部を小鍋で温め、砂糖を加えて溶かしてから冷ます。','残りの水と分量のレモン汁を加えて混ぜ、人数分のグラスへ注ぐ。飲まない分は冷蔵する。'];
    const next=original.map(s=>s.includes('牛乳を')&&s.includes('温め')&&!/弱火/.test(s)?s+'弱火で混ぜ、ふきこぼれる前に火を止める。':s);
    return joinSentences(next);
  }
  if(['plain-rice','staple-brown-rice'].includes(recipe.id))return ['炊飯済みのご飯を十分に温める。冷たいかたまりが残らないようにほぐし、全体が熱くなったことを確かめてから人数分の茶わんに盛る。'];
  if(['staple-mixed-rice','staple-barley-rice'].includes(recipe.id))return joinSentences(original.map(s=>s.includes('温め')?s+'冷たいかたまりが残らないようにほぐし、全体が熱くなったことを確かめる。':s));
  // 作業の順序は元レシピのまま。補足は該当する作業の直後へ置く。
  // 例: コロッケの揚げ方を、先行するじゃがいもの蒸し工程に差し込まない。
  const anchorPattern = {
    'stir-fry':/炒/, grill:/焼/, fried:/揚/, meuniere:/焼/,
    simmer:/煮/, stew:/煮/, hotpot:/煮/, steam:/蒸|ふた/,
    oven:/オーブン|トースター|焼/, pasta:/ゆで|茹で/,
    noodle:/ゆで|茹で|温め/, 'miso-soup':/みそ|味噌/,
    potage:/ミキサー|ブレンダー|なめらか|つぶ/,
    soup:/煮/, boil:/ゆで|茹で/,
    salad:/和え|混ぜ|盛/, dressed:/和え|混ぜ|盛/,
    cold:/和え|混ぜ|盛/, pickled:/浸|漬|和え/,
    porridge:/煮|温め/, custard:/卵液|注|加熱|蒸|オーブン/,
    'starch-pudding':/加熱|煮|とろみ/, batter:/粉|生地/,
  };
  const anchors=tips.filter(t=>t!==safety).map(tip=>{
    const pattern=/を加えた後は弱火/.test(tip)?(hasPart(recipe,'milk')?/牛乳/:/豆乳/):anchorPattern[type];
    let index=pattern?original.findIndex(sentence=>pattern.test(sentence)):-1;
    if(type==='fried'&&/コロッケ/.test(recipe.name)&&/衣/.test(tip))index=original.findIndex(sentence=>/衣/.test(sentence));
    return {tip,index:index<0?Math.max(0,original.length-1):index};
  });
  let lastHeat=-1;original.forEach((sentence,index)=>{if(heatWords.test(sentence))lastHeat=index;});
  const result=[...before];
  original.forEach((sentence,index)=>{
    if(index===lastHeat&&tips.includes(safety)&&plateWords.test(sentence)){
      const guarded=sentence.replace(/(盛り付ける|盛る|器に分ける|皿に分ける|いただく|切り分ける)/, '中心の温度を確かめてから$1');
      result.push(guarded+'加熱完了の目安は、最も厚い部分の中心75℃で1分以上。色や肉汁だけでは判断しない。');
    }else{
      result.push(sentence);
      if(index===lastHeat&&tips.includes(safety))result.push(safety);
    }
    for(const entry of anchors)if(entry.index===index)result.push('コツ：'+entry.tip);
  });

  return joinSentences([...new Set(result)]);
}

/** 既存の保存データを移行せず、現在の公開DBの手順だけを整えます。 */
export function decorateCookingInstructions(recipe, ingredients = {}) {
  if(recipe?.custom===true)return recipe;
  const nature=recipeNature(recipe);
  if(purchased.has(nature))return {...recipe,steps:[]};
  if(nature!=='home-cooked')return recipe;
  // 新しい家庭料理集は下ごしらえから仕上げまで個別に記述済みです。
  // 工程が4つや5つでも、共通の説明を重ねて水増ししません。
  if(['varied-','comfort-'].some(prefix=>recipe.id?.startsWith(prefix))&&(recipe.steps?.length??0)>=4)return {...recipe,steps:[...recipe.steps]};
  if((recipe.steps?.length??0)>=6)return {...recipe,steps:[...recipe.steps]};
  let steps=null;
  if(['beef-hamburg','tofu-burger','classic-hamburg','familiar-hamburg-oroshi','familiar-hamburg-stew','familiar-hamburg-cheese'].includes(recipe.id))steps=hamburg(recipe);
  if(!steps&&['classic-gyoza','classic-shumai'].includes(recipe.id))steps=dumplings(recipe);
  if(!steps&&['daily-curry-chicken','daily-curry-pork','daily-curry-beef','daily-curry-vegetable'].includes(recipe.id))steps=curry(recipe);
  if(!steps)steps=classicFried(recipe);
  if(!steps)steps=breadedFish(recipe);
  if(!steps)steps=tempura(recipe);
  if(!steps)steps=generalSteps(recipe,ingredients);
  return {...recipe,steps};
}
