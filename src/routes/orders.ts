import { Router } from 'express';
import {
    createOrder,
    getMyOrders,
    getMyOrderDetails,
    getAllOrdersAdmin,
    getOrderDetailsAdmin,
    assignOrderAdmin,
    cancelOrderAdmin,
    getAssignedOrdersEmployee,
    updateOrderStatus
} from '../controllers/orders.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

// Customer
router.post('/', authMiddleware, requireRole('customer'), createOrder);
router.get('/my', authMiddleware, requireRole('customer'), getMyOrders);
router.get('/my/:id', authMiddleware, requireRole('customer'), getMyOrderDetails);

// Employee
router.get('/assigned', authMiddleware, requireRole('employee'), getAssignedOrdersEmployee);
router.patch('/:id/status', authMiddleware, requireRole('employee'), updateOrderStatus);

// Admin
router.get('/', authMiddleware, requireRole('admin'), getAllOrdersAdmin);
router.get('/:id', authMiddleware, requireRole('admin'), getOrderDetailsAdmin);
router.patch('/:id/assign', authMiddleware, requireRole('admin'), assignOrderAdmin);
router.patch('/:id/cancel', authMiddleware, requireRole('admin'), cancelOrderAdmin);

export default router;
