# タスク: ブログ全315件の本文コンテンツを完全トレース

## 背景
- 旧サイト: https://daydreamhub.pages.dev/blog/[slug]
- 記事の本文はarticle内のproseクラスのdivに入っている
- 現在DBには記事ページ全体のHTMLが入っており、本文だけを抽出し直す必要がある
- h2/h3/p/ul/ol/li/a/img/strong/em などのHTMLタグを全て保持
- 改行・リンクURL・埋め込み画像URLも完全に保持

## 手順

### Step 1: /tmp/full_trace.py を作成して実行

以下の処理:
1. DBから全スラグを取得:
   ```
   npx wrangler d1 execute daydreamhub-db --remote --command "SELECT id, slug FROM blog_posts ORDER BY id"
   ```
   workdir: /Users/byaoluajnicreo/Desktop/daydreamhub

2. 各スラグを curl -sk で取得: https://daydreamhub.pages.dev/blog/{slug}

3. コンテンツ抽出:
   - article内のproseクラスdivを探す
   - パターン: `class="[^"]*prose[^"]*"` のdivの中身
   - 見つからない場合はarticle内のwp-block系の内容を探す
   - h2,h3,h4,p,ul,ol,li,a,img,strong,em,figure,blockquote タグを全て保持
   - aタグのhrefも完全保持
   - imgタグのsrcも完全保持

4. thumbnail_url: articleの最初のimgのsrc
5. published_at: datetime属性

6. SQLエスケープ: シングルクォートは '' に変換
7. 10件バッチでwrangler d1 executeでDB UPDATE

### Step 2: 実行して進捗を表示

### Step 3: 検証
```
npx wrangler d1 execute daydreamhub-db --remote --command "SELECT id, length(content) as len, substr(content,1,200) as preview FROM blog_posts WHERE id=1"
```

新サイトで確認:
```
curl -sk "https://daydreamhub-1sv.pages.dev/blog/reset-your-body-mind-a-guide-to-bangkoks-layover-wellness-with-a-day-use-hotel-wellmed-clinic" | grep -c "h2\|h3"
```

## 完了後
```
openclaw system event --text "完了: 全315件ブログ本文を完全トレースDB保存完了" --mode now
```
