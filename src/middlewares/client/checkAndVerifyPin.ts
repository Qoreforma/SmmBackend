import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { UserRepository } from "@/repositories/client/UserRepository";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { comparePassword } from "@/utils/cryptography";
import {
  checkPinLockout,
  recordFailedPinAttempt,
  recordSuccessfulPin,
} from "../shared/pinRateLimiter";
import ServiceContainer from "@/services/client/container";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const userRepository = new UserRepository();
const biometricService = ServiceContainer.getBiometricService();
const biometricV2Service = ServiceContainer.getBiometricV2Service();

export const checkAndVerifyPin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id;

    // Check lockout FIRST — before any DB call
    const { locked, remainingSeconds } = await checkPinLockout(
      userId.toString(),
    );
    if (locked) {
      SentryHelper.captureBusinessError(
        "PIN_LOCKOUT",
        "PIN verification locked due to too many failed attempts",
        userId.toString(),
        {
          event: "pin_lockout",
          remainingSeconds,
        },
      );

      return sendErrorResponse(
        res,
        `Transaction PIN locked due to too many failed attempts. Try again in ${remainingSeconds} seconds`,
        HTTP_STATUS.LOCKED,
        ERROR_CODES.ACCOUNT_LOCKED,
        { retryAfter: remainingSeconds },
      );
    }

    const user = await userRepository.findById(userId);

    if (!user) {
      return sendErrorResponse(
        res,
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const pinToken = req.body.pinToken;
    if (pinToken) {
      // If a pinToken is provided, check v2 transaction token first, then fallback to v1 biometric
      let isBiometricValid = false;
      try {
        const isV2Token = await biometricV2Service.consumeTransactionToken(
          userId.toString(),
          pinToken,
        );
        if (isV2Token) {
          isBiometricValid = true;
        } else {
          const v1Result = await biometricService.verifyTransactionBiometric(
            userId.toString(),
            pinToken,
          );
          isBiometricValid = v1Result.success;
        }
      } catch {
        isBiometricValid = false;
      }

      if (!isBiometricValid) {
        recordFailedPinAttempt(userId.toString());

        return sendErrorResponse(
          res,
          "Biometric verification failed",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_CREDENTIALS,
        );
      }
    } else {
      if (!user.pin) {
        return sendErrorResponse(
          res,
          "PIN not set",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (!req.body.pin) {
        return sendErrorResponse(
          res,
          "PIN is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      const isPinValid = await comparePassword(String(req.body.pin), user.pin);

      if (!isPinValid) {
        recordFailedPinAttempt(userId.toString());

        return sendErrorResponse(
          res,
          "Invalid PIN",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INVALID_PIN,
        );
      }
    }

    // Success — clear counters in background (fire-and-forget)
    recordSuccessfulPin(userId.toString());

    req.userData = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const checkAndVerifyPinOptional = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (req.body.pin === undefined && req.body.pinToken === undefined)
      return next();

    const userId = req.user!.id;

    // Same lockout check when PIN or biometric is actually provided
    const { locked, remainingSeconds } = await checkPinLockout(
      userId.toString(),
    );
    if (locked) {
      SentryHelper.captureBusinessError(
        "PIN_LOCKOUT",
        "PIN verification locked due to too many failed attempts (optional flow)",
        userId.toString(),
        {
          event: "pin_lockout_optional",
          remainingSeconds,
        },
      );

      return sendErrorResponse(
        res,
        `Transaction PIN locked due to too many failed attempts. Try again in ${remainingSeconds} seconds`,
        HTTP_STATUS.LOCKED,
        ERROR_CODES.ACCOUNT_LOCKED,
        { retryAfter: remainingSeconds },
      );
    }

    const user = await userRepository.findById(userId);

    if (!user) {
      return sendErrorResponse(
        res,
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const pinToken = req.body.pinToken;
    if (pinToken) {
      // Biometric verification path: v2 transaction token or v1 biometric token
      let isBiometricValid = false;
      try {
        const isV2Token = await biometricV2Service.consumeTransactionToken(
          userId.toString(),
          pinToken,
        );
        if (isV2Token) {
          isBiometricValid = true;
        } else {
          const v1Result = await biometricService.verifyTransactionBiometric(
            userId.toString(),
            pinToken,
          );
          isBiometricValid = v1Result.success;
        }
      } catch {
        isBiometricValid = false;
      }

      if (!isBiometricValid) {
        recordFailedPinAttempt(userId.toString());

        return sendErrorResponse(
          res,
          "Biometric verification failed",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_CREDENTIALS,
        );
      }
    } else {
      if (!user.pin) {
        return sendErrorResponse(
          res,
          "PIN not set",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const isPinValid = await comparePassword(String(req.body.pin), user.pin);

      if (!isPinValid) {
        recordFailedPinAttempt(userId.toString());
        return sendErrorResponse(
          res,
          "Invalid PIN",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INVALID_PIN,
        );
      }
    }

    recordSuccessfulPin(userId.toString());
    req.userData = user;
    next();
  } catch (error) {
    next(error);
  }
};
