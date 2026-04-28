import { Router } from 'express';
import { getAllServices, getServiceById, createService, updateService } from '../controllers/services.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/', getAllServices);
router.get('/:id', getServiceById);
router.post('/', authMiddleware, requireRole('admin'), createService);
router.patch('/:id', authMiddleware, requireRole('admin'), updateService);

export default router;
