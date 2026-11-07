import { Router } from "express";
import { WebhookController } from "@/controllers/admin/WebhookController";

const router = Router();
const webhookController = new WebhookController();

// SAFEHAVEN
router.post("/savehaven", webhookController.handleSafeHavenWebhook);
router.post("/savehaven/subaccount", webhookController.handleSafeHavenWebhook);

// FLUTTERWAVE
router.post("/flutterwave", webhookController.handleFlutterwaveWebhook);
router.get("/flutterwave/callback", webhookController.handleFlutterwaveCallback);

// MONNIFY
router.post("/monnify", webhookController.handleMonnifyWebhook);
router.get("/monnify/callback", webhookController.handleMonnifyCallback);

// XIXAPAY
router.post("/xixapay", webhookController.handleXixapayWebhook);

// TEXTVERIFIED
router.post("/textverified", webhookController.handleTextverifiedWebhook);

export default router;
