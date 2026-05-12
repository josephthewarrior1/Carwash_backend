import { Router } from 'express';
import { createPayment, getPaymentStatus, xenditCallback } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

// Xendit webhook — must be before /:orderId to avoid param matching
router.post('/callback', xenditCallback);

// Customer payment routes
router.post('/:orderId', authMiddleware, requireRole('customer'), createPayment);
router.get('/:orderId', authMiddleware, requireRole('customer'), getPaymentStatus);

export default router;
