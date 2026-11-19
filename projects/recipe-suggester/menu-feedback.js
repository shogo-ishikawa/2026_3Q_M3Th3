import {mountTasteFeedback} from './taste-feedback.js';
import {RECIPES} from './data.js';
import {normaliseJapaneseSearch} from './japanese-search.js';

const VOTES = 'mealPaletteMenuVotes';
const MINIMUM_VOTES = 5;

// 管理者に提案する編集候補。収録済みの料理は表記違いを含めて候補から外す。
export const MENU_INTERESTS = [
  {id: 'regional', label: '各地の郷土料理', dishes: [
    {name: '里いもと牛肉の芋煮', terms: ['芋煮', 'いも煮']},
    {name: '鶏と根菜のせんべい汁', terms: ['せんべい汁', '煎餅汁']},
  ]},
  {id: 'seafood', label: '魚介のおかず', dishes: [
    {name: '白身魚とあさりのアクアパッツァ', terms: ['アクアパッツァ', 'アクアパッツア']},
    {name: '白身魚のかぶら蒸し', terms: ['かぶら蒸し', '蕪蒸し', 'かぶ蒸し']},
  ]},
  {id: 'vegetables', label: '野菜の副菜', dishes: [
    {name: '温野菜のバーニャカウダ', terms: ['バーニャカウダ', 'バーニャ・カウダ']},
    {name: 'なすのカポナータ', terms: ['カポナータ']},
  ]},
  {id: 'breakfast', label: '朝ごはん', dishes: [
    {name: 'りんごのオーバーナイトオーツ', terms: ['オーバーナイトオーツ']},
    {name: '卵ときのこのそば粉ガレット', terms: ['ガレット']},
  ]},
  {id: 'noodles', label: '麺料理', dishes: [
    {name: 'かぼちゃのほうとう', terms: ['ほうとう', '餺飥']},
    {name: 'えびのパッタイ', terms: ['パッタイ']},
  ]},
  {id: 'world', label: '世界の家庭料理', dishes: [
    {name: '鶏肉のビリヤニ', terms: ['ビリヤニ', 'ビリヤーニ']},
    {name: 'ひよこ豆と野菜のクスクス', terms: ['クスクス']},
  ]},
];

export function menuProposals(counts, recipes = RECIPES) {
  const names = recipes.map(recipe => normaliseJapaneseSearch(recipe.name));
  const proposals = [];
  for (const interest of MENU_INTERESTS) {
    const count = counts[interest.id];
    if (!Number.isSafeInteger(count) || count < MINIMUM_VOTES) continue;
    const dish = interest.dishes.find(candidate => !candidate.terms.some(term => {
      const key = normaliseJapaneseSearch(term);
      return names.some(name => name.includes(key));
    }));
    if (dish) proposals.push({topic: interest.label, dish: dish.name, count});
  }
  return proposals.sort((a, b) => b.count - a.count);
}

export async function readMenuProposalCounts(db, firestore) {
  const votes = firestore.collection(db, VOTES);
  const results = await Promise.all(MENU_INTERESTS.map(async ({id}) => {
    const group = firestore.query(votes, firestore.where('interest', '==', id));
    const result = await firestore.getCountFromServer(group);
    return [id, result.data().count];
  }));
  return Object.fromEntries(results);
}

function mountVote(container, db, firestore, uid) {
  const ref = firestore.doc(db, VOTES, uid);
  container.innerHTML = `<details class="panel appearance-settings">
    <summary>追加してほしいメニューを選ぶ（任意）</summary>
    <p class="section-copy">増やしてほしい料理のテーマを1つ選んでください。送信すると、選んだテーマを1アカウント1票として管理者が集計します。食事記録や栄養値は集計に使いません。送信後も変更や取り消しができます。</p>
    <label class="start-page-choice">料理のテーマ<select disabled><option value="">選んでください</option></select></label>
    <div class="welcome-actions"><button type="button" class="button-secondary" data-send disabled>この希望を集計に送る</button>
    <button type="button" class="button-text" data-withdraw hidden>希望を取り消す</button>
    <button type="button" class="button-secondary" data-retry hidden>もう一度読み込む</button></div>
    <p class="field-note" role="status"></p></details>`;
  const details = container.firstElementChild;
  const select = details.querySelector('select');
  const send = details.querySelector('[data-send]');
  const withdraw = details.querySelector('[data-withdraw]');
  const retry = details.querySelector('[data-retry]');
  const status = details.querySelector('[role=status]');
  for (const {id, label} of MENU_INTERESTS) select.add(new Option(label, id));
  let saved = '';
  let loaded = false;
  let busy = false;
  function controls() {
    select.disabled = !loaded || busy;
    send.disabled = select.disabled || !select.value || select.value === saved;
    withdraw.hidden = !saved;
    withdraw.disabled = busy;
  }
  async function load() {
    if (busy || loaded) return;
    busy = true;
    retry.hidden = true;
    status.textContent = '送信済みの希望を確認しています。';
    try {
      const snapshot = await firestore.getDocFromServer(ref);
      saved = snapshot.exists() ? snapshot.data().interest : '';
      select.value = saved;
      loaded = true;
      status.textContent = saved ? '送信済みのテーマを表示しています。' : '希望はまだ送信されていません。';
    } catch {
      retry.hidden = false;
      status.textContent = '希望を読み込めませんでした。通信状態を確認してください。';
    } finally {
      busy = false;
      controls();
    }
  }
  async function save(interest) {
    if (!loaded || busy || (interest && !MENU_INTERESTS.some(item => item.id === interest))) return;
    busy = true;
    controls();
    status.textContent = '希望を更新しています。';
    try {
      // オフラインで保留された票を後で送らない。送信または撤回はサーバーの確定後に表示する。
      await firestore.runTransaction(db, async transaction => {
        if (interest) transaction.set(ref, {interest});
        else transaction.delete(ref);
      });
      saved = interest;
      select.value = interest;
      status.textContent = interest ? '希望を送信しました。' : '希望を取り消しました。';
    } catch {
      status.textContent = '更新できませんでした。通信状態を確認して、もう一度お試しください。';
    } finally {
      busy = false;
      controls();
    }
  }
  details.addEventListener('toggle', () => { if (details.open) load(); });
  retry.addEventListener('click', load);
  select.addEventListener('change', controls);
  send.addEventListener('click', () => save(select.value));
  withdraw.addEventListener('click', () => save(''));
}

function mountProposals(container, db, firestore) {
  container.innerHTML = `<section class="panel appearance-settings">
    <div class="panel-heading"><h3>次に追加するメニュー候補</h3></div>
    <p class="section-copy">5人以上が希望したテーマを人数順に並べ、テーマごとに未収録の料理を1品提案します。</p>
    <button type="button" class="button-secondary">希望を集計する</button>
    <p role="status" class="field-note"></p><ol></ol></section>`;
  const button = container.querySelector('button');
  const status = container.querySelector('[role=status]');
  const list = container.querySelector('ol');
  button.addEventListener('click', async () => {
    button.disabled = true;
    list.replaceChildren();
    status.textContent = '希望を集計しています。';
    try {
      const counts = await readMenuProposalCounts(db, firestore);
      const proposals = menuProposals(counts);
      for (const proposal of proposals) {
        const row = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = proposal.dish;
        row.append(name, '　' + proposal.count + '人が「' + proposal.topic + '」を希望');
        list.append(row);
      }
      status.textContent = proposals.length ? proposals.length + '件の候補があります。'
        : '5人以上が希望したテーマのうち、提案できる未収録の料理はまだありません。';
    } catch {
      status.textContent = '集計できませんでした。通信状態を確認して、もう一度お試しください。';
    } finally {
      button.disabled = false;
    }
  });
}

export function setupMenuFeedback(session) {
  const {db, firestore, user, isAdmin} = session;
  const vote = document.getElementById('menu-feedback');
  const admin = document.getElementById('admin-menu-proposals');
  mountVote(vote, db, firestore, user.uid);
  if (isAdmin) mountProposals(admin, db, firestore);
  const unmountTaste = mountTasteFeedback(session);
  return () => {
    unmountTaste();
    vote.replaceChildren();
    admin.replaceChildren();
  };
}
