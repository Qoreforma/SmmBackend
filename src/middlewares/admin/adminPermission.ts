import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuthenticatedAdminRequest } from "./adminAuth";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import logger from "@/logger";

export const requirePermission = (...permissions: string[]) => {
  return (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.admin) {
      return sendErrorResponse(
        res,
        "Admin authentication required",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Super admin has all permissions
    if (req.admin.permissions.includes("*")) {
      return next();
    }

    // Check if admin has at least one of the required permissions
    const hasPermission = permissions.some((permission) =>
      req.admin.permissions.includes(permission),
    );

    if (!hasPermission) {
      try {
        Sentry.captureMessage(
          `Admin permission denied: required permissions not granted`,
          {
            level: "warning",
            tags: {
              adminId: req.admin.id.toString(),
              adminLevel: req.admin.adminLevel,
              route: req.path,
            },
            contexts: {
              permissionDenial: {
                requiredPermissions: permissions,
                adminPermissions: req.admin.permissions.slice(0, 10), // First 10 for context
              },
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture permission denial:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "Insufficient permissions",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    next();
  };
};

