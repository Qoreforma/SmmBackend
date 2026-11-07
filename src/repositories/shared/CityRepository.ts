import { BaseRepository } from "../BaseRepository";
import { City, ICity } from "@/models/reference/City";

export class CityRepository extends BaseRepository<ICity> {
  constructor() {
    super(City);
  }

  async findByNumericId(id: number): Promise<ICity | null> {
    return this.model.findOne({ id }).exec();
  }

  async findByStateId(stateId: number): Promise<ICity[]> {
    return this.model.find({ state_id: stateId }).sort({ name: 1 }).exec();
  }

  async findByCountryId(countryId: number): Promise<ICity[]> {
    return this.model.find({ country_id: countryId }).sort({ name: 1 }).exec();
  }

  async findByStateCode(stateCode: string): Promise<ICity[]> {
    return this.model
      .find({ state_code: stateCode.toUpperCase() })
      .sort({ name: 1 })
      .exec();
  }

  async findByCountryCode(countryCode: string): Promise<ICity[]> {
    return this.model
      .find({ country_code: countryCode.toUpperCase() })
      .sort({ name: 1 })
      .exec();
  }

  async searchByName(name: string): Promise<ICity[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({ name: { $regex: searchTerm, $options: "i" } })
      .limit(100) // Limit global searches to prevent huge result sets
      .exec();
  }

  async searchByNameInState(stateId: number, name: string): Promise<ICity[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({
        state_id: stateId,
        name: { $regex: searchTerm, $options: "i" },
      })
      .exec();
  }

  async searchByNameInCountry(
    countryId: number,
    name: string
  ): Promise<ICity[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({
        country_id: countryId,
        name: { $regex: searchTerm, $options: "i" },
      })
      .limit(100)
      .exec();
  }

  // Not advisable to use this in production due to potential large data sets
  async findAllCities(): Promise<ICity[]> {
    return this.model.find({}).sort({ name: 1 }).exec();
  }

  async findAllWithPagination(
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: ICity[]; total: number }> {
    return this.findWithPagination({}, page, limit, { name: 1 });
  }

  async findByStateIdWithPagination(
    stateId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: ICity[]; total: number }> {
    return this.findWithPagination({ state_id: stateId }, page, limit, {
      name: 1,
    });
  }

  async findByCountryIdWithPagination(
    countryId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: ICity[]; total: number }> {
    return this.findWithPagination({ country_id: countryId }, page, limit, {
      name: 1,
    });
  }

  async countByStateId(stateId: number): Promise<number> {
    return this.count({ state_id: stateId });
  }

  async countByCountryId(countryId: number): Promise<number> {
    return this.count({ country_id: countryId });
  }

  async countAllCities(): Promise<number> {
    return this.count({});
  }

  async textSearch(searchTerm: string, limit: number = 50): Promise<ICity[]> {
    return this.model
      .find({ $text: { $search: searchTerm } })
      .limit(limit)
      .exec();
  }
}
