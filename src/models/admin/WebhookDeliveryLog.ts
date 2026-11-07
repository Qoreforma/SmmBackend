import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWebhookDeliveryLog extends Document {
  transactionId: Types.ObjectId;
  transactionReference: string;
  
  provider: 'saveHaven' | 'monnify' | 'flutterwave';
  providerTransactionId?: string;
  
  // Webhook timing
  expectedArrivalBy?: Date;        // Expected webhook deadline
  receivedAt?: Date;               // When webhook actually arrived
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  
  // Status tracking
  status: 'awaiting' | 'received' | 'processing' | 'success' | 'failed' | 'timeout';
  
  // Processing details
  webhookPayload?: any;            // Store the webhook data
  processingError?: string;
  retryCount: number;
  lastRetryAt?: Date;
  
  // Refund tracking
  refundIssued: boolean;           // Was refund issued for missing webhook?
  refundedAt?: Date;
  refundTransactionId?: Types.ObjectId;
  refundReason?: string;
  
  meta?: any;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookDeliveryLogSchema = new Schema<IWebhookDeliveryLog>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
    transactionReference: { type: String, required: true, index: true },
    
    provider: {
      type: String,
      enum: ['saveHaven', 'monnify', 'flutterwave'],
      required: true,
      index: true,
    },
    providerTransactionId: { type: String, index: true },
    
    expectedArrivalBy: { type: Date },
    receivedAt: { type: Date },
    processingStartedAt: { type: Date },
    processingCompletedAt: { type: Date },
    
    status: {
      type: String,
      enum: ['awaiting', 'received', 'processing', 'success', 'failed', 'timeout'],
      default: 'awaiting',
      index: true,
    },
    
    webhookPayload: { type: Schema.Types.Mixed },
    processingError: { type: String },
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date },
    
    refundIssued: { type: Boolean, default: false },
    refundedAt: { type: Date },
    refundTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    refundReason: { type: String },
    
    meta: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

WebhookDeliveryLogSchema.index({ provider: 1, createdAt: -1 });
WebhookDeliveryLogSchema.index({ status: 1, createdAt: -1 });
WebhookDeliveryLogSchema.index({ expectedArrivalBy: 1, status: 1 });  
WebhookDeliveryLogSchema.index({ refundIssued: 1, status: 1 });      

export const WebhookDeliveryLog = mongoose.model<IWebhookDeliveryLog>(
  'WebhookDeliveryLog',
  WebhookDeliveryLogSchema
);