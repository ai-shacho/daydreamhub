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
    set('detail-hotel', data.hotel_name || '—');
    set('detail-plan', data.plan_name || '—');
    set('detail-checkin', data.check_in_date ? formatDisplayDate(data.check_in_date) : '—');
    set('detail-price', data.total_price_usd != null ? `$${Number(data.total_price_usd).toFixed(2)}` : '—');
    card.classList.remove('hidden');
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
