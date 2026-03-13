import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import crypto from 'crypto';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const registerSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['customer', 'employee']).default('customer'),
    address: z.string().optional(),
    phone: z.string().optional()
});

export const register = (req: Request, res: Response): any => {
    try {
        const data = registerSchema.parse(req.body);

        const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(data.email);
        if (existing) {
            return res.status(400).json({ success: false, message: 'Email already exists', data: null });
        }

        const id = crypto.randomUUID();
        const hashedPassword = bcrypt.hashSync(data.password, 10);

        const stmt = db.prepare(`
      INSERT INTO users (id, name, email, password, role, address, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

        stmt.run(id, data.name, data.email, hashedPassword, data.role, data.address || null, data.phone || null);

        res.status(201).json({ success: true, message: 'User registered successfully', data: { id, name: data.name, email: data.email, role: data.role } });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string()
});

export const login = (req: Request, res: Response): any => {
    try {
        const data = loginSchema.parse(req.body);

        const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(data.email) as any;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials', data: null });
        }

        const isMatch = bcrypt.compareSync(data.password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials', data: null });
        }

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: { id: user.id, name: user.name, email: user.email, role: user.role }
            }
        });

    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
