import { SystemProvider } from '@/utils/constants';
import mongoose, { Schema, Document, Types } from 'mongoose';

// Logs:
// - Wallet debits/credits
// - Transaction status changes
// - Webhook arrivals and processing
// - Polling attempts and results
// - Admin balance adjustments
// - Refunds and reversals
export interface IAuditLog extends Document {
  adminId?: Types.ObjectId;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  createdAt: Date;

  // User/Transaction Context
  userId?: Types.ObjectId;                    // User affected by this action
  transactionId?: Types.ObjectId;             // Transaction being logged
  transactionReference?: string;              
  transactionType?: string;                   //  "DATA", "WITHDRAWAL", "WALLET_TRANSFER"

  // Balance Tracking
  balanceBefore?: number;                     // Wallet balance before operation
  balanceAfter?: number;                      // Wallet balance after operation
  amountChanged?: number;                     // Amount debited/credited

  // Context & Reason
  initiatedBy?: 'user' | 'webhook' | 'polling' | 'admin' | 'system' | SystemProvider;
  provider?: string;                          // "monnify", "flutterwave", "saveHaven", "xixapay"
  reason?: string;                            // "refund", "timeout", "provider_failure", "duplicate_charge"

  // State Management
  previousStatus?: string;                    // For status change logs
  newStatus?: string;                         // For status change logs
  
  // Audit Trail
  auditTrailId?: string;                      // Link related audit logs together
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    // EXISTING FIELDS
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', index: true },
    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String },
    details: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
      index: true,
    },
    errorMessage: { type: String },

    // User/Transaction Context
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    transactionReference: { type: String, index: true },
    transactionType: { type: String, index: true },

    // Balance Tracking
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    amountChanged: { type: Number },

    // Context & Reason
    initiatedBy: {
      type: String,
      index: true,
    },
    provider: { type: String, index: true },
    reason: { type: String },

    // State Management
    previousStatus: { type: String },
    newStatus: { type: String },

    // Audit Trail
    auditTrailId: { type: String, index: true },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// INDEXES FOR QUERYING
AuditLogSchema.index({ adminId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, createdAt: -1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });                    
AuditLogSchema.index({ initiatedBy: 1, createdAt: -1 });             
AuditLogSchema.index({ provider: 1, createdAt: -1 });                
AuditLogSchema.index({ action: 1, userId: 1, createdAt: -1 });       

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);