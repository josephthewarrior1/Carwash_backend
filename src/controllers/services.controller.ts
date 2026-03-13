import { Request, Response } from 'express';
import db from '../db';
import crypto from 'crypto';
import { z } from 'zod';

export const getAllServices = (req: Request, res: Response) => {
    try {
        const services = db.prepare(`SELECT * FROM services`).all();
        res.status(200).json({ success: true, message: 'Services retrieved successfully', data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

export const getServiceById = (req: Request, res: Response): any => {
    try {
        const { id } = req.params;
        const service = db.prepare(`SELECT * FROM services WHERE id = ?`).get(id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found', data: null });
        }

        res.status(200).json({ success: true, message: 'Service retrieved successfully', data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const createServiceSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.number().positive(),
    vehicle_type: z.enum(['sedan', 'suv', 'truck', 'motorcycle'])
});

export const createService = (req: Request, res: Response): any => {
    try {
        const data = createServiceSchema.parse(req.body);
        const id = crypto.randomUUID();

        const stmt = db.prepare(`
      INSERT INTO services (id, name, description, price, vehicle_type)
      VALUES (?, ?, ?, ?, ?)
    `);

        stmt.run(id, data.name, data.description || null, data.price, data.vehicle_type);

        res.status(201).json({ success: true, message: 'Service created successfully', data: { id, ...data } });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors });
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};
