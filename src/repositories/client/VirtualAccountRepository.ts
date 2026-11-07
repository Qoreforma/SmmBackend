import { BaseRepository } from "../BaseRepository";
import {
  VirtualAccount,
  IVirtualAccount,
} from "@/models/banking/VirtualAccount";

export class VirtualAccountRepository extends BaseRepository<IVirtualAccount> {
  constructor() {
    super(VirtualAccount);
  }

  async createAccount(
    data: Partial<IVirtualAccount>
  ): Promise<IVirtualAccount> {
    return this.model.create(data);
  }

  async findByUserId(userId: string): Promise<IVirtualAccount[]> {
    return this.model
      .find({ userId, deletedAt: null })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByAccountNumber(
    accountNumber: string
  ): Promise<IVirtualAccount | null> {
    return this.model.findOne({ accountNumber, deletedAt: null }).exec();
  }

  async findByUserAndType(
    userId: string,
    type: "permanent" | "temporary"
  ): Promise<IVirtualAccount | null> {
    return this.model.findOne({ userId, type, deletedAt: null }).exec();
  }

  async findActiveAccounts(userId: string): Promise<IVirtualAccount[]> {
    const now = new Date();
    return this.model
      .find({
        userId,
        deletedAt: null,
        $or: [
          { type: "permanent" },
          { type: "temporary", expiredAt: { $gt: now } },
        ],
      })
      .exec();
  }

  async findTemporaryAccountByUserIdForAdmin(userId: string): Promise<any[]> {
    return this.model
      .find({
        userId,
        isActive: true,
        deletedAt: null,
        type: "temporary",
      })
      .select("-meta -accountReference -orderReference")
      .lean()
      .exec();
  }

    async findPermanentAccountByUserIdForAdmin(userId: string): Promise<any[]> {
    return this.model
      .find({
        userId,
        isActive: true,
        deletedAt: null,
        type: "permanent",
      })
      .select("-meta -accountReference -orderReference")
      .lean()
      .exec();
  }
}
