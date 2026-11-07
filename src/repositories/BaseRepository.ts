import mongoose, {
  Model,
  Document,
  FilterQuery,
  UpdateQuery,
  QueryOptions,
  PipelineStage,
  ClientSession,
} from "mongoose";

export abstract class BaseRepository<T extends Document> {
  constructor(protected model: Model<T>) {}

  async create(data: Partial<T>, session?: ClientSession): Promise<T> {
    const document = new this.model(data);
    return await document.save({ session });
  }

  async findById(
    id: string,
    populate?:
      | string
      | string[]
      | mongoose.PopulateOptions
      | mongoose.PopulateOptions[],
    select?: string,
    session?: ClientSession,
  ): Promise<T | null> {
    let query = this.model.findById(id).session(session ?? null);

    if (select) {
      query = query.select(select) as any;
    }

    if (populate) {
      query = query.populate(populate as any);
    }

    return await query.exec();
  }

  async findOne(
    filter: FilterQuery<T>,
    select?: string,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    session?: ClientSession,
  ): Promise<T | null> {
    let query = this.model.findOne(filter).session(session ?? null);

    if (select) {
      query = query.select(select) as any;
    }

    if (populate && populate.length > 0) {
      populate.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    return await query.exec();
  }

  async find(
    filter: FilterQuery<T> = {},
    select?: string,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    session?: ClientSession,
  ): Promise<T[]> {
    let query = this.model.find(filter).session(session ?? null);

    if (select) {
      query = query.select(select) as any;
    }

    if (populate && populate.length > 0) {
      populate.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    return await query.exec();
  }

  async findWithPagination(
    filter: FilterQuery<T>,
    page: number = 1,
    limit: number = 10,
    sort: any = { createdAt: -1 },
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    select?: string,
    session?: ClientSession,
  ): Promise<{ data: T[]; total: number }> {
    const skip = (page - 1) * limit;

    let query = this.model
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .session(session ?? null);

    if (select) {
      query = query.select(select) as any;
    }

    if (populate && populate.length > 0) {
      populate.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    const [data, total] = await Promise.all([
      query.exec(),
      this.model
        .countDocuments(filter)
        .session(session ?? null)
        .exec(),
    ]);

    return { data, total };
  }

  async update(
    id: string,
    data: UpdateQuery<T>,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    select?: string,
    session?: ClientSession,
  ): Promise<T | null> {
    let query = this.model.findByIdAndUpdate(id, data, {
      new: true,
      session,
    });

    if (select) {
      query = query.select(select) as any;
    }

    if (populate && populate.length > 0) {
      populate.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    return await query.exec();
  }

  async updateOne(
    filter: FilterQuery<T>,
    data: UpdateQuery<T>,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    select?: string,
    session?: ClientSession,
  ): Promise<T | null> {
    let query = this.model.findOneAndUpdate(filter, data, {
      new: true,
      session,
    });

    if (select) {
      query = query.select(select) as any;
    }

    if (populate && populate.length > 0) {
      populate.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    return await query.exec();
  }

  async delete(id: string, session?: ClientSession): Promise<T | null> {
    return await this.model
      .findByIdAndDelete(id)
      .session(session ?? null)
      .exec();
  }

  async deleteMany(
    filter: FilterQuery<T>,
    session?: ClientSession,
  ): Promise<any> {
    const deletedCount = await this.model
      .countDocuments(filter)
      .session(session ?? null)
      .exec();
    await this.model
      .deleteMany(filter)
      .session(session ?? null)
      .exec();
    return deletedCount;
  }

  async softDelete(id: string, session?: ClientSession): Promise<T | null> {
    return await this.model
      .findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true, session })
      .exec();
  }

  async count(
    filter: FilterQuery<T> = {},
    session?: ClientSession,
  ): Promise<number> {
    return await this.model
      .countDocuments(filter)
      .session(session ?? null)
      .exec();
  }

  async distinct(field: string, filter: FilterQuery<T> = {}): Promise<any[]> {
    return await this.model.distinct(field, filter).exec();
  }

  async aggregate<T = any>(pipeline: PipelineStage[]): Promise<T[]> {
    return this.model.aggregate<T>(pipeline).exec();
  }

  async aggregateOne<T = any>(pipeline: PipelineStage[]): Promise<T | null> {
    const results = await this.model.aggregate<T>(pipeline).exec();
    return results[0] || null;
  }

  async bulkUpdate(
    ids: string[],
    data: UpdateQuery<T>,
    session?: ClientSession,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const result = await this.model
      .updateMany({ _id: { $in: ids } } as FilterQuery<T>, data, { session })
      .exec();
    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }
}
