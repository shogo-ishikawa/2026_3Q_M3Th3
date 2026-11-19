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
    const matches = firestore.or(firestore.where('interest', '==', id), firestore.where('interests', 'array-contains', id));
    const group = firestore.query(votes, matches);
    const result = await firestore.getCountFromServer(group);
    return [id, result.data().count];
  }));
  return Object.fromEntries(results);
}

const topicIds = MENU_INTERESTS.map(topic => topic.id);

export function readMenuVotes(data) {
  if (data === undefined) return [];
  const topics = data?.interest === undefined ? data?.interests : [data.interest];
  if (!Array.isArray(topics) || !topics.length || Object.keys(data).length !== 1 ||
      new Set(topics).size !== topics.length || !topics.every(id => topicIds.includes(id))) {
    throw Error('保存した希望の形式を確認できませんでした。');
  }
  return topicIds.filter(id => topics.includes(id));
}

/** 他端末の追加を残し、利用者が指定した1件だけを変更する。 */
export function updateMenuVote(db, firestore, uid, previous, next) {
  if (previous === next || (previous !== '' && !topicIds.includes(previous)) || (next !== '' && !topicIds.includes(next))) {
    throw Error('変更する料理のテーマを選んでください。');
  }
  const ref = firestore.doc(db, VOTES, uid);
  return firestore.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : undefined;
    const current = readMenuVotes(data);
    if (previous && !current.includes(previous)) return {topics: current, status: 'missing'};
    if (next && current.includes(next)) return {topics: current, status: 'duplicate'};
    const topics = topicIds.filter(id => id === next || (id !== previous && current.includes(id)));
    if (!topics.length) transaction.delete(ref);
    else if (topics.length === 1 && !data?.interests) transaction.set(ref, {interest: topics[0]});
    else transaction.set(ref, {interests: topics});
    return {topics, status: 'saved'};
  });
}

function mountVote(container, db, firestore, uid) {
  const ref = firestore.doc(db, VOTES, uid);
  container.innerHTML = `<details class="panel appearance-settings">
    <summary>追加してほしいメニューを選ぶ（任意）</summary>
    <p class="section-copy">増やしてほしい料理のテーマを複数送れます。各テーマにつき1人1票で集計し、後から1件ずつ変更・取り消しができます。食事記録や栄養値は送信しません。</p>
    <ul aria-label="送信済みの希望"></ul>
    <label class="start-page-choice"><span data-label>追加するテーマ</span><select disabled></select></label>
    <div class="welcome-actions"><button type="button" class="button-secondary" data-send disabled>この希望を集計に送る</button>
    <button type="button" class="button-text" data-cancel hidden>変更をやめる</button>
    <button type="button" class="button-secondary" data-retry hidden>もう一度読み込む</button></div>
    <p class="field-note" role="status"></p></details>`;
  const details = container.firstElementChild, select = details.querySelector('select'), list = details.querySelector('ul');
  const send = details.querySelector('[data-send]'), cancel = details.querySelector('[data-cancel]');
  const retry = details.querySelector('[data-retry]'), status = details.querySelector('[role=status]');
  const label = details.querySelector('[data-label]');
  let saved = [], editing = '', loaded = false, busy = false;
  function controls() {
    select.disabled = !loaded || busy || saved.length === topicIds.length;
    send.disabled = select.disabled || !select.value;
    cancel.disabled = busy;
    for (const action of list.querySelectorAll('button')) action.disabled = !loaded || busy || (action.hasAttribute('data-edit') && saved.length === topicIds.length);
  }
  function render() {
    list.replaceChildren();
    select.replaceChildren(new Option('選んでください', ''));
    for (const {id, label: name} of MENU_INTERESTS) {
      if (!saved.includes(id)) { select.add(new Option(name, id)); continue; }
      const row = document.createElement('li');
      row.append(document.createTextNode(name + '　'));
      for (const [action, title] of [['edit', '変更'], ['withdraw', '取り消す']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button-text';
        button.dataset[action] = id;
        button.textContent = title;
        button.setAttribute('aria-label', name + 'の希望を' + (action === 'edit' ? '変更' : '取り消す'));
        row.append(button);
      }
      list.append(row);
    }
    list.hidden = !saved.length;
    label.textContent = editing ? '「' + MENU_INTERESTS.find(topic => topic.id === editing).label + '」の変更先' : '追加するテーマ';
    send.textContent = editing ? '希望を変更する' : 'この希望を集計に送る';
    cancel.hidden = !editing;
    controls();
  }
  async function load() {
    if (busy) return;
    busy = true;
    controls();
    retry.hidden = true;
    status.textContent = '送信済みの希望を確認しています。';
    try {
      const snapshot = await firestore.getDocFromServer(ref);
      saved = readMenuVotes(snapshot.exists() ? snapshot.data() : undefined);
      loaded = true;
      editing = '';
      render();
      status.textContent = saved.length ? '送信済みの希望は' + saved.length + '件です。' : '希望はまだ送信されていません。';
    } catch {
      loaded = false;
      retry.hidden = false;
      status.textContent = '希望を読み込めませんでした。通信状態を確認してください。';
    } finally {
      busy = false;
      controls();
    }
  }
  async function save(previous, next) {
    if (!loaded || busy) return;
    busy = true;
    controls();
    status.textContent = '希望を更新しています。';
    try {
      const result = await updateMenuVote(db, firestore, uid, previous, next);
      saved = result.topics;
      editing = '';
      render();
      if (result.status === 'missing') status.textContent = '別の端末でこの希望が変更されました。最新の一覧を表示しています。';
      else if (result.status === 'duplicate') status.textContent = 'このテーマはすでに送信されています。';
      else status.textContent = !next ? '希望を取り消しました。' : previous ? '希望を変更しました。' : '希望を送信しました。';
    } catch (error) {
      status.textContent = error?.code === 'permission-denied'
        ? '希望を保存する権限を確認できませんでした。管理者に受付設定の確認を依頼してください。'
        : '更新できませんでした。通信状態を確認して、もう一度お試しください。';
    } finally {
      busy = false;
      controls();
    }
  }
  list.addEventListener('click', event => {
    const action = event.target.closest('button');
    if (!action || busy) return;
    if (action.dataset.withdraw) save(action.dataset.withdraw, '');
    else if (action.dataset.edit) {
      editing = action.dataset.edit;
      render();
      select.focus();
    }
  });
  details.addEventListener('toggle', () => { if (details.open) load(); });
  retry.addEventListener('click', load);
  cancel.addEventListener('click', () => { editing = ''; render(); select.focus(); });
  select.addEventListener('change', controls);
  send.addEventListener('click', () => save(editing, select.value));
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
