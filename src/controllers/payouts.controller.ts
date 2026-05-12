import { Response } from 'express';
import crypto from 'crypto';
import db from '../db';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';

// GET /admin/payouts — list all payouts (admin)
export const listPayouts = (req: AuthRequest, res: Response): any => {
    try {
        const rows = db.prepare(`
            SELECT p.*, u.name as employee_name, u.phone as employee_phone
            FROM payouts p
            JOIN users u ON p.employee_id = u.id
            ORDER BY p.created_at DESC
        `).all();
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const createPayoutSchema = z.object({
    employee_id: z.string().uuid(),
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
    note: z.string().optional(),
});

// POST /admin/payouts — create payout from completed+paid orders in a period
export const createPayout = (req: AuthRequest, res: Response): any => {
    try {
        const data = createPayoutSchema.parse(req.body);

        // Sum up all unpaid payouts (no payout row yet) for completed, paid orders
        const earnedRow = db.prepare(`
            SELECT COALESCE(SUM(washer_payout), 0) as total
            FROM orders
            WHERE assigned_employee_id = ?
              AND status = 'done'
              AND payment_status = 'paid'
              AND completed_at >= ?
              AND completed_at <= ?
              AND deleted_at IS NULL
        `).get(data.employee_id, data.period_start, data.period_end) as any;
        const amount = earnedRow.total;

        if (amount <= 0) {
            return res.status(400).json({ success: false, message: 'No payable earnings in that period', data: null });
        }

        const id = crypto.randomUUID();
        db.prepare(`
            INSERT INTO payouts (id, employee_id, amount, period_start, period_end, status, note)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `).run(id, data.employee_id, amount, data.period_start, data.period_end, data.note || null);

        res.status(201).json({ success: true, data: { id, amount } });
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (e as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /admin/payouts/:id/mark-paid
export const markPayoutPaid = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const result = db.prepare(`
            UPDATE payouts SET status = 'paid', paid_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
        `).run(id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Pending payout not found' });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /employee/payouts — washer's own payout history
export const listMyPayouts = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const rows = db.prepare(`
            SELECT * FROM payouts WHERE employee_id = ?
            ORDER BY created_at DESC
        `).all(userId);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
