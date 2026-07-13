# フローA不具合調査 - 事実確定チェックリスト

## コードパス（確定事実）

```
フロントの「Call to Book $7」
  ↓ __create_call_group_direct (chat.ts:883)
  ↓ createCallGroup (tools.ts:405)
    → concierge_call_groups: INSERT (pending, external hotel あり)
    → concierge_calls: INSERT ×最大3件 (call_order=1,2,3)
    → payment_status: 'required'
  ↓ PayPal決済 URL 返却
  ↓ [ユーザーが PayPal で支払い]
  ↓ /api/concierge/pay (POST: action=capture)
    → captureOrder(order_id)
    → payment_status: 'paid' に更新
    → triggerInitialGroupCallIfNeeded(group_id) 呼び出し
  ↓ initiateNextGroupCall (tools.ts:468)
    → current_order: 0+1=1
    → call_order=1 の concierge_calls を見つけす
    → initiateCall(session_id, call_id)
  ↓ initiateCall (tools.ts:675)
    → normalizePhoneNumber(hotel_phone) 検証
    → Twilio/Telnyx API 呼び出し
    → telnyx_call_id: 'twilio:...' or 'telnyx:...' に更新
    → status: 'calling'
```

## 架電が「されない」停止条件（優先度順）

### **S級：環境変数欠落（絶対停止）**
- [ ] **Twilio未設定** (line 754)
  - SQL: `SELECT concierge_calls WHERE created_at > DATE('now','-1 hour') LIMIT 5`
  - 確認項目: `status = 'failed'` かつ `ai_summary LIKE 'No call provider configured'`
  
- [ ] **Google Places API未設定** (line 272)
  - 確認項目: `_structExternalHotels` 空 → `phone` 空のまま `concierge_calls` に保存

### **A級：電話番号問題（最高確度）**
- [ ] **hotel_phone が空**
  - SQL: `SELECT * FROM concierge_calls WHERE hotel_phone IS NULL OR hotel_phone = '' AND created_at > DATE('now', '-1 day') LIMIT 10`
  - 確認項目: 本来 Google Places から取得されているはずが空

- [ ] **normalizePhoneNumber 失敗**
  - SQL: `SELECT status, ai_summary FROM concierge_calls WHERE status = 'failed' AND created_at > DATE('now', '-6 hours') LIMIT 5`
  - 確認項目: `ai_summary LIKE '%Phone must%'` or `'%E.164%'`

- [ ] **Tokyo 環境 / テストモック使用**
  - コード確認: `searchHotelsExternal` (line 264) の tokyo モック使用中か
  - SQL: 不要（コード上のモック確認のみ）

### **B級：DBレコード構造問題**
- [ ] **concierge_calls に call_order が正しく入っていない**
  - SQL:
    ```sql
    SELECT call_group_id, call_order, id, hotel_name, hotel_phone, status 
    FROM concierge_calls 
    WHERE call_group_id IN (
      SELECT id FROM concierge_call_groups WHERE payment_status='paid' ORDER BY id DESC LIMIT 5
    )
    ORDER BY call_group_id, call_order;
    ```
  - 確認項目: `call_order = 1, 2, 3` が揃っているか

- [ ] **concierge_call_groups の current_order が進まない**
  - SQL: `SELECT id, current_order, total_calls, status FROM concierge_call_groups WHERE payment_status='paid' ORDER BY id DESC LIMIT 5`
  - 確認項目: `current_order = 0` のまま進まず

### **C級：アルゴリズム条件（边界条件）**
- [ ] **`initiateNextGroupCall` で nextCall が NULL**
  - コード: tools.ts line 561-571 の WHERE 条件が厳しい
  - SQL:
    ```sql
    SELECT id, hotel_name, telnyx_call_id, outcome, status
    FROM concierge_calls
    WHERE call_group_id = {group_id}
      AND call_order = {next_order}
      AND telnyx_call_id IS NULL
      AND COALESCE(outcome, '') NOT IN ('booked', 'available', 'unavailable', 'no_answer')
      AND COALESCE(status, 'pending') IN ('pending', 'calling')
    ORDER BY COALESCE(attempt, 1) DESC, id DESC
    LIMIT 1;
    ```
  - 確認項目: `outcome` が `'booked'` 等のターミナル状態に誤ってセットされていないか

### **D級：暴走編集の影響**
- [ ] **twilio-voice.ts の変更がコンシェルジュ架電後の応答を破壊しているか**
  - git diff: `9f920c8..7cfed43 -- src/pages/api/webhooks/twilio-voice.ts`
  - 確認項目: ポストコール SSML/応答生成のみ（架電開始は無関係）

## ログ確認手順

### Wrangler tail（リアルタイム）
```bash
cd /root/daydreamhub
wrangler tail
# フィルタ: "[initiateCall]" "Payment processing" "paid-but-call-not-started"
```

### SQL 確認（D1）
```sql
-- 1. 最近の支払い完了
SELECT id, group_id, payment_status, created_at 
FROM concierge_call_groups 
WHERE payment_status='paid' 
ORDER BY created_at DESC LIMIT 10;

-- 2. それぞれのグループに紐づく呼び出し
SELECT id, call_group_id, call_order, hotel_name, hotel_phone, status, telnyx_call_id, outcome
FROM concierge_calls
WHERE call_group_id = {confirmed_group_id}
ORDER BY call_order, attempt;

-- 3. スキップ/失敗した呼び出し
SELECT id, status, ai_summary, created_at
FROM concierge_calls
WHERE status IN ('failed', 'skipped')
AND created_at > datetime('now', '-6 hours')
ORDER BY created_at DESC
LIMIT 20;

-- 4. 架電が始まったが進まないホテル
SELECT id, hotel_name, telnyx_call_id, status, outcome, updated_at
FROM concierge_calls
WHERE status='calling' 
  AND telnyx_call_id LIKE 'twilio:%'
  AND outcome IS NULL
  AND updated_at < datetime('now', '-2 minutes')
ORDER BY updated_at DESC
LIMIT 10;
```

### Twilio コンソール確認
https://www.twilio.com/console/calls/logs
- **フィルタ**: Recent calls → 電話番号で検索 (hotel_phone から)
- **確認項目**: 
  - "Initiated" → "Completed"/"Ringing" 遷移したか
  - HTTP 側で失敗している場合: "Failed to dial" or "Invalid phone number"

### Telnyx コンソール確認
https://portal.telnyx.com/calls
- **確認項目**: 呼び出しが作成されたが実行されず、など

## 予想される原因（仮説）

### ケース1: 本番環境で Google Places API 未設定
**症状**: フロントでホテル選択時に `phone` 空のまま
**確認方法**: SQL で `hotel_phone = ''` のレコード数
**修正**: `.env.production` に `GOOGLE_PLACES_API_KEY` を設定

### ケース2: 電話番号形式が E.164 でない
**症状**: `initiateCall` で `normalizePhoneNumber` fail → `status: 'failed'`
**確認方法**: `ai_summary LIKE '%Phone must be E.164%'`
**修正**: Google Places から返される `nationalPhoneNumber` + 国番号を `+` で結合

### ケース3: Tokyo テスト環境が本番でも有効
**症状**: テスト用モック電話番号（`+818038489554`など）を架電しようとして失敗
**確認方法**: `searchHotelsExternal` の Tokyo 判定ロジック確認
**修正**: 本番では Tokyo を対象外にするか、モック内 E.164 形式検証

## 次のステップ

1. **上記 SQL を実行** → `concierge_calls` / `concierge_call_groups` の直近データを確認
2. **wrangler tail** でリアルタイムログをキャプチャ（テスト発信）
3. **Twilio console** で架電ログを確認
4. **原因候補を 1 つに絞る** → 修正コミット
