import { Request, Response } from 'express';
import db from '../db';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth';

// GET /employee/profile
export const getProfile = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const user = db.prepare(`SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?`).get(userId) as any;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // total / completed jobs from orders
    const totalJobs = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE assigned_employee_id = ?`).get(userId) as any;
    const completedJobs = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE assigned_employee_id = ? AND status = 'done'`).get(userId) as any;

    // total earnings from completed orders
    const earningsRow = db.prepare(`SELECT COALESCE(SUM(washer_payout),0) as total FROM orders WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid'`).get(userId) as any;

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        joined_date: user.created_at,
        total_jobs: totalJobs.count,
        completed_jobs: completedJobs.count,
        earnings: earningsRow.total,
        // future: rating, specialties
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /employee/earnings
export const getEarnings = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const dateParam = req.query.date as string | undefined; // YYYY-MM-DD

    // If a date is specified, filter by completed_at on that day
    if (dateParam) {
      const dayEarnings = db.prepare(`
        SELECT COALESCE(SUM(washer_payout),0) as total
        FROM orders
        WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND date(completed_at) = ?
      `).get(userId, dateParam) as any;

      const dayCount = db.prepare(`
        SELECT COUNT(*) as c
        FROM orders
        WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND date(completed_at) = ?
      `).get(userId, dateParam) as any;

      return res.status(200).json({
        success: true,
        data: {
          date: dateParam,
          earnings: dayEarnings.total,
          completed_count: dayCount.c,
        }
      });
    }

    // Otherwise return today / week / month as before, but using completed_at
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const todayEarnings = db.prepare(`
      SELECT COALESCE(SUM(washer_payout),0) as total FROM orders
      WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND date(completed_at) = ?
    `).get(userId, today) as any;

    const weekEarnings = db.prepare(`
      SELECT COALESCE(SUM(washer_payout),0) as total FROM orders
      WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND completed_at >= ?
    `).get(userId, weekAgo) as any;

    const monthEarnings = db.prepare(`
      SELECT COALESCE(SUM(washer_payout),0) as total FROM orders
      WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND completed_at >= ?
    `).get(userId, monthStart) as any;

    const completedToday = db.prepare(`
      SELECT COUNT(*) as c FROM orders
      WHERE assigned_employee_id = ? AND status = 'done' AND payment_status = 'paid' AND date(completed_at) = ?
    `).get(userId, today) as any;

    res.status(200).json({
      success: true,
      data: {
        today_earnings: todayEarnings.total,
        week_earnings: weekEarnings.total,
        month_earnings: monthEarnings.total,
        completed_today: completedToday.c,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /employee/inventory
export const getInventory = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const items = db.prepare(`SELECT * FROM inventory_items WHERE employee_id = ?`).all(userId);
    res.status(200).json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// POST /employee/inventory/request
export const requestSupply = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const { item_name, quantity_requested } = req.body;
    if (!item_name || !quantity_requested) {
      return res.status(400).json({ success: false, message: 'item_name and quantity_requested are required' });
    }
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO supply_requests (id, employee_id, item_name, quantity_requested) VALUES (?, ?, ?, ?)`).run(id, userId, item_name, quantity_requested);
    res.status(201).json({ success: true, message: 'Supply request submitted', data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// POST /employee/inventory/batch-request
export const batchRequest = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const { items } = req.body; // [{ item_name, quantity_requested }]
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array required' });
    }

    const batchId = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO supply_requests (id, employee_id, item_name, quantity_requested, batch_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const item of items) {
        stmt.run(crypto.randomUUID(), userId, item.item_name, item.quantity_requested ?? 1, batchId);
      }
    });
    insertMany();

    res.status(201).json({ success: true, message: 'Batch request submitted', data: { batch_id: batchId } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error', data: null });
  }
};

// GET /employee/supply-requests – get own supply requests (grouped by batch)
export const getMySupplyRequests = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const rows = db.prepare(`
      SELECT sr.*, u.name as employee_name
      FROM supply_requests sr
      JOIN users u ON sr.employee_id = u.id
      WHERE sr.employee_id = ?
      ORDER BY sr.created_at DESC
    `).all(userId) as any[];

    // Group into batches
    const batches: Record<string, any> = {};
    for (const row of rows) {
      const batchId = row.batch_id ?? row.id;
      if (!batches[batchId]) {
        batches[batchId] = {
          batch_id: batchId,
          status: row.status,
          created_at: row.created_at,
          items: [],
        };
      }
      batches[batchId].items.push({
        item_name: row.item_name,
        quantity_requested: row.quantity_requested,
      });
    }

    res.status(200).json({ success: true, data: Object.values(batches) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// DELETE /employee/supply-requests/:batchId – remove a batch (only if pending)
export const deleteSupplyRequest = (req: AuthRequest, res: Response): any => {
  try {
    const userId = req.user!.id;
    const { batchId } = req.params;

    // Only allow deletion of pending batches to avoid accidental clean-up after approval
    const batch = db.prepare(`
      SELECT * FROM supply_requests WHERE batch_id = ? AND employee_id = ?
    `).all(batchId, userId) as any[];

    if (batch.length === 0) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    // Check if any item is not pending
    const nonPending = batch.filter((r: any) => r.status !== 'pending');
    if (nonPending.length > 0) {
      return res.status(400).json({ success: false, message: 'Only pending batches can be deleted' });
    }

    db.prepare(`DELETE FROM supply_requests WHERE batch_id = ? AND employee_id = ?`).run(batchId, userId);
    res.status(200).json({ success: true, message: 'Batch deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};