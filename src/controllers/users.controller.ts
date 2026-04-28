import { Response } from 'express';
import db from '../db';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';

export const listUsers = (req: AuthRequest, res: Response): any => {
    try {
        const { role } = req.query;
        let query = `SELECT id, name, email, role, address, phone, avatar_url, created_at FROM users WHERE 1=1`;
        const params: any[] = [];

        if (role) {
            query += ` AND role = ?`;
            params.push(role);
        }
        query += ` ORDER BY created_at DESC`;

        const users = db.prepare(query).all(...params);
        res.status(200).json({ success: true, message: 'Users retrieved successfully', data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getUserById = (req: AuthRequest, res: Response): any => {
    try {
        const { id } = req.params;
        const user = db.prepare(
            `SELECT id, name, email, role, address, phone, avatar_url, created_at FROM users WHERE id = ?`
        ).get(id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', data: null });
        }

        res.status(200).json({ success: true, message: 'User retrieved successfully', data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const updateMeSchema = z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    avatar_url: z.string().optional().nullable(),
});

export const updateMe = (req: AuthRequest, res: Response): any => {
    try {
        const userId = req.user!.id;
        const data = updateMeSchema.parse(req.body);
        const fields = Object.entries(data).filter(([, v]) => v !== undefined);

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update', data: null });
        }

        const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
        const values = fields.map(([, v]) => v);

        db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...values, userId);
        const updated = db.prepare(
            `SELECT id, name, email, role, address, phone, avatar_url, created_at FROM users WHERE id = ?`
        ).get(userId);

        res.status(200).json({ success: true, message: 'Profile updated successfully', data: updated });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
