# DayDreamHub

## ⚠️ 絶対ルール（エラー調査・デバッグ時）
**【推測の禁止と証拠の徹底】**
- エラー原因の特定や解決策の提示において、**推測や思い込みによる断定は絶対に禁止**します。
- 必ず「実際のログ」「エラーメッセージ」「DBの生データ」などの**観測可能な事実・証拠**のみに基づいて報告してください。
- 証拠がなく推測に頼らざるを得ない場合は、必ず「ここから先は証拠が不十分なため推測である」と明記し、事実を確認するための「ログ出力コードの追加（トラップコードのデプロイ）」等の具体的な証拠収集手段を先に提案してください。

## Documentation

- [ARCHITECTURE](/root/daydreamhub/docs/ARCHITECTURE.md)
- [FEATURES](/root/daydreamhub/docs/FEATURES.md)
- [OPERATIONS](/root/daydreamhub/docs/OPERATIONS.md)
- [API](/root/daydreamhub/docs/API.md)
- [DECISIONS](/root/daydreamhub/docs/DECISIONS.md)

--- 

*This is an auto-generated file, please do not edit directly.*

Astro + Cloudflare + Tailwind で構築したWebサイト。候補地の画像（カイロ、カルガリー、エクアドル、ギザ等）が置かれている。

## 技術スタック

- **フレームワーク:** Astro（SSR, Cloudflare adapter）
- **スタイリング:** Tailwind CSS
- **デプロイ先:** Cloudflare Workers（SSRモード）

## 開発・デプロイ

```bash
cd /root/daydreamhub
npm run dev      # ローカル開発（Astro dev server）
npm run build    # ビルド
wrangler deploy  # Cloudflare にデプロイ
```

## D1データベース

`d1/` ディレクトリあり。Cloudflare D1（SQLite）を使用している可能性あり。

## 画像ファイル

`*_candidate.jpg` — 候補地の写真（cairo, calgary, ecuador, giza, goris, nairobi等）