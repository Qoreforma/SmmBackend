import mongoose, { Schema, Document } from 'mongoose';

export interface ISettlementReconciliationRun extends Document {
  provider: 'saveHaven' | 'monnify' | 'flutterwave';
  date: Date;
  status: 'completed' | 'failed' | 'partial';
  startedAt: Date;
  completedAt?: Date;
  totalProviderTransactions: number;
  totalOurTransactions: number;
  matched: number;
  missingInOurDb: number;
  missingInProvider: number;
  amountMismatches: number;
  discrepanciesCreated: number;
  providerApiReachable: boolean;
  errorMessage?: string;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SettlementReconciliationRunSchema = new Schema<ISettlementReconciliationRun>(
  {
    provider: {
      type: String,
      enum: ['saveHaven', 'monnify', 'flutterwave'],
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['completed', 'failed', 'partial'],
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
    },
    totalProviderTransactions: {
      type: Number,
      required: true,
      default: 0,
    },
    totalOurTransactions: {
      type: Number,
      required: true,
      default: 0,
    },
    matched: {
      type: Number,
      required: true,
      default: 0,
    },
    missingInOurDb: {
      type: Number,
      required: true,
      default: 0,
    },
    missingInProvider: {
      type: Number,
      required: true,
      default: 0,
    },
    amountMismatches: {
      type: Number,
      required: true,
      default: 0,
    },
    discrepanciesCreated: {
      type: Number,
      required: true,
      default: 0,
    },
    providerApiReachable: {
      type: Boolean,
      required: true,
      default: false,
    },
    errorMessage: {
      type: String,
    },
    durationMs: {
      type: Number,
    },
  },
  { timestamps: true },
);

// Indexes for common queries
SettlementReconciliationRunSchema.index({ provider: 1, date: -1 });
SettlementReconciliationRunSchema.index({ provider: 1, status: 1 });
SettlementReconciliationRunSchema.index({ date: -1 });
SettlementReconciliationRunSchema.index({ createdAt: -1 });

export const SettlementReconciliationRun = mongoose.model<ISettlementReconciliationRun>(
  'SettlementReconciliationRun',
  SettlementReconciliationRunSchema,
);