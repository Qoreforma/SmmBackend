import { Request, Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { Admin } from "@/models/admin/Admin";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { AdminJWTPayload } from "@/types/admin";
import logger from "@/logger";
import adminJwtUtil from "@/config/admin/jwt";
import cacheService from "@/services/core/CacheService";
import { isIpInCidrs, getClientIp } from "@/utils/cidr";

export interface AuthenticatedAdminRequest extends Request {
  admin?: any;
  tokenPayload?: AdminJWTPayload;
}

export const adminAuth = async (
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Extract token from authorization header
    const token = adminJwtUtil.extractTokenFromHeader(
      req.headers.authorization,
    );

    if (!token) {
      return sendErrorResponse(
        res,
        "Admin authentication required",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    if (await cacheService.isTokenBlacklisted(token)) {
      return sendErrorResponse(
        res,
        "Session no longer active. Please log in again.",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    // Verify the access token
    let decoded: AdminJWTPayload;
    try {
      decoded = adminJwtUtil.verifyAccessToken(token);
    } catch (error: any) {
      if (error.message === "ADMIN_ACCESS_TOKEN_EXPIRED") {
        return sendErrorResponse(
          res,
          "Admin access token has expired",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_TOKEN,
        );
      } else if (error.message === "ADMIN_ACCESS_TOKEN_INVALID") {
        return sendErrorResponse(
          res,
          "Invalid admin access token",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_TOKEN,
        );
      }
      throw error;
    }

    // Fetch admin from database
    const admin = await Admin.findById(decoded.adminId).select(
      "-password -passwordHistory",
    );

    if (!admin) {
      logger.warn(`Admin not found for token`, { adminId: decoded.adminId });
      return sendErrorResponse(
        res,
        "Admin not found",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Reject tokens that are no longer the admin's active session.
    // Covers logout (activeTokenId set to null) and refresh rotation
    // (activeTokenId moved to the newly-issued token) — both currently
    // update this field correctly, but nothing was checking it here.
    if (admin.activeTokenId !== decoded.tokenId) {
      logger.warn(`Stale/revoked admin token used`, {
        adminId: admin._id,
        tokenId: decoded.tokenId,
      });
      return sendErrorResponse(
        res,
        "Session no longer active. Please log in again.",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    // Check admin account status
    if (admin.status !== "active") {
      try {
        Sentry.captureMessage(
          `Inactive admin access attempt: ${admin.status}`,
          {
            level: "warning",
            tags: {
              adminId: admin._id.toString(),
              adminStatus: admin.status,
              adminLevel: admin.adminLevel,
              route: req.path,
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture inactive admin attempt:",
          sentryErr,
        );
      }

      logger.warn(`Inactive admin attempted access`, {
        adminId: admin._id,
        status: admin.status,
      });
      return sendErrorResponse(
        res,
        `Admin account is ${admin.status}`,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Session-level IP recheck
    // We only enforce this if ENFORCE_DEVICE_TRUST !== "false"
    if (process.env.ENFORCE_DEVICE_TRUST !== "false") {
      const cacheKey = `admin:trusted_ips:${admin._id}`;
      let trustedIps = await cacheService.get<string[]>(cacheKey);
      
      // If missing from cache, fallback to reading from DB
      if (!trustedIps) {
        trustedIps = admin.allowedIpRanges.map((r: any) => r.cidr);
        await cacheService.set(cacheKey, trustedIps, 24 * 60 * 60);
      }

      const clientIp = getClientIp(req);
      if (!isIpInCidrs(clientIp, trustedIps)) {
        logger.warn(`Admin session IP mismatch`, { adminId: admin._id, clientIp });
        
        // Mid-session mismatch: Kill session
        if (decoded.family) {
          await adminJwtUtil.invalidateTokenFamily(decoded.family, admin.id);
        }
        await admin.updateOne({ $unset: { activeTokenId: 1 } });
        
        return sendErrorResponse(
          res,
          "Session no longer active. Please log in again.",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_TOKEN,
        );
      }
    }

    // Check if account is locked
    if (admin.checkAccountLock && admin.checkAccountLock()) {
      try {
        Sentry.captureMessage(`Locked admin access attempt`, {
          level: "warning",
          tags: {
            adminId: admin._id.toString(),
            adminLevel: admin.adminLevel,
            route: req.path,
          },
        });
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture locked admin attempt:",
          sentryErr,
        );
      }

      logger.warn(`Locked admin attempted access`, { adminId: admin._id });
      return sendErrorResponse(
        res,
        "Admin account is temporarily locked due to multiple failed login attempts",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_LOCKED,
      );
    }

    // Update last active timestamp
    if (admin.updateLastActive) {
      await admin.updateLastActive();
    }

    // Attach admin and token payload to request
    req.admin = admin;
    req.admin.adminId = admin._id;
    req.tokenPayload = decoded;

    try {
      Sentry.setUser({
        id: admin._id.toString(),
        email: admin.email,
        username: admin.email,
        adminLevel: admin.adminLevel,
      });
    } catch (err) {
      logger.error("[Sentry] Failed to set admin context:", err);
    }

    next();
  } catch (error: any) {
    logger.error("Admin authentication failed", {
      error: error.message,
      stack: error.stack,
    });

    return sendErrorResponse(
      res,
      "Admin authentication failed",
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.UNAUTHORIZED,
    );
  }
};

// Optional: Middleware to check super admin privileges
export const requireSuperAdmin = (
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.tokenPayload || !adminJwtUtil.isSuperAdmin(req.tokenPayload)) {
    return sendErrorResponse(
      res,
      "Super admin privileges required",
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODES.UNAUTHORIZED,
    );
  }
  next();
};

// Optional: Middleware to check specific admin levels
export const requireAdminLevel = (...allowedLevels: string[]) => {
  return (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    if (
      !req.tokenPayload ||
      !allowedLevels.includes(req.tokenPayload.adminLevel)
    ) {
      return sendErrorResponse(
        res,
        "Insufficient admin privileges",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }
    next();
  };
};

export const requireRole = (allowedRoles: string[]) => {
  return (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.admin) {
        return sendErrorResponse(
          res,
          "Authentication required",
          HTTP_STATUS.UNAUTHORIZED,
        );
      }

      const { adminLevel } = req.admin;

      if (!allowedRoles.includes(adminLevel)) {
        logger.warn("Insufficient role", {
          adminId: req.admin.id,
          adminLevel,
          allowedRoles,
          route: req.route?.path,
        });

        return sendErrorResponse(
          res,
          "Insufficient role to access this resource",
          HTTP_STATUS.FORBIDDEN,
        );
      }

      return next();
    } catch (error) {
      logger.error("Role check error", {
        error: (error as Error).message,
        adminId: req.admin?.id,
      });

      return sendErrorResponse(
        res,
        "Authorization failed",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
};
