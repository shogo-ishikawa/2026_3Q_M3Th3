# Meal Palette の Firebase 設定

Web版とホーム画面版で同じ Firebase プロジェクトを使います。Cloud Firestore の `(default)` データベースに利用者の記録を保存します。保存先は東京 `asia-northeast1` です。この設定が指定する地域は Firestore のものです。

## 公開前の設定

1. Firebase コンソールで専用プロジェクト `meal-palette-98d2c` を選びます。Web アプリを登録して、プロジェクトIDと Web 用 SDK 設定を確認します。
2. Authentication の「ログイン方法」で Google を有効にします。プロジェクトのサポートメールを設定します。「設定」の承認済みドメインに `shogo-ishikawa.github.io` を追加します。手元で実際の Google ログインを試す場合は `localhost` も承認します。
3. Firestore の Standard エディションで `(default)` データベースを本番環境モードで作成します。作成時のロケーションは **東京（asia-northeast1）** を選びます。Firestore のロケーションは作成時に確定します。
4. Firebase CLI にログインし、この README のディレクトリで以下を実行します。配布先には Meal Palette 専用のプロジェクトIDを指定してください。ルールの配布はそのデータベース全体に適用されます。配布時に CLI がデータベースの実際の地域と種類を確認します。
5. 公開ワークフローは Firebase Hosting の予約 URL（`/__/firebase/init.json`）からこのプロジェクトの Web 設定を取得します。予約 URL が利用できない場合は、GitHub の Settings → Secrets and variables → Actions → Variables に `MEAL_PALETTE_FIREBASE_WEB_CONFIG` を登録します。Web SDK の設定はブラウザーに配信されます。サービスアカウント秘密鍵や OAuth クライアントシークレットは使用しません。

| 変数名 | 値 |
| --- | --- |
| `MEAL_PALETTE_FIREBASE_PROJECT_ID` | 任意。指定する場合は `meal-palette-98d2c` |
| `MEAL_PALETTE_FIREBASE_WEB_CONFIG` | 任意の上書き設定。同じプロジェクトの Web アプリ用 SDK 設定の JSON。キーを二重引用符で囲みます |

```sh
firebase login
firebase deploy --only firestore --project meal-palette-98d2c
```

データベース作成を CLI で行う場合は手順3で次のコマンドを使えます。既存のデータベースは2行目で詳細を確認できます。

```sh
firebase firestore:databases:create '(default)' --location=asia-northeast1 --project meal-palette-98d2c
firebase firestore:databases:get '(default)' --project meal-palette-98d2c
```

設定後、Pages の公開ワークフローを実行します。一般アカウントで献立を保存し、同じアカウントで別の端末から復元できるか確認します。管理者アカウントでは赤い「管理者画面」と希望の集計を確認できます。

## 記録とメニューの希望

食事記録、献立、栄養の設定を保存するドキュメントは UID ごとに分かれています。Google でログインした本人だけがアプリから読み書きできます。管理者としてログインしても他人の食事記録を参照する権限は付きません。Firebase コンソールやサーバーからの管理操作は Google Cloud IAM の権限で管理されます。

利用者が「この希望を集計に送る」操作をしたときだけ、希望の分類を `mealPaletteMenuVotes/{uid}` に1件保存します。希望を変更すると同じ1件を更新し、取り消すと削除します。希望票にはメールアドレス、食事の内容、栄養値、自由記述を保存しません。

管理画面では分類別の件数を Firestore の集計クエリで取得し、5票以上集まったテーマを新メニュー候補に使います。Firestore は集計にもコレクションの一覧権限を使うため、この権限のある管理者は別のクライアントから UID と希望分類の組を照会できます。公開する管理画面には個票を表示しません。

お気に入りと献立のジャンルは、本人が設定で送信した場合だけ `mealPaletteTasteReports/{uid}` に保存します。保存するフィールドは `favoriteGenre` と `planGenre` の2つです。各項目は5種類のジャンルまたは「未共有」です。利用者は共有する分類を修正・撤回できます。管理画面では項目・ジャンル別に5人以上のグループを表示します。希望票と同じく、一覧権限を持つ管理者は別のクライアントからUIDと分類の組を照会できます。

## ローカルで権限を確認する

Firebase CLI、Java 21、Python 3 を用意し、このディレクトリで実行します。専用のデモプロジェクトで、本人・他人・未認証・アプリ管理者の読み書き、希望の集計と取り消しを検査します。2つの Firebase クライアントで、新規ログイン、複数文書にまたがる記録の復元、同時編集の競合も検査します。

```sh
npm ci --prefix ../tools/firebase-sdk
firebase emulators:exec --project demo-meal-palette --only firestore "python3 tests/firestore_rules.py && node tests/journal_transactions.mjs"
```

[Firestore のロケーション](https://firebase.google.com/docs/firestore/locations) ／ [データベースの管理](https://firebase.google.com/docs/firestore/manage-databases) ／ [Web で Google ログインを使う](https://firebase.google.com/docs/auth/web/google-signin) ／ [集計クエリと権限](https://firebase.google.com/docs/firestore/query-data/aggregation-queries)
