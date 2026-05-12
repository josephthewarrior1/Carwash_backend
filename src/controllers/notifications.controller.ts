import { Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

export const listNotifications = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const rows = db.prepare(`
            SELECT * FROM notifications WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 50
        `).all(userId);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const markNotificationRead = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;
        db.prepare(`
            UPDATE notifications SET read_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(id, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const markAllNotificationsRead = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        db.prepare(`
            UPDATE notifications SET read_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND read_at IS NULL
        `).run(userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
