import { Request, Response } from 'express';
import db from '../db';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';

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
    duration: z.number().int().positive().default(60),
    vehicle_type: z.enum(['sedan', 'suv', 'truck', 'motorcycle']),
    image_url: z.string().optional().nullable(),
});

export const createService = (req: Request, res: Response): any => {
    try {
        const data = createServiceSchema.parse(req.body);
        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO services (id, name, description, price, duration, vehicle_type, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.name, data.description || null, data.price, data.duration, data.vehicle_type, data.image_url || null);

        res.status(201).json({ success: true, message: 'Service created successfully', data: { id, ...data } });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors});
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

const updateServiceSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    price: z.number().positive().optional(),
    duration: z.number().int().positive().optional(),
    vehicle_type: z.enum(['sedan', 'suv', 'truck', 'motorcycle']).optional(),
    image_url: z.string().optional().nullable(),
});

export const updateService = (req: Request, res: Response): any => {
    try {
        const { id } = req.params;
        const service = db.prepare(`SELECT * FROM services WHERE id = ?`).get(id);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found', data: null });
        }

        const data = updateServiceSchema.parse(req.body);
        const fields = Object.entries(data).filter(([, v]) => v !== undefined);

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update', data: null });
        }

        const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
        const values = fields.map(([, v]) => v);

        db.prepare(`UPDATE services SET ${setClauses} WHERE id = ?`).run(...values, id);
        const updated = db.prepare(`SELECT * FROM services WHERE id = ?`).get(id);

        res.status(200).json({ success: true, message: 'Service updated successfully', data: updated });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: 'Validation error', data: (error as any).errors});
        }
        res.status(500).json({ success: false, message: 'Internal server error', data: null });
    }
};

   // GET /services/supply-requests (Admin only)
export const getSupplyRequests = (req: AuthRequest, res: Response): any => {
  try {
    // Get all requests, grouped by batch_id (fallback to id if batch_id is null)
    const rows = db.prepare(`
      SELECT sr.*, u.name as employee_name
      FROM supply_requests sr
      JOIN users u ON sr.employee_id = u.id
      ORDER BY sr.created_at DESC
    `).all() as any[];

    // Group into batches
    const batches: Record<string, any> = {};
    for (const row of rows) {
      const batchId = row.batch_id ?? row.id; // use own id if no batch_id
      if (!batches[batchId]) {
        batches[batchId] = {
          batch_id: batchId,
          employee_name: row.employee_name,
          employee_id: row.employee_id,
          status: row.status, // will be same for all items in batch
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

// PATCH /services/supply-requests/:id (Admin only)
export const updateSupplyRequest = (req: AuthRequest, res: Response): any => {
  try {
    const { id } = req.params; // this is batch_id
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const updateStmt = db.prepare(`UPDATE supply_requests SET status = ? WHERE batch_id = ?`);
    updateStmt.run(status, id);
    // Also update if there are rows with null batch_id but id = batch_id (old single items)
    db.prepare(`UPDATE supply_requests SET status = ? WHERE id = ? AND batch_id IS NULL`).run(status, id);

    res.status(200).json({ success: true, message: `Batch ${status}` });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// DELETE /services/supply-requests/:id (Admin only)
export const deleteSupplyRequest = (req: AuthRequest, res: Response): any => {
  try {
    const { id } = req.params; // batch_id

    // Delete all rows with this batch_id
    const result = db.prepare(`DELETE FROM supply_requests WHERE batch_id = ?`).run(id);
    if (result.changes === 0) {
      // fallback: maybe it's a single item with id = batch_id
      db.prepare(`DELETE FROM supply_requests WHERE id = ?`).run(id);
    }
    res.status(200).json({ success: true, message: 'Batch deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};