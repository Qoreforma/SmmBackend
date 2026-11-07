import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDeviceCredential extends Document {
  userId: Types.ObjectId;
  deviceId: string;
  deviceName?: string;
  publicKey: string;
  algorithm: "ES256" | "RS256";
  biometricType: "faceId" | "touchId" | "fingerprint" | "biometric";
  isLoginEnabled: boolean;
  isTransactionEnabled: boolean;
  lastUsedAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceCredentialSchema = new Schema<IDeviceCredential>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    deviceName: {
      type: String,
      trim: true,
      default: "Mobile Device",
    },
    publicKey: {
      type: String,
      required: true,
    },
    algorithm: {
      type: String,
      enum: ["ES256", "RS256"],
      default: "ES256",
    },
    biometricType: {
      type: String,
      enum: ["faceId", "touchId", "fingerprint", "biometric"],
      default: "biometric",
    },
    isLoginEnabled: {
      type: Boolean,
      default: true,
    },
    isTransactionEnabled: {
      type: Boolean,
      default: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

DeviceCredentialSchema.index({ userId: 1, deviceId: 1 });
DeviceCredentialSchema.index({ userId: 1, revokedAt: 1 });
DeviceCredentialSchema.index({ deviceId: 1, revokedAt: 1 });

export const DeviceCredential = mongoose.model<IDeviceCredential>(
  "DeviceCredential",
  DeviceCredentialSchema,
);
