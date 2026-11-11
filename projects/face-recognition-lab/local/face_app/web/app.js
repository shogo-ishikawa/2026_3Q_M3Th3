"use strict";
/* FACEGATE 画面の動き。サーバー(このPC内)から状態を受け取り、表示を更新する。 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EMO = ["中立", "喜び", "驚き", "悲しみ", "怒り", "嫌悪", "恐れ", "軽蔑"];
const EMO_COL = ["#9aa7b8", "#ffd36b", "#7cceff", "#5f8dff", "#ff6f84", "#63c98a", "#c08bff", "#8fb3b3"];
const LIVE_PAGES = { auth: "auth", analysis: "analysis", register: "register" };

let S = null;              // 最新の状態
let page = null;
let settings = null;
let resultShown = false;
let backTimer = null;
let regDoneHandled = false;
let flashStart = 0;          // 認証成功の光の演出の開始時刻
let stateAt = 0;             // 状態を受け取った時刻(演出をなめらかにするため)
const R = { sim: 0, idx: 0, last: 0, name: "" };   // 類似度カウントアップ・ルーレットの状態

/* ------------------------------------------------------------ 通信 */
async function get(path) { return (await fetch(path, { cache: "no-store" })).json(); }
async function post(path, body = {}) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
function initial(name) { return [...String(name || "?").trim()][0] || "?"; }
function setAvatar(el, name) { el.textContent = initial(name); el.style.setProperty("--h", hue(name)); }
function honor(name) { return /(さん|くん|君|ちゃん|様|先生)$/.test(name) ? name : name + "さん"; }

/* ------------------------------------------------------------ 画面の切り替え */
async function go(p) {
  clearTimeout(backTimer); clearInterval(backTimer);
  page = p;
  $$(".page").forEach((s) => s.classList.toggle("on", s.id === "page-" + p));
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.page === (p === "register" ? "users" : p)));

  const stage = $("#stage");
  const slot = $(`#page-${p} .stage-slot`);
  if (slot) {
    slot.appendChild(stage);
    stage.className = "stage mode-" + p;
    $("#stage-off").classList.remove("hidden");
    $("#stage-off-msg").textContent = "カメラを起動しています…";
    const titles = {
      auth: ["FACIAL RECOGNITION SYSTEM", "見るだけで、あなたを確かめる"],
      analysis: ["LIVE EXPRESSION ANALYSIS", "表情ラベルと撮影条件をリアルタイムに"],
      register: ["FACE ENROLLMENT", "あなたの顔を登録します"],
    }[p];
    $("#stage-title").textContent = titles[0];
    $("#stage-sub").textContent = titles[1];
  }

  // サーバーの動作モード
  if (p === "auth" || p === "analysis") {
    const r = await post("/api/mode", { mode: p });
    if (!r.ok) { toast(r.error || "開始できませんでした"); return go(r.error && r.error.includes("登録") ? "users" : "home"); }
  } else if (p !== "register") {
    post("/api/mode", { mode: "idle" });
  }
  const v = $("#video");
  if (LIVE_PAGES[p]) v.src = "/stream.mjpg?t=" + Date.now();
  else v.removeAttribute("src");

  if (p === "auth") { resultShown = false; showRes("wait"); R.sim = 0; R.name = ""; }
  if (p === "register") regDoneHandled = false;
  if (p === "home") loadSummary();
  if (p === "users") loadUsers();
  if (p === "logs") loadLogs();
  if (p === "settings") loadSettings();
}

document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-page],[data-go]");
  if (n) { e.preventDefault(); go(n.dataset.page || n.dataset.go); }
});

/* ------------------------------------------------------------ 状態の受信 */
async function poll() {
  try {
    S = await get("/api/state");
    stateAt = performance.now();
    update();
  } catch (e) { /* サーバー終了時など */ }
  setTimeout(poll, 110);
}

function update() {
  if (!S) return;
  // 映像の待機表示
  const live = LIVE_PAGES[page];
  if (live) {
    const showing = S.mode !== "idle" && S.frame_id > 0 && $("#video").naturalWidth > 0;
    $("#stage-off").classList.toggle("hidden", showing);
    if (S.error) $("#stage-off-msg").textContent = S.error;
  }
  if (S.error && live && !update._err) { toast(S.error, 6000); update._err = true; }
  if (!S.error) update._err = false;

  if (page === "auth") updateAuth();
  if (page === "analysis") updateAnalysis();
  if (page === "register") updateRegister();
  if (page === "home") updateSetup();
  if (page === "settings") updateSettingsLive();
}

/* ------------------------------------------------------------ 顔認証 */
const PHASE_STEP = { detecting: 0, analyzing: 1, matching: 2, unknown: 2, complete: 3 };
function setSteps(phase) {
  const k = PHASE_STEP[phase] ?? 0;
  $$("#steps li").forEach((li, i) => {
    li.className = i < k ? "done" : i === k ? (phase === "unknown" ? "ng" : phase === "complete" ? "fin" : "now") : "";
  });
}
function showRes(which) {
  ["wait", "unknown", "ok"].forEach((w) => $("#res-" + w).classList.toggle("hidden", w !== which));
}
function updateAuth() {
  setSteps(S.phase);
  const a = S.auth;
  $("#stage-prog").style.width = Math.round((a.progress || 0) * 100) + "%";
  const hints = {
    detecting: ["LOOK AT THE CAMERA", "カメラの方を見てください"],
    analyzing: ["KEEP A NATURAL EXPRESSION", "自然な表情でそのままお待ちください"],
    matching: ["KEEP A NATURAL EXPRESSION", "照合しています…"],
    unknown: ["NOT REGISTERED", "登録されていない方です"],
    complete: ["VERIFICATION COMPLETE", "認証が完了しました"],
  }[S.phase] || ["LOOK AT THE CAMERA", "カメラの方を見てください"];
  if (S.phase === "detecting" && S.faces.length) hints.splice(0, 2, "TARGET ACQUIRED", "顔をとらえました。そのままお待ちください");
  $("#stage-hint").textContent = hints[0];
  $("#stage-hint-ja").textContent = hints[1];

  if (S.phase === "complete" && a.result && !resultShown) {
    resultShown = true;
    flashStart = performance.now();
    const r = a.result;
    setAvatar($("#res-avatar"), r.name);
    $("#res-hello").textContent = honor(r.name) + "、こんにちは!";
    $("#res-name").textContent = r.name;
    $("#res-sim").textContent = r.similarity.toFixed(3);
    $("#res-emo").textContent = r.emotion || "—";
    $("#res-reg").textContent = (r.consent_at || "").slice(0, 10) || "—";
    $("#res-time").textContent = r.time.replace(/-/g, ".").replace(" ", "  ");
    $("#res-loc").textContent = r.location;
    showRes("ok");
    let n = (settings && settings.return_sec) || 5;
    $("#res-count").textContent = n;
    backTimer = setInterval(() => {
      n -= 1; $("#res-count").textContent = Math.max(0, n);
      if (n <= 0) { clearInterval(backTimer); go("home"); }
    }, 1000);
  } else if (!resultShown) {
    showRes(S.phase === "unknown" ? "unknown" : "wait");
    $("#res-wait-msg").textContent = a.msg || "カメラの方を見てください";
    $("#res-wait-title").textContent = { detecting: S.faces.length ? "Locking" : "Searching", analyzing: "Analyzing", matching: "Matching" }[S.phase] || "Scanning";
  }
}

/* ------------------------------------------------------------ 分析モード */
function buildEmoBars() {
  $("#emo-bars").innerHTML = EMO.map((e, i) =>
    `<span>${e}</span><div class="b"><i id="eb${i}" style="background:${EMO_COL[i]};box-shadow:0 0 8px ${EMO_COL[i]}66"></i></div><span class="p" id="ep${i}">0%</span>`).join("");
  $("#sr-btns").innerHTML = EMO.map((e, i) => `<button data-sr="${i}">${i + 1} ${e}</button>`).join("");
  $("#sr-btns").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-sr]"); if (!b) return;
    const r = await post("/api/selfreport", { index: +b.dataset.sr }); toast(r.msg);
  });
}
function updateAnalysis() {
  const m = S.faces.find((f) => f.main);
  $("#stage-hint").textContent = S.faces.length ? `${S.faces.length} FACE${S.faces.length > 1 ? "S" : ""} DETECTED` : "NO FACE";
  $("#stage-hint-ja").textContent = `処理速度 ${S.fps} fps ・ 1〜8キーでも気持ちを申告できます`;
  $("#stage-prog").style.width = m ? Math.round(Math.max(0, m.sim) * 100) + "%" : "0%";
  if (!m) { $("#an-name").textContent = "顔が映っていません"; $("#an-sim").textContent = "類似度 —"; return; }
  $("#an-name").textContent = m.name;
  setAvatar($("#an-avatar"), m.name === "未登録" || m.name === "判定中" ? "?" : m.name);
  $("#an-sim").textContent = `類似度 ${m.sim.toFixed(3)} / しきい値 ${settings ? (+settings.threshold).toFixed(3) : "—"}`;
  if (m.probs) m.probs.forEach((p, i) => { $("#eb" + i).style.width = p * 100 + "%"; $("#ep" + i).textContent = Math.round(p * 100) + "%"; });
  if (m.quality) {
    $("#an-q").innerHTML = `${m.quality.score}<span class="small muted"> 点</span>`;
    $("#an-q").style.color = m.quality.score >= 80 ? "var(--ok)" : m.quality.score >= 60 ? "var(--warn)" : "var(--ng)";
    $("#an-q-adv").textContent = m.quality.advice[0] || "良好です";
  }
  if (S.mood != null) {
    $("#mood-bar").style.left = ((S.mood + 1) / 2 * 100) + "%";
    $("#an-mood").textContent = `分類スコア ${S.mood.toFixed(2)}`;
  }
  drawTimeline(m.history || []);
  const c = S.challenge;
  if (c) {
    $("#ch-text").textContent = c.state === "running" ? `${c.text}(残り${Math.ceil(c.remaining)}秒)` : c.text;
    $("#ch-text").style.color = c.state === "passed" ? "var(--ok)" : c.state === "failed" ? "var(--ng)" : "var(--accent)";
  }
}
function drawTimeline(h) {
  const cv = $("#timeline"), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (h.length < 2) return;
  for (let k = 0; k < 8; k++) {
    g.beginPath();
    h.forEach((p, i) => { const x = i / (h.length - 1) * W, y = H - 4 - p[k] * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = EMO_COL[k]; g.lineWidth = [1, 3, 4].includes(k) ? 2 : 1; g.globalAlpha = [0, 1, 3, 4].includes(k) ? 1 : .55; g.stroke();
  }
  g.globalAlpha = 1;
}
$("#ch-btn").addEventListener("click", async () => {
  const r = await post("/api/challenge"); if (!r.ok) toast("顔が映っていません");
});
$("#an-report").addEventListener("click", makeReport);
async function makeReport() {
  const r = await post("/api/report");
  if (r.ok) window.open(r.url, "_blank"); else toast(r.error);
}
document.addEventListener("keydown", (e) => {
  if (page === "analysis" && /^[1-8]$/.test(e.key) && !e.target.closest("input")) {
    post("/api/selfreport", { index: +e.key - 1 }).then((r) => toast(r.msg));
  }
  if (page === "analysis" && (e.key === "c" || e.key === "C") && !e.target.closest("input")) $("#ch-btn").click();
});

/* ------------------------------------------------------------ 登録 */
function updateRegister() {
  const r = S.register; if (!r) return;
  $("#reg-count").textContent = r.count;
  $("#reg-target").textContent = "/ " + r.target;
  $("#reg-arc").style.strokeDashoffset = 327 * (1 - r.count / r.target);
  $("#reg-name").textContent = r.name;
  $("#reg-msg").textContent = r.msg || "";
  $("#reg-tip").textContent = r.done ? "" : (r.tip || "");
  $("#stage-hint").textContent = r.done ? "ENROLLMENT COMPLETE" : "HOLD STILL";
  $("#stage-hint-ja").textContent = r.done ? "登録が完了しました" : (r.ok ? "そのままでお待ちください" : (r.msg || ""));
  $("#stage-prog").style.width = Math.round(r.count / r.target * 100) + "%";
  if (r.done && !regDoneHandled) {
    regDoneHandled = true;
    toast(`${honor(r.name)}を登録しました`);
    setTimeout(() => go("users"), 1400);
  }
}

$("#add-user").addEventListener("click", openModal);
function openModal() {
  $("#m-name").value = ""; $("#m-consent").checked = false;
  $("#m-result").classList.add("hidden");
  $("#m-camera span").textContent = `自動で${(settings && settings.register_shots) || 10}枚撮影します`;
  $("#modal").classList.remove("hidden"); setTimeout(() => $("#m-name").focus(), 50);
}
$("#m-close").addEventListener("click", () => { $("#modal").classList.add("hidden"); if (page === "users") loadUsers(); });
function checkModal() {
  const name = $("#m-name").value.trim();
  if (!name) { toast("名前を入力してください"); return null; }
  if (!$("#m-consent").checked) { toast("本人の同意を確認してください"); return null; }
  return name;
}
$("#m-camera").addEventListener("click", async () => {
  const name = checkModal(); if (!name) return;
  const r = await post("/api/mode", { mode: "register", name, consent: true });
  if (!r.ok) return toast(r.error);
  $("#modal").classList.add("hidden");
  go("register");
});
$("#m-files").addEventListener("click", (e) => { if (!checkModal()) e.preventDefault(); });
$("#m-files").addEventListener("change", async (e) => {
  const name = checkModal(); const files = [...e.target.files]; e.target.value = "";
  if (!name || !files.length) return;
  const box = $("#m-result"); box.classList.remove("hidden"); box.innerHTML = "読み込み中…";
  const images = [];
  for (const f of files) images.push({ name: f.name, data: await shrink(f) });
  box.innerHTML = "解析中…";
  const r = await post("/api/register/upload", { name, consent: true, images });
  if (r.error) { box.innerHTML = `<span class="ng">${esc(r.error)}</span>`; return; }
  box.innerHTML = r.results.map((x) => `<div><span class="${x.ok ? "ok" : "ng"}">${x.ok ? "○" : "×"}</span> ${esc(x.file)} — ${esc(x.msg)}</div>`).join("")
    + `<div style="margin-top:6px"><b>${r.saved}枚</b>を登録しました</div>`;
});
function shrink(file) {   // 送る前に縮小して軽くする
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = img.width * s; c.height = img.height * s;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", 0.92)); URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

/* ------------------------------------------------------------ ユーザー管理 */
async function loadUsers() {
  const { users } = await get("/api/users");
  $("#user-grid").innerHTML = users.map((u) => `
    <div class="ucard">
      <div class="avatar" style="--h:${hue(u.name)}">${esc(initial(u.name))}</div>
      <div class="info"><div class="nm">${esc(u.name)}</div>
        <div class="meta">登録日 ${esc((u.consent_at || "").slice(0, 10) || "—")}<br>登録データ ${u.templates}件</div></div>
      <button class="btn sm danger del" data-del="${esc(u.name)}">削除</button>
    </div>`).join("") + `<div class="ucard add" id="add-card"><b>＋</b>新しいユーザーを登録</div>`;
  $("#add-card").addEventListener("click", openModal);
}
$("#user-grid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  if (!confirm(`${b.dataset.del} さんの登録情報と関連する記録行を削除します。個人別に分けられないイベント行・生成済みレポート・画面保存は全員分を削除します。元の入力写真と外へコピーしたファイルは残ります。削除しますか?`)) return;
  const r = await post("/api/users/delete", { name: b.dataset.del });
  toast(r.ok ? "登録情報と関連する記録を削除しました" : (r.error || "登録者が見つかりません")); loadUsers();
});

/* ------------------------------------------------------------ ホーム */
async function loadSummary() {
  const s = await get("/api/summary");
  $("#st-users").textContent = s.users;
  $("#st-today").textContent = s.today;
  $("#st-last").textContent = s.last ? s.last.name : "—";
  $("#st-last-time").textContent = s.last ? s.last.time.slice(5, 16).replace("-", "/") : "最後に認証した人";
  $("#recent").innerHTML = s.recent.length ? s.recent.map((r) => `
    <div class="item"><div class="avatar sm" style="--h:${hue(r.name)}">${esc(r.name === "-" ? "?" : initial(r.name))}</div>
      <div>${esc(r.name === "-" ? "未登録の方" : r.name)}<div class="muted small">${esc(r.location)}</div></div>
      <span class="pill ${r.result === "成功" ? "ok" : "ng"}">${esc(r.result)}</span>
      <span class="muted small">${esc(r.time.slice(5, 16).replace("-", "/"))}</span></div>`).join("")
    : `<div class="empty">まだアクセスはありません。「顔認証を開始」から始めましょう。</div>`;
}
function updateSetup() {
  const need = !S.models_ready || !S.engine_ready;
  $("#setup-card").classList.toggle("hidden", !need);
  const d = S.download || {};
  $("#dl-bar").style.width = Math.round((d.progress || 0) * 100) + "%";
  $("#dl-btn").disabled = !!d.active;
  $("#dl-btn").textContent = d.active ? "ダウンロード中…" : d.error ? "再試行" : "ダウンロード開始";
  $("#dl-file").textContent = d.active && d.file ? `▸ ${d.file}` : "";
  $("#dl-mb").textContent = d.active && d.mb_total ? `${d.mb_done} / ${d.mb_total} MB ・ ${d.speed || 0} MB/s` : "";
  $("#dl-msg").textContent = d.active ? `全体 ${Math.round((d.progress || 0) * 100)}% ・ ${d.detail || ""}` : (S.engine_error || "");
  const err = $("#dl-err");
  err.classList.toggle("hidden", !d.error);
  if (d.error) err.innerHTML = esc(d.error) + (d.reasons || []).map((r) => `<div>${esc(r)}</div>`).join("") +
    `<div>詳しい記録: download_log.txt</div>`;
  $("#st-status").textContent = need ? "準備が必要" : "稼働中";
  $("#st-status").style.color = need ? "var(--warn)" : "var(--ok)";
  $("#st-status-sub").textContent = need ? "モデルをダウンロードしてください" : "すべてのモデルが利用可能";
  if (updateSetup._was && !need) { toast("準備が完了しました!"); loadSummary(); }
  updateSetup._was = need;
}
$("#dl-btn").addEventListener("click", () => post("/api/download"));
$("#dl-files").addEventListener("change", async (e) => {
  const files = [...e.target.files]; e.target.value = "";
  for (const f of files) {
    toast(`${f.name} を確認しています…`, 6000);
    const r = await (await fetch("/api/models/upload?name=" + encodeURIComponent(f.name), { method: "POST", body: f })).json();
    toast(r.msg, 5000);
    await new Promise((ok) => setTimeout(ok, 900));
  }
});
setInterval(() => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  $("#clock").innerHTML = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}<br><span style="font-size:22px;color:#dfe9f6">${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</span>`;
}, 1000);

/* ------------------------------------------------------------ アクセスログ */
async function loadLogs() {
  const { logs } = await get("/api/logs");
  $("#log-empty").classList.toggle("hidden", logs.length > 0);
  $("#log-body").innerHTML = logs.map((r) => `<tr><td>${esc(r.time)}</td><td>${esc(r.name === "-" ? "未登録の方" : r.name)}</td>
    <td><span class="pill ${r.result === "成功" ? "ok" : "ng"}">${esc(r.result)}</span></td><td>${esc(r.similarity)}</td>
    <td>${esc(r.emotion || "—")}</td><td>${esc(r.location)}</td></tr>`).join("");
}
$("#log-report").addEventListener("click", makeReport);
$("#log-open").addEventListener("click", () => post("/api/open", { what: "data" }));
$("#eval-btn").addEventListener("click", async () => {
  $("#eval-btn").disabled = true; toast("評価しています…", 8000);
  const r = await post("/api/evaluate", { path: $("#eval-path").value.trim() });
  $("#eval-btn").disabled = false;
  if (!r.ok) return toast(r.error, 5000);
  $("#eval-out").classList.remove("hidden");
  $("#eval-text").textContent = r.text.split("\n").filter((l) => !/^(画像ごと|グラフ)/.test(l)).join("\n");
  $("#eval-img").src = r.image + "?t=" + Date.now();
  toast("評価が終わりました");
});

/* ------------------------------------------------------------ 設定 */
async function loadSettings() {
  settings = await get("/api/settings");
  $("#set-camera").value = settings.camera;
  $("#set-mirror").checked = settings.mirror;
  $("#set-threshold").value = settings.threshold;
  $("#thr-val").textContent = (+settings.threshold).toFixed(3);
  $("#set-confirm").value = settings.confirm_frames;
  $("#set-show").value = settings.show_sec;
  $("#set-return").value = settings.return_sec;
  $("#set-location").value = settings.location;
  $("#set-blur").checked = settings.privacy_blur;
  $("#set-shots").value = settings.register_shots;
}
$("#set-threshold").addEventListener("input", (e) => { $("#thr-val").textContent = (+e.target.value).toFixed(3); });
$("#set-save").addEventListener("click", async () => {
  const r = await post("/api/settings", {
    camera: +$("#set-camera").value, mirror: $("#set-mirror").checked, threshold: +$("#set-threshold").value,
    confirm_frames: +$("#set-confirm").value, show_sec: +$("#set-show").value, return_sec: +$("#set-return").value, location: $("#set-location").value,
    privacy_blur: $("#set-blur").checked, register_shots: +$("#set-shots").value,
  });
  if (r.ok) { settings = r.settings; toast("設定を保存しました"); } else toast(r.error);
});
$("#camtest-btn").addEventListener("click", () => { post("/api/camtest"); $("#camtest-out").classList.remove("hidden"); $("#camtest-out").textContent = "診断しています…(10秒ほどかかります)"; updateSettingsLive._done = false; });
$("#open-root").addEventListener("click", () => post("/api/open", { what: "root" }));
function updateSettingsLive() {
  $("#sys-models").textContent = S.engine_ready ? "準備OK" : "未準備";
  $("#sys-models").style.color = S.engine_ready ? "var(--ok)" : "var(--warn)";
  $("#sys-fps").textContent = S.fps ? S.fps + " fps" : "—(カメラ停止中)";
  const c = S.camtest;
  if (!c.active && c.found !== null && !updateSettingsLive._done && !$("#camtest-out").classList.contains("hidden")) {
    updateSettingsLive._done = true;
    $("#camtest-out").textContent = c.lines.join("\n");
    if (c.found >= 0) { $("#set-camera").value = c.found; toast(`カメラ ${c.found} 番が使えます。「保存する」を押してください`, 5000); }
  }
}

/* ------------------------------------------------------------ 顔のワイヤーフレーム */
// 正規化した顔の型(目・口の位置を基準に、実際の顔へ変形して描く)
const MESH = (() => {
  const P = [];
  const N = 30;
  for (let i = 0; i < N; i++) {            // 輪郭
    const t = i / N * Math.PI * 2, s = Math.sin(t), c = Math.cos(t);
    const taper = c < 0 ? 1 - 0.32 * c * c : 1;
    P.push([0.5 + 0.40 * s * taper, 0.47 - 0.6 * c]);
  }
  for (let i = 0; i < 18; i++) {           // 内側の輪
    const t = i / 18 * Math.PI * 2, s = Math.sin(t), c = Math.cos(t);
    P.push([0.5 + 0.27 * s * (c < 0 ? 1 - 0.25 * c * c : 1), 0.52 - 0.4 * c]);
  }
  for (const ex of [0.33, 0.67]) {         // 目
    for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; P.push([ex + 0.075 * Math.cos(t), 0.4 + 0.03 * Math.sin(t)]); }
    for (let i = 0; i < 4; i++) P.push([ex - 0.09 + i * 0.06, 0.31 - (i === 1 || i === 2 ? 0.02 : 0)]);  // 眉
  }
  P.push([0.5, 0.36], [0.5, 0.46], [0.5, 0.56], [0.43, 0.6], [0.57, 0.6], [0.5, 0.62]);              // 鼻
  for (let i = 0; i < 10; i++) { const t = i / 10 * Math.PI * 2; P.push([0.5 + 0.12 * Math.cos(t), 0.74 + 0.04 * Math.sin(t)]); } // 口
  P.push([0.25, 0.55], [0.75, 0.55], [0.32, 0.7], [0.68, 0.7], [0.4, 0.18], [0.6, 0.18], [0.5, 0.12], [0.5, 0.88], [0.38, 0.88], [0.62, 0.88]);
  const E = new Set();
  P.forEach((p, i) => {
    P.map((q, j) => [Math.hypot(p[0] - q[0], p[1] - q[1]), j]).filter(([, j]) => j !== i)
      .sort((a, b) => a[0] - b[0]).slice(0, 3).forEach(([, j]) => E.add(i < j ? i + "-" + j : j + "-" + i));
  });
  return { P, E: [...E].map((s) => s.split("-").map(Number)) };
})();
const SRC = [[0.33, 0.4], [0.67, 0.4], [0.5, 0.75]];   // 型の上の左目・右目・口の中心

function affine(src, dst) {            // 3点の対応から変換 (x', y') = A(x, y) + b を求める
  const [[x0, y0], [x1, y1], [x2, y2]] = src;
  const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  const solve = (v0, v1, v2) => [
    (v0 * (y1 - y2) - y0 * (v1 - v2) + (v1 * y2 - v2 * y1)) / det,
    (x0 * (v1 - v2) - v0 * (x1 - x2) + (x1 * v2 - x2 * v1)) / det,
    (x0 * (y1 * v2 - y2 * v1) - y0 * (x1 * v2 - x2 * v1) + v0 * (x1 * y2 - x2 * y1)) / det,
  ];
  const a = solve(dst[0][0], dst[1][0], dst[2][0]), b = solve(dst[0][1], dst[1][1], dst[2][1]);
  return ([x, y]) => [a[0] * x + a[1] * y + a[2], b[0] * x + b[1] * y + b[2]];
}

function drawOverlay(t) {
  const stage = $("#stage"), cv = $("#overlay");
  const W = stage.clientWidth, H = stage.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!S || !LIVE_PAGES[page] || S.mode === "idle") return;
  const [fw, fh] = S.frame_size, sc = Math.max(W / fw, H / fh);
  const ox = (W - fw * sc) / 2, oy = (H - fh * sc) / 2;
  const M = ([x, y]) => [ox + x * fw * sc, oy + y * fh * sc];

  // 顔が映っていないときは、画面全体を細い線がゆっくり探す
  if (page === "auth" && !S.faces.length && S.phase !== "complete") searchSweep(g, W, H, t);

  for (const f of S.faces) {
    const [bx, by] = M([f.box[0], f.box[1]]);
    const bw = f.box[2] * fw * sc, bh = f.box[3] * fh * sc;
    let col = "124,206,255";
    if (page === "auth" && S.phase === "unknown") col = "255,111,132";
    if (page === "auth" && S.phase === "complete") col = "99,230,184";
    if (page === "register" && S.register && !S.register.ok) col = "200,215,235";
    if (page === "analysis" && f.name === "未登録") col = "255,111,132";
    const dim = page === "auth" && !f.main;          // 認証の対象でない人は控えめに表示
    if (dim) col = "170,185,205";

    // 枠の位置(認証では、顔をとらえた瞬間に大きな枠が顔へ吸い付く「ロックオン」)
    const el = authElapsed();
    const lock = page === "auth" && f.main && S.phase !== "complete" ? Math.max(0, 1 - el / 0.65) : 0;
    const pad = 0.16 + 0.6 * lock * lock, L = Math.min(bw, bh) * 0.24;
    const x0 = bx - bw * pad, y0 = by - bh * pad, x1 = bx + bw * (1 + pad), y1 = by + bh * (1 + pad * 0.6);

    // スキャン線の位置(上→下へ 1.6 秒で走り、0.45 秒休む)
    const scanning = !dim && ((page === "auth" && ["analyzing", "matching"].includes(S.phase)) || page === "register");
    let scanY = null, scanP = 0;
    if (scanning) {
      const cyc = (t % 2050) / 1600;
      if (cyc <= 1) { scanP = cyc < 0.5 ? 2 * cyc * cyc : 1 - Math.pow(-2 * cyc + 2, 2) / 2; scanY = y0 + (y1 - y0) * scanP; }
    }

    // ワイヤーフレーム(スキャン線が通った部分が光る)
    if (f.lm && f.lm.length === 5) {
      const pts = f.lm.map(M);
      const [eA, eB] = pts[0][0] <= pts[1][0] ? [pts[0], pts[1]] : [pts[1], pts[0]];
      const mouth = [(pts[3][0] + pts[4][0]) / 2, (pts[3][1] + pts[4][1]) / 2];
      const T = affine(SRC, [eA, eB, mouth]);
      const Q = MESH.P.map(T);
      const revealY = scanY !== null ? scanY : y1 + 999;   // スキャンの休みの間は全体が光ったまま
      g.globalAlpha = dim ? 0.35 : 1;
      g.lineWidth = 0.8;
      g.strokeStyle = `rgba(${col},${scanning ? .14 : .32})`;
      g.beginPath(); for (const [i, j] of MESH.E) { g.moveTo(...Q[i]); g.lineTo(...Q[j]); } g.stroke();
      if (scanning) {                               // 通過済みの線を明るく
        g.strokeStyle = `rgba(${col},.55)`; g.lineWidth = 1;
        g.beginPath();
        for (const [i, j] of MESH.E) if (Q[i][1] < revealY && Q[j][1] < revealY) { g.moveTo(...Q[i]); g.lineTo(...Q[j]); }
        g.stroke();
      }
      g.shadowColor = `rgba(${col},.9)`; g.shadowBlur = 6;
      Q.forEach((q, i) => {
        let a = 0.45 + 0.55 * Math.abs(Math.sin(t / 700 + i * 1.7)), r = i % 5 === 0 ? 1.9 : 1.3, c = col;
        if (scanning) {
          a = q[1] < revealY ? 0.95 : 0.3;
          if (scanY !== null && Math.abs(q[1] - scanY) < 14) { r += 1.6; a = 1; c = "225,248,255"; }   // 線の真上の点
        }
        g.fillStyle = `rgba(${c},${a})`; g.beginPath(); g.arc(q[0], q[1], r, 0, 7); g.fill();
      });
      g.shadowBlur = 0;
    }

    // 四隅の枠
    if (dim) g.globalAlpha = 0.45;
    g.strokeStyle = `rgba(${col},.95)`; g.lineWidth = 2.4; g.shadowColor = `rgba(${col},.8)`; g.shadowBlur = 14;
    g.beginPath();
    g.moveTo(x0, y0 + L); g.lineTo(x0, y0); g.lineTo(x0 + L, y0);
    g.moveTo(x1 - L, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + L);
    g.moveTo(x1, y1 - L); g.lineTo(x1, y1); g.lineTo(x1 - L, y1);
    g.moveTo(x0 + L, y1); g.lineTo(x0, y1); g.lineTo(x0, y1 - L);
    g.stroke(); g.shadowBlur = 0; g.globalAlpha = 1;
    if (dim) continue;

    // ロックオンの文字
    if (page === "auth" && f.main && ["detecting", "analyzing"].includes(S.phase) && el < 1.6) {
      g.font = "600 11px Consolas,'Cascadia Mono',monospace";
      const txt = el < 0.65 ? "ACQUIRING TARGET" : "TARGET LOCKED";
      g.fillStyle = `rgba(${col},${el < 0.65 ? 0.5 + 0.5 * Math.abs(Math.sin(t / 90)) : 1})`;
      g.fillText(txt, Math.max(8, x0), y0 - 10 < 140 ? y1 + 20 : y0 - 10);   // 見出しと重なるときは枠の下に
    }

    // スキャン線
    if (scanY !== null) scanLine(g, x0, x1, y0, scanY, col, Math.round(scanP * 100));
    // 認証成功の瞬間: 緑の光がサッと走る
    if (page === "auth" && S.phase === "complete" && flashStart) {
      const e = (t - flashStart) / 650;
      if (e >= 0 && e < 1.4) {
        if (e < 1) scanLine(g, x0, x1, y0, y0 + (y1 - y0) * (1 - Math.pow(1 - e, 3)), "99,230,184", null);
        g.fillStyle = `rgba(99,230,184,${0.16 * Math.max(0, 1 - e / 1.4)})`;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    // 名札(分析モード)
    if (page === "analysis") {
      const label = `${f.name}  ${f.emotion != null ? EMO[f.emotion] : ""}`;
      g.font = "500 13px 'Segoe UI','Yu Gothic UI','Meiryo',sans-serif";
      const tw = g.measureText(label).width + 22;
      const lx = Math.min(Math.max(8, x0), W - tw - 8), ly = Math.max(8, y0 - 34);
      g.fillStyle = "rgba(8,16,30,.78)"; g.strokeStyle = `rgba(${col},.7)`; g.lineWidth = 1;
      g.beginPath(); g.roundRect ? g.roundRect(lx, ly, tw, 26, 6) : g.rect(lx, ly, tw, 26); g.fill(); g.stroke();
      g.fillStyle = "#e8f3ff"; g.fillText(label, lx + 11, ly + 18);
    }
  }
}

// 映画のようなスキャン線(光る線 + 残像 + 細かい横縞 + 進み具合の表示)
function scanLine(g, x0, x1, top, y, col, pct) {
  const trail = Math.min(y - top, (x1 - x0) * 0.55);
  if (trail > 2) {
    const grd = g.createLinearGradient(0, y - trail, 0, y);
    grd.addColorStop(0, `rgba(${col},0)`); grd.addColorStop(0.75, `rgba(${col},.10)`); grd.addColorStop(1, `rgba(${col},.30)`);
    g.fillStyle = grd; g.fillRect(x0, y - trail, x1 - x0, trail);
    g.fillStyle = `rgba(${col},.10)`;               // 走査線のような細かい横縞
    for (let yy = y - 3; yy > y - trail; yy -= 3) g.fillRect(x0, yy, x1 - x0, 1);
  }
  const ext = (x1 - x0) * 0.08;
  const hg = g.createLinearGradient(x0 - ext, 0, x1 + ext, 0);
  hg.addColorStop(0, `rgba(${col},0)`); hg.addColorStop(0.12, `rgba(${col},.9)`);
  hg.addColorStop(0.5, "rgba(235,250,255,1)"); hg.addColorStop(0.88, `rgba(${col},.9)`); hg.addColorStop(1, `rgba(${col},0)`);
  g.save();
  g.shadowColor = `rgba(${col},1)`; g.shadowBlur = 22;
  g.fillStyle = hg; g.globalAlpha = 0.45; g.fillRect(x0 - ext, y - 3, x1 - x0 + ext * 2, 6);   // ぼんやり光る帯
  g.globalAlpha = 1; g.fillRect(x0 - ext, y - 1, x1 - x0 + ext * 2, 2);                       // 芯の明るい線
  g.restore();
  g.fillStyle = `rgba(${col},.95)`;                   // 両端の目盛り
  g.fillRect(x0 - 2, y - 7, 2, 14); g.fillRect(x1, y - 7, 2, 14);
  if (pct !== null) {
    g.font = "600 11px Consolas,'Cascadia Mono',monospace";
    g.fillStyle = `rgba(${col},1)`; g.fillText(`SCAN ${String(pct).padStart(2, "0")}%`, x1 + 10, y + 4);
  }
}

// 顔を探しているときの、画面全体をゆっくり走る線
function searchSweep(g, W, H, t) {
  const y = H * 0.08 + H * 0.84 * (0.5 - 0.5 * Math.cos((t % 5200) / 5200 * Math.PI * 2));
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, "rgba(124,206,255,0)"); grd.addColorStop(0.5, "rgba(124,206,255,.55)"); grd.addColorStop(1, "rgba(124,206,255,0)");
  g.save(); g.shadowColor = "rgba(124,206,255,.9)"; g.shadowBlur = 16;
  g.fillStyle = grd; g.fillRect(0, y - 1, W, 2); g.restore();
  const tg = g.createLinearGradient(0, y - 40, 0, y + 40);
  tg.addColorStop(0, "rgba(124,206,255,0)"); tg.addColorStop(0.5, "rgba(124,206,255,.07)"); tg.addColorStop(1, "rgba(124,206,255,0)");
  g.fillStyle = tg; g.fillRect(0, y - 40, W, 80);
}
// サーバーの経過時間 + 受信からの時間 で、なめらかな経過時間を求める
function authElapsed() {
  if (!S || !S.auth) return 0;
  if (S.phase === "complete" || !S.faces.length) return S.auth.elapsed || 0;
  return (S.auth.elapsed || 0) + (performance.now() - stateAt) / 1000;
}

// 認証中の右パネル: 計測値、類似度のカウントアップ、候補ルーレット
function animatePanel(t) {
  if (page !== "auth" || !S || resultShown) return;
  const m = S.faces.find((f) => f.main);
  const on = !!m && S.phase !== "unknown";
  $("#metrics").classList.toggle("on", on);
  $("#cand").classList.toggle("on", on && S.phase === "matching");
  if (!m) { R.sim = 0; $("#mt-sim").textContent = "0.000"; $("#mb-sim").style.width = "0"; return; }
  const q = m.quality || {};
  $("#mt-q").textContent = q.score != null ? q.score + " / 100" : "--";
  $("#mb-q").style.width = (q.score || 0) + "%";
  $("#mt-yaw").textContent = q.yaw != null ? (q.yaw >= 0 ? "+" : "") + q.yaw.toFixed(2) : "--";
  $("#mb-yaw").style.width = Math.max(4, 100 - Math.min(100, Math.abs(q.yaw || 0) * 220)) + "%";
  $("#mt-light").textContent = q.brightness != null ? q.brightness : "--";
  $("#mb-light").style.width = Math.min(100, (q.brightness || 0) / 2.2) + "%";
  // 類似度は照合の段階になってから 0 → 実際の値へカウントアップ
  const target = S.phase === "matching" ? Math.max(0, m.sim) : 0;
  R.sim += (target - R.sim) * 0.07;
  $("#mt-sim").textContent = R.sim.toFixed(3);
  $("#mb-sim").style.width = R.sim * 100 + "%";
  if (settings) $("#mb-thr").style.left = settings.threshold * 100 + "%";
  // 候補ルーレット: 名前が高速で切り替わり、だんだん遅くなって本人で止まる
  const names = S.auth.candidates || [];
  $("#cand-n").textContent = names.length + " USERS";
  const total = S.auth.total || 0.001, el = authElapsed();
  const frac = Math.min(1, Math.max(0, (el - total * 0.55) / (total * 0.45)));
  const cand = $("#cand"), registered = m.name !== "未登録" && m.name !== "判定中";
  if (S.phase !== "matching" || !names.length) { cand.classList.remove("spin", "lock"); $("#cand-name").textContent = "— — —"; return; }
  if (frac > 0.8 && registered) {
    if (R.name !== m.name) { R.name = m.name; $("#cand-name").textContent = m.name; setAvatar($("#cand-av"), m.name); }
    cand.classList.remove("spin"); cand.classList.add("lock");
    return;
  }
  cand.classList.add("spin"); cand.classList.remove("lock");
  const interval = 55 + 420 * frac * frac;
  if (t - R.last > interval) {
    R.last = t; R.idx = (R.idx + 1) % names.length;
    const nm = names[R.idx]; R.name = nm;
    $("#cand-name").textContent = nm; setAvatar($("#cand-av"), nm);
  }
}

function frame(t) { drawOverlay(t); animatePanel(t); requestAnimationFrame(frame); }

/* ------------------------------------------------------------ 飾り */
function decorate() {
  // サイドバーの波
  const g = $("#wavelines"); let html = "";
  for (let k = 0; k < 26; k++) {
    let d = "";
    for (let x = 0; x <= 200; x += 5) {
      const y = 95 - k * 1.6 + 26 * Math.sin(x / 34 + k * 0.18) * Math.exp(-((x - 110) ** 2) / 9000) - x * 0.12;
      d += (x ? "L" : "M") + x + " " + y.toFixed(1);
    }
    html += `<path d="${d}" opacity="${(0.25 + 0.75 * k / 26).toFixed(2)}"/>`;
  }
  g.innerHTML = html;
  // ホームの顔ワイヤーフレーム
  const T = ([x, y]) => [30 + x * 140, 18 + y * 150];
  const Q = MESH.P.map(T);
  $("#hero-face").innerHTML =
    `<g stroke="rgba(124,206,255,.35)" stroke-width=".6">${MESH.E.map(([i, j]) => `<line x1="${Q[i][0]}" y1="${Q[i][1]}" x2="${Q[j][0]}" y2="${Q[j][1]}"/>`).join("")}</g>` +
    `<g fill="#9fdcff" stroke="none">${Q.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="${i % 5 ? 1.1 : 1.8}"><animate attributeName="opacity" values="1;.25;1" dur="${2 + (i % 7) * .4}s" repeatCount="indefinite"/></circle>`).join("")}</g>`;
}

/* ------------------------------------------------------------ 起動 */
window.addEventListener("beforeunload", () => navigator.sendBeacon("/api/bye"));
/* ------------------------------------------------------------ 起動画面 */
async function bootScreen() {
  const boot = $("#boot");
  let skipped = false, done;
  const finished = new Promise((ok) => (done = ok));
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, skipped ? 0 : ms));
  const skip = () => { skipped = true; };
  boot.addEventListener("click", skip);
  window.addEventListener("keydown", skip, { once: true });

  // ロゴを1文字ずつ
  $("#boot-logo").innerHTML = [..."FACEGATE"].map((c, i) =>
    `<span class="${i >= 4 ? "hl" : ""}" style="animation-delay:${0.35 + i * 0.07}s">${c}</span>`).join("");
  // 顔のワイヤーフレームを線から順に描く
  const T = ([x, y]) => [30 + x * 140, 18 + y * 150];
  const Q = MESH.P.map(T);
  const order = MESH.E.map((e, k) => [e, Math.min(Q[e[0]][1], Q[e[1]][1]), k]).sort((a, b) => a[1] - b[1]);
  $("#boot-face").innerHTML =
    order.map(([[i, j]], k) => `<line x1="${Q[i][0]}" y1="${Q[i][1]}" x2="${Q[j][0]}" y2="${Q[j][1]}" style="animation-delay:${(0.2 + k * 0.006).toFixed(3)}s"/>`).join("") +
    Q.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="${i % 5 ? 1.2 : 2}" style="animation-delay:${(0.5 + q[1] / 200 * 0.9).toFixed(2)}s"/>`).join("");
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  $("#boot-clock").textContent = `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}  ${p2(d.getHours())}:${p2(d.getMinutes())}`;

  // 実際の状態を取得して起動ログに反映
  const [st, sum] = await Promise.all([get("/api/state").catch(() => ({})), get("/api/summary").catch(() => ({ users: 0 }))]);
  const ready = st.engine_ready;
  const steps = [
    ["INITIALIZING SYSTEM CORE", "OK", ""],
    ["FACE DETECTOR · YuNet", ready ? "OK" : "SETUP", ready ? "" : "warn"],
    ["FACE RECOGNIZER · SFace", ready ? "OK" : "SETUP", ready ? "" : "warn"],
    ["EMOTION MODEL · FER+", ready ? "OK" : "SETUP", ready ? "" : "warn"],
    [`USER DATABASE · ${sum.users} REGISTERED`, "OK", ""],
    ["PRIVACY · LOCAL PROCESSING ONLY", "ON", ""],
  ];
  await sleep(900);
  const log = $("#boot-log");
  for (let i = 0; i < steps.length; i++) {
    const [txt, res, cls] = steps[i];
    const row = document.createElement("div");
    row.innerHTML = `<span>&gt; ${txt}</span><span class="st wait">...</span>`;
    log.appendChild(row);
    await sleep(170);
    const stEl = row.querySelector(".st");
    stEl.textContent = `[ ${res} ]`; stEl.className = "st " + cls;
    $("#boot-bar").style.width = Math.round((i + 1) / steps.length * 100) + "%";
    await sleep(120);
  }
  $("#boot-ready").textContent = ready ? "SYSTEM READY" : "SETUP REQUIRED";
  $("#boot-ready").classList.add("on");
  await sleep(850);
  // スキャン線が上から下へ走りながら、ホーム画面が現れる
  boot.classList.add("out"); $("#boot-line").classList.add("out");
  const line = $("#boot-line");
  setTimeout(() => { boot.remove(); line && line.remove(); done(); }, 950);
  return finished;
}

(async function init() {
  decorate();
  buildEmoBars();
  settings = await get("/api/settings");
  go("home");
  poll();
  requestAnimationFrame(frame);
  bootScreen();
})();

$("#delete-local-data").addEventListener("click", async () => {
  if (!confirm("このアプリが保存した登録者・設定・アクセスログ・分析CSV・生成レポート・画面保存をすべて削除します。モデルと自分で用意した入力写真、アプリ外へコピーしたファイルは残ります。削除しますか?")) return;
  const r = await post("/api/privacy/reset", { confirm: "DELETE" });
  if (!r.ok) return toast(r.error || "削除できませんでした");
  settings = null; toast("アプリが保存したデータを削除しました"); go("home");
});
