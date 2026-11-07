import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { SaveHavenService } from "../../client/providers/payments/SaveHavenService";
import { BankRepository } from "@/repositories/shared/BankRepository";

export class SystemBankAccountService {
  constructor(
    private bankAccountRepository: SystemBankAccountRepository,
    private saveHavenService: SaveHavenService,
    private bankRepository: BankRepository,
  ) {}

  async listBankAccounts(page: number = 1, limit: number = 20) {
    const result = await this.bankAccountRepository.findWithPagination(
      {},
      page,
      limit,
    );

    const data = await Promise.all(
      result.data.map(async (account) => {
        const bank = await this.bankRepository.findBySavehavenCode(
          account.bankCode,
        );
        return {
          ...account.toObject(),
          bank: {
            bankName: bank ? bank.name : "Unknown Bank",
            icon: bank ? bank.icon : null,
          },
        };
      }),
    );
    return {
      data,
      total: result.total,
    };
  }

  async verifyBankAccount(bankCode: string, accountNumber: string) {
    const result = await this.saveHavenService.nameEnquiry(
      accountNumber,
      bankCode
    );
    return result;
  }

  async createBankAccount(data: any) {
    const payload = {
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      bankCode: data.bankCode,
      isActive: true,
      isDefault: true,
    };
    const bankAccount = await this.bankAccountRepository.create(payload);
    return bankAccount;
  }

  async updateBankAccountStatus(accountId: string, isActive: boolean) {
    const bankAccount = await this.bankAccountRepository.findById(accountId);
    if (!bankAccount) {
      throw new Error("Bank account not found");
    }

    bankAccount.isActive = isActive;
    await bankAccount.save();

    return bankAccount;
  }

  async deleteBankAccount(accountId: string) {
    await this.bankAccountRepository.delete(accountId);
  }
}
