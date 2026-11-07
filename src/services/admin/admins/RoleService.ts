import { IRole } from "@/models/admin/Role";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { RoleRepository } from "@/repositories/admin/RoleRepository";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import {
  HTTP_STATUS,
} from "@/utils/constants";

export interface IRoleFilters {
  search?: string;
}

export interface ICreateRoleData {
  name: string;
  description: string;
  permissions: string[]; // Changed from String[] to string[]
}

export interface IUpdateRoleData {
  name?: string;
  description?: string;
  permissions?: string[]; // Changed from String[] to string[]
}

export class RoleService {
  constructor(
    private roleRepository: RoleRepository,
    private adminRepository: AdminRepository,
  ) {}

  async getAllRoles(
    page: number = 1,
    limit: number = 10,
    filters: IRoleFilters = {},
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ) {
    // Use the new method name
    return await this.roleRepository.findRolesWithFilters(
      page,
      limit,
      filters,
      sortBy,
      sortOrder,
    );
  }

  async getRoleById(id: string): Promise<IRole | null> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      return null;
    }
    return role;
  }

  async createRole(roleData: ICreateRoleData): Promise<IRole> {
    // Check if role name already exists
    const existingRole = await this.roleRepository.findByName(roleData.name);
    if (existingRole) {
      const error = new Error("Role with this name already exists");
      (error as any).statusCode = HTTP_STATUS.CONFLICT;
      throw error;
    }

    const newRole = await this.roleRepository.create({
      ...roleData,
    });

    return newRole;
  }

  async updateRole(
    id: string,
    updateData: IUpdateRoleData,
  ): Promise<IRole | null> {
    const existingRole = await this.roleRepository.findById(id);
    if (!existingRole) return null;

    const oldName = existingRole.name;
    const oldPermissions = existingRole.permissions as string[];

    if (updateData.name && updateData.name !== oldName) {
      const roleWithNewName = await this.roleRepository.findByName(
        updateData.name,
      );
      if (roleWithNewName) {
        const error = new Error("Role with this name already exists");
        (error as any).statusCode = HTTP_STATUS.CONFLICT;
        throw error;
      }
    }

    const updatedRole = await this.roleRepository.update(id, updateData);

    // If name changed, sync adminLevel across all admins carrying the old name
    if (updateData.name && updateData.name !== oldName) {
      const admins = await this.adminRepository.findByRole(oldName);
      await Promise.all(
        admins.map((admin) =>
          this.adminRepository.update(admin._id.toString(), {
            adminLevel: updateData.name,
          }),
        ),
      );
    }

    // If permissions changed, sync to all admins carrying this role
    if (updateData.permissions) {
      await this.syncPermissionsToAdmins(
        updatedRole!.name,
        oldPermissions,
        updateData.permissions,
      );
    }

    return updatedRole;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      const error = new Error("Role not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }

    // Check if role is assigned to any users
    const usersWithRole = await this.adminRepository.findByRole(id);
    if (usersWithRole && usersWithRole.length > 0) {
      const error = new Error(
        "Cannot delete role that is assigned to admin user. Remove role from admin user first.",
      );
      (error as any).statusCode = HTTP_STATUS.CONFLICT;
      throw error;
    }

    await this.roleRepository.delete(id);
  }

  async getAvailablePermissions(): Promise<{
    categories: Record<string, any>;
    allPermissions: string[];
  }> {
    const categories = ADMIN_PERMISSIONS;
    const allPermissions = this.extractAllPermissions(categories);

    return {
      categories,
      allPermissions,
    };
  }

  async updateRolePermissions(
    id: string,
    permissions: string[],
  ): Promise<IRole | null> {
    const role = await this.roleRepository.findById(id);
    if (!role) return null;

    const oldPermissions = role.permissions as string[];

    const updatedRole = await this.roleRepository.update(id, { permissions });

    await this.syncPermissionsToAdmins(role.name, oldPermissions, permissions);

    return updatedRole;
  }

  //  ROLE ASSIGNMENT
  async assignRole(adminId: string, roleId: string) {
    // Check if admin exists
    const admin = await this.adminRepository.findById(adminId);
    if (!admin) {
      const error = new Error("Admin not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }

    // Check if role exists
    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      const error = new Error("Role not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }

    // Check if admin already has this role
    if (admin.adminLevel && admin.adminLevel.toString() === role.name) {
      const error = new Error("Admin already has this role");
      (error as any).statusCode = HTTP_STATUS.CONFLICT;
      throw error;
    }

    // Strip old role permissions + its derived scoped permissions
    let currentPermissions = admin.permissions || [];

    if (admin.adminLevel) {
      const previousRole = await this.roleRepository.findByName(
        admin.adminLevel.toString(),
      );
      if (previousRole) {
        const previousRolePermissions = new Set(
          previousRole.permissions as string[],
        );

        currentPermissions = currentPermissions.filter(
          (p) => !previousRolePermissions.has(p)
        );
      }
    }

    // Merge new role permissions
    const newRolePermissions = (role.permissions as string[]).filter(
      (p) => !currentPermissions.includes(p),
    );
    currentPermissions = [...currentPermissions, ...newRolePermissions];

    // Auto-add scoped permissions if flags are on
    const scopedNetworkPermissions =
      await this.buildNetworkScopedPermissions(currentPermissions);
    const scopedCategoryPermissions =
      await this.buildCategoryScopedPermissions(currentPermissions);
    const allPermissions = [
      ...new Set([
        ...currentPermissions,
        ...scopedNetworkPermissions,
        ...scopedCategoryPermissions,
      ]),
    ];

    // Assign role to admin
    const updatedAdmin = await this.adminRepository.updateRole(
      adminId,
      role.name,
      allPermissions,
    );

    return {
      admin: updatedAdmin,
      role: role,
      message: `Role '${role.name}' assigned to admin '${admin.email}'`,
    };
  }

  async revokeRole(adminId: string, roleId: string) {
    // Check if admin exists
    const admin = await this.adminRepository.findById(adminId);
    if (!admin) {
      const error = new Error("Admin not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }
    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      const error = new Error("Role not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }

    // Check if admin has this role
    if (!admin.adminLevel || admin.adminLevel.toString() !== role.name) {
      const error = new Error("Admin does not have this role");
      (error as any).statusCode = HTTP_STATUS.CONFLICT;
      throw error;
    }

    // Remove role from admin
    const updatedAdmin = await this.adminRepository.updateRole(
      adminId,
      "revoked",
      [],
    );

    return {
      admin: updatedAdmin,
      message: `Role '${role?.name || "Unknown"}' revoked from admin '${
        admin.email
      }'`,
    };
  }

  async getUsersByRole(roleId: string, page: number = 1, limit: number = 10) {
    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      const error = new Error("Role not found");
      (error as any).statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }

    const users = await this.adminRepository.findByRoleWithPagination(
      role.name,
      page,
      limit,
    );

    return {
      role: role,
      users: users,
    };
  }

  private async syncPermissionsToAdmins(
    roleName: string,
    oldPermissions: string[],
    newPermissions: string[],
  ): Promise<void> {
    const oldPermissionsSet = new Set(oldPermissions);
    const admins = await this.adminRepository.findByRole(roleName);

    await Promise.all(
      admins.map((admin) => {
        const stripped = (admin.permissions || []).filter(
          (p) => !oldPermissionsSet.has(p),
        );
        const merged = [...new Set([...stripped, ...newPermissions])];
        return this.adminRepository.update(admin._id.toString(), {
          permissions: merged,
        });
      }),
    );
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

  private extractAllPermissions(permissionObj: any): string[] {
    const permissions: string[] = [];

    function traverse(obj: any) {
      for (const key in obj) {
        if (typeof obj[key] === "string") {
          permissions.push(obj[key]);
        } else if (typeof obj[key] === "object") {
          traverse(obj[key]);
        }
      }
    }

    traverse(permissionObj);
    return permissions;
  }
}
