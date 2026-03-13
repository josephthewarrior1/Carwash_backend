import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export function requireRole(role: 'admin' | 'employee' | 'customer') {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized: User not authenticated', data: null });
            return;
        }

        if (req.user.role !== role) {
            res.status(403).json({ success: false, message: `Forbidden: Requires ${role} role`, data: null });
            return;
        }

        next();
    };
}
