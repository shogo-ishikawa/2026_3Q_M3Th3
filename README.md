# 計算科学基礎：2026年度　3Q（月3木3クラス）

このリポジトリでは、授業で使用する教材と、学生・グループが作成するプログラムや作品を管理します。

前半で学んだPythonの基礎を使い、後半では、それぞれの興味や関心に応じた作品を作成します。教員が用意した初期コードを試し、気付いたことや改善したい点をもとに、AIや教員のサポートも受けながら開発を進めていきましょう。

## ディレクトリ構成

| パス | 内容 |
| --- | --- |
| `projects/` | 各学生・グループのコード、教材、説明書 |
| `projects/recipe-suggester/` | 条件に合わせて食材の除外・レシピ表示・食事履歴を使うMeal PaletteとColab教材 |
| `projects/ai-music-arranger/` | 音源を解析し、伴奏・ドラム・抽出メロディを重ねるColab教材 |
| `projects/password-lab/` | 練習用パスワードの探索・推定とCPU/GPU比較を学ぶ教材 |
| `projects/sound-analysis-lab/` | 音と波・スペクトルのWeb入門と、音源分離・比較分析のColab教材 |
| `projects/lottery-lab/` | くじ引きの1000回チャレンジと、全設定の繰り返し比較を楽しむブラウザ教材 |
| `projects/face-recognition-lab/` | カメラ・画像で本人照合と表情分類を試すFACEGATE。ブラウザ版・Python版・Colab分析教材 |
| `projects/dj-lab/` | 16音源パッドを拍に合わせて重ねるDJループスタジオ「LOOP ROOM」。合成デモ・エフェクト・録音・ブラウザ内保存 |
| `projects/shift-planner/` | 必要人数・勤務可能日時・上限を守り、過去実績と勤務量の比率も考慮するシフトスタジオ。CSV・Excel入出力 |
| `projects/pip0/` | デバイス内のファイル整理アシスタント「pip0」（グループの作品の初期コード） |
| `CLAUDE.md` | Claude Codeなどで開発する際の共通方針 |

各作品は、リポジトリのトップにある `projects/` の下に、作品ごとのディレクトリを作って管理します。詳しい置き方は [projects/README.md](projects/README.md) を確認してください。

## グループワークの進め方

1. 初期コードをGoogle Colabなどで動かし、入力を変えて試します。
2. 入力例と実行結果を記録し、便利だった点や困った点を整理します。
3. グループで改善目標を決め、コードを変更します。
4. 改善前と同じ条件で試し、意図した動作になったかを確認します。
5. 変更した内容、その理由、確認方法、残っている課題を説明します。

AIにコード作成を手伝ってもらう際も、自分たちが変更した部分の役割を説明できることを目指してください。

## プロジェクト一覧

| プロジェクト | 概要 | 状態 |
| --- | --- | --- |
| [Meal Palette](projects/recipe-suggester/) | 食事カレンダーと栄養の集計を使う献立提案。主食・飲み物・手入力・手持ちの食材と買い物リストに対応 | [ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/recipe-suggester/) ／ [使い方](projects/recipe-suggester/docs/manual.md) |
| [pip0](projects/pip0/) | ダウンロードの自動仕分け・改名、作業に合わせたファイル候補、思い出し検索、長く使わないファイルの退避、機密ファイルのドラッグ警告を行う、Windows 11 用のファイル整理アシスタント | 初期コード作成（Linux 上の試験とダミーデータのデモで確認。Windows 11 実機での確認は未実施） |

## ファイルを追加する際のお願い

- 自分たちの作品用ディレクトリで作業し、ほかの作品を変更する場合は担当者と相談してください。
- 各作品の `README.md` に、目的、実行方法、工夫した点を記載してください。
- APIキー、パスワード、学籍番号などの個人情報は登録しないでください。
- 他者のコードやデータを利用する場合は、利用条件と出典を確認し、作品の説明書に記載してください。
- ノートブックを登録する前に、個人情報や秘密情報を含む出力が残っていないか確認してください。

## 公開用に整理した学生作品

| 作品 | 概要 | 起動・使い方 |
| --- | --- | --- |
| [AI作曲アレンジ](projects/ai-music-arranger/) | YouTube・音声ファイル・デモ音源から、コード伴奏とドラムを加えて聴き比べる教材 | [Colabで開く](https://colab.research.google.com/github/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/ai-music-arranger/ai_music_arranger.ipynb) ／ [操作マニュアル](projects/ai-music-arranger/docs/manual.md) |
| [くじびきラボ](projects/lottery-lab/) | 1回・まとめ引き、当選コレクション、設定ごとの平均とばらつきを比べる確率実験 | [ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/lottery-lab/) ／ [操作マニュアル](projects/lottery-lab/docs/manual.md) |
| [パスワード実験室](projects/password-lab/) | 辞書・規則・総当たりの短時間の実測と推定、保存方式と計算装置の比較 | [ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/password-lab/) ／ [操作マニュアル](projects/password-lab/docs/manual.md) |
| [音の実験室](projects/sound-analysis-lab/) | 波形・スペクトル・スペクトログラムを学ぶWeb入門と、日本語グラフで音源を比較するColab教材 | [Webで学ぶ](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/sound-analysis-lab/) ／ [Colabで分析](https://colab.research.google.com/github/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/sound-analysis-lab/sound_analysis_lab.ipynb) |
| [LOOP ROOM](projects/dj-lab/) | 学生のDJアプリをもとにした公開用発展版。16音源を拍に合わせて重ね、デモ演奏・ミックス・録音を試すブラウザアプリ | [ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/dj-lab/) ／ [操作マニュアル](projects/dj-lab/docs/manual.md) |
| [シフトスタジオ](projects/shift-planner/) | 学生のシフト作成アプリをもとにした公開用発展版。勤務条件を守る割り当てを探索し、履歴を含む勤務量の偏りを比較 | [ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/shift-planner/) ／ [操作マニュアル](projects/shift-planner/docs/manual.md) |

| [FACEGATE](projects/face-recognition-lab/) | 学生の元提出ZIPを未改変で配布。ブラウザ発展版では高速照合・複数人処理を追加 | [学生の元提出版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/face-recognition-lab/original/facegate-submitted.zip) ／ [ブラウザ発展版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/face-recognition-lab/) |

ブラウザ版は **GitHub Actions** でまとめて公開します。リポジトリの Settings → Pages でSourceをGitHub Actionsに設定します。公開対象の追加方法は[Pagesの公開手順](docs/pages.md)を参照してください。作品ごとのURLは `/projects/作品名/` です。
