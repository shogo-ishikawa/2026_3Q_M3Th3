import {GENRES} from './storage.js';
import {RECIPES} from './data.js';

const REPORTS = 'mealPaletteTasteReports';
const SKIP = '未共有';
const axes = {favoriteGenre: 'お気に入りの料理', planGenre: '保存した献立'};

function leadingGenre(values) {
  const counts = new Map(GENRES.map(genre => [genre, 0]));
  for (const genre of values) if (counts.has(genre)) counts.set(genre, counts.get(genre) + 1);
  const max = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => max && count === max);
  return leaders.length === 1 ? leaders[0][0] : SKIP;
}

// 各端末で計算し、外部には共有する人が選んだ2つの分類だけを返す。
export function inferTasteReport(journal, recipes = RECIPES) {
  const byId = new Map([...recipes, ...(journal?.customRecipes ?? [])].map(r => [r.id, r.genre]));
  const favorites = (journal?.favourites ?? []).map(f => f.genre ?? byId.get(f.item?.recipeId));
  const dishes = new Map();
  function add(date, meal, id) {
    if (byId.has(id)) dishes.set(JSON.stringify([date, meal, id]), byId.get(id));
  }
  for (const entry of journal?.entries ?? []) {
    if (entry.status === 'planned') for (const item of entry.items) add(entry.date, entry.meal, item.recipeId);
  }
  for (const day of journal?.draftPlan?.days ?? []) {
    for (const id of day.recipeIds) if (!day.omittedRecipeIds?.includes(id)) add(day.date, day.meal, id);
  }
  return {favoriteGenre: leadingGenre(favorites), planGenre: leadingGenre(dishes.values())};
}

export async function readTasteCounts(db, firestore) {
  const collection = firestore.collection(db, REPORTS);
  const groups = await Promise.all(Object.entries(axes).flatMap(([field, label]) =>
    GENRES.map(async genre => {
      const q = firestore.query(collection, firestore.where(field, '==', genre));
      const count = (await firestore.getCountFromServer(q)).data().count;
      return {label, genre, count};
    })));
  return groups.filter(g => Number.isSafeInteger(g.count) && g.count >= 5).sort((a, b) => b.count - a.count);
}

function mountMember(container, {db, firestore, uid, journal}) {
  container.innerHTML = `<details class="panel appearance-settings"><summary>アプリ改善に料理の好みを共有する（任意）</summary>
    <p class="section-copy">お気に入りと保存した献立から、それぞれ最も多いジャンルを端末で調べます。同数の場合は自分で選べます。共有したい分類を確認・修正してから送信してください。</p>
    <p class="field-note">共有するのは選んだジャンルだけです。レシピ名、食事記録、家族構成、生年月日は送りません。1人につき各1件で、あとから変更・取り消しができます。</p>
    <div data-genres></div><div class="welcome-actions">
    <button type="button" class="button-secondary" data-suggest>自分の記録から候補を更新</button>
    <button type="button" class="button-primary" data-share>この内容を共有する</button>
    <button type="button" class="button-text" data-withdraw hidden>共有を取り消す</button>
    <button type="button" class="button-secondary" data-retry hidden>もう一度読み込む</button>
    </div><p class="field-note" role="status"></p></details>`;
  const find = selector => container.querySelector(selector);
  const status = find('[role=status]');
  const selects = {};
  for (const [field, label] of Object.entries(axes)) {
    const title = document.createElement('label');
    title.className = 'start-page-choice';
    title.append(label);
    const select = document.createElement('select');
    select.add(new Option('共有しない', SKIP));
    for (const genre of GENRES) select.add(new Option(genre, genre));
    title.append(select);
    find('[data-genres]').append(title);
    selects[field] = select;
  }
  const retry = find('[data-retry]'), share = find('[data-share]'), withdraw = find('[data-withdraw]'), suggest = find('[data-suggest]');
  const ref = firestore.doc(db, REPORTS, uid);
  let saved = null, loaded = false, busy = false;
  function setFields(report) { for (const [key, field] of Object.entries(selects)) field.value = report[key]; }
  function controls() {
    for (const field of Object.values(selects)) field.disabled = !loaded || busy;
    suggest.disabled = !loaded || busy;
    share.disabled = !loaded || busy || Object.values(selects).every(field => field.value === SKIP)
      || (saved && Object.keys(selects).every(key => saved[key] === selects[key].value));
    withdraw.disabled = busy;
    withdraw.hidden = !saved;
  }
  function infer() {
    const raw = journal.exportLocal();
    return inferTasteReport(raw ? JSON.parse(raw) : null);
  }
  function suggestFromJournal() {
    try {
      const result = infer();
      setFields(result);
      status.textContent = '端末の記録から候補を更新しました。共有したい項目を確認してください。';
    } catch {
      status.textContent = '記録を読み込めませんでした。共有するジャンルを自分で選べます。';
    }
    controls();
  }
  async function load() {
    if (busy || loaded) return;
    busy = true; retry.hidden = true; controls();
    try {
      const snapshot = await firestore.getDocFromServer(ref);
      saved = snapshot.exists() ? snapshot.data() : null;
      loaded = true;
      if (saved) { setFields(saved); status.textContent = '現在共有している分類です。'; }
      else suggestFromJournal();
    } catch {
      retry.hidden = false;
      status.textContent = '共有状況を読み込めませんでした。通信状態を確認してください。';
    } finally { busy = false; controls(); }
  }
  async function save(report) {
    if (!loaded || busy) return;
    busy = true; controls();
    try {
      await firestore.runTransaction(db, async tx => {
        if (report) tx.set(ref, report);
        else tx.delete(ref);
      });
      saved = report;
      if (!report) setFields({favoriteGenre: SKIP, planGenre: SKIP});
      status.textContent = report ? '選んだ分類を共有しました。' : '共有を取り消しました。';
    } catch { status.textContent = '更新できませんでした。通信状態を確認して、もう一度お試しください。'; }
    finally { busy = false; controls(); }
  }
  controls();
  find('details').addEventListener('toggle', event => { if (event.target.open) load(); });
  find('[data-genres]').addEventListener('change', controls);
  suggest.addEventListener('click', suggestFromJournal);
  share.addEventListener('click', () => save(Object.fromEntries(Object.entries(selects).map(([k, el]) => [k, el.value]))));
  withdraw.addEventListener('click', () => save(null));
  retry.addEventListener('click', load);
}

function mountAdmin(container, {db, firestore}) {
  container.innerHTML = `<section class="panel appearance-settings"><h3>お気に入りと献立の傾向</h3>
    <p class="section-copy">共有に参加した人が5人以上いるジャンルを項目ごとに表示します。新しいレシピを増やすジャンルの検討に使えます。</p>
    <button class="button-secondary" type="button">料理の傾向を集計する</button><p class="field-note" role="status"></p><ul></ul></section>`;
  const button = container.querySelector('button'), list = container.querySelector('ul'), status = container.querySelector('[role=status]');
  button.addEventListener('click', async () => {
    list.replaceChildren();
    button.disabled = true;
    status.textContent = '集計しています。';
    try {
      const groups = await readTasteCounts(db, firestore);
      for (const {label, genre, count} of groups) {
        const li = document.createElement('li');
        li.textContent = label + '　' + genre + '（' + count + '人）';
        list.append(li);
      }
      status.textContent = groups.length ? '共有人数が多い順に表示しています。' : '5人以上が共有したジャンルはまだありません。';
    } catch { status.textContent = '集計できませんでした。通信状態を確認してください。'; }
    finally { button.disabled = false; }
  });
}

export function mountTasteFeedback(session) {
  const member = document.getElementById('taste-feedback'), admin = document.getElementById('admin-taste-trends');
  mountMember(member, session);
  if (session.isAdmin) mountAdmin(admin, session);
  return () => { member.replaceChildren(); admin.replaceChildren(); };
}
