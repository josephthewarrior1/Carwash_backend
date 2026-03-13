import { Request, Response } from 'express';
import db from '../db';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';

const createOrderSchema = z.object({
    service_id: z.string().uuid(),
    vehicle_plate: z.string().min(1),
    vehicle_type: z.enum(['sedan', 'suv', 'truck', 'motorcycle']),
    location_address: z.string().min(1),
    location_lat: z.number().optional(),
    location_lng: z.number().optional(),
    scheduled_at: z.string().datetime(),
    notes: z.string().optional()
});

export const createOrder = (req: AuthRequest, res: Response): any => {
    try {
        const data = createOrderSchema.parse(req.body);
        const userId = req.user!.id;
        const orderId = crypto.randomUUID();

        // Check if service exists and vehicle type matches
        const service = db.prepare(`SELECT * FROM services WHERE id = ?`).get(data.service_id) as any;
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found', data: null });
        }
        if (service.vehicle_type !== data.vehicle_type) {
            return res.status(400).json({ success: false, message: `Service only applicable for ${service.vehicle_type}`, data: null });
        }

        const tx = db.transaction(() => {
            const stmt = db.prepare(`
        INSERT INTO orders (id, customer_id, service_id, vehicle_plate, vehicle_type, location_address, location_lat, location_lng, scheduled_at, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);
            stmt.run(orderId, userId, data.service_id, data.vehicle_plate, data.vehicle_type, data.location_address, data.location_lat || null, data.location_lng || null, data.scheduled_at, data.notes || null);

            const historyStmt = db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'pending', ?, 'Order created')
      `);
            historyStmt.run(crypto.randomUUID(), orderId, userId);
            return orderId;
        });

        const resultId = tx();
        const newOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(resultId);

        res.status(201).json({ success: true, message: 'Order created successfully', data: newOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getMyOrders = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const orders = db.prepare(`SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC`).all(userId);
        res.status(200).json({ success: true, message: 'Orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getMyOrderDetails = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND customer_id = ?`).get(id, userId);
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
        let query = `SELECT * FROM orders WHERE 1=1`;
        const params: any[] = [];

        if (status) {
            query += ` AND status = ?`;
            params.push(status);
        }
        if (date) {
            query += ` AND date(scheduled_at) = date(?)`;
            params.push(date);
        }
        query += ` ORDER BY created_at DESC`;

        const orders = db.prepare(query).all(...params);
        res.status(200).json({ success: true, message: 'Orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getOrderDetailsAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

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

        if (order.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending orders can be assigned', data: null });
        }

        const employee = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'employee'`).get(data.employee_id);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found', data: null });
        }

        const tx = db.transaction(() => {
            db.prepare(`UPDATE orders SET assigned_employee_id = ?, status = 'confirmed' WHERE id = ?`).run(data.employee_id, id);
            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'confirmed', ?, ?)
      `).run(crypto.randomUUID(), id, adminId, `Assigned to employee ${data.employee_id}`);
        });

        tx();
        const updatedOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

        res.status(200).json({ success: true, message: 'Order assigned successfully', data: updatedOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const cancelOrderAdmin = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const adminId = req.user!.id;

        const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null });
        }

        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Only pending or confirmed orders can be cancelled', data: null });
        }

        const tx = db.transaction(() => {
            db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(id);
            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, 'cancelled', ?, 'Cancelled by Admin')
      `).run(crypto.randomUUID(), id, adminId);
        });

        tx();
        const updatedOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

        res.status(200).json({ success: true, message: 'Order cancelled successfully', data: updatedOrder });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getAssignedOrdersEmployee = (req: AuthRequest, res: Response): any => {
    try {
        const employeeId = req.user!.id;
        const orders = db.prepare(`SELECT * FROM orders WHERE assigned_employee_id = ? ORDER BY scheduled_at ASC`).all(employeeId);
        res.status(200).json({ success: true, message: 'Assigned orders retrieved successfully', data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const validTransitions: Record<string, string[]> = {
    'confirmed': ['on_the_way'],
    'on_the_way': ['in_progress'],
    'in_progress': ['done'],
    'done': []
};

const updateStatusSchema = z.object({
    status: z.enum(['on_the_way', 'in_progress', 'done']),
    notes: z.string().optional()
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

        // Validation transition
        const allowedNextStatuses = validTransitions[order.status] || [];
        if (!allowedNextStatuses.includes(data.status)) {
            return res.status(400).json({ success: false, message: `Invalid status transition from ${order.status} to ${data.status}`, data: null });
        }

        const tx = db.transaction(() => {
            db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(data.status, id);
            db.prepare(`
        INSERT INTO order_status_history (id, order_id, status, changed_by_user_id, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), id, data.status, userId, data.notes || null);
        });

        tx();
        const updatedOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

        res.status(200).json({ success: true, message: `Order status updated to ${data.status}`, data: updatedOrder });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
