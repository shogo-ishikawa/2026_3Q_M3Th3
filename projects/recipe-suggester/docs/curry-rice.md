# カレーのご飯量

カレーの具・ルーは元レシピの1人分を保ち、炊飯済みの白米だけを0〜1000gで指定する。初期値は150g。0gでは米の材料行を削除し、「ご飯0g・ルーのみ」と表示する。ナンは別の主食として追加する。

`curry-rice.js` の公開関数:

- `curryRiceFor(recipeId, data?)` は変更可能なカレーの定義を返す。対象外は `null`。`data` を渡すと、新しいカレーレシピも同じ材料条件で判定する。
- `defaultCurryRiceSelection(recipeId, data?)` は `{recipeId, riceGrams:150}` を返す。
- `buildCurryRiceSelection({id?, recipeId, riceGrams}, data)` は元レシピを変更せず、1人分の保存可能なマイレシピを返す。編集時は同じ `id` を渡す。
- `eligibleCurryRiceSelections(recipeId, settings, data)` は150gと0gを実際の材料・確認フラグで判定し、除外条件に合う `{config,recipe}` の配列を返す。例えば米を除外した場合でも、米以外の材料が適合すれば0gを初期値にできる。入力変更後も呼び出し元で現在の除外条件を検証する。

`mountCurryRice({recipeId,data,initial?,onChange,onError})` はフォーム内に置ける `div` を返す。初期表示と有効な入力で `onChange(recipe)` を通知し、不正な入力では `onChange(null)` とエラーを通知する。生成したIDは入力変更の間も保持する。空欄は0gとは扱わない。

## 栄養・記録・買い物

米以外の材料を元の人数で割り、指定した米のg数を加える。成分値は既存の `ingredients.rice.nutritionPerUnit`（炊飯済み精白米）を使う。通常の材料から計算するレシピは、この配合全体から栄養を求める。未入力の成分値は `null` を保つ。

例外は `prepared-retort-vegetable-curry` と `prepared-retort-keema-curry`。この2品の `manualNutrition` は、ご飯180gを含む明示されたモデル配合の1食分なので、登録された米180gを差し引いて指定した米を足す。2人分の材料が米360g＋指定したルーモデル400gであることも確認する。原材料・アレルゲンは商品ごとの確認が必要な状態を保つ。

その他の `manualNutrition` を持つ完成品は、米の内訳が分からないため対象外にする。外食の商品全体から任意の米の栄養を差し引くことはしない。材料の量が明示された手作り・レトルト・外食のレシピは同じ処理を使える。

結果は `servings:1`、`custom:true`、基準量1皿、計算済み `manualNutrition` を持つ。ご飯0gは `role:'main'`、`staple:false`、`mealBase:false` とし、`family:'curry'` を維持する。ご飯ありは元の役割・主食設定を保つ。買い物は選択した米のg数を皿数・人数で1回ずつ拡大する。0gの材料行は保存しない。商品・材料の確認フラグとアレルゲン情報を引き継ぎ、元レシピと過去の記録は変更しない。

検証: `node --test tests/curry-rice.test.mjs tests/curry-rice-ui.test.mjs`
