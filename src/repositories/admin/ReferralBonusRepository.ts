import { BaseRepository } from "../BaseRepository";
import { IReferralBonus, ReferralBonus } from "@/models/billing/bonuses/ReferralBonus";
import { Types } from "mongoose";

export class ReferralBonusRepository extends BaseRepository<IReferralBonus> {
  constructor() {
    super(ReferralBonus);
  }

  async getAllApplicableBonuses(
    userType: string,
    amountTraded: number
  ): Promise<IReferralBonus[]> {
    return await this.find({
      userType,
      isActive: true,
      threshold: { $lte: amountTraded },
    });
  }

  async getAlls(): Promise<IReferralBonus[]> {
    return await this.find({});
  }
}
