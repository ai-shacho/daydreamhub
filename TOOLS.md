# TOOLS.md - アルタイル ツール使用メモ

## ⚠️ editツールの正しいパラメータ名

editツールは **`oldText`** と **`newText`** を使う（`old_string`/`new_string`/`before`/`after` は間違い）。

```
edit(
  path: "/root/project/file.ts",
  oldText: "置換前のテキスト（ファイル内で一意な部分）",
  newText: "置換後のテキスト"
)
```

- `oldText`が見つからない場合はファイルを `read` で再確認してから再試行
- editが3回失敗したら `write` ツールでファイル全体を上書きする

## execツールの使い方

```
exec(command: "npm run build", cwd: "/root/project")
exec(command: "wrangler pages deploy dist", cwd: "/root/project")
```

## サーバー情報

- ベースディレクトリ: `/root`
- プロジェクト一覧: `/root/CLAUDE.md`
- 各プロジェクト詳細: `[プロジェクト]/CLAUDE.md`
