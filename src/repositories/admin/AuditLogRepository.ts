import { BaseRepository } from '../BaseRepository';
import { AuditLog, IAuditLog } from '@/models/admin/AuditLog';
import { FilterQuery } from 'mongoose';

export class AuditLogRepository extends BaseRepository<IAuditLog> {
  constructor() {
    super(AuditLog);
  }

  async findByAdmin(adminId: string, page: number = 1, limit: number = 20) {
    return await this.findWithPagination({ adminId } as FilterQuery<IAuditLog>, page, limit);
  }

  async findByAction(action: string, page: number = 1, limit: number = 20) {
    return await this.findWithPagination({ action } as FilterQuery<IAuditLog>, page, limit);
  }

  async findByResource(resource: string, page: number = 1, limit: number = 20) {
    return await this.findWithPagination({ resource } as FilterQuery<IAuditLog>, page, limit);
  }
}
