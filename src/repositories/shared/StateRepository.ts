
import { BaseRepository } from "../BaseRepository";
import { State, IState } from "@/models/reference/State";

export class StateRepository extends BaseRepository<IState> {
  constructor() {
    super(State);
  }

  async findByNumericId(id: number): Promise<IState | null> {
    return this.model.findOne({ id }).exec();
  }

  async findByCountryId(countryId: number): Promise<IState[]> {
    return this.model.find({ country_id: countryId }).sort({ name: 1 }).exec();
  }

  async findByCountryCode(countryCode: string): Promise<IState[]> {
    return this.model
      .find({ country_code: countryCode.toUpperCase() })
      .sort({ name: 1 })
      .exec();
  }

  async findByIso2(iso2: string): Promise<IState | null> {
    return this.model.findOne({ iso2: iso2.toUpperCase() }).exec();
  }

  async searchByName(countryId: number, name: string): Promise<IState[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({
        country_id: countryId,
        name: { $regex: searchTerm, $options: "i" },
      })
      .exec();
  }

  async searchByNameGlobal(name: string): Promise<IState[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({ name: { $regex: searchTerm, $options: "i" } })
      .exec();
  }

  async findAllStates(): Promise<IState[]> {
    return this.model.find({}).sort({ name: 1 }).exec();
  }

  async findAllWithPagination(
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: IState[]; total: number }> {
    return this.findWithPagination({}, page, limit, { name: 1 });
  }

  async findByCountryIdWithPagination(
    countryId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: IState[]; total: number }> {
    return this.findWithPagination({ country_id: countryId }, page, limit, {
      name: 1,
    });
  }

  async countByCountryId(countryId: number): Promise<number> {
    return this.count({ country_id: countryId });
  }
}
