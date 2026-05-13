import * as https from 'https';
import db from '../db';
import { notify, notifyAdmins } from './notifications';

const XENDIT_SECRET = process.env.XENDIT_SECRET_KEY ?? '';

export function xenditGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${XENDIT_SECRET}:`).toString('base64');
        const options: https.RequestOptions = {
            hostname: 'api.xendit.co',
            path,
            method: 'GET',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
        };
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', (chunk) => (raw += chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); } catch { reject(new Error(raw)); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * If the order has an invoice in pending state, query Xendit for the latest
 * status and update our DB row accordingly. Returns the live payment_status.
 * Safe to call anywhere — silently ignores errors and missing data.
 */
export async function syncPaymentStatus(orderId: string): Promise<string | null> {
    const row = db.prepare(
        `SELECT customer_id, assigned_employee_id, washer_payout, total_amount,
                payment_status, xendit_invoice_id
         FROM orders WHERE id = ?`
    ).get(orderId) as any;
    if (!row) return null;
    if (row.payment_status !== 'pending' || !row.xendit_invoice_id) {
        return row.payment_status;
    }
    try {
        const remote = await xenditGet(`/v2/invoices/${row.xendit_invoice_id}`);
        if (remote?.status === 'PAID' || remote?.status === 'SETTLED') {
            db.prepare(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`).run(orderId);
            // Notify everyone with skin in the game so they see the payment
            // event without needing to manually refresh:
            //   customer: payment confirmation receipt
            //   washer:   earnings just unlocked (washer_payout counts now)
            //   admin:    platform revenue tick
            const shortId = orderId.substring(0, 8).toUpperCase();
            notify({
                userId: row.customer_id,
                type: 'payment_paid',
                title: 'Payment received',
                body: `Order #${shortId} paid successfully. Thank you!`,
                orderId,
            });
            if (row.assigned_employee_id) {
                notify({
                    userId: row.assigned_employee_id,
                    type: 'payout_unlocked',
                    title: 'Earnings unlocked',
                    body: `Order #${shortId} paid. Rp ${Math.round(row.washer_payout || 0)} added to your earnings.`,
                    orderId,
                });
            }
            notifyAdmins({
                type: 'payment_paid',
                title: 'Order paid',
                body: `Order #${shortId} — Rp ${Math.round(row.total_amount || 0)} received.`,
                orderId,
            });
            return 'paid';
        }
        if (remote?.status === 'EXPIRED') {
            db.prepare(
                `UPDATE orders SET payment_status = 'expired', xendit_invoice_url = NULL WHERE id = ?`
            ).run(orderId);
            notify({
                userId: row.customer_id,
                type: 'payment_expired',
                title: 'Payment link expired',
                body: 'Tap the order to try paying again.',
                orderId,
            });
            return 'expired';
        }
    } catch (_) { /* ignore poll failure, return current DB value */ }
    return row.payment_status;
}
