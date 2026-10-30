// node --test browser-extension/tests のための入口です。
//
// Node.js 22 の node --test は、フォルダーを渡されると、そのフォルダーの index.js を
// 1つのテストファイルとして実行します。ここで、このフォルダーの *.test.js をすべて読み込みます。
// （node --test だけで実行したときは、Node.js が *.test.js を1つずつ見つけて実行します）

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

for (const name of testFiles) {
  await import(pathToFileURL(join(testsDir, name)).href);
}
