import { Router } from 'express';
import { AdminDashboardController } from '@/controllers/admin/system/DashboardController';
import { adminAuth } from '@/middlewares/admin/adminAuth';

const router = Router();
const dashboardController = new AdminDashboardController();

// All routes require admin authentication
router.use(adminAuth);

router.get('/stats', dashboardController.getDashboardStats);
router.get('/revenue-chart', dashboardController.getRevenueChart);
router.get('/profit-chart', dashboardController.getProfitChart);
router.get('/comparison', dashboardController.getComparison);
router.get('/transaction-distribution', dashboardController.getTransactionTypeDistribution);

export default router;
