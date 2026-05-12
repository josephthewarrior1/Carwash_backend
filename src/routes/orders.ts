import { Router } from 'express';
import {
    createOrder,
    getMyOrders,
    getMyOrderDetails,
    getAllOrdersAdmin,
    getOrderDetailsAdmin,
    assignOrderAdmin,
    cancelOrderAdmin,
    cancelOrderCustomer,
    acceptOrderEmployee,
    declineOrderEmployee,
    getAssignedOrdersEmployee,
    updateOrderStatus,
    deleteOrderAdmin,
} from '../controllers/orders.controller';
import { getOrderStats } from '../controllers/stats.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

// Customer
router.post('/', authMiddleware, requireRole('customer'), createOrder);
router.get('/my', authMiddleware, requireRole('customer'), getMyOrders);
router.get('/my/:id', authMiddleware, requireRole('customer'), getMyOrderDetails);
router.post('/my/:id/cancel', authMiddleware, requireRole('customer'), cancelOrderCustomer);

// Employee
router.get('/assigned', authMiddleware, requireRole('employee'), getAssignedOrdersEmployee);
router.post('/assigned/:id/accept', authMiddleware, requireRole('employee'), acceptOrderEmployee);
router.post('/assigned/:id/decline', authMiddleware, requireRole('employee'), declineOrderEmployee);
router.patch('/:id/status', authMiddleware, requireRole('employee', 'admin'), updateOrderStatus);

// Admin
router.get('/stats', authMiddleware, requireRole('admin'), getOrderStats);
router.get('/', authMiddleware, requireRole('admin'), getAllOrdersAdmin);
router.get('/:id', authMiddleware, requireRole('admin'), getOrderDetailsAdmin);
router.patch('/:id/assign', authMiddleware, requireRole('admin'), assignOrderAdmin);
router.patch('/:id/cancel', authMiddleware, requireRole('admin'), cancelOrderAdmin);
router.delete('/:id', authMiddleware, requireRole('admin'), deleteOrderAdmin);

export default router;
