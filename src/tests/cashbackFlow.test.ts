import { clearTestDB } from "./setup";
import { WalletService } from "@/services/client/wallet/WalletService";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { Types } from "mongoose";

describe("Cashback Flow", () => {
  let walletService: WalletService;
  let walletRepo: WalletRepository;
  let txRepo: TransactionRepository;

  beforeAll(async () => {
    walletRepo = new WalletRepository();
    txRepo = new TransactionRepository();
    walletService = new WalletService(walletRepo, null as any, txRepo, null as any, null as any, null as any, null as any, null as any);
  });

  afterAll(async () => {
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it("should credit bonus correctly", async () => {
    const userId = new Types.ObjectId().toString();
    await walletRepo.create({
      userId: new Types.ObjectId(userId),
      balance: 1000,
      bonusBalance: 0,
      totalCredits: 1000,
      totalDebits: 0,
      type: "main"
    } as any);

    await walletService.creditBonus(userId, 150, "Cashback earned", {
      type: "cashback_earned",
      provider: "MTN",
      initiatedBy: new Types.ObjectId(userId),
    });

    const wallet = await walletRepo.findOne({ userId: new Types.ObjectId(userId) });
    expect(wallet?.bonusBalance).toBe(150);

    const tx = await txRepo.findOne({ userId: new Types.ObjectId(userId), type: "cashback_earned" });
    expect(tx).toBeDefined();
    expect(tx?.amount).toBe(150);
    expect(tx?.bonusBalanceBefore).toBe(0);
    expect(tx?.bonusBalanceAfter).toBe(150);
  });

  it("should debit bonus when spending cashback", async () => {
    const userId = new Types.ObjectId().toString();
    await walletRepo.create({
      userId: new Types.ObjectId(userId),
      balance: 1000,
      bonusBalance: 200,
      totalCredits: 1000,
      totalDebits: 0,
      type: "main"
    } as any);

    await walletService.debitBonus(userId, 150, "Cashback spent", {
      type: "cashback_spent",
      provider: "MTN",
      initiatedBy: new Types.ObjectId(userId),
      idempotencyKey: "test-bonus-debit"
    });

    const wallet = await walletRepo.findOne({ userId: new Types.ObjectId(userId) });
    expect(wallet?.bonusBalance).toBe(50);
    // Note: debitBonus doesn't change main balance

    const tx = await txRepo.findOne({ userId: new Types.ObjectId(userId), type: "cashback_spent" });
    expect(tx).toBeDefined();
    expect(tx?.amount).toBe(150);
    expect(tx?.bonusBalanceBefore).toBe(200);
    expect(tx?.bonusBalanceAfter).toBe(50);
  });
});
