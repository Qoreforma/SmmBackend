import { Request, Response, NextFunction } from "express";
import { WebhookService } from "@/services/WebhookService";
import logger from "@/logger";
import { HTTP_STATUS } from "@/utils/constants";
import { SafeHavenWebhookProcessor } from "@/services/client/webhooks/SafeHavenWebhookProcessor";
import { MonnifyWebhookProcessor } from "@/services/client/webhooks/MonnifyWebhookProcessor";
import { MonnifyWebhookService } from "@/services/client/webhooks/MonnifyWebhookService";
import { FlutterwaveWebhookProcessor } from "@/services/client/webhooks/FlutterwaveWebhookProcessor";
import { FlutterwaveWebhookService } from "@/services/client/webhooks/FlutterwaveWebhookService";
import { SaveHavenWebhookService } from "@/services/client/webhooks/SaveHavenWebhookService";
import { XixapayWebhookProcessor } from "@/services/client/webhooks/Xixapaywebhookprocessor";
import { XixapayWebhookService } from "@/services/client/webhooks/Xixapaywebhookservice";
import ServiceContainer from "@/services/client/container";
import { Transaction } from "@/models/wallet/Transaction";
import { TRANSACTION_TYPES } from "@/utils/constants";

export class WebhookController {
  private webhookService: WebhookService;
  private saveHavenProcessor: SafeHavenWebhookProcessor;
  private saveHavenService: SaveHavenWebhookService;
  private monnifyProcessor: MonnifyWebhookProcessor;
  private monnifyService: MonnifyWebhookService;
  private flutterwaveProcessor: FlutterwaveWebhookProcessor;
  private flutterwaveService: FlutterwaveWebhookService;
  private xixapayProcessor: XixapayWebhookProcessor;
  private xixapayService: XixapayWebhookService;

  constructor() {
    this.webhookService = new WebhookService();
    this.saveHavenProcessor = new SafeHavenWebhookProcessor();
    this.saveHavenService = new SaveHavenWebhookService(
      ServiceContainer.getNotificationService(),
    );
    this.monnifyProcessor = new MonnifyWebhookProcessor();
    this.monnifyService = new MonnifyWebhookService();
    this.flutterwaveProcessor = new FlutterwaveWebhookProcessor();
    this.flutterwaveService = new FlutterwaveWebhookService();
    this.xixapayProcessor = new XixapayWebhookProcessor();
    this.xixapayService = new XixapayWebhookService(
      ServiceContainer.getNotificationService(),
    );
  }

  // Handle SafeHaven webhook callbacks
  handleSafeHavenWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("SafeHaven webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
      });



      if (!this.saveHavenProcessor.validatePayload(req.body)) {
        logger.error("SafeHaven webhook: Invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.saveHavenProcessor.process(req.body);
      await this.saveHavenService.processWebhook(webhookData);

      logger.info("SafeHaven webhook processed successfully", {
        eventType: req.body?.type,
        status: webhookData.status,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("SafeHaven webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  // Handle Monnify webhook callbacks
  handleMonnifyWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Monnify webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
      });

      const signature = req.headers["monnify-signature"] as string;
      const rawBody = (req as any).rawBody;

      if (!signature || !rawBody) {
        logger.warn("Monnify webhook: Missing signature header or raw body");
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const isValidSignature = this.monnifyProcessor.validateSignature(
        rawBody,
        signature,
      );

      if (!isValidSignature) {
        logger.error("Monnify webhook: Invalid signature", {
          signature: signature.substring(0, 10) + "...",
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      if (!this.monnifyProcessor.validatePayload(req.body)) {
        logger.error("Monnify webhook: Invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.monnifyProcessor.process(req.body);
      await this.monnifyService.processWebhook(webhookData);

      logger.info("Monnify webhook processed successfully", {
        eventType: req.body?.eventType,
        status: webhookData.status,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Monnify webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  handleMonnifyCallback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const { paymentReference } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(
      `${frontendUrl}/payment/status?ref=${paymentReference}`,
    );
  };

  // Handle Xixapay webhook callbacks
  handleXixapayWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Xixapay webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
      });

      const signature = req.headers["x-xixapay-signature"] as string;
      const rawBody = (req as any).rawBody;

      if (!this.xixapayProcessor.validateSignature(rawBody, signature)) {
        logger.warn("Xixapay webhook: invalid signature");
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      if (!this.xixapayProcessor.validatePayload(req.body)) {
        logger.error("Xixapay webhook: invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.xixapayProcessor.process(req.body);
      await this.xixapayService.processWebhook(webhookData);

      logger.info("Xixapay webhook processed successfully", {
        transactionId: req.body?.transaction_id,
        status: webhookData.status,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Xixapay webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  // Handle Flutterwave webhook callbacks
  handleFlutterwaveWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Flutterwave webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        eventType: req.body?.type,
        webhookId: req.body?.id,
        transactionId: req.body?.data?.id,
      });

      const signature = req.headers["flutterwave-signature"] as string;
      const rawBody = (req as any).rawBody;

      if (process.env.FLUTTERWAVE_VALIDATE_SIGNATURE !== "false") {
        if (!signature || !rawBody) {
          logger.warn(
            "Flutterwave webhook: Missing signature header or raw body",
          );
          return res.status(HTTP_STATUS.OK).json({ status: "success" });
        }

        const isValidSignature = this.flutterwaveProcessor.validateSignature(
          rawBody,
          signature,
        );

        if (!isValidSignature) {
          logger.error("Flutterwave webhook: Invalid signature", {
            signature: signature.substring(0, 10) + "...",
          });
          return res.status(HTTP_STATUS.OK).json({ status: "success" });
        }
      }

      if (!this.flutterwaveProcessor.validatePayload(req.body)) {
        logger.error("Flutterwave webhook: Invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.flutterwaveProcessor.process(req.body);
      await this.flutterwaveService.processWebhook(webhookData);

      logger.info("Flutterwave webhook processed successfully", {
        eventType: req.body?.type,
        reference: webhookData.reference,
        status: webhookData.status,
        transactionId: webhookData.providerTransactionId,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Flutterwave webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  handleFlutterwaveCallback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const { status, tx_ref, transaction_id } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(
      `${frontendUrl}/payment/status?ref=${tx_ref}&status=${status}&txId=${transaction_id}`,
    );
  };

  // Handle Textverified webhook callbacks (Real-time SMS OTP delivery)
  handleTextverifiedWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Textverified webhook endpoint hit", {
        event: req.body?.event,
        id: req.body?.id,
        ip: req.ip,
      });

      const signature = (req.headers["x-webhook-signature"] || req.headers["x-signature"]) as string;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      const textverifiedService = ServiceContainer.getTextverifiedService();

      if (signature) {
        const isValid = textverifiedService.verifyWebhookSignature(signature, rawBody);
        if (!isValid) {
          logger.error("Textverified webhook: Invalid signature", {
            signature: signature.substring(0, 15) + "...",
          });
          return res.status(HTTP_STATUS.OK).json({ status: "success" });
        }
      }

      const event = req.body?.event;
      if (event === "v2.sms.received") {
        const data = req.body?.data || {};
        const reservationId = data.reservationId;
        const parsedCode = data.parsedCode || "";
        const smsContent = data.smsContent || "";
        const from = data.from || "Textverified";
        const to = data.to;

        if (reservationId) {
          const tx = await Transaction.findOne({
            status: "pending",
            type: TRANSACTION_TYPES.NUMBER_RENTAL,
            $or: [
              { "meta.providerOrderId": reservationId },
              { providerReference: reservationId },
              ...(to ? [{ "meta.phoneNumber": to }] : []),
            ],
          });

          if (tx) {
            await Transaction.findByIdAndUpdate(tx._id, {
              status: "success",
              "polling.stoppedAt": new Date(),
              "polling.stopReason": "webhook",
              meta: {
                ...tx.meta,
                otpCode: parsedCode || tx.meta?.otpCode,
                sms: [
                  ...(tx.meta?.sms || []),
                  {
                    sender: from,
                    text: smsContent,
                    code: parsedCode,
                    date: data.createdAt || new Date(),
                  },
                ],
                receivedAt: new Date(),
                providerStatus: "verificationCompleted",
              },
            });

            logger.info("Textverified webhook: Transaction updated with OTP", {
              reference: tx.reference,
              reservationId,
              otpCode: parsedCode,
            });
          } else {
            logger.warn("Textverified webhook: No matching pending transaction found", {
              reservationId,
              to,
            });
          }
        }
      }

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Textverified webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };
}
