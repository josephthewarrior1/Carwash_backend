import db from '../db';
import crypto from 'crypto';
import { notify } from './notifications';
import { syncPaymentStatus } from './xendit';

const ONE_MINUTE = 60_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Auto-cancel `pending` orders that have not been assigned within 2 hours of
 * their scheduled time, plus any pending order whose scheduled time has
 * already passed.
 */
function autoCancelStalePending() {
    try {
        const stale = db.prepare(`
            SELECT id, customer_id FROM orders
            WHERE status = 'pending'
              AND deleted_at IS NULL
              AND (
                julianday(scheduled_at) - julianday('now') < (2.0 / 24.0)
              )
        `).all() as { id: string; customer_id: string }[];

        for (const row of stale) {
            const tx = db.transaction(() => {
                db.prepare(`
                    UPDATE orders
                    SET status = 'cancelled',
                        cancellation_reason = 'Auto-cancelled — no washer assigned in time'
                    WHERE id = ?
                `).run(row.id);
                db.prepare(`
                    INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
                    VALUES (?, ?, 'cancelled', ?, 'Auto-cancelled — no washer assigned in time')
                `).run(crypto.randomUUID(), row.id, row.customer_id);
            });
            tx();
            notify({
                userId: row.customer_id,
                type: 'order_auto_cancelled',
                title: 'Booking cancelled',
                body: 'No washer could be assigned in time. Please try a different slot.',
                orderId: row.id,
            });
        }
        if (stale.length) console.log(`[cron] auto-cancelled ${stale.length} stale pending order(s)`);
    } catch (e) {
        console.error('[cron] autoCancelStalePending failed:', e);
    }
}

/**
 * Sync Xendit invoice state for all pending payments. Catches the case where
 * a customer paid but the webhook wasn't configured.
 */
async function pollPendingPayments() {
    try {
        const rows = db.prepare(`
            SELECT id FROM orders
            WHERE payment_status = 'pending'
              AND xendit_invoice_id IS NOT NULL
              AND deleted_at IS NULL
        `).all() as { id: string }[];
        for (const r of rows) {
            await syncPaymentStatus(r.id);
        }
    } catch (e) {
        console.error('[cron] pollPendingPayments failed:', e);
    }
}

/**
 * Auto-cancel done orders that have not been paid 48 hours after completion
 * and reverse the washer's payout for them. The platform refuses to pay the
 * washer for unpaid work.
 */
function reverseUnpaidDoneOrders() {
    try {
        const rows = db.prepare(`
            SELECT id, assigned_employee_id, washer_payout, customer_id
            FROM orders
            WHERE status = 'done'
              AND (payment_status IS NULL OR payment_status != 'paid')
              AND completed_at IS NOT NULL
              AND julianday('now') - julianday(completed_at) > 2
              AND deleted_at IS NULL
        `).all() as any[];

        for (const row of rows) {
            const tx = db.transaction(() => {
                db.prepare(`
                    UPDATE orders
                    SET status = 'cancelled',
                        cancellation_reason = 'Auto-reversed — unpaid 48h after completion',
                        washer_payout = 0,
                        platform_revenue = 0
                    WHERE id = ?
                `).run(row.id);
                db.prepare(`
                    INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
                    VALUES (?, ?, 'cancelled', ?, 'Auto-reversed — unpaid 48h after completion')
                `).run(crypto.randomUUID(), row.id, row.customer_id);
            });
            tx();
            if (row.assigned_employee_id) {
                notify({
                    userId: row.assigned_employee_id,
                    type: 'payout_reversed',
                    title: 'Payout reversed',
                    body: `Customer did not pay within 48 hours. Rp ${row.washer_payout} removed from earnings.`,
                    orderId: row.id,
                });
            }
            notify({
                userId: row.customer_id,
                type: 'order_auto_cancelled',
                title: 'Unpaid order cancelled',
                body: 'Your completed order was auto-cancelled because payment was not made within 48 hours.',
                orderId: row.id,
            });
        }
        if (rows.length) console.log(`[cron] reversed ${rows.length} unpaid completed order(s)`);
    } catch (e) {
        console.error('[cron] reverseUnpaidDoneOrders failed:', e);
    }
}

export function startCronJobs() {
    // Initial run shortly after boot, then every minute.
    setTimeout(() => {
        autoCancelStalePending();
        pollPendingPayments();
        reverseUnpaidDoneOrders();
    }, 10_000);

    setInterval(() => {
        autoCancelStalePending();
        reverseUnpaidDoneOrders();
    }, 5 * ONE_MINUTE);

    // Payment polling more often since customers are actively waiting.
    setInterval(pollPendingPayments, ONE_MINUTE);

    console.log('[cron] schedulers started');
}
