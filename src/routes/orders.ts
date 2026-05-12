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
    , deleteOrderAdmin
} from '../controllers/orders.controller';
import { getOrderStats } from '../controllers/stats.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

// Customer
router.post('/', authMiddleware, requireRole('customer'), createOrder);
router.get('/my', authMiddleware, requireRole('customer'), getMyOrders);
router.get('/my/:id', authMiddleware, requireRole('customer'), getMyOrderDetails);

// Employee
router.get('/assigned', authMiddleware, requireRole('employee'), getAssignedOrdersEmployee);
router.patch('/:id/status', authMiddleware, requireRole('employee', 'admin'), updateOrderStatus);

// Admin
router.get('/stats', authMiddleware, requireRole('admin'), getOrderStats);
router.get('/', authMiddleware, requireRole('admin'), getAllOrdersAdmin);
router.get('/:id', authMiddleware, requireRole('admin'), getOrderDetailsAdmin);
router.patch('/:id/assign', authMiddleware, requireRole('admin'), assignOrderAdmin);
router.patch('/:id/cancel', authMiddleware, requireRole('admin'), cancelOrderAdmin);
router.delete('/:id', authMiddleware, requireRole('admin'), deleteOrderAdmin);

export default router;
