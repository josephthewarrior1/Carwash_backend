import { Router } from 'express';
import { getAllServices, getServiceById, createService } from '../controllers/services.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/', getAllServices);
router.get('/:id', getServiceById);
router.post('/', authMiddleware, requireRole('admin'), createService);

export default router;
