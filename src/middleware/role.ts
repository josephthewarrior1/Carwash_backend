import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export function requireRole(...roles: ('admin' | 'employee' | 'customer')[]) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized: User not authenticated', data: null });
            return;
        }

        if (!roles.includes(req.user.role as any)) {
            res.status(403).json({ success: false, message: `Forbidden: Requires one of [${roles.join(', ')}]`, data: null });
            return;
        }

        next();
    };
}
