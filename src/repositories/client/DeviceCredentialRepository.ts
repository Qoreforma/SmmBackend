import { Types } from "mongoose";
import { BaseRepository } from "../BaseRepository";
import { DeviceCredential, IDeviceCredential } from "@/models/core/DeviceCredential";

export class DeviceCredentialRepository extends BaseRepository<IDeviceCredential> {
  constructor() {
    super(DeviceCredential);
  }

  /**
   * Find active (non-revoked) credential for a specific user and device.
   */
  async findActiveByDevice(
    userId: string | Types.ObjectId,
    deviceId: string,
  ): Promise<IDeviceCredential | null> {
    return this.model
      .findOne({
        userId: new Types.ObjectId(userId.toString()),
        deviceId,
        revokedAt: null,
      })
      .exec();
  }

  /**
   * Find active credential by deviceId alone (useful when looking up by device first).
   */
  async findActiveByDeviceId(deviceId: string): Promise<IDeviceCredential | null> {
    return this.model
      .findOne({
        deviceId,
        revokedAt: null,
      })
      .exec();
  }

  /**
   * List all active credentials for a user.
   */
  async findActiveByUser(
    userId: string | Types.ObjectId,
  ): Promise<IDeviceCredential[]> {
    return this.model
      .find({
        userId: new Types.ObjectId(userId.toString()),
        revokedAt: null,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * List all credentials for a user (including revoked ones for audit/history).
   */
  async findAllByUser(
    userId: string | Types.ObjectId,
  ): Promise<IDeviceCredential[]> {
    return this.model
      .find({
        userId: new Types.ObjectId(userId.toString()),
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Upsert a device credential: If an existing active or revoked credential exists for this
   * user and deviceId, update it with new key and reset revokedAt to null. Otherwise create new.
   */
  async upsertCredential(
    userId: string | Types.ObjectId,
    data: {
      deviceId: string;
      publicKey: string;
      algorithm?: "ES256" | "RS256";
      biometricType?: "faceId" | "touchId" | "fingerprint" | "biometric";
      deviceName?: string;
      isLoginEnabled?: boolean;
      isTransactionEnabled?: boolean;
    },
  ): Promise<IDeviceCredential> {
    const userObjectId = new Types.ObjectId(userId.toString());
    const existing = await this.model.findOne({
      userId: userObjectId,
      deviceId: data.deviceId,
    });

    if (existing) {
      existing.publicKey = data.publicKey;
      existing.algorithm = data.algorithm || "ES256";
      existing.biometricType = data.biometricType || existing.biometricType || "biometric";
      if (data.deviceName) existing.deviceName = data.deviceName;
      if (data.isLoginEnabled !== undefined) existing.isLoginEnabled = data.isLoginEnabled;
      if (data.isTransactionEnabled !== undefined) existing.isTransactionEnabled = data.isTransactionEnabled;
      existing.revokedAt = null;
      existing.revokedReason = null;
      existing.lastUsedAt = new Date();
      return existing.save();
    }

    return this.model.create({
      userId: userObjectId,
      deviceId: data.deviceId,
      publicKey: data.publicKey,
      algorithm: data.algorithm || "ES256",
      biometricType: data.biometricType || "biometric",
      deviceName: data.deviceName || "Mobile Device",
      isLoginEnabled: data.isLoginEnabled ?? true,
      isTransactionEnabled: data.isTransactionEnabled ?? true,
      lastUsedAt: new Date(),
    });
  }

  /**
   * Soft-revoke a specific device.
   */
  async revokeDevice(
    userId: string | Types.ObjectId,
    deviceId: string,
    reason = "user_revoked",
  ): Promise<boolean> {
    const result = await this.model.updateOne(
      {
        userId: new Types.ObjectId(userId.toString()),
        deviceId,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: reason,
          isLoginEnabled: false,
          isTransactionEnabled: false,
        },
      },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Soft-revoke all active devices for a user.
   */
  async revokeAllDevices(
    userId: string | Types.ObjectId,
    reason = "user_revoked_all",
  ): Promise<number> {
    const result = await this.model.updateMany(
      {
        userId: new Types.ObjectId(userId.toString()),
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: reason,
          isLoginEnabled: false,
          isTransactionEnabled: false,
        },
      },
    );
    return result.modifiedCount;
  }

  /**
   * Update last used timestamp.
   */
  async updateLastUsed(credentialId: string | Types.ObjectId): Promise<void> {
    await this.model.findByIdAndUpdate(credentialId, {
      $set: { lastUsedAt: new Date() },
    });
  }

  /**
   * Soft-revoke active credentials on a physical device belonging to any other user.
   * Ensures a physical device is uniquely bound to one active user at a time.
   * Returns the list of affected user IDs.
   */
  async revokeDeviceForOtherUsers(
    excludeUserId: string | Types.ObjectId,
    deviceId: string,
    reason = "device_reassigned",
  ): Promise<string[]> {
    const excludeObjId = new Types.ObjectId(excludeUserId.toString());
    const existing = await this.model
      .find({
        deviceId,
        userId: { $ne: excludeObjId },
        revokedAt: null,
      })
      .exec();

    if (existing.length === 0) return [];

    const affectedUserIds = [
      ...new Set(existing.map((c) => c.userId.toString())),
    ];

    await this.model.updateMany(
      {
        deviceId,
        userId: { $ne: excludeObjId },
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: reason,
          isLoginEnabled: false,
          isTransactionEnabled: false,
        },
      },
    );

    return affectedUserIds;
  }
}

