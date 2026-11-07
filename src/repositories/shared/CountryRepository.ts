import { BaseRepository } from "../BaseRepository";
import { Country, ICountry } from "@/models/reference/Country";

export class CountryRepository extends BaseRepository<ICountry> {
  constructor() {
    super(Country);
  }

  async findByNumericId(id: number): Promise<ICountry | null> {
    return this.model.findOne({ id }).exec();
  }

  async findByIso2(iso2: string): Promise<ICountry | null> {
    return this.model.findOne({ iso2: iso2.toUpperCase() }).exec();
  }

  async findByIso3(iso3: string): Promise<ICountry | null> {
    return this.model.findOne({ iso3: iso3.toUpperCase() }).exec();
  }

  async searchByName(name: string): Promise<ICountry[]> {
    const searchTerm = name.toLowerCase();
    return this.model
      .find({ name: { $regex: searchTerm, $options: "i" } })
      .exec();
  }

  async findByRegion(region: string): Promise<ICountry[]> {
    return this.model
      .find({ region: { $regex: `^${region}$`, $options: "i" } })
      .exec();
  }

  async findAllCountries(): Promise<ICountry[]> {
    return this.model.find({}).sort({ name: 1 }).exec();
  }

  async findAllWithPagination(
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: ICountry[]; total: number }> {
    return this.findWithPagination({}, page, limit, { name: 1 });
  }

  async countCountries(): Promise<number> {
    return this.count({});
  }

  async findByPhonecode(phonecode: string): Promise<ICountry[]> {
    return this.model.find({ phonecode }).exec();
  }

  async findByCurrency(currency: string): Promise<ICountry[]> {
    return this.model
      .find({ currency: { $regex: `^${currency}$`, $options: "i" } })
      .exec();
  }
}
