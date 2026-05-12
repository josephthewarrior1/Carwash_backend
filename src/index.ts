import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import servicesRoutes from './routes/services';
import ordersRoutes from './routes/orders';
import usersRoutes from './routes/users';
import uploadRoutes from './routes/upload';
import { createSchema } from './db/schema';
import { seed } from './db/seed';import employeeRoutes from './routes/employee';
import adminFinanceRoutes from './routes/admin_finance';
import paymentRoutes from './routes/payments';
import notificationRoutes from './routes/notifications';
import { startCronJobs } from './utils/cron';
import { normaliseTimestamps } from './utils/dates';


dotenv.config();

createSchema();
seed();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Normalise all known timestamp fields to ISO-8601 UTC ("…Z") on every JSON
// response. SQLite emits "YYYY-MM-DD HH:MM:SS" without a tz designator, and
// both Node's Date and Flutter's DateTime.parse interpret that as local time,
// causing display drift equal to the local tz offset. This middleware walks
// the JSON body and fixes timestamp fields by name before sending.
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body?: any) => {
        if (body && typeof body === 'object') {
            if (Array.isArray(body)) {
                body = body.map(normaliseTimestamps);
            } else {
                if ('data' in body) body.data = normaliseTimestamps(body.data);
                else body = normaliseTimestamps(body);
            }
        }
        return originalJson(body);
    };
    next();
});

// Main Routes
app.use('/auth', authRoutes);
app.use('/services', servicesRoutes);
app.use('/orders', ordersRoutes);
app.use('/users', usersRoutes);
app.use('/upload', uploadRoutes);
app.use('/employee', employeeRoutes);
app.use('/admin', adminFinanceRoutes);
app.use('/payments', paymentRoutes);
app.use('/notifications', notificationRoutes);

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ success: true, message: 'Server is running', data: null });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: 'Something went wrong!', data: null });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    startCronJobs();
});
