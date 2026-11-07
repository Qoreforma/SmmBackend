import { BaseRepository } from "../BaseRepository";
import { User, IUser } from "@/models/core/User";

export class UserRepository extends BaseRepository<IUser> {
  // Fields to exclude for admin views
  private readonly adminExcludedFields = {
    password: 0,
    pin: 0,
    otp: 0,
    otpExpiry: 0,
    bvn: 0,
    nin: 0,
  };

  constructor() {
    super(User);
  }

  async findByEmail(
    email: string,
    includeDeleted = false,
  ): Promise<IUser | null> {
    if (!email) return null;
    const query: any = { email: email.toLowerCase() };

    if (!includeDeleted) {
      query.deletedAt = null;
    }

    return this.model.findOne(query).exec();
  }
  async findByIds(userIds: string[]): Promise<IUser[]> {
    try {
      const users = await this.model.find({
        _id: { $in: userIds },
      });
      return users || [];
    } catch (error) {
      throw new Error(`Failed to find users: ${error}`);
    }
  }
  async findByUsername(
    username: string,
    includeDeleted = false,
  ): Promise<IUser | null> {
    if (!username) return null;
    const query: any = { username: username };
    if (!includeDeleted) {
      query.deletedAt = null;
    }
    return this.model.findOne(query).exec();
  }

  async findByRefCode(
    refCode: string,
    includeDeleted = false,
  ): Promise<IUser | null> {
    if (!refCode) return null;
    const query: any = { refCode: refCode };
    if (!includeDeleted) {
      query.deletedAt = null;
    }
    return this.model.findOne(query).exec();
  }

  async findByPhone(
    phone: string,
    includeDeleted = false,
  ): Promise<IUser | null> {
    if (!phone) return null;
    const query: any = { phone: phone };
    if (!includeDeleted) {
      query.deletedAt = null;
    }
    return this.model.findOne(query).exec();
  }

  async updatePassword(
    userId: string | any,
    hashedPassword: string,
  ): Promise<IUser | null> {
    // Handle both userId and email
    const filter = userId.includes("@")
      ? { email: userId.toLowerCase() }
      : { _id: userId };
    return this.model
      .findOneAndUpdate(filter, { password: hashedPassword }, { new: true })
      .exec();
  }

  async updateEmail(userId: string, email: string): Promise<IUser | null> {
    return this.model
      .findByIdAndUpdate(userId, { email: email.toLowerCase() }, { new: true })
      .exec();
  }

  async updateStatus(
    userId: string,
    status: "active" | "inactive" | "suspended",
  ): Promise<IUser | null> {
    return this.model
      .findByIdAndUpdate(userId, { status }, { new: true })
      .exec();
  }

  async verifyEmail(userId: string): Promise<IUser | null> {
    return this.model
      .findByIdAndUpdate(userId, { emailVerifiedAt: new Date() }, { new: true })
      .exec();
  }

  async verifyPhone(
    userId: string,
    phone?: number,
    phoneCode?: string,
  ): Promise<IUser | null> {
    return this.model
      .findByIdAndUpdate(
        userId,
        { phoneVerifiedAt: new Date(), phone, phoneCode },
        { new: true },
      )
      .exec();
  }

  async findMany(filter: any, skip: number = 0, limit: number = 10) {
    return this.model.find(filter).skip(skip).limit(limit).exec();
  }

  // Admin-specific methods that exclude sensitive fields
  async findByIdForAdmin(userId: string): Promise<IUser | null> {
    return this.model
      .findOne({ _id: userId, deletedAt: null })
      .select(this.adminExcludedFields)
      .exec();
  }

  async findWithPaginationForAdmin(
    filter: any,
    page: number = 1,
    limit: number = 20,
    sortOptions: any = { createdAt: -1 },
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const pipeline: any[] = [
      { $match: filter },
      {
        $lookup: {
          from: "wallets", // MongoDB collection name (usually lowercase plural)
          localField: "_id",
          foreignField: "userId",
          as: "wallet",
        },
      },
      {
        $unwind: {
          path: "$wallet",
          preserveNullAndEmptyArrays: true, // Include users without wallets
        },
      },
      {
        $lookup: {
          from: "virtualaccounts",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$type", "permanent"] },
                    { $eq: ["$deletedAt", null] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],
          as: "permanentVirtualAccounts",
        },
      },
      // Lookup real user-added bank accounts from the bankaccounts collection
      {
        $lookup: {
          from: "bankaccounts",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$deletedAt", null] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],
          as: "bankAccountsList",
        },
      },
      {
        $addFields: {
          "wallet.balance": { $ifNull: ["$wallet.balance", 0] },
          "wallet.bonusBalance": { $ifNull: ["$wallet.bonusBalance", 0] },
          "wallet.commissionBalance": { $ifNull: ["$wallet.commissionBalance", 0] },
          // bankAccountsCount: real user-added bank accounts (not virtual/NIP accounts)
          bankAccountsCount: {
            $ifNull: [{ $arrayElemAt: ["$bankAccountsList.count", 0] }, 0],
          },
          bvnVerified: { $ifNull: ["$bvnVerified", false] },
          bvnValidated: { $ifNull: ["$bvnValidated", false] },
          hasBvn: {
            $cond: [
              {
                $and: [
                  { $ne: ["$bvn", null] },
                  { $ne: ["$bvn", ""] },
                ],
              },
              true,
              false,
            ],
          },
          hasNin: {
            $cond: [
              {
                $and: [
                  { $ne: ["$nin", null] },
                  { $ne: ["$nin", ""] },
                ],
              },
              true,
              false,
            ],
          },
        },
      },
      {
        $project: {
          password: 0,
          pin: 0,
          otp: 0,
          otpExpiry: 0,
          bvn: 0,
          nin: 0,
          permanentVirtualAccounts: 0,
          bankAccountsList: 0,
        },
      },
      { $sort: sortOptions },
      { $skip: skip },
      { $limit: limit },
    ];

    const [data, totalResult] = await Promise.all([
      this.model.aggregate(pipeline).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total: totalResult };
  }
}