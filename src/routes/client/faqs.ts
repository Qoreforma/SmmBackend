import { Router } from 'express';
import { FAQController } from '@/controllers/client/FAQController';

const router = Router();
const faqController = new FAQController();


router.get('/', faqController.getAllFAQs);

router.get('/categories', faqController.getAllCategories);

router.get('/search', faqController.searchFAQs);

router.get('/categories/:slug', faqController.getFAQsByCategory);

router.get('/:id', faqController.getFAQById);

export default router;