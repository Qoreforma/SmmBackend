import { Router } from 'express';
import { DepositController } from '@/controllers/client/DepositController';
import { authenticate } from '@/middlewares/client/auth';
import { validateRequest, validateQuery } from '@/middlewares/shared/validation';
import { createDepositRequestSchema, depositWebhookSchema, depositQuerySchema } from '@/validations/client/depositValidation';

const router = Router();


const depositController = new DepositController();

router.post('/webhook', validateRequest(depositWebhookSchema), depositController.handleDepositWebhook);
router.use(authenticate);
router.post('/request', validateRequest(createDepositRequestSchema), depositController.createDepositRequest);
router.get('/', validateQuery(depositQuerySchema), depositController.getDeposits);
router.get('/:depositId', depositController.getDepositById);

export default router;
