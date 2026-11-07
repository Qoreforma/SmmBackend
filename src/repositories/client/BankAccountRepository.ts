import { BaseRepository } from "../BaseRepository";
import { BankAccount, IBankAccount } from "@/models/reference/BankAccount";
import { Types } from "mongoose";

export class BankAccountRepository extends BaseRepository<IBankAccount> {
  constructor() {
    super(BankAccount);
  }

  async findByUserId(userId: string | Types.ObjectId): Promise<IBankAccount[]> {
    return this.model
      .find({ userId, deletedAt: null })
      .populate("bankId")
      .exec();
  }

  async findByIdAndPopulate(
    id: string | Types.ObjectId,
  ): Promise<IBankAccount | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate("bankId")
      .exec();
  }

  async findByAccountNumber(
    userId: string | Types.ObjectId,
    accountNumber: string,
    bankCode: string,
  ): Promise<IBankAccount | null> {
    return this.model
      .findOne({ userId, accountNumber, bankCode, deletedAt: null })
      .exec();
  }

  async countByUserId(userId: string | Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ userId, deletedAt: null }).exec();
  }

  async findByUserIdForAdmin(userId: string): Promise<any[]> {
    return this.model
      .aggregate([
        {
          $match: { userId: new Types.ObjectId(userId), deletedAt: null },
        },
        {
          $lookup: {
            from: "banks",
            let: { bankCode: "$bankCode" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$savehavenCode", "$$bankCode"] },
                      { $eq: ["$universalCode", "$$bankCode"] },
                      { $eq: ["$monnifyCode", "$$bankCode"] },
                      { $eq: ["$flutterwaveCode", "$$bankCode"] },
                    ],
                  },
                },
              },
              {
                $project: { name: 1, _id: 1 },
              },
            ],
            as: "bankDetails",
          },
        },
        {
          $unwind: {
            path: "$bankDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            userId: 1,
            bankCode: 1,
            accountNumber: 1,
            accountName: 1,
            isDefault: 1,
            createdAt: 1,
            updatedAt: 1,
            bankName: "$bankDetails.name",
          },
        },
      ])
      .exec();
  }
}
