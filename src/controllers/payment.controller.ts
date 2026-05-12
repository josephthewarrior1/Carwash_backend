import { Request, Response } from 'express';
import * as https from 'https';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const XENDIT_SECRET = process.env.XENDIT_SECRET_KEY ?? '';
const XENDIT_CALLBACK_TOKEN = process.env.XENDIT_CALLBACK_TOKEN ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://carwash.brevonsolutions.com';

function xenditPost(path: string, body: object): Promise<any> {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${XENDIT_SECRET}:`).toString('base64');
        const data = JSON.stringify(body);
        const options: https.RequestOptions = {
            hostname: 'api.xendit.co',
            path,
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
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
        req.write(data);
        req.end();
    });
}

function xenditGet(path: string): Promise<any> {
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

// POST /payments/:orderId  — create or return existing pending invoice
export const createPayment = async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const { orderId } = req.params;
        const userId = req.user!.id;

        const order = db.prepare(`
            SELECT o.*, u.email, u.name
            FROM orders o JOIN users u ON o.customer_id = u.id
            WHERE o.id = ? AND o.customer_id = ?
        `).get(orderId, userId) as any;

        if (!order) return res.status(404).json({ success: false, message: 'Order not found', data: null });
        if (order.status !== 'done') return res.status(400).json({ success: false, message: 'Payment only available for completed orders', data: null });
        if (order.payment_status === 'paid') return res.status(400).json({ success: false, message: 'Order already paid', data: null });

        // Return existing pending invoice instead of creating a new one
        if (order.payment_status === 'pending' && order.xendit_invoice_url) {
            return res.json({
                success: true,
                data: {
                    invoice_url: order.xendit_invoice_url,
                    invoice_id: order.xendit_invoice_id,
                    payment_status: 'pending',
                    amount: order.total_amount,
                },
            });
        }

        const shortId = (Array.isArray(orderId) ? orderId[0] : orderId).substring(0, 8).toUpperCase();
        const invoice = await xenditPost('/v2/invoices', {
            external_id: orderId,
            amount: order.total_amount,
            payer_email: order.email,
            description: `CleanRide Car Wash — Order #${shortId}`,
            currency: 'IDR',
            success_redirect_url: `${FRONTEND_URL}/customer/bookings/${orderId}`,
            failure_redirect_url: `${FRONTEND_URL}/customer/bookings/${orderId}`,
            invoice_duration: 86400,
        });

        if (invoice.error_code) {
            return res.status(500).json({ success: false, message: invoice.message ?? 'Failed to create invoice', data: null });
        }

        db.prepare(`
            UPDATE orders SET xendit_invoice_id = ?, xendit_invoice_url = ?, payment_status = 'pending'
            WHERE id = ?
        `).run(invoice.id, invoice.invoice_url, orderId);

        return res.json({
            success: true,
            data: {
                invoice_url: invoice.invoice_url,
                invoice_id: invoice.id,
                payment_status: 'pending',
                amount: order.total_amount,
            },
        });
    } catch (e: any) {
        console.error('createPayment error:', e);
        return res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

// GET /payments/:orderId — get current payment status, syncing with Xendit if pending
export const getPaymentStatus = async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const { orderId } = req.params;
        const userId = req.user!.id;

        const order = db.prepare(`
            SELECT payment_status, xendit_invoice_url, xendit_invoice_id, total_amount
            FROM orders WHERE id = ? AND customer_id = ?
        `).get(orderId, userId) as any;

        if (!order) return res.status(404).json({ success: false, message: 'Order not found', data: null });

        // If still pending and we have an invoice id, poll Xendit for the latest state.
        // This is what makes the client-side polling fast and reliable even without
        // a webhook URL configured.
        let paymentStatus = order.payment_status;
        if (paymentStatus === 'pending' && order.xendit_invoice_id) {
            try {
                const remote = await xenditGet(`/v2/invoices/${order.xendit_invoice_id}`);
                if (remote?.status === 'PAID' || remote?.status === 'SETTLED') {
                    db.prepare(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`).run(orderId);
                    paymentStatus = 'paid';
                } else if (remote?.status === 'EXPIRED') {
                    db.prepare(`UPDATE orders SET payment_status = 'expired', xendit_invoice_url = NULL WHERE id = ?`).run(orderId);
                    paymentStatus = 'expired';
                }
            } catch (_) { /* ignore poll failures, return DB value */ }
        }

        return res.json({
            success: true,
            data: {
                payment_status: paymentStatus,
                invoice_url: order.xendit_invoice_url,
                invoice_id: order.xendit_invoice_id,
                amount: order.total_amount,
            },
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

// POST /payments/callback — Xendit webhook (public, no auth)
export const xenditCallback = (req: Request, res: Response): any => {
    try {
        const callbackToken = req.headers['x-callback-token'];
        if (XENDIT_CALLBACK_TOKEN && callbackToken !== XENDIT_CALLBACK_TOKEN) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { external_id, status, id: invoiceId } = req.body;
        if (!external_id) return res.status(400).json({ success: false, message: 'Missing external_id' });

        if (status === 'PAID') {
            db.prepare(`UPDATE orders SET payment_status = 'paid', xendit_invoice_id = ? WHERE id = ?`)
                .run(invoiceId, external_id);
        } else if (status === 'EXPIRED') {
            db.prepare(`UPDATE orders SET payment_status = 'expired', xendit_invoice_url = NULL WHERE id = ?`)
                .run(external_id);
        }

        return res.status(200).json({ success: true });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
