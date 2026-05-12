import { Request, Response } from 'express';
import db from '../db';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { syncPaymentStatus } from '../utils/xendit';
import { notify } from '../utils/notifications';

const createOrderSchema = z.object({
    service_id: z.string().uuid(),
    vehicle_plate: z.string().min(1),
    vehicle_type: z.enum(['sedan', 'suv', 'truck', 'motorcycle']),
    location_address: z.string().min(1),
    location_lat: z.number().optional(),
    location_lng: z.number().optional(),
    scheduled_at: z.string().datetime().refine(
        (v) => new Date(v).getTime() > Date.now(),
        'scheduled_at must be in the future',
    ),
    notes: z.string().optional()
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Detect time overlap within ±1 hour window. */
function hasTimeOverlap(scheduledAt: string, other: string): boolean {
    const diffHours = Math.abs(
        new Date(scheduledAt).getTime() - new Date(other).getTime(),
    ) / (1000 * 60 * 60);
    return diffHours < 1;
}

export const createOrder = (req: AuthRequest, res: Response): any => {
    try {
        const data = createOrderSchema.parse(req.body);
        const userId = req.user!.id;
        const orderId = crypto.randomUUID();

        // Check if service exists (and is still active) and vehicle type matches
        const service = db.prepare(
            `SELECT * FROM services WHERE id = ? AND COALESCE(is_active, 1) = 1`
        ).get(data.service_id) as any;
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found or no longer available', data: null });
        }
        if (service.vehicle_type !== data.vehicle_type) {
            return res.status(400).json({ success: false, message: `Service only applicable for ${service.vehicle_type}`, data: null });
        }

        // Prevent same vehicle being booked twice for the same time slot
        const activePlateOrders = db.prepare(`
            SELECT scheduled_at FROM orders
            WHERE vehicle_plate = ?
              AND status NOT IN ('done', 'cancelled', 'no_show', 'failed')
              AND deleted_at IS NULL
        `).all(data.vehicle_plate) as { scheduled_at: string }[];
        const plateConflict = activePlateOrders.find(o =>
            hasTimeOverlap(data.scheduled_at, o.scheduled_at)
        );
        if (plateConflict) {
            return res.status(400).json({
                success: false,
                message: 'This vehicle is already booked within an hour of that time',
                data: null,
            });
        }

        const settingsRow = db.prepare(`SELECT value FROM business_settings WHERE key = 'commission_rate'`).get() as any;
        const commissionRate = settingsRow ? parseFloat(settingsRow.value) : 0.7;
        const washerPayout = service.price * commissionRate;
        const platformRevenue = service.price - washerPayout;

        const tx = db.transaction(() => {
            const stmt = db.prepare(`
        INSERT INTO orders (id, customer_id, service_id, vehicle_plate, vehicle_type, location_address, location_lat, location_lng, scheduled_at, notes, status, total_amount, washer_payout, platform_revenue)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `);
            stmt.run(orderId, userId, data.service_id, data.vehicle_plate, data.vehicle_type, data.location_address, data.location_lat || null, data.location_lng || null, data.scheduled_at, data.notes || null, service.price, washerPayout, platformRevenue);

            const historyStmt = db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'pending', ?, 'Order created')
      `);
            historyStmt.run(crypto.randomUUID(), orderId, userId);
            return orderId;
        });

        const resultId = tx();
        const newOrder = db.prepare(`
            SELECT o.*, c.name as customer_name
            FROM orders o
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.id = ?
        `).get(resultId);

        res.status(201).json({ success: true, message: 'Order created successfully', data: newOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).issues ?? (error as any).errors });
        }
        console.error('createOrder error:', error?.message ?? error);
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getMyOrders = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const orders = db.prepare(`
            SELECT o.*, s.name as service_name, c.name as customer_name
            FROM orders o
            LEFT JOIN services s ON o.service_id = s.id
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.customer_id = ?
            ORDER BY o.created_at DESC
        `).all(userId);
        res.status(200).json({ success: true, message: 'Orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getMyOrderDetails = async (req: AuthRequest, res: Response): Promise<any> => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;

        // Sync payment status with Xendit before reading, so the order row reflects
        // the latest state (covers cases where the webhook isn't configured).
        const orderId = Array.isArray(id) ? id[0] : id;
        await syncPaymentStatus(orderId);

        const order = db.prepare(`
            SELECT
                o.*,
                s.name as service_name,
                c.name as customer_name,
                w.name as washer_name,
                w.phone as washer_phone,
                w.avatar_url as washer_avatar
            FROM orders o
            LEFT JOIN services s ON o.service_id = s.id
            LEFT JOIN users c ON o.customer_id = c.id
            LEFT JOIN users w ON o.assigned_employee_id = w.id
            WHERE o.id = ? AND o.customer_id = ?
        `).get(id, userId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        const history = db.prepare(`SELECT * FROM order_status_history WHERE order_id = ? ORDER BY changed_at ASC`).all(id);

        res.status(200).json({ success: true, message: 'Order retrieved successfully', data: { order, history } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getAllOrdersAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { status, date } = req.query;
        let query = `
            SELECT o.*, c.name as customer_name
            FROM orders o
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE 1=1
        `;
        const params: any[] = [];

        if (status) {
            query += ` AND o.status = ?`;
            params.push(status);
        }
        if (date) {
            query += ` AND date(o.scheduled_at) = date(?)`;
            params.push(date);
        }
        query += ` ORDER BY o.created_at DESC`;

        const orders = db.prepare(query).all(...params);
        res.status(200).json({ success: true, message: 'Orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getOrderDetailsAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const order = db.prepare(`
            SELECT
                o.*,
                s.name as service_name,
                c.name as customer_name,
                c.phone as customer_phone,
                w.name as washer_name,
                w.phone as washer_phone,
                w.avatar_url as washer_avatar
            FROM orders o
            LEFT JOIN services s ON o.service_id = s.id
            LEFT JOIN users c ON o.customer_id = c.id
            LEFT JOIN users w ON o.assigned_employee_id = w.id
            WHERE o.id = ?
        `).get(id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        const history = db.prepare(`SELECT * FROM order_status_history WHERE order_id = ? ORDER BY changed_at ASC`).all(id);

        res.status(200).json({ success: true, message: 'Order retrieved successfully', data: { order, history } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const assignOrderSchema = z.object({
    employee_id: z.string().uuid()
});

export const assignOrderAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const data = assignOrderSchema.parse(req.body);
        const adminId = req.user!.id;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        if (!['pending', 'assigned'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Only pending or assigned orders can be (re)assigned', data: null });
        }

        const employee = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'employee'`).get(data.employee_id) as any;
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found', data: null });
        }

        // Capacity check: this washer must not have a conflicting active job within ±1h
        const washerActive = db.prepare(`
            SELECT id, scheduled_at FROM orders
            WHERE assigned_employee_id = ?
              AND id != ?
              AND status IN ('assigned', 'confirmed', 'on_the_way', 'in_progress')
              AND deleted_at IS NULL
        `).all(data.employee_id, id) as { id: string; scheduled_at: string }[];
        const washerConflict = washerActive.find(o =>
            hasTimeOverlap(order.scheduled_at, o.scheduled_at)
        );
        if (washerConflict) {
            return res.status(409).json({
                success: false,
                message: `${employee.name} already has an overlapping job within an hour`,
                data: null,
            });
        }

        const previousAssignee = order.assigned_employee_id as string | null;
        const auditNote = previousAssignee && previousAssignee !== data.employee_id
            ? `Reassigned from ${previousAssignee} to ${employee.name}`
            : `Assigned to ${employee.name}`;

        const tx = db.transaction(() => {
            db.prepare(`UPDATE orders SET assigned_employee_id = ?, status = 'assigned' WHERE id = ?`)
              .run(data.employee_id, id);
            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'assigned', ?, ?)
      `).run(crypto.randomUUID(), id, adminId, auditNote);
        });

        try {
            tx();
        } catch (txErr: any) {
            console.error('assignOrderAdmin tx failed:', txErr.message);
            throw txErr;
        }
        notify({
            userId: data.employee_id,
            type: 'order_assigned',
            title: 'New job assigned',
            body: `You have a new wash scheduled — please accept or decline.`,
            orderId: id as string,
        });
        const updatedOrder = db.prepare(`
            SELECT o.*, c.name as customer_name
            FROM orders o
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.id = ?
        `).get(id);

        res.status(200).json({ success: true, message: 'Order assigned successfully', data: updatedOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).issues ?? (error as any).errors });
        }
        console.error('assignOrderAdmin error:', error?.message ?? error);
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const cancelOrderAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const adminId = req.user!.id;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        if (!['pending', 'assigned', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Only pre-arrival orders can be cancelled', data: null });
        }

        const tx = db.transaction(() => {
            db.prepare(`
                UPDATE orders
                SET status = 'cancelled',
                    cancelled_by = ?,
                    cancellation_reason = ?
                WHERE id = ?
            `).run(adminId, reason, id);
            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'cancelled', ?, ?)
      `).run(crypto.randomUUID(), id, adminId, reason ? `Admin: ${reason}` : 'Cancelled by Admin');
        });

        tx();
        notify({
            userId: order.customer_id,
            type: 'order_cancelled',
            title: 'Order cancelled',
            body: reason ?? 'Your order has been cancelled by Admin.',
            orderId: id as string,
        });
        const updatedOrder = db.prepare(`
            SELECT o.*, c.name as customer_name
            FROM orders o
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.id = ?
        `).get(id);

        res.status(200).json({ success: true, message: 'Order cancelled successfully', data: updatedOrder });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getAssignedOrdersEmployee = (req: AuthRequest, res: Response): any => {
    try {
        const employeeId = req.user!.id;
        const orders = db.prepare(`
            SELECT
                o.*,
                s.name as service_name,
                s.duration as service_duration,
                c.name as customer_name,
                c.phone as customer_phone,
                c.avatar_url as customer_avatar
            FROM orders o
            LEFT JOIN services s ON o.service_id = s.id
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.assigned_employee_id = ?
            ORDER BY o.scheduled_at ASC
        `).all(employeeId);
        res.status(200).json({ success: true, message: 'Assigned orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const validTransitions: Record<string, string[]> = {
    'confirmed': ['on_the_way', 'no_show', 'failed'],
    'on_the_way': ['in_progress', 'no_show', 'failed'],
    'in_progress': ['done', 'failed'],
    'done': [],
    'no_show': [],
    'failed': [],
};

const MIN_WASH_DURATION_MINUTES = 5;

const updateStatusSchema = z.object({
    status: z.enum(['on_the_way', 'in_progress', 'done', 'no_show', 'failed']),
    notes: z.string().optional(),
    before_photo_url: z.string().url().optional(),
    after_photo_url: z.string().url().optional(),
    reason: z.string().optional(),
});

export const updateOrderStatus = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const data = updateStatusSchema.parse(req.body);
        const userId = req.user!.id;
        const userRole = req.user!.role;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        if (userRole === 'employee' && order.assigned_employee_id !== userId) {
            return res.status(403).json({ success: false, message: 'Forbidden: Order is not assigned to you', data: null });
        }
        if (userRole === 'admin' && !['confirmed', 'on_the_way', 'in_progress'].includes(order.status)) {
            return res.status(400).json({ success: false, message: `Cannot update status from ${order.status}`, data: null });
        }

        // Validate transition
        const allowedNextStatuses = validTransitions[order.status] || [];
        if (!allowedNextStatuses.includes(data.status)) {
            return res.status(400).json({ success: false, message: `Invalid status transition from ${order.status} to ${data.status}`, data: null });
        }

        // Quality: minimum elapsed wash duration before marking done
        if (data.status === 'done' && order.started_at) {
            const elapsedMinutes =
                (Date.now() - new Date(order.started_at).getTime()) / 1000 / 60;
            if (elapsedMinutes < MIN_WASH_DURATION_MINUTES) {
                return res.status(400).json({
                    success: false,
                    message: `Wash must run for at least ${MIN_WASH_DURATION_MINUTES} minutes (only ${Math.round(elapsedMinutes)} min elapsed)`,
                    data: null,
                });
            }
        }

        const tx = db.transaction(() => {
            if (data.status === 'done') {
                db.prepare(`
                    UPDATE orders
                    SET status = ?,
                        completed_at = CURRENT_TIMESTAMP,
                        after_photo_url = COALESCE(?, after_photo_url)
                    WHERE id = ?
                `).run(data.status, data.after_photo_url ?? null, id);
            } else if (data.status === 'in_progress') {
                db.prepare(`
                    UPDATE orders
                    SET status = ?,
                        started_at = CURRENT_TIMESTAMP,
                        before_photo_url = COALESCE(?, before_photo_url)
                    WHERE id = ?
                `).run(data.status, data.before_photo_url ?? null, id);
            } else if (data.status === 'no_show' || data.status === 'failed') {
                db.prepare(`
                    UPDATE orders
                    SET status = ?,
                        cancellation_reason = ?
                    WHERE id = ?
                `).run(data.status, data.reason ?? null, id);
            } else {
                db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(data.status, id);
            }

            const auditNote = data.notes
                ?? data.reason
                ?? (data.status === 'on_the_way' ? 'Washer en route'
                  : data.status === 'in_progress' ? 'Wash started'
                  : data.status === 'done' ? 'Wash completed'
                  : null);

            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), id, data.status, userId, auditNote);
        });

        tx();
        notify({
            userId: order.customer_id,
            type: `order_${data.status}`,
            title: data.status === 'on_the_way' ? 'Your washer is on the way'
                : data.status === 'in_progress' ? 'Your wash has started'
                : data.status === 'done' ? 'Your wash is complete'
                : data.status === 'no_show' ? 'Washer could not reach you'
                : 'Order update',
            body: data.notes ?? data.reason ?? undefined,
            orderId: id as string,
        });
        const updatedOrder = db.prepare(`
            SELECT o.*, c.name as customer_name
            FROM orders o
            LEFT JOIN users c ON o.customer_id = c.id
            WHERE o.id = ?
        `).get(id);

        res.status(200).json({ success: true, message: `Order status updated to ${data.status}`, data: updatedOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

// DELETE /orders/:id – Admin only. Soft-deletes; blocks if paid.
export const deleteOrderAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.payment_status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete a paid order — refund via Xendit first',
            });
        }
        // Soft delete — preserves history, financial audit trail, and any
        // outstanding Xendit invoice references.
        db.prepare(`
            UPDATE orders
            SET deleted_at = CURRENT_TIMESTAMP,
                status = CASE WHEN status IN ('done','cancelled','no_show','failed') THEN status ELSE 'cancelled' END
            WHERE id = ?
        `).run(id);
        res.status(200).json({ success: true, message: 'Order archived' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// ─── Customer self-cancel ──────────────────────────────────────────────────
export const cancelOrderCustomer = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

        const order = db.prepare(
            `SELECT * FROM orders WHERE id = ? AND customer_id = ?`
        ).get(id, userId) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }
        if (!['pending', 'assigned'].includes(order.status)) {
            return res.status(400).json({
                success: false,
                message: 'You can only cancel before the washer accepts the job',
                data: null,
            });
        }

        const tx = db.transaction(() => {
            db.prepare(`
                UPDATE orders
                SET status = 'cancelled', cancelled_by = ?, cancellation_reason = ?
                WHERE id = ?
            `).run(userId, reason, id);
            db.prepare(`
                INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
                VALUES (?, ?, 'cancelled', ?, ?)
            `).run(crypto.randomUUID(), id, userId, reason ? `Customer: ${reason}` : 'Cancelled by customer');
        });
        tx();

        if (order.assigned_employee_id) {
            notify({
                userId: order.assigned_employee_id,
                type: 'order_cancelled',
                title: 'Job cancelled by customer',
                body: reason ?? undefined,
                orderId: id as string,
            });
        }

        return res.status(200).json({ success: true, message: 'Order cancelled', data: null });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

// ─── Washer accept / decline ───────────────────────────────────────────────
export const acceptOrderEmployee = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) return res.status(404).json({ success: false, message: 'Order not found', data: null });
        if (order.assigned_employee_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not your job to accept', data: null });
        }
        if (order.status !== 'assigned') {
            return res.status(400).json({ success: false, message: `Cannot accept from ${order.status}`, data: null });
        }

        const tx = db.transaction(() => {
            db.prepare(`UPDATE orders SET status = 'confirmed', accepted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
            db.prepare(`
                INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
                VALUES (?, ?, 'confirmed', ?, 'Washer accepted')
            `).run(crypto.randomUUID(), id, userId);
        });
        tx();

        notify({
            userId: order.customer_id,
            type: 'order_confirmed',
            title: 'Your washer has confirmed',
            body: 'Your booking is locked in — you\'ll get an update when they\'re on the way.',
            orderId: id as string,
        });
        return res.status(200).json({ success: true, message: 'Order accepted', data: null });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const declineOrderEmployee = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) return res.status(404).json({ success: false, message: 'Order not found', data: null });
        if (order.assigned_employee_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not your job to decline', data: null });
        }
        if (order.status !== 'assigned') {
            return res.status(400).json({ success: false, message: `Cannot decline from ${order.status}`, data: null });
        }

        const tx = db.transaction(() => {
            // Send back to pending so admin can reassign
            db.prepare(`UPDATE orders SET status = 'pending', assigned_employee_id = NULL WHERE id = ?`).run(id);
            db.prepare(`
                INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
                VALUES (?, ?, 'pending', ?, ?)
            `).run(crypto.randomUUID(), id, userId, reason ? `Washer declined: ${reason}` : 'Washer declined');
        });
        tx();
        return res.status(200).json({ success: true, message: 'Order declined', data: null });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
