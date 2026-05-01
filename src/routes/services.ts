import { Router } from 'express';
import { getAllServices, getServiceById, createService, updateService, getSupplyRequests, updateSupplyRequest, deleteSupplyRequest } from '../controllers/services.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/', getAllServices);
router.get('/supply-requests', authMiddleware, requireRole('admin'), getSupplyRequests);
router.patch('/supply-requests/:id', authMiddleware, requireRole('admin'), updateSupplyRequest);
router.delete('/supply-requests/:id', authMiddleware, requireRole('admin'), deleteSupplyRequest);
router.get('/:id', getServiceById);
router.post('/', authMiddleware, requireRole('admin'), createService);
router.patch('/:id', authMiddleware, requireRole('admin'), updateService);

export default router;
