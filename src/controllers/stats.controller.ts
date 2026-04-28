import { Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

export const getOrderStats = (req: AuthRequest, res: Response): any => {
    try {
        const totalOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders`).get() as any).count as number;
        const pendingOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'pending'`).get() as any).count as number;
        const confirmedOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'`).get() as any).count as number;
        const activeOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status IN ('on_the_way', 'in_progress')`).get() as any).count as number;
        const completedOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'done'`).get() as any).count as number;
        const cancelledOrders = (db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'cancelled'`).get() as any).count as number;

        // Last 7 days: one row per day, count orders scheduled on that day
        const weeklyRaw = db.prepare(`
            SELECT DATE(scheduled_at) as date, COUNT(*) as count
            FROM orders
            WHERE DATE(scheduled_at) >= DATE('now', '-6 days')
            GROUP BY DATE(scheduled_at)
            ORDER BY date ASC
        `).all() as { date: string; count: number }[];

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const weeklyMap: Record<string, number> = {};
        for (const row of weeklyRaw) {
            weeklyMap[row.date] = row.count;
        }

        const weeklyBookings: { day: string; count: number }[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().slice(0, 10);
            weeklyBookings.push({ day: dayNames[d.getDay()], count: weeklyMap[iso] || 0 });
        }

        // Last 6 months: one row per month
        const monthlyRaw = db.prepare(`
            SELECT strftime('%Y-%m', scheduled_at) as month_key, COUNT(*) as count
            FROM orders
            WHERE scheduled_at >= DATE('now', 'start of month', '-5 months')
            GROUP BY month_key
            ORDER BY month_key ASC
        `).all() as { month_key: string; count: number }[];

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthlyMap: Record<string, number> = {};
        for (const row of monthlyRaw) {
            monthlyMap[row.month_key] = row.count;
        }

        const monthlyOrders: { month: string; count: number }[] = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyOrders.push({ month: monthNames[d.getMonth()], count: monthlyMap[key] || 0 });
        }

        res.status(200).json({
            success: true,
            message: 'Order stats retrieved successfully',
            data: {
                totalOrders,
                pendingOrders,
                confirmedOrders,
                activeOrders,
                completedOrders,
                cancelledOrders,
                weeklyBookings,
                monthlyOrders
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
