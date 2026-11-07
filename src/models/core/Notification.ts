import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INotification extends Document {
  legacyNotificationId?: string;
  type: string;
  notifiableType: 'User' | 'Admin';
  notifiableId: Types.ObjectId;
  title: string;
  message: string;
  data?: any;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    legacyNotificationId: { type: String, index: true,sparse: true  },
    type: { type: String, required: true },
    notifiableType: { type: String, enum: ['User', 'Admin'], required: true },
    notifiableId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false, required: true },
    readAt: { type: Date },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
NotificationSchema.index({ notifiableId: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ read: 1 });
NotificationSchema.index({ readAt: 1 });
NotificationSchema.index({ createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);