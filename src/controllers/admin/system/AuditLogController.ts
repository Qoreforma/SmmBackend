import { Request, Response } from "express";
import { AuditLogService } from "@/services/admin/system/AuditLogService";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class AuditLogController {
  private auditLogService: AuditLogService;

  constructor() {
    this.auditLogService = AdminServiceContainer.getAuditLogService()
  }

  listAuditLogs = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.auditLogService.listAuditLogs(
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,
        "Audit logs retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getAuditLogDetails = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.auditLogService.getAuditLogDetails(id);
      return sendSuccessResponse(res, result, "Audit log details retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

  exportAuditLogs = async (req: Request, res: Response) => {
    try {
      const filters = req.query;
      const result = await this.auditLogService.exportAuditLogs(filters);
      return sendSuccessResponse(res, result, "Audit logs exported");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };
}
