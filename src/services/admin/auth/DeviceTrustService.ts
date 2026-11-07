import { Types } from "mongoose";
import { Admin, IAdmin } from "@/models/admin/Admin";
import { AdminDeviceApprovalRequest } from "@/models/admin/AdminDeviceApprovalRequest";
import { BlockedIpRange } from "@/models/admin/BlockedIpRange";
import { isIpInCidrs } from "@/utils/cidr";
import cacheService from "@/services/core/CacheService";
import { EmailService } from "@/services/core/EmailService";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import logger from "@/logger";

export class DeviceTrustService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Check if an IP address is blocked globally
   */
  async isIpBlocked(ip: string): Promise<boolean> {
    const blockedRanges = await BlockedIpRange.find().lean();
    if (!blockedRanges.length) return false;

    const cidrs = blockedRanges.map((r) => r.cidr);
    return isIpInCidrs(ip, cidrs);
  }

  /**
   * Main trust check logic
   * Returns true if trusted.
   * If not trusted, generates a pending request (or dedupes) and returns false.
   */
  async checkDeviceAndIpTrust(
    admin: IAdmin,
    deviceId: string,
    ip: string,
    userAgent?: string,
  ): Promise<boolean> {
    if (
      process.env.ENFORCE_DEVICE_TRUST !== "true" &&
      process.env.ENFORCE_DEVICE_TRUST !== "false"
    ) {
      throw new Error(
        "ENFORCE_DEVICE_TRUST environment variable must be set to explicitly 'true' or 'false'",
      );
    }

    // 1. Day-one bootstrap (Monitor-only mode) auto-approves
    if (process.env.ENFORCE_DEVICE_TRUST === "false") {
      await this.autoTrustDeviceAndIp(admin, deviceId, ip, userAgent);
      return true;
    }

    // 2. Check if device is trusted
    const isDeviceTrusted = admin.trustedDevices.some(
      (d) => d.deviceId === deviceId,
    );

    // 3. Check if IP is in allowed ranges
    const allowedCidrs = admin.allowedIpRanges.map((r) => r.cidr);
    const isIpTrusted = isIpInCidrs(ip, allowedCidrs);

    if (isDeviceTrusted && isIpTrusted) {
      // Update last used for device
      await Admin.updateOne(
        { _id: admin._id, "trustedDevices.deviceId": deviceId },
        { $set: { "trustedDevices.$.lastUsedAt": new Date() } },
      );
      return true;
    }

    // 4. Untrusted. Create or update pending request
    await this.handleUntrustedAccess(admin, deviceId, ip, userAgent);
    return false;
  }

  private async autoTrustDeviceAndIp(
    admin: IAdmin,
    deviceId: string,
    ip: string,
    userAgent?: string,
  ): Promise<void> {
    const isDeviceTrusted = admin.trustedDevices.some(
      (d) => d.deviceId === deviceId,
    );
    const allowedCidrs = admin.allowedIpRanges.map((r) => r.cidr);
    const isIpTrusted = isIpInCidrs(ip, allowedCidrs);

    const updates: any = { $push: {} };
    let hasUpdates = false;

    if (!isDeviceTrusted) {
      updates.$push.trustedDevices = {
        deviceId,
        userAgent,
        label: "Auto-trusted (Monitor Mode)",
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };
      hasUpdates = true;
    }

    if (!isIpTrusted) {
      const cidrSuffix = ip.includes(":") ? "/128" : "/32";
      updates.$push.allowedIpRanges = {
        cidr: `${ip}${cidrSuffix}`,
        label: "Auto-trusted (Monitor Mode)",
        addedAt: new Date(),
      };
      hasUpdates = true;
    }

    if (hasUpdates) {
      await Admin.updateOne({ _id: admin._id }, updates);
      await this.invalidateAdminCache(admin._id.toString());
      logger.info(
        `Auto-trusted device/IP for admin ${admin._id} in monitor mode`,
      );
    }
  }

  private async handleUntrustedAccess(
    admin: IAdmin,
    deviceId: string,
    ip: string,
    userAgent?: string,
  ): Promise<void> {
    // Look for existing pending request
    const existingReq = await AdminDeviceApprovalRequest.findOne({
      adminId: admin._id,
      deviceId,
      requestedIp: ip,
      status: "pending",
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours

    if (existingReq) {
      // Deduplicate: Refresh expiration and userAgent
      existingReq.expiresAt = expiresAt;
      existingReq.userAgent = userAgent || existingReq.userAgent;

      // Re-email only if last email was > 15 mins ago
      const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
      let shouldEmail = false;
      if (
        !existingReq.lastEmailedAt ||
        existingReq.lastEmailedAt < fifteenMinsAgo
      ) {
        shouldEmail = true;
        existingReq.lastEmailedAt = now;
      }

      await existingReq.save();

      if (shouldEmail) {
        await this.notifyApprovers(admin, ip, deviceId);
      }
    } else {
      // Create new pending request
      await AdminDeviceApprovalRequest.create({
        adminId: admin._id,
        deviceId,
        requestedIp: ip,
        userAgent,
        status: "pending",
        expiresAt,
        lastEmailedAt: now,
      });

      await this.notifyApprovers(admin, ip, deviceId);
    }
  }

  private async notifyApprovers(
    requestingAdmin: IAdmin,
    ip: string,
    deviceId: string,
  ) {
    // Find admins with APPROVE_DEVICE_REQUESTS permission or '*'
    const approvers = await Admin.find({
      status: "active",
      $or: [
        { permissions: "*" },
        { permissions: ADMIN_PERMISSIONS.SECURITY.APPROVE_DEVICE_REQUESTS },
      ],
    }).select("email");

    const emails = approvers.map((a) => a.email);
    for (const email of emails) {
      await this.emailService.sendDeviceApprovalAlertEmail(
        email,
        requestingAdmin.email,
        ip,
        deviceId,
      );
    }
  }

  async approveRequest(
    requestId: string,
    approverId: Types.ObjectId,
  ): Promise<void> {
    const request =
      await AdminDeviceApprovalRequest.findById(requestId).populate("adminId");
    if (!request || request.status !== "pending") {
      throw new Error("Request not found or not pending");
    }

    const requestingAdmin = request.adminId as unknown as IAdmin;
    const isSelfApproval = requestingAdmin._id.equals(approverId);

    if (isSelfApproval) {
      // Check if self-approval is allowed: IP-only mismatch AND no other active approver
      const isDeviceTrusted = requestingAdmin.trustedDevices.some(
        (d) => d.deviceId === request.deviceId,
      );
      if (!isDeviceTrusted) {
        throw new Error(
          "Self-approval is only permitted for IP-only mismatches",
        );
      }

      const otherApproversCount = await Admin.countDocuments({
        status: "active",
        _id: { $ne: approverId },
        $or: [
          { permissions: "*" },
          { permissions: ADMIN_PERMISSIONS.SECURITY.APPROVE_DEVICE_REQUESTS },
        ],
      });

      if (otherApproversCount > 0) {
        throw new Error(
          "Self-approval is not permitted when other approvers are active",
        );
      }

      // Allowed self-approval, notify out-of-band
      const emergencyEmail = process.env.EMERGENCY_SECURITY_ALERT_EMAIL;
      if (emergencyEmail) {
        await this.emailService.sendEmergencySelfApprovalAlertEmail(
          emergencyEmail,
          requestingAdmin.email,
          request.requestedIp,
        );
      }
    }

    // Approve: Add device and IP to trusted lists
    const updates: any = { $push: {} };
    const isDeviceTrusted = requestingAdmin.trustedDevices.some(
      (d) => d.deviceId === request.deviceId,
    );
    if (!isDeviceTrusted) {
      updates.$push.trustedDevices = {
        deviceId: request.deviceId,
        userAgent: request.userAgent,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };
    }

    // Convert IP to /32 or /128 CIDR
    const cidrSuffix = request.requestedIp.includes(":") ? "/128" : "/32";
    const newCidr = `${request.requestedIp}${cidrSuffix}`;
    const isIpTrusted = requestingAdmin.allowedIpRanges.some(
      (r) => r.cidr === newCidr,
    );

    if (!isIpTrusted) {
      updates.$push.allowedIpRanges = {
        cidr: newCidr,
        addedBy: approverId,
        addedAt: new Date(),
      };
    }

    if (Object.keys(updates.$push).length > 0) {
      await Admin.updateOne({ _id: requestingAdmin._id }, updates);
    }

    request.status = "approved";
    request.decisionType = isSelfApproval
      ? "self_approved_no_other_approver"
      : "normal";
    request.reviewedBy = approverId;
    request.reviewedAt = new Date();
    await request.save();

    await this.invalidateAdminCache(requestingAdmin._id.toString());
  }

  async denyRequest(
    requestId: string,
    approverId: Types.ObjectId,
    blockIpGlobally: boolean,
    reason?: string,
  ): Promise<void> {
    const request = await AdminDeviceApprovalRequest.findById(requestId);
    if (!request || request.status !== "pending") {
      throw new Error("Request not found or not pending");
    }

    request.status = "denied";
    request.reviewedBy = approverId;
    request.reviewedAt = new Date();
    await request.save();

    if (blockIpGlobally) {
      const cidrSuffix = request.requestedIp.includes(":") ? "/128" : "/32";
      const cidr = `${request.requestedIp}${cidrSuffix}`;

      await BlockedIpRange.updateOne(
        { cidr },
        { $setOnInsert: { cidr, reason, blockedBy: approverId } },
        { upsert: true },
      );
      // Invalidate all admin caches just in case they were using this IP (unlikely if it was blocked, but safe)
      await cacheService.deletePattern("admin:trusted_ips:*");
    }
  }

  async invalidateAdminCache(adminId: string): Promise<void> {
    await cacheService.delete(`admin:trusted_ips:${adminId}`);
  }

  async getBlockedIps(
    page: number,
    limit: number,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      BlockedIpRange.find()
        .populate("blockedBy", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlockedIpRange.countDocuments(),
    ]);
    return { data, total };
  }

  async addBlockedIp(
    cidr: string,
    approverId: Types.ObjectId,
    reason?: string,
  ): Promise<void> {
    await BlockedIpRange.updateOne(
      { cidr },
      { $setOnInsert: { cidr, reason, blockedBy: approverId } },
      { upsert: true },
    );
    await cacheService.deletePattern("admin:trusted_ips:*");
  }

  async removeBlockedIp(cidr: string): Promise<void> {
    await BlockedIpRange.deleteOne({ cidr });
  }

  async getAllTrustedDevicesAndIps(
    page: number,
    limit: number,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const [admins, total] = await Promise.all([
      Admin.find({ status: "active" })
        .select("email firstName lastName trustedDevices allowedIpRanges")
        .skip(skip)
        .limit(limit)
        .lean(),
      Admin.countDocuments({ status: "active" }),
    ]);

    const data = admins.map((admin) => ({
      adminId: admin._id,
      adminEmail: admin.email,
      adminName: `${admin.firstName} ${admin.lastName}`,
      trustedDevices: (admin.trustedDevices || []).map((device) => ({
        deviceIdMasked: this.maskDeviceId(device.deviceId),
        userAgent: device.userAgent || "N/A",
        label: device.label,
        createdAt: device.createdAt,
        lastUsedAt: device.lastUsedAt,
      })),
      allowedIpRanges: admin.allowedIpRanges || [],
    }));

    return { data, total };
  }

  private maskDeviceId(deviceId: string): string {
    if (!deviceId || deviceId.length < 8) return "***";
    return `${deviceId.substring(0, 4)}...${deviceId.substring(deviceId.length - 4)}`;
  }
}
