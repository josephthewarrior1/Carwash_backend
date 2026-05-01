import { Router } from 'express';
import { getProfile, getEarnings, getInventory, requestSupply, batchRequest, getMySupplyRequests, deleteSupplyRequest } from '../controllers/employee.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/profile', authMiddleware, requireRole('employee'), getProfile);
router.get('/earnings', authMiddleware, requireRole('employee'), getEarnings);
router.get('/inventory', authMiddleware, requireRole('employee'), getInventory);
router.post('/inventory/request', authMiddleware, requireRole('employee'), requestSupply);
router.post('/inventory/batch-request', authMiddleware, requireRole('employee'), batchRequest);
router.get('/supply-requests', authMiddleware, requireRole('employee'), getMySupplyRequests);
router.delete('/supply-requests/:batchId', authMiddleware, requireRole('employee'), deleteSupplyRequest);

export default router;