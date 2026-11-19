// The Firebase CLI supplies the selected project ID to deploy hooks.
import {execFileSync} from 'node:child_process';

const project = process.env.GCLOUD_PROJECT;
if (!project) throw new Error('Firebase CLI で配布先のプロジェクトを指定してください。');

const response = execFileSync('firebase', [
  'firestore:databases:get', '(default)', '--project', project, '--json',
], {encoding: 'utf8'});
const database = JSON.parse(response).result;
if (database?.locationId !== 'asia-northeast1' || database.type !== 'FIRESTORE_NATIVE') {
  throw new Error('Meal Palette の (default) データベースを東京（asia-northeast1）の Firestore Native として設定してください。');
}
console.log('Firestore 配布先を確認しました。', database.name, database.locationId);
