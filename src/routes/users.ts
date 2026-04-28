import { Router } from 'express';
import { listUsers, getUserById, updateMe } from '../controllers/users.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/', authMiddleware, requireRole('admin'), listUsers);
router.put('/me', authMiddleware, updateMe);
router.get('/:id', authMiddleware, requireRole('admin'), getUserById);

export default router;
