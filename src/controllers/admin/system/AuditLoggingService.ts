import { AuditLogRepository } from '@/repositories/admin/AuditLogRepository';
import { Types } from 'mongoose';
import logger from '@/logger';
import { v4 as uuidv4 } from 'uuid';
import { SystemProvider } from '@/utils/constants';


// Simple wrapper to log:
// - All wallet operations (debit/credit)
// - All transaction status changes
// - All webhook events
// - All polling attempts
// - All admin actions

export class AuditLoggingService {
  constructor(private auditLogRepository: AuditLogRepository) {}

  
  // Log wallet operation (debit or credit)
  
  async logWalletEvent(data: {
    userId: Types.ObjectId;
    action: 'debit' | 'credit';
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    reason?: string;
    reference?: string;
    transactionId?: string | Types.ObjectId;
    initiatedBy?: 'user' | 'webhook' | 'polling' | 'admin' | 'system' | SystemProvider;
  }): Promise<void> {
    try {
      await this.auditLogRepository.create({
        userId: data.userId,
        action: `wallet_${data.action}`,
        resource: 'Wallet',
        resourceId: data.userId.toString(),
        transactionId: data.transactionId ? new Types.ObjectId(data.transactionId) : undefined,
        transactionReference: data.reference,
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        amountChanged: data.amount,
        reason: data.reason || 'wallet_operation',
        initiatedBy: data.initiatedBy || 'system',
        details: {
          reference: data.reference,
          action: data.action,
        },
        status: 'success',
      });
    } catch (error: any) {
      logger.error('Failed to log wallet event:', error);
    }
  }

  
  // Log transaction status change
  // Called from PaymentReconciliationService, TransactionPollingService, and Webhook processors
  
  async logTransactionEvent(data: {
    userId: Types.ObjectId;
    transactionId: string | Types.ObjectId;
    transactionReference: string;
    action: 'created' | 'status_changed' | 'refunded' | 'timeout' | 'reversed';
    previousStatus?: string;
    newStatus?: string;
    balanceBefore?: number;
    balanceAfter?: number;
    amount?: number;
    provider?: string;
    reason?: string;
    initiatedBy: 'user' | 'webhook' | 'polling' | 'admin' | 'system';
  }): Promise<void> {
    try {
      const actionDetails: any = {
        action: data.action,
      };

      if (data.previousStatus && data.newStatus) {
        actionDetails.statusChange = {
          from: data.previousStatus,
          to: data.newStatus,
        };
      }

      await this.auditLogRepository.create({
        userId: data.userId,
        transactionId: new Types.ObjectId(data.transactionId),
        transactionReference: data.transactionReference,
        action: `transaction_${data.action}`,
        resource: 'Transaction',
        resourceId: data.transactionId.toString(),
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        amountChanged: data.amount,
        previousStatus: data.previousStatus,
        newStatus: data.newStatus,
        reason: data.reason,
        provider: data.provider,
        initiatedBy: data.initiatedBy,
        details: actionDetails,
        status: 'success',
      });
    } catch (error: any) {
      logger.error('Failed to log transaction event:', error);
    }
  }

  
  // Log webhook arrival and processing
  // Called from Webhook processors (SaveHaven, Monnify, Flutterwave)
  
  async logWebhookEvent(data: {
    webhookType?: string;
    provider: string;
    transactionReference?: string;
    transactionId?: string | Types.ObjectId;
    status: 'received' | 'processing' | 'success' | 'failed';
    details?: any;
  }): Promise<void> {
    try {
      await this.auditLogRepository.create({
        transactionId: data.transactionId ? new Types.ObjectId(data.transactionId) : undefined,
        transactionReference: data.transactionReference,
        action: `webhook_${data.status}`,
        resource: 'Webhook',
        resourceId: data.transactionReference || 'unknown',
        provider: data.provider,
        details: {
          webhookType: data.webhookType,
          ...data.details,
        },
        initiatedBy: 'webhook',
        status: data.status === 'failed' ? 'failed' : 'success',
      });
    } catch (error: any) {
      logger.error('Failed to log webhook event:', error);
      // Don't throw
    }
  }

  
  // Log polling attempt
  // Called from TransactionPollingService
  
  async logPollingEvent(data: {
    transactionId: string | Types.ObjectId;
    transactionReference: string;
    pollCount: number;
    status: 'attempt' | 'success' | 'failed' | 'timeout' | 'max_attempts';
    details?: any;
  }): Promise<void> {
    try {
      await this.auditLogRepository.create({
        transactionId: new Types.ObjectId(data.transactionId),
        transactionReference: data.transactionReference,
        action: `polling_${data.status}`,
        resource: 'Polling',
        resourceId: data.transactionId.toString(),
        details: {
          pollCount: data.pollCount,
          ...data.details,
        },
        initiatedBy: 'polling',
        status: data.status === 'failed' ? 'failed' : 'success',
      });
    } catch (error: any) {
      logger.error('Failed to log polling event:', error);
      // Don't throw
    }
  }

  
  // Log admin action (balance adjustment, reversal, etc)
  // Called from Admin methods
  
  async logAdminAction(data: {
    adminId: string | Types.ObjectId | null;
    action: string;
    resource: string;
    resourceId: string;
    userId?: string | Types.ObjectId;
    transactionId?: string | Types.ObjectId;
    amount?: number;
    details?: any;
    reason: string;
    status: 'success' | 'failed';
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.auditLogRepository.create({
        adminId: data.adminId ? new Types.ObjectId(data.adminId) : undefined,
        userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
        transactionId: data.transactionId ? new Types.ObjectId(data.transactionId) : undefined,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        amountChanged: data.amount,
        reason: data.reason,
        details: {
          ...data.details,
          adminAction: true,
        },
        status: data.status,
        errorMessage: data.errorMessage,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        initiatedBy: 'admin',
      });
    } catch (error: any) {
      logger.error('Failed to log admin action:', error);
      // Don't throw
    }
  }

  
  // Create audit trail - link multiple related logs together
  createAuditTrail(): string {
    return uuidv4();
  }

  
  // Get all logs for a user
  async getUserAuditTrail(
    userId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 50
  ) {
    return await this.auditLogRepository.findWithPagination(
      { userId: new Types.ObjectId(userId) },
      page,
      limit,
      { createdAt: -1 }
    );
  }

  
  // Get all logs for a transaction
  async getTransactionAuditTrail(
    transactionId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 100
  ) {
    return await this.auditLogRepository.findWithPagination(
      { transactionId: new Types.ObjectId(transactionId) },
      page,
      limit,
      { createdAt: -1 }
    );
  }

  
  // Get all logs for a transaction reference
  
  async getTransactionByReferenceAuditTrail(
    transactionReference: string,
    page: number = 1,
    limit: number = 100
  ) {
    return await this.auditLogRepository.findWithPagination(
      { transactionReference },
      page,
      limit,
      { createdAt: -1 }
    );
  }

  
  // Get all admin actions for a user
  
  async getUserAdminActions(
    userId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 50
  ) {
    return await this.auditLogRepository.findWithPagination(
      {
        userId: new Types.ObjectId(userId),
        initiatedBy: 'admin',
      },
      page,
      limit,
      { createdAt: -1 }
    );
  }
}