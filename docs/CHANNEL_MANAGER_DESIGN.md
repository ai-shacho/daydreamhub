# デイユース・チャネルマネージャー 設計書（Draft v1）

作成: 2026-07-25 / 対象: DayDreamHub (DDH)

## 0. 何を作るか

通常のチャネルマネージャー（TL-リンカーン、SiteMinder等）は「日付 × 部屋タイプ × 残室数」を複数OTAに同期する。
本システムはその**時間軸拡張版**：「日付 × 部屋タイプ × **時間帯** × 残室数」を管理・同期する。

### 通常CMとの本質的な違い（＝設計の勘所）

| 項目 | 泊CM | デイユースCM |
|---|---|---|
| 在庫の単位 | 1日1泊 | 同じ部屋を1日に複数回転（3h/5h/8h等） |
| 競合条件 | 同日重複のみ | 時間帯の**重なり判定**＋清掃バッファ |
| 泊在庫との関係 | — | チェックアウト〜チェックインの隙間が商品になる／泊が入ると日中も潰れる |
| チャネル側の表現力 | ほぼ共通(日付×残室) | チャネルごとにバラバラ（固定スロット制・自由時間制・プラン制） |

### 戦略上の2方向

- **(a) DDH内製在庫エンジン**: ホテルがDDHに在庫・料金を流し込みやすくする（まずこれ）
- **(b) 独立CM事業**: 他のデイユースOTA（Dayuse.com, HotelsByDay, 国内OTAのデイユースプラン）にも配信する外販プロダクト

**方針: (a)から作るが、スキーマとアダプタ層は最初から(b)を見据えてチャネル非依存にする。**
DDH自身を「最初のチャネル」として扱うのがポイント。これで(b)への拡張がアダプタ追加だけになる。

---

## 1. 在庫モデル（コア仕様）

### 検討した3案

- **A. 固定スロット制**（10-15時 / 15-20時 など）: 実装・同期が簡単。ホテルの実運用にも合う。ただし時間貸し（1h単位レンタル）を表現できない。
- **B. 連続時間制**（任意開始時刻、重なり判定）: 時間貸しまで表現できるが、チャネル同期の共通表現として複雑すぎる。
- **C. ハイブリッド（採用）**: 内部は**30分バケットの残数カウント**（1日48マス × 部屋タイプ）。販売単位は「レートプラン」（滞在時間・開始可能時間帯・料金）として上に載せる。固定スロットも時間貸しもプラン定義で表現でき、チャネルへはチャネルの表現力に合わせて丸めて配信する。

### C案の動作原理

- 部屋タイプごとに `capacity`（デイユースに出す室数）を持つ
- 予約确定時: 滞在時間＋**清掃バッファ**（部屋タイプ毎に設定、既定30分）ぶんのバケットを一括デクリメント
- 空き判定: プランの開始候補時刻ごとに「必要バケットが全て残数>0か」を見るだけ（重なり判定が配列の min 取るだけになる）
- 泊在庫との連動: 泊予約・泊OTAのブロックは「その日の該当時間帯のバケットを0にするイベント」として同じ仕組みに流し込む（チェックアウト11時・チェックイン15時なら 11:30〜14:30 だけデイユース可、も自然に表現できる）

---

## 2. データモデル（D1 追加テーブル）

```sql
-- デイユース在庫を持つ部屋タイプ（既存 plans.room_type を正規化して昇格）
room_types (
  id, hotel_id, name, name_ja,
  capacity INTEGER,            -- デイユースに出す室数
  cleaning_buffer_min INTEGER DEFAULT 30,
  open_time TEXT, close_time TEXT   -- デイユース販売可能時間帯 例 "09:00"-"22:00"
)

-- 日次在庫: 1行 = 部屋タイプ×日付。48バケットの残数をJSON配列で保持
inventory_days (
  room_type_id, date TEXT,          -- PK (room_type_id, date)
  buckets TEXT,                     -- 例 "[2,2,2,1,...]" 48要素
  version INTEGER,                  -- 楽観ロック＋差分同期カーソル
  updated_at
)

-- レートプラン（販売商品）。既存 plans を拡張・移行
rate_plans (
  id, hotel_id, room_type_id,
  duration_min INTEGER,             -- 180 / 300 / 480、時間貸しは60
  start_window TEXT,                -- 開始可能時間帯 "10:00-19:00"、固定スロットなら "13:00-13:00"
  start_step_min INTEGER,           -- 開始時刻の刻み。固定スロット=NULL、時間貸し=30
  base_price REAL, currency TEXT,
  min_lead_min INTEGER,             -- 直前予約の締切（例: 60分前まで）
  cancellation_policy, is_active
)

-- 日別オーバーライド（料金・売止）
rate_overrides (
  rate_plan_id, date, price REAL NULL, closed INTEGER DEFAULT 0
)

-- チャネル定義とマッピング
channels ( id, code /* 'ddh','ical','dayuse_com',... */, hotel_id, config JSON, status )
channel_rate_plan_map ( channel_id, rate_plan_id, external_plan_id, price_adjust JSON )

-- 変更イベントログ（配信のソース・オブ・トゥルース）
ari_events (
  id AUTOINCREMENT, hotel_id, room_type_id, date,
  kind TEXT,          -- 'inventory' | 'rate' | 'stop_sell'
  payload JSON, created_at
)
channel_sync_cursors ( channel_id, last_event_id, last_full_sync_at )

-- 予約はチャネル横断で一意化
bookings に追加: channel_id, external_booking_id, slot_start TEXT, slot_end TEXT
UNIQUE(channel_id, external_booking_id)   -- 冪等性キー
```

---

## 3. 同期アーキテクチャ（Cloudflare前提）

```
[オーナーUI/PMS/泊iCal] ──書込──> InventoryDO (Durable Object, hotel単位)
                                   │ 直列化してD1更新 + ari_events追記
                                   ▼
                        Cron(1分) → 未配信ari_eventsをチャネル別に集約
                                   ▼
                        ChannelAdapter.pushARI(diff)  ← リトライ+指数バックオフ
                                   
[各OTA] ──予約webhook──> /api/channel/:code/webhook → 署名検証 → DO経由で在庫引当
                                   └ 在庫なし → 即エラー応答 or 自動リレー（後述）
```

- **ダブルブッキング防止**: 在庫の増減は必ずホテル単位の Durable Object を通す（D1直書き禁止）。DOが直列実行を保証するのでロック不要
- **冪等性**: 予約取込は `(channel_id, external_booking_id)` のUNIQUE制約で二重取込を弾く
- **ドリフト自己修復**: 差分配信に加え、1日1回の**フル同期**（全日付・全プランを再配信）。CMの定石
- **配信失敗時**: 3回失敗でチャネルを `degraded` にし、オーナー/管理者へ通知（在庫ズレたまま売れ続けるのが最悪なので、失敗が続いたら該当チャネルを売止方向に倒す＝**フェイルセーフは常に「売らない」側**）

### チャネルアダプタ interface

```ts
interface ChannelAdapter {
  pushARI(diff: AriDiff[]): Promise<PushResult>       // 在庫・料金・売止の配信
  parseInboundBooking(req): InboundBooking            // webhook解釈
  confirmBooking(b), cancelBooking(b)                 // OTA側への応答
  capabilities: { slots: 'fixed'|'free', rates: boolean, ... }  // 表現力宣言
}
```

`capabilities` が肝。自由時間制の内部在庫を、固定スロットしか受けられないチャネルには「代表スロット2〜3個に丸めて」配信する。

---

## 4. 開発手順（フェーズ）

### Phase 0: 調査（〜1週間）
1. **外部チャネルの現実確認**: Dayuse.com / HotelsByDay にパートナー・コネクティビティAPIが存在するか、国内サイトコントローラー（TL-リンカーン、ねっぱん）の接続審査条件。※ここの結果で(b)の優先度が決まる
2. 既存DDH掲載ホテル数軒に運用ヒアリング（固定スロットで回してるか、清掃バッファ実態、泊とのインベントリ共用状況）
3. 既存 `plans` / `blocked_dates` / 予約承認フローの移行影響調査

### Phase 1: コア在庫エンジン + DDH自身を最初のチャネル化（2〜3週間）
1. 上記スキーマのマイグレーション（`plans`→`rate_plans`+`room_types` へ移行スクリプト）
2. InventoryDO 実装（引当・解放・ari_events）＋単体テスト（境界: バッファ跨ぎ、閉店時刻、同時引当）
3. DDH予約フローを在庫エンジン経由に切替。**在庫が入っているホテルは即時確定**、未整備ホテルは従来のリクエスト承認にフォールバック（`channels.status`で分岐）
4. 空き検索API: `GET /api/availability?hotel&date&duration` → 開始可能時刻リスト

### Phase 2: オーナーUI + 泊在庫との間接連携（2週間）
1. オーナーパネルにタイムライン型カレンダー（横軸=時間、縦軸=部屋タイプ、ドラッグで売止）
2. 日別の残数一括設定・料金オーバーライド・スロットひな形（「平日は12-16時を2室」等）
3. **iCal 取込**（Booking.com/Airbnb等の泊予約カレンダーURLを登録→泊ブロックを自動反映）と iCal 書出し。これが最小コストの「他OTA連携」
4. 予約確定/キャンセルのメール・Telegram通知

### Phase 3: 外部チャネル配信 = CM化（Phase 0 の結果次第）
1. アダプタ2号機（Phase 0 で見つかった接続先。無ければ「メール/FAX配信アダプタ」— fax-sender-ddh 資産を流用し、API非対応ホテル・OTAへの擬似接続にする）
2. 管理画面: チャネル別同期状態・失敗ログ・手動フル同期ボタン
3. 外販するならマルチテナント化（`channels` はホテル単位設計済みなので拡張で足りる）

---

## 5. 主要な論点・リスク

- **最大のリスクは技術でなくチャネル側**: デイユースOTAの公開コネクティビティAPIは泊の世界ほど整っていない可能性が高い。Phase 0 の調査結果が出るまで Phase 3 の工数は確約しない
- **既存予約フローとの併存**: 即時確定とリクエスト承認の2モードが恒久的に併存する前提で作る（全ホテルが在庫を入れてくれるとは限らない）
- **タイムゾーン**: 在庫バケットは常に**ホテル現地時刻**で持つ。UTC変換はAPI境界でのみ行う（80都市展開なのでここを曖昧にすると必ず事故る）
- **通貨**: `rate_plans.currency` はホテル通貨。表示換算は既存 `exchange_rate_cache` を流用
