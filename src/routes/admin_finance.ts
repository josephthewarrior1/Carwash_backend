import { Router } from 'express';
import { getFinanceSummary, getFinanceChart, getPayroll, getSettings, updateSettings, getTransactions } from '../controllers/admin_finance.controller';
import { listPayouts, createPayout, markPayoutPaid } from '../controllers/payouts.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/finance', authMiddleware, requireRole('admin'), getFinanceSummary);
router.get('/finance/chart', authMiddleware, requireRole('admin'), getFinanceChart);
router.get('/payroll', authMiddleware, requireRole('admin'), getPayroll);
router.get('/settings', authMiddleware, requireRole('admin'), getSettings);
router.patch('/settings', authMiddleware, requireRole('admin'), updateSettings);
router.get('/transactions', authMiddleware, requireRole('admin'), getTransactions);

router.get('/payouts', authMiddleware, requireRole('admin'), listPayouts);
router.post('/payouts', authMiddleware, requireRole('admin'), createPayout);
router.post('/payouts/:id/mark-paid', authMiddleware, requireRole('admin'), markPayoutPaid);

export default router;
