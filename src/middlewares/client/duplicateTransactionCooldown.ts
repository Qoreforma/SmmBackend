/**
 * duplicateTransactionCooldown.ts
 *
 * Prevents users from firing identical bill-payment requests within a 1-minute
 * window. Two mechanisms run in parallel:
 *
 *   1. In-flight lock  — refuses a new request if one with the SAME fingerprint
 *      is currently pending/processing in the DB (created in the last 15 min).
 *      This catches the classic "user taps twice" race where the wallet-lock
 *      has already been released.
 *
 *   2. Cooldown key   — after any bill-payment attempt (success OR failure) the
 *      fingerprint is locked in Redis for 60 s. Any retry within that window is
 *      rejected immediately with a clear message including the remaining seconds.
 *
 * Usage (in a route file):
 *
 *   import { billPaymentCooldown } from "@/middlewares/client/duplicateTransactionCooldown";
 *
 *   router.post(
 *     "/",
 *     rateLimiter(10, 60000),
 *     validateRequest(electricitySchema),
 *     checkServiceAvailability(TRANSACTION_TYPES.ELECTRICITY),
 *     checkAndVerifyPin,
 *     walletLock,
 *     billPaymentCooldown("electricity", (req) => `${req.body.number}:${req.body.amount}`),
 *     billPaymentController.purchaseElectricity,
 *   );
 */

import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { CacheService } from "@/services/core/CacheService";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Transaction } from "@/models/wallet/Transaction";
import logger from "@/logger";

const cacheService = new CacheService();

/** How long (seconds) the cooldown key lives in Redis after an attempt. */
const COOLDOWN_TTL_SECONDS = 60;

/** Look back this many minutes when checking the DB for an in-flight order. */
const IN_FLIGHT_LOOKBACK_MINUTES = 2;

const COOLDOWN_PREFIX = "txn_cooldown:";

/**
 * Factory that returns an Express middleware enforcing:
 *   - 1-min Redis cooldown on the derived fingerprint
 *   - in-flight DB check (pending/processing status in last 2 min for same target & amount)
 *
 * @param serviceType  Short label used in the Redis key (e.g. "electricity")
 * @param getTarget    Function that extracts the unique target string from the
 *                     request (e.g. meter number + amount, phone + dataPlan).
 *                     Return null/undefined to skip the check for that request.
 */
export function billPaymentCooldown(
  serviceType: string,
  getTarget: (req: AuthRequest) => string | null | undefined,
) {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        next();
        return;
      }

      const target = getTarget(req);
      if (!target) {
        next();
        return;
      }

      const cooldownKey = `${COOLDOWN_PREFIX}${serviceType}:${userId}:${target}`;

      // ── 1. Check Redis cooldown key ──────────────────────────────────────
      const ttlRemaining = await cacheService.ttl(cooldownKey);
      // getTtl returns -2 if key doesn't exist, -1 if no TTL, else seconds
      if (ttlRemaining > 0) {
        logger.warn(`[BillPaymentCooldown] Cooldown active for ${serviceType}`, {
          userId,
          target,
          ttlRemaining,
        });

        sendErrorResponse(
          res,
          `Please wait ${ttlRemaining} second${ttlRemaining !== 1 ? "s" : ""} before retrying this transaction.`,
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_TRANSACTION,
        );
        return;
      }

      // ── 2. Check DB for an in-flight (pending/processing) order ─────────
      const [targetIdentifier, amountOrPlan] = target.split(":").map((s) => s?.trim());
      if (targetIdentifier) {
        const since = new Date(
          Date.now() - IN_FLIGHT_LOOKBACK_MINUTES * 60 * 1000,
        );

        const query: any = {
          userId,
          status: { $in: ["pending", "processing"] },
          createdAt: { $gte: since },
          // We store the target in meta — best-effort match; missing meta is fine.
          $or: [
            { "meta.meterNumber": targetIdentifier },    // electricity
            { "meta.phone": targetIdentifier },          // airtime / data / intl
            { "meta.smartCardNumber": targetIdentifier },// cable TV
            { "meta.customerId": targetIdentifier },     // betting
            { "meta.number": targetIdentifier },         // education / other
          ],
        };

        // If amount was part of the fingerprint, require amount to match as well
        if (amountOrPlan) {
          const numAmount = parseFloat(amountOrPlan);
          if (!isNaN(numAmount) && numAmount > 0) {
            query.amount = numAmount;
          }
        }

        const inFlight = await Transaction.findOne(query)
          .select("_id reference status createdAt")
          .lean()
          .exec();

        if (inFlight) {
          logger.warn(`[BillPaymentCooldown] In-flight order detected for ${serviceType}`, {
            userId,
            target,
            existingReference: inFlight.reference,
          });

          sendErrorResponse(
            res,
            "A similar transaction is still being processed. Please wait a moment before retrying.",
            HTTP_STATUS.CONFLICT,
            ERROR_CODES.DUPLICATE_TRANSACTION,
          );
          return;
        }
      }

      // ── 3. Set the cooldown key so the next attempt within 60 s is blocked
      // We set it NOW (before the handler runs) so a rapid double-tap is
      // blocked even if the first attempt is still mid-flight.
      await cacheService.acquireLock(cooldownKey, "1", COOLDOWN_TTL_SECONDS);

      next();
    } catch (err) {
      // If Redis is down, log but don't block the transaction
      logger.error("[BillPaymentCooldown] Error in cooldown middleware — allowing request", err);
      next();
    }
  };
}
