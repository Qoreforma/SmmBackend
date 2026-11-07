import { BaseRepository } from "../BaseRepository";
import { Types } from "mongoose";
import { Bank, IBank } from "@/models/reference/Bank";

export class BankRepository extends BaseRepository<IBank> {
  constructor() {
    super(Bank);
  }

  async findByFlutterWaveCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ flutterwaveCode: code });
  }

  async findByMonnifyCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ monnifyCode: code });
  }

  async findBySavehavenCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ savehavenCode: code });
  }
}
