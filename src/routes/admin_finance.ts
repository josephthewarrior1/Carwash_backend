import { Router } from 'express';
import { getFinanceSummary, getFinanceChart, getPayroll, getSettings, updateSettings, getTransactions } from '../controllers/admin_finance.controller';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

router.get('/finance', authMiddleware, requireRole('admin'), getFinanceSummary);
router.get('/finance/chart', authMiddleware, requireRole('admin'), getFinanceChart);
router.get('/payroll', authMiddleware, requireRole('admin'), getPayroll);
router.get('/settings', authMiddleware, requireRole('admin'), getSettings);
router.patch('/settings', authMiddleware, requireRole('admin'), updateSettings);
router.get('/transactions', authMiddleware, requireRole('admin'), getTransactions);

export default router;
