import { BaseRepository } from "../BaseRepository";
import { CashbackRule, ICashbackRule } from "@/models/billing/fees/CashbackRule";
import { Types } from "mongoose";

export class CashbackRuleRepository extends BaseRepository<ICashbackRule> {
  constructor() {
    super(CashbackRule);
  }

  async findActiveRules(): Promise<ICashbackRule[]> {
    return this.model.find({ active: true }).exec();
  }

  async findByFilters(filters: any): Promise<ICashbackRule[]> {
    return this.model.find(filters).exec();
  }
}
