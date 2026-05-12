import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} from '../controllers/notifications.controller';

const router = Router();
router.get('/', authMiddleware, listNotifications);
router.post('/read-all', authMiddleware, markAllNotificationsRead);
router.post('/:id/read', authMiddleware, markNotificationRead);

export default router;
