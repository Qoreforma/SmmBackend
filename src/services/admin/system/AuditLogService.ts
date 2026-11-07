import { AuditLogRepository } from "@/repositories/admin/AuditLogRepository";

export class AuditLogService {
  constructor(private auditLogRepository: AuditLogRepository) {}

  async listAuditLogs(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = {};

    if (filters.adminId) {
      query.adminId = filters.adminId;
    }

    if (filters.action) {
      query.action = filters.action;
    }

    if (filters.resource) {
      query.resource = filters.resource;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    const result = await this.auditLogRepository.findWithPagination(
      query,
      page,
      limit
    );

    return {
      auditLogs: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getAuditLogDetails(logId: string) {
    const log = await this.auditLogRepository.findById(logId);
    if (!log) {
      throw new Error("Audit log not found");
    }
    return log;
  }

  async exportAuditLogs(filters: any = {}) {
    const query: any = {};

    if (filters.adminId) query.adminId = filters.adminId;
    if (filters.action) query.action = filters.action;
    if (filters.resource) query.resource = filters.resource;
    if (filters.status) query.status = filters.status;

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    const logs = await this.auditLogRepository.find(query);

    return {
      logs,
      count: logs.length,
      exportedAt: new Date(),
    };
  }
}
