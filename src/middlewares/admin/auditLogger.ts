import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuditLog } from "@/models/admin/AuditLog";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import logger from "@/logger";

export const auditLog = (action: string, resource: string) => {
  return async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    // Store original send function
    const originalSend = res.send;

    // Override send function to capture response
    res.send = function (data: any): Response {
      // Log the admin action
      if (req.admin) {
        const status =
          res.statusCode >= 200 && res.statusCode < 300 ? "success" : "failed";

        if (status === "failed") {
          try {
            Sentry.captureMessage(
              `Admin operation failed: ${action} on ${resource}`,
              {
                level: "warning",
                tags: {
                  adminId: req.admin.id.toString(),
                  adminLevel: req.admin.adminLevel,
                  action,
                  resource,
                  statusCode: res.statusCode.toString(),
                },
                contexts: {
                  adminOperation: {
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    resourceId: req.params.id || req.body.id,
                  },
                },
              },
            );
          } catch (sentryErr) {
            logger.error(
              "[Sentry] Failed to capture failed admin operation:",
              sentryErr,
            );
          }
        }

        AuditLog.create({
          adminId: req.admin.id,
          action,
          resource,
          resourceId: req.params.id || req.body.id,
          details: {
            method: req.method,
            path: req.path,
            body: req.body,
            query: req.query,
            params: req.params,
          },
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get("user-agent"),
          status,
          errorMessage: status === "failed" ? JSON.stringify(data) : undefined,
        }).catch((error) => {
          logger.error("Audit log error:", error);
        });
      }

      return originalSend.call(this, data);
    };

    next();
  };
};
