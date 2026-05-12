import * as https from 'https';
import db from '../db';

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
        `SELECT payment_status, xendit_invoice_id FROM orders WHERE id = ?`
    ).get(orderId) as any;
    if (!row) return null;
    if (row.payment_status !== 'pending' || !row.xendit_invoice_id) {
        return row.payment_status;
    }
    try {
        const remote = await xenditGet(`/v2/invoices/${row.xendit_invoice_id}`);
        if (remote?.status === 'PAID' || remote?.status === 'SETTLED') {
            db.prepare(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`).run(orderId);
            return 'paid';
        }
        if (remote?.status === 'EXPIRED') {
            db.prepare(
                `UPDATE orders SET payment_status = 'expired', xendit_invoice_url = NULL WHERE id = ?`
            ).run(orderId);
            return 'expired';
        }
    } catch (_) { /* ignore poll failure, return current DB value */ }
    return row.payment_status;
}
