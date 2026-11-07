import { BaseRepository } from "../BaseRepository";
import { Alert, IAlert } from "@/models/system/Alert";

export class AlertRepository extends BaseRepository<IAlert> {
  constructor() {
    super(Alert);
  }

  async findPending(): Promise<IAlert[]> {
    return await this.model.find({ status: "pending", deletedAt: null }).exec();
  }

  async findByStatus(status: string): Promise<IAlert[]> {
    return await this.model.find({ status, deletedAt: null }).exec();
  }

  async findReadyForDispatch(): Promise<IAlert[]> {
    const now = new Date();
    return await this.model
      .find({
        status: "pending",
        deletedAt: null,
        dispatchTime: { $lte: now },
      })
      .exec();
  }

  async findReadyForBatchContinuation(): Promise<IAlert[]> {
    const now = new Date();
    return await this.model
      .find({
        status: "dispatching",
        deletedAt: null,
        nextBatchAt: { $lte: now },
      })
      .exec();
  }
}
