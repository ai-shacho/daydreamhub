# daydreamhub

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
