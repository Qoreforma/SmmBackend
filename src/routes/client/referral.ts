import { Router } from 'express';
import { ReferralController } from '@/controllers/client/ReferralController';
import { authenticate } from '@/middlewares/client/auth';

const router = Router();

const referralController = new ReferralController();

router.use(authenticate);
router.get('/stats', referralController.getReferralStats);
router.get('/', referralController.getReferredUsers);
router.get('/upline', referralController.getReferralUpline);
router.get('/earnings', referralController.getReferralEarnings);
router.get('/terms', referralController.getReferralTerms);

export default router;
