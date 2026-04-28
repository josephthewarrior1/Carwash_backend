import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const BASE_URL = process.env.BASE_URL || 'https://carwash-api.brevonsolutions.com';

// POST /upload  — requires a valid JWT; accepts field name "image"
router.post('/', authMiddleware, upload.single('image'), (req: AuthRequest, res: Response): any => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided', data: null });
    }

    const url = `${BASE_URL}/uploads/${req.file.filename}`;
    return res.status(201).json({ success: true, message: 'Image uploaded successfully', data: { url, filename: req.file.filename } });
});

export default router;
