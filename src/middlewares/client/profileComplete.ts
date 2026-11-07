import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuthRequest } from "@/middlewares/client/auth";
import { UserRepository } from "@/repositories/client/UserRepository";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";

const userRepository = new UserRepository();

export const profileComplete = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id;
    const user = await userRepository.findById(userId);

    if (!user) {
      return sendErrorResponse(
        res,
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if required profile fields are completed
    if (
      !user.firstname ||
      !user.lastname ||
      !user.phone ||
      !user.emailVerifiedAt
    ) {
      const missingFields = [];
      if (!user.firstname) missingFields.push("firstname");
      if (!user.lastname) missingFields.push("lastname");
      if (!user.phone) missingFields.push("phone");
      if (!user.emailVerifiedAt) missingFields.push("emailVerifiedAt");

      try {
        Sentry.captureMessage(`User attempted action with incomplete profile`, {
          level: "info",
          tags: {
            userId,
            event: "incomplete_profile_attempt",
            route: req.path,
          },
          contexts: {
            profileCompletion: {
              missingFields,
              fieldCount: missingFields.length,
            },
          },
        });
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture incomplete profile:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "Please complete your profile before performing this action",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.PROFILE_INCOMPLETE,
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
