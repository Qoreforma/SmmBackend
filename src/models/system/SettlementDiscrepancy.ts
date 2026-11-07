import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISettlementDiscrepancy extends Document {
  provider: 'saveHaven' | 'monnify' | 'flutterwave';
  reconciliationDate: Date;
  reconciliationRunId?: Types.ObjectId; // Link back to the run that created this
  // Discrepancy type
  type: 'missing_in_our_db'        // Provider has it, we don't
       | 'missing_in_provider'     // We have it, provider doesn't
       | 'amount_mismatch'         // Both have it but amounts differ
       | 'status_mismatch';        // Both have it but status differs
  // Transaction details
  reference?: string;              // Platform reference if available
  providerReference?: string;      // Provider reference if available
  ourAmount?: number;              // What we recorded
  providerAmount?: number;         // What provider recorded
  ourStatus?: string;              // What we recorded
  providerStatus?: string;         // What provider recorded
  // Resolution
  status: 'detected' | 'investigating' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical';
  investigationNotes?: string;
  resolution?: string;
  rootCause?: string;
  resolvedAt?: Date;
  investigatedBy?: Types.ObjectId;
  meta?: any;
  createdAt: Date;
  updatedAt: Date;
}

const SettlementDiscrepancySchema = new Schema<ISettlementDiscrepancy>(
  {
    provider: {
      type: String,
      enum: ['saveHaven', 'monnify', 'flutterwave'],
      required: true,
      index: true,
    },
    reconciliationDate: { type: Date, required: true, index: true },
    reconciliationRunId: {
      type: Schema.Types.ObjectId,
      ref: 'SettlementReconciliationRun',
      sparse: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'missing_in_our_db',
        'missing_in_provider',
        'amount_mismatch',
        'status_mismatch',
      ],
      required: true,
      index: true,
    },
    reference: { type: String, sparse: true, index: true },
    providerReference: { type: String, sparse: true },
    ourAmount: { type: Number },
    providerAmount: { type: Number },
    ourStatus: { type: String },
    providerStatus: { type: String },
    status: {
      type: String,
      enum: ['detected', 'investigating', 'resolved', 'ignored'],
      default: 'detected',
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    investigationNotes: { type: String },
    resolution: { type: String },
    rootCause: { type: String },
    resolvedAt: { type: Date },
    investigatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

SettlementDiscrepancySchema.index({ provider: 1, reconciliationDate: -1 });
SettlementDiscrepancySchema.index({ provider: 1, status: 1, severity: 1 });
SettlementDiscrepancySchema.index({ type: 1, status: 1 });

export const SettlementDiscrepancy = mongoose.model<ISettlementDiscrepancy>(
  'SettlementDiscrepancy',
  SettlementDiscrepancySchema,
);