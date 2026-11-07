import { BaseRepository } from "../BaseRepository";
import { Role, IRole } from "@/models/admin/Role";
import { FilterQuery, Types } from "mongoose";
import { IRoleFilters } from "@/services/admin/admins/RoleService";
import { Admin } from "@/models/admin/Admin";
type RoleWithAdminCount = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  adminCount: number;
};
export class RoleRepository extends BaseRepository<IRole> {
  constructor() {
    super(Role);
  }

  async findByName(name: string): Promise<IRole | null> {
    if (!name) return null;
    return await this.model.findOne({ name }).exec();
  }

  async findBySlug(slug: string): Promise<IRole | null> {
    return await this.model.findOne({ slug }).exec();
  }

  async findActiveRoles(): Promise<IRole[]> {
    return await this.model.find({ status: "active" }).exec();
  }

  // Custom method with different name to avoid signature conflict
  async findRolesWithFilters(
    page: number = 1,
    limit: number = 10,
    filters: IRoleFilters = {},
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ): Promise<{
    data: RoleWithAdminCount[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    // Build filter query
    const query: FilterQuery<IRole> = {};

    if (filters.search) {
      const searchRegex = new RegExp(filters.search, "i");
      query.$or = [{ name: searchRegex }, { description: searchRegex }];
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [data, total] = await Promise.all([
      this.model.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(query).exec(),
    ]);

    // Get admin counts for each role
    const roleNames = data.map((role) => role.name);
    const adminCounts = await Admin.aggregate([
      {
        $match: {
          adminLevel: { $in: roleNames },
        },
      },
      {
        $group: {
          _id: "$adminLevel",
          count: { $sum: 1 },
        },
      },
    ]);

    // Create a map for quick lookup
    const adminCountMap = new Map<string, number>(
      adminCounts.map((item) => [item._id as string, item.count as number]),
    );

    // Add adminCount to each role
    const dataWithAdminCount: RoleWithAdminCount[] = data.map((role) => ({
      _id: role._id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      permissions: role.permissions,
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      adminCount: adminCountMap.get(role.name) || 0,
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data: dataWithAdminCount,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
