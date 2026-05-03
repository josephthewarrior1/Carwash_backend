import { Request, Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

export const getFinanceSummary = (req: AuthRequest, res: Response): any => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const todayRev = db.prepare(`SELECT COALESCE(SUM(platform_revenue),0) as total FROM orders WHERE status = 'done' AND date(completed_at) = ?`).get(today) as any;
    const weekRev = db.prepare(`SELECT COALESCE(SUM(platform_revenue),0) as total FROM orders WHERE status = 'done' AND completed_at >= ?`).get(weekAgo) as any;
    const monthRev = db.prepare(`SELECT COALESCE(SUM(platform_revenue),0) as total FROM orders WHERE status = 'done' AND completed_at >= ?`).get(monthStart) as any;
    const allTimeRev = db.prepare(`SELECT COALESCE(SUM(platform_revenue),0) as total FROM orders WHERE status = 'done'`).get() as any;

    res.status(200).json({
      success: true,
      data: {
        today: todayRev.total,
        week: weekRev.total,
        month: monthRev.total,
        all_time: allTimeRev.total
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getFinanceChart = (req: AuthRequest, res: Response): any => {
  try {
    const days = 30;
    const results: {date: string; revenue: number}[] = [];
    const stmt = db.prepare(`
      SELECT date(completed_at) as day, SUM(platform_revenue) as rev
      FROM orders
      WHERE status = 'done' AND completed_at >= date('now', ?)
      GROUP BY day
      ORDER BY day
    `);
    const rows = stmt.all(`-${days} days`) as any[];
    // Fill missing days with 0
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const found = rows.find(r => r.day === dateStr);
      results.push({ date: dateStr, revenue: found ? found.rev : 0 });
    }
    res.status(200).json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getPayroll = (req: AuthRequest, res: Response): any => {
  try {
    const rows = db.prepare(`
      SELECT u.id, u.name, COUNT(o.id) as completed_jobs, COALESCE(SUM(o.washer_payout),0) as total_payout
      FROM users u
      LEFT JOIN orders o ON u.id = o.assigned_employee_id AND o.status = 'done'
      WHERE u.role = 'employee'
      GROUP BY u.id
      ORDER BY total_payout DESC
    `).all();
    res.status(200).json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSettings = (req: AuthRequest, res: Response): any => {
  try {
    const rows = db.prepare(`SELECT key, value FROM business_settings`).all();
    const settings: any = {};
    for (const r of rows as any[]) settings[r.key] = r.value;
    res.status(200).json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateSettings = (req: AuthRequest, res: Response): any => {
  try {
    const { commission_rate } = req.body;
    if (commission_rate !== undefined) {
      db.prepare(`INSERT OR REPLACE INTO business_settings (key, value) VALUES ('commission_rate', ?)`).run(String(commission_rate));
    }
    res.status(200).json({ success: true, message: 'Settings updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /admin/transactions – completed orders with revenue breakdown
export const getTransactions = (req: AuthRequest, res: Response): any => {
  try {
    const transactions = db.prepare(`
      SELECT
        o.id,
        o.status,
        o.total_amount,
        o.washer_payout,
        o.platform_revenue,
        o.completed_at,
        o.vehicle_plate,
        c.name as customer_name,
        e.name as washer_name
      FROM orders o
      LEFT JOIN users c ON o.customer_id = c.id
      LEFT JOIN users e ON o.assigned_employee_id = e.id
      WHERE o.status = 'done'
      ORDER BY o.completed_at DESC
    `).all();

    res.status(200).json({ success: true, data: transactions });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

