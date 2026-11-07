import { BaseRepository } from '../BaseRepository';
import { Deposit, IDeposit } from '@/models/banking/Deposit';
import { DepositRequest, IDepositRequest } from '@/models/banking/DepositRequest';

export class DepositRepository extends BaseRepository<IDeposit> {
  constructor() {
    super(Deposit);
  }

  async findByReference(reference: string): Promise<IDeposit | null> {
    return this.model.findOne({ reference }).exec();
  }

  async findByUserId(userId: string, filters: any = {}, page: number = 1, limit: number = 10) {
    const query: any = { userId, ...filters };
    return this.findWithPagination(query, page, limit, { createdAt: -1 });
  }
}

export class DepositRequestRepository extends BaseRepository<IDepositRequest> {
  constructor() {
    super(DepositRequest);
  }

  async findByReference(reference: string): Promise<IDepositRequest | null> {
    return this.model.findOne({ reference }).exec();
  }

  async findByUserId(userId: string, filters: any = {}, page: number = 1, limit: number = 10) {
    const query: any = { userId, ...filters };
    return this.findWithPagination(query, page, limit, { createdAt: -1 });
  }

  async updateStatus(requestId: string, status: string): Promise<IDepositRequest | null> {
    return this.model.findByIdAndUpdate(
      requestId,
      { status },
      { new: true }
    ).exec();
  }
}
