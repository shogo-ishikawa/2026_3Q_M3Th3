# Third-party software

## SheetJS Community Edition 0.20.3

- Official distribution: https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs
- Documentation: https://docs.sheetjs.com/
- Licence: Apache License 2.0. Full text: `vendor/LICENSE-SheetJS.txt`.
- Vendored file: `vendor/xlsx.mjs`, SHA-256 `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`.
- Copyright (C) 2012-present SheetJS LLC.

This unchanged local copy reads and writes Excel files. The application does not load a CDN script or upload workbook contents. Input formulas are rejected; output text cells are written as strings. CSV exports escape leading formula characters with an apostrophe, and imports of the application's own CSV files undo that escape. Original leading apostrophes are doubled on export so they survive re-import.
