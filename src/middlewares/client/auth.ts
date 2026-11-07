import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Sentry from "@/config/sentry";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { CacheService } from "@/services/core/CacheService";
import { IUser, User } from "@/models/core/User";
import logger from "@/logger";

const cacheService = new CacheService();

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role?: string };
  userData?: IUser;
}

const BLOCKED_STATUSES = ["suspended", "fraudulent"];

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendErrorResponse(
        res,
        "No token provided",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }

    const token = authHeader.substring(7);

    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not defined");

    const isBlacklisted = await cacheService.exists(
      CACHE_KEYS.TOKEN_BLACKLIST(token),
    );
    if (isBlacklisted) {
      return sendErrorResponse(
        res,
        "Token has been revoked",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;

    let userStatus: string | null = null;
    try {
      const cached = await cacheService.get<any>(
        CACHE_KEYS.USER_PROFILE(decoded.id),
      );
      if (cached) {
        userStatus = cached.status;
      } else {
        const user = await User.findById(decoded.id).select("status").lean();
        userStatus = user?.status || null;
      }
    } catch {}

    if (userStatus && BLOCKED_STATUSES.includes(userStatus)) {
      try {
        Sentry.captureMessage(`Blocked account access attempt: ${userStatus}`, {
          level: "warning",
          tags: {
            userId: decoded.id,
            accountStatus: userStatus,
            route: req.path,
          },
        });
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture blocked account attempt:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "Account is not accessible",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_SUSPENDED,
      );
    }

    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };

    try {
      Sentry.setUser({
        id: decoded.id,
        email: decoded.email,
        username: decoded.email,
      });
    } catch (sentryErr) {
      logger.error("[Sentry] Failed to set user context:", sentryErr);
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return sendErrorResponse(
        res,
        "Token expired",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.TOKEN_EXPIRED,
      );
    }
    return sendErrorResponse(
      res,
      "Invalid token",
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_TOKEN,
    );
  }
};
