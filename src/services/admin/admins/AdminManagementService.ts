import {
  ERROR_CODES,
  HTTP_STATUS,
} from "@/utils/constants";
import logger from "@/logger";
import { CreateAdminRequest, UpdateAdminRequest } from "@/types/admin";
import { Admin, IAdmin } from "@/models/admin/Admin";
import { generatePasswordCrypto } from "@/utils/helpers";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { EmailService } from "@/services/core/EmailService";
import { Role } from "@/models/admin/Role";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

export class AdminManagementService {
  constructor(
    private emailService: EmailService,
    private adminRepository: AdminRepository,
  ) {}
  async createAdmin(
    data: CreateAdminRequest,
    creatorId: string,
    creatorPermissions: string[] = [],
  ): Promise<IAdmin> {
    const { firstName, lastName, email, adminLevel, phone } = data;

    try {
      const existingAdmin = await this.adminRepository.findByEmail(email);
      if (existingAdmin) {
        throw new AppError(
          "Admin with this email already exists",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }

      const newPassword = generatePasswordCrypto();
      // Fetch role permissions
      let rolePermissions: string[] = [];
      const role = await Role.findOne({ name: adminLevel });
      if (role) {
        rolePermissions = [...role.permissions];
      }

      const creatorHasFullAccess = creatorPermissions.includes("*");
      if (!creatorHasFullAccess) {
        const ungranted = rolePermissions.filter(
          (p) => p !== "*" && !creatorPermissions.includes(p),
        );
        if (ungranted.length > 0) {
          throw new AppError(
            `Cannot create an admin with permissions you don't hold: ${ungranted.join(", ")}`,
            HTTP_STATUS.FORBIDDEN,
            ERROR_CODES.AUTHORIZATION_ERROR,
          );
        }
      }

      // Auto-enable scoped network permissions if flag is on
      const scopedNetworkPermissions =
        await this.buildNetworkScopedPermissions(rolePermissions);
      const scopedCategoryPermissions =
        await this.buildCategoryScopedPermissions(rolePermissions);
      const allPermissions = [
        ...new Set([
          ...rolePermissions,
          ...scopedNetworkPermissions,
          ...scopedCategoryPermissions,
        ]),
      ];

      const adminData = {
        firstName,
        lastName,
        email: email.toLowerCase(),
        password: newPassword,
        adminLevel,
        phone,
        createdBy: creatorId,
        permissions: allPermissions,
      };

      const admin = await this.adminRepository.create(adminData);

      await this.emailService.sendAdminWelcomeEmail(
        admin.email,
        admin.firstName,
        admin.adminLevel,
        newPassword,
      );

      logger.info("Admin account created successfully", {
        adminId: admin._id.toString(),
        email: admin.email,
        adminLevel: admin.adminLevel,
        createdBy: creatorId,
      });

      return admin;
    } catch (error: any) {
      logger.error("Failed to create admin account", {
        email,
        error: error.message,
        createdBy: creatorId,
      });
      throw error;
    }
  }

  async getAllAdmins(query: {
    page?: number;
    limit?: number;
    adminLevel?: string;
    status?: string;
    search?: string;
  }) {
    const { page = 1, limit = 10, adminLevel, status, search } = query;

    const filter: any = {
      isSystemSecured: { $ne: true },
    };

    // Build filter object
    if (adminLevel) filter.adminLevel = adminLevel;
    if (status) filter.status = status;
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    const skip = (page - 1) * limit;

    const [admins, total] = await Promise.all([
      Admin.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).exec(),
      Admin.countDocuments(filter),
    ]);

    return {
      admins,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  async getAdminById(adminId: string): Promise<IAdmin> {
    const admin = await Admin.findById(adminId);
    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return admin;
  }

  async updateAdmin(
    adminId: string,
    data: UpdateAdminRequest,
    updatedBy: string,
    updaterPermissions: string[] = [],
  ): Promise<IAdmin> {
    const admin = await Admin.findById(adminId);
    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isAdminLevelChanging =
      data.adminLevel && data.adminLevel !== admin.adminLevel;

    if (isAdminLevelChanging) {
      if (!admin.permissions) {
        admin.permissions = [];
      }

      // Remove previous role permissions and its scoped network permissions
      const previousRole = await Role.findOne({ name: admin.adminLevel });
      if (previousRole) {
        const previousRolePermissions = new Set(previousRole.permissions);

        admin.permissions = admin.permissions.filter(
          (permission) => !previousRolePermissions.has(permission)
        );
      }

      // Add new role permissions
      const newRole = await Role.findOne({ name: data.adminLevel });
      if (newRole) {
        const currentPermissions = admin.permissions || [];
        const newRolePermissions = newRole.permissions.filter(
          (p) => !currentPermissions.includes(p),
        );
        admin.permissions = [...currentPermissions, ...newRolePermissions];

        // Auto-enable scoped network permissions if flag is on
        // Auto-enable scoped network and category permissions if flags are on
        const scopedNetworkPermissions =
          await this.buildNetworkScopedPermissions(admin.permissions);
        const scopedCategoryPermissions =
          await this.buildCategoryScopedPermissions(admin.permissions);
        admin.permissions = [
          ...new Set([
            ...admin.permissions,
            ...scopedNetworkPermissions,
            ...scopedCategoryPermissions,
          ]),
        ];
      }
    }

    const allowedUpdates = [
      "firstName",
      "lastName",
      "phone",
      "status",
      "adminLevel",
    ];

    allowedUpdates.forEach((field) => {
      if ((data as any)[field] !== undefined) {
        (admin as any)[field] = (data as any)[field];
      }
    });

    // Only allow direct permission updates when adminLevel is NOT changing.
    // When adminLevel changes, permissions are computed above from the new role.
    if (!isAdminLevelChanging && data.permissions !== undefined) {
      const updaterHasFullAccess = updaterPermissions.includes("*");
      if (!updaterHasFullAccess) {
        const ungranted = data.permissions.filter(
          (p) => !updaterPermissions.includes(p),
        );
        if (ungranted.length > 0) {
          throw new AppError(
            `Cannot grant permissions you don't hold: ${ungranted.join(", ")}`,
            HTTP_STATUS.FORBIDDEN,
            ERROR_CODES.AUTHORIZATION_ERROR,
          );
        }
      }
      admin.permissions = data.permissions;
    }

    admin.updatedBy = updatedBy;
    await admin.save();

    logger.info("Admin account updated", {
      adminId,
      updatedBy,
      updatedFields: Object.keys(data),
      adminLevelChanged: isAdminLevelChanging,
    });

    return admin;
  }

  async deactivateAdmin(adminId: string, deactivatedBy: string): Promise<void> {
    const admin = await Admin.findById(adminId);
    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (admin.adminLevel === "super_admin") {
      throw new AppError(
        "Cannot delete super admin account",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    await Admin.findByIdAndDelete(adminId);

    logger.info("Admin account deleted", {
      adminId,
      deactivatedBy,
    });
  }

  async resetAdminPassword(adminId: string, resetBy: string): Promise<void> {
    const admin = await Admin.findById(adminId);
    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const generatedPassword = generatePasswordCrypto();

    admin.password = generatedPassword;
    admin.updatedBy = resetBy;
    await admin.save();

    // Send password reset notification
    await this.emailService.sendPasswordResetConfirmation(
      admin.email,
      admin.firstName,
      generatedPassword,
    );

    logger.info("Admin password reset", {
      adminId,
      resetBy,
    });
  }

  async getAdminStatistics() {
    const stats = await Admin.aggregate([
      {
        $group: {
          _id: "$adminLevel",
          count: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          suspended: {
            $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] },
          },
          deactivated: {
            $sum: { $cond: [{ $eq: ["$status", "deactivated"] }, 1, 0] },
          },
        },
      },
    ]);

    const totalStats = await Admin.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          recentLogins: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    "$lastLogin",
                    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    return {
      byLevel: stats,
      overall: totalStats[0] || { total: 0, active: 0, recentLogins: 0 },
    };
  }

  private async buildNetworkScopedPermissions(
    permissions: string[],
  ): Promise<string[]> {
    return [];
  }

  private async buildCategoryScopedPermissions(
    permissions: string[],
  ): Promise<string[]> {
    return [];
  }
}
