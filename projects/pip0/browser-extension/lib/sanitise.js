// URL とページの題名を、受け口へ渡す前に整える関数です。
//
// URL の決まりは、pip0 本体（Python）の provenance.sanitise_url と同じです（docs/design.md 6-3）。
// 受け口も、受け取った URL に同じ処理をもう一度行います。
//
//   http／https   →「スキーム://ホスト[:ポート]/パス」だけを残す
//                   （ユーザー名・パスワード、? 以降、# 以降を除く）
//   ほかのスキーム →「data:」のようにスキームだけ（data:、blob:、javascript:、file: など）
//   URL として読めないもの、文字列でないもの → null
//
// 例：https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123#top
//   → https://files.slack.com/files-pri/T0-F0/report.pdf
//
// URL の ? 以降には、Slack 等の一時的な鍵（ログインしなくてもファイルを開ける値）が
// 入っていることがあるため、拡張機能の中で先に取り除きます。

// URL の最大文字数（これを超える部分は切り捨てます）
export const URL_MAX_CHARS = 2048;

// ページの題名の最大文字数
export const TITLE_MAX_CHARS = 512;

// スキーム・ホスト・パスを残す URL の種類（これ以外はスキームだけにします）
const WEB_SCHEMES = ["http:", "https:"];

// 制御文字（改行・タブ・NUL・DEL など）
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// URL から、鍵が含まれることがある部分を取り除いて返します。
export function sanitiseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  let url;
  try {
    // ブラウザーと同じ決まり（WHATWG URL）で読みます。前後の空白は無視されます
    url = new URL(value);
  } catch (error) {
    return null; // URL として読めない（相対的な URL、ホストのない http: など）
  }

  if (WEB_SCHEMES.includes(url.protocol)) {
    // url.host は「ホスト名:ポート」（既定のポートは付きません）。
    // ユーザー名・パスワード（url.username、url.password）、
    // ? 以降（url.search）、# 以降（url.hash）は使いません。
    const cleaned = url.protocol + "//" + url.host + url.pathname;
    return cutText(cleaned, URL_MAX_CHARS);
  }

  // data: や blob: は URL の中にデータや元のページの URL を含むため、スキームだけを残します
  return cutText(url.protocol, URL_MAX_CHARS);
}

// ページの題名から制御文字を除き、最大 TITLE_MAX_CHARS 文字にして返します。
// 空になったときと、文字列でないときは null です。
export function cleanTitle(value) {
  if (typeof value !== "string") {
    return null;
  }
  // toWellFormed：対になっていないサロゲート（壊れた文字）を「�」に置き換えます
  const text = value.toWellFormed().replace(CONTROL_CHARACTERS, " ").trim();
  if (text === "") {
    return null;
  }
  return cutText(text, TITLE_MAX_CHARS);
}

// 文字列を、最大 maxChars 文字に切り詰めて返します。
// 絵文字などを途中で切らないよう、1文字ずつ（コードポイントごと）に数えます。
// Python の len() と同じ数え方です。
export function cutText(text, maxChars) {
  const characters = Array.from(text);
  if (characters.length <= maxChars) {
    return text;
  }
  return characters.slice(0, maxChars).join("");
}
