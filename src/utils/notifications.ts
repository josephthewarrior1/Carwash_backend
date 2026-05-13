import crypto from 'crypto';
import db from '../db';

/**
 * Inserts an in-app notification for a user. Fire-and-forget — failures are
 * logged but do not throw because notifications must never block business logic.
 */
export function notify(opts: {
    userId: string;
    type: string;
    title: string;
    body?: string;
    orderId?: string;
}): void {
    try {
        db.prepare(`
            INSERT INTO notifications (id, user_id, type, title, body, order_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            crypto.randomUUID(),
            opts.userId,
            opts.type,
            opts.title,
            opts.body ?? null,
            opts.orderId ?? null,
        );
    } catch (e) {
        console.error('notify failed:', e);
    }
}

/** Notify every admin user. Useful for events that any admin should see. */
export function notifyAdmins(opts: {
    type: string;
    title: string;
    body?: string;
    orderId?: string;
}): void {
    try {
        const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as { id: string }[];
        for (const a of admins) {
            notify({ ...opts, userId: a.id });
        }
    } catch (e) {
        console.error('notifyAdmins failed:', e);
    }
}
