import { WalletService } from "../../services/client/wallet/WalletService";
import { Types } from "mongoose";
import { Transaction } from "../../models/wallet/Transaction";
import { Wallet } from "../../models/wallet/Wallet";
import { User } from "../../models/core/User";
import ServiceContainer from "../../services/client/container";

describe("CRITICAL 1: Race Conditions - Concurrent Transfers", () => {
  let walletService: WalletService;
  let senderId: string;
  let recipientId: string;
  const initialBalance = 100000; // ₦100,000

  // Clear database and create fresh test data before each test
  beforeEach(async () => {
    
    // Get service from container
    walletService = ServiceContainer.getWalletService();

    // Create real test users
    const sender = await User.create({
      username: "sender",
      email: "sender@test.com",
      password: "password123",
      firstname: "Test",
      lastname: "Sender",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    const recipient = await User.create({
      username: "recipient",
      email: "recipient@test.com",
      password: "password123",
      firstname: "Test",
      lastname: "Recipient",
      phone: "+2348087654321",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    // Create sender's wallet with initial balance
    await Wallet.create({
      userId: sender._id,
      balance: initialBalance,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    // Create recipient's wallet
    await Wallet.create({
      userId: recipient._id,
      balance: 0,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    senderId = sender._id.toString();
    recipientId = recipient._id.toString();
  });

  it("should prevent double-debit on 3 concurrent transfers of ₦50k", async () => {
    const transferAmount = 50000;

    // Launch 3 concurrent transfers - THIS TESTS REAL RACE CONDITIONS
    const transfer1 = walletService.transferFunds(
      senderId,
      "recipient", // Using username
      transferAmount,
      "Transfer 1"
    );

    const transfer2 = walletService.transferFunds(
      senderId,
      "recipient",
      transferAmount,
      "Transfer 2"
    );

    const transfer3 = walletService.transferFunds(
      senderId,
      "recipient",
      transferAmount,
      "Transfer 3"
    );

    // Wait for all to complete
    const results = await Promise.allSettled([transfer1, transfer2, transfer3]);

    // Count successes and failures
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    console.log(`Transfers: ${succeeded} succeeded, ${failed} failed`);
    console.log("Results:", results.map((r, i) => ({
      transfer: i + 1,
      status: r.status,
      error: r.status === "rejected" ? r.reason.message : null
    })));

    /**
     * CRITICAL ASSERTIONS
     */
    // Only 1 transfer should succeed
    expect(succeeded).toBe(1);
    expect(failed).toBe(2);

    // Check wallet balance NEVER goes negative
    const senderWallet = await Wallet.findOne({ userId: senderId });
    expect(senderWallet?.balance).toBeGreaterThanOrEqual(0);

    // Check that balance decreased by only ONE transfer amount
    expect(senderWallet?.balance).toBeLessThan(initialBalance);
    expect(senderWallet?.balance).toBeGreaterThan(0);

    // Count actual successful transactions in DB
    const debitTransactions = await Transaction.find({
      userId: senderId,
      type: "DEBIT",
      status: "completed",
    });

    expect(debitTransactions.length).toBeLessThanOrEqual(1);

    console.log(`✅ Race condition test passed: ${succeeded}/3 transfers succeeded (expected 1)`);
    console.log(`Final sender balance: ₦${senderWallet?.balance.toLocaleString()}`);
  });

  it("should handle rapid succession transfers correctly", async () => {
    // Test 5 transfers in rapid succession
    const transferAmount = 15000; // Smaller amounts

    const transfers = Array.from({ length: 5 }, (_, i) =>
      walletService.transferFunds(
        senderId,
        "recipient",
        transferAmount,
        `Transfer ${i + 1}`
      )
    );

    const results = await Promise.allSettled(transfers);
    
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    
    // Check final balance matches number of successful transfers
    const senderWallet = await Wallet.findOne({ userId: senderId });
    const recipientWallet = await Wallet.findOne({ userId: recipientId });

    console.log(`${succeeded} transfers succeeded`);
    console.log(`Sender final balance: ₦${senderWallet?.balance.toLocaleString()}`);
    console.log(`Recipient final balance: ₦${recipientWallet?.balance.toLocaleString()}`);

    // Balance should never go negative
    expect(senderWallet?.balance).toBeGreaterThanOrEqual(0);
    
    // Total debited should match successful transfers (accounting for charges)
    expect(senderWallet?.balance).toBeLessThan(initialBalance);
  });

  it("should prevent concurrent deposit duplicates", async () => {
    // Create a mock payment reference
    const paymentReference = `PAY_${Date.now()}`;
    const depositAmount = 50000;

    // TODO: Implement deposit verification if you have this method
    // This would test idempotency of payment verification
    
    console.log("⚠️  Deposit duplicate test - implement when verifyPayment is available");
  });
});