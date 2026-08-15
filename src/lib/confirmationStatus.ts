import { formatDisplayDate } from './dateFormat';

/**
 * 予約確認画面（EN/JA共通）のステータス判定ロジック。
 * booking/confirmation.astro と ja/booking/confirmation.astro の両方から呼び出し、
 * 挙動の差異をなくす。
 *
 * 状態の優先順位:
 *  1. payment_status=pending（URLパラメータ）→ 決済審査中（時計・animate-pulse）。DBに予約なし→ポーリングしない。
 *  2. alt_status === 'awaiting_customer_choice' → 代替ホテル選択画面（status より優先）。
 *  3. booking.status による分岐。
 */
export function initConfirmationStatus(): void {
  const container = document.querySelector('[data-order-id]') as HTMLElement | null;
  if (!container) return;

  // One script serves /booking/confirmation and its /ja/ twin, so the wording
  // and the date format follow the path.
  const ja = location.pathname.startsWith('/ja/');

  const orderId = container.getAttribute('data-order-id') || '';
  const paymentStatus = container.getAttribute('data-payment-status') || '';

  function showState(state: string): void {
    document.querySelectorAll('[id^="state-"]').forEach((el) => el.classList.add('hidden'));
    document.getElementById(`state-${state}`)?.classList.remove('hidden');
  }

  // 1. PayPal PENDING（決済審査中）: URLパラメータで明示。DBに予約レコードはまだ無いのでポーリング不要。
  if (paymentStatus === 'pending') {
    showState('payment-review');
    return;
  }

  // order が無い（直接アクセス等）→ 確定表示でフォールバック
  if (!orderId) {
    showState('confirmed');
    return;
  }

  let bookingId: number | null = null;

  function fillConfirmedCard(data: any): void {
    const card = document.getElementById('booking-details-card');
    if (!card) return;
    const set = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('detail-hotel', (ja && data.hotel_name_ja) || data.hotel_name || '—');
    set('detail-plan', (ja && data.plan_name_ja) || data.plan_name || '—');
    set('detail-checkin', data.check_in_date ? formatDisplayDate(data.check_in_date, ja ? 'ja' : 'en') : '—');
    set('detail-price', data.total_price_usd != null ? `$${Number(data.total_price_usd).toFixed(2)}` : '—');
    fillAddOns(data.options || []);
    card.classList.remove('hidden');
  }

  // The add-ons the guest paid for, listed with who each one covered. Without
  // this the total on screen is larger than the plan price with no explanation.
  function fillAddOns(options: any[]): void {
    const row = document.getElementById('detail-addons-row');
    const list = document.getElementById('detail-addons');
    if (!row || !list) return;
    if (!options.length) { row.classList.add('hidden'); return; }
    const n = (v: any) => Number(v) || 0;
    const count = (v: number, one: string, many: string, jaUnit: string) =>
      ja ? `${v}${jaUnit}` : `${v} ${v === 1 ? one : many}`;
    const coverage = (o: any) => {
      if (o.pricing_type === 'per_adult_child') {
        const parts: string[] = [];
        if (n(o.quantity) > 0) parts.push(count(n(o.quantity), 'adult', 'adults', '名（大人）'));
        if (n(o.child_quantity) > 0) parts.push(count(n(o.child_quantity), 'child', 'children', '名（子供）'));
        if (n(o.infant_quantity) > 0) parts.push(count(n(o.infant_quantity), 'infant', 'infants', '名（幼児）'));
        return parts.join(ja ? '＋' : ' + ');
      }
      if (o.pricing_type === 'per_person') return count(n(o.quantity), 'guest', 'guests', '名');
      return ja ? '1予約' : count(n(o.quantity) || 1, 'booking', 'bookings', '予約');
    };
    list.innerHTML = '';
    for (const o of options) {
      const li = document.createElement('li');
      li.className = 'flex justify-between gap-3';
      const left = document.createElement('span');
      left.textContent = `${o.name} (${coverage(o)})`;
      const right = document.createElement('span');
      right.className = 'whitespace-nowrap';
      right.textContent = o.currency && o.currency !== 'USD' && o.amount_local != null
        ? `${o.currency} ${o.amount_local} (≈ $${Number(o.amount_usd || 0).toFixed(2)})`
        : `$${Number(o.amount_usd || 0).toFixed(2)}`;
      li.append(left, right);
      list.appendChild(li);
    }
    row.classList.remove('hidden');
  }

  async function checkStatus(): Promise<void> {
    try {
      const res = await fetch(`/api/booking-status?order=${encodeURIComponent(orderId)}`);
      if (!res.ok) {
        showState('pending');
        setTimeout(checkStatus, 15000);
        return;
      }
      const data = await res.json();
      if (data.id != null) bookingId = data.id;

      // 2. 代替ホテル選択待ち（status とは独立。最優先で判定）
      if (data.alt_status === 'awaiting_customer_choice') {
        showState('alt-choice');
        return;
      }

      // 3. status による分岐
      switch (data.status) {
        case 'confirmed':
          showState('confirmed');
          fillConfirmedCard(data);
          return;
        case 'pending_confirmation':
          // 決済完了・ホテル承認待ち。封筒アイコン＋「予約リクエスト受付」文言。
          // 承認結果はメールで通知するため、ここで終端（ポーリング停止）。
          showState('pending');
          return;
        case 'cancelled':
        case 'refunded':
          showState('cancelled');
          return;
        case 'pending':
        case 'calling':
          showState('pending');
          setTimeout(checkStatus, 10000);
          return;
        default:
          showState('pending');
          setTimeout(checkStatus, 10000);
      }
    } catch {
      showState('pending');
      setTimeout(checkStatus, 15000);
    }
  }

  checkStatus();

  // 代替ホテル選択ボタン → /api/bookings/{id}/alt-choice（token=paypal_order_id, choice）
  async function submitAltChoice(choice: 'retry' | 'refund'): Promise<boolean> {
    if (!bookingId) return false;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/alt-choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: orderId, choice }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  document.getElementById('btn-retry-more')?.addEventListener('click', async () => {
    const ok = await submitAltChoice('retry');
    if (ok) {
      showState('pending');
      setTimeout(checkStatus, 5000);
    }
  });

  document.getElementById('btn-refund')?.addEventListener('click', async () => {
    const ok = await submitAltChoice('refund');
    if (ok) showState('cancelled');
  });
}
