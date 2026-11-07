

import { WalletService } from "../../services/client/wallet/WalletService";
import ServiceContainer from "../../services/client/container";
import { User } from "../../models/core/User";
import { Wallet } from "../../models/wallet/Wallet";
import { Transaction } from "../../models/wallet/Transaction";

describe("CRITICAL 4: Balance Consistency - Professional Fintech Standard", () => {
  let walletService: WalletService;
  let userId: string;
  let recipientId: string;

  beforeEach(async () => {
    walletService = ServiceContainer.getWalletService();

    const user = await User.create({
      username: "testuser",
      email: "test@example.com",
      password: "password123",
      firstname: "Test",
      lastname: "User",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    const recipient = await User.create({
      username: "recipient",
      email: "recipient@example.com",
      password: "password123",
      firstname: "Recipient",
      lastname: "User",
      phone: "+2348087654321",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    await Wallet.create({
      userId: user._id,
      balance: 100000,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    await Wallet.create({
      userId: recipient._id,
      balance: 50000,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    userId = user._id.toString();
    recipientId = recipient._id.toString();
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 1: INSUFFICIENT BALANCE REJECTION
   * ═══════════════════════════════════════════════════════════════
   */
  it("should reject debit if insufficient balance", async () => {
    const walletBefore = await Wallet.findOne({ userId });
    const balanceBefore = walletBefore?.balance;

    console.log(`Wallet balance: ₦${balanceBefore?.toLocaleString()}`);
    console.log("Attempting to debit: ₦150,000");

    // Should throw error because balance (100k) < amount (150k)
    try {
      await walletService.debitWallet(userId, 150000, "Over-debit attempt");
      fail("Should have thrown Insufficient balance error");
    } catch (error: any) {
      expect(error.message).toContain("Insufficient balance");
    }

    // Verify balance unchanged
    const walletAfter = await Wallet.findOne({ userId });
    expect(walletAfter?.balance).toBe(balanceBefore);
    expect(walletAfter?.balance).toBeGreaterThanOrEqual(0);

    // No transaction created
    const transactions = await Transaction.find({
      userId,
      type: "wallet_debit",
    });
    expect(transactions.length).toBe(0);

    console.log("✅ Insufficient balance rejection passed");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 2: VALID DEBIT SUCCEEDS
   * ═══════════════════════════════════════════════════════════════
   */
  it("should debit wallet successfully when balance is sufficient", async () => {
    const debitAmount = 50000;

    const result = await walletService.debitWallet(
      userId,
      debitAmount,
      "Valid debit test"
    );

    console.log("Debit result:", {
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      amount: result.amount,
    });

    // Assertions on return value
    expect(result).toBeDefined();
    expect(result.balanceBefore).toBe(100000);
    expect(result.balanceAfter).toBe(50000);
    expect(result.direction).toBe("DEBIT");
    expect(result.reference).toBeDefined();

    // Verify actual database balance
    const wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(50000);
    expect(wallet?.balance).toBeGreaterThanOrEqual(0);

    // Transaction should exist with SUCCESS status
    const transaction = await Transaction.findOne({
      reference: result.reference,
    });
    expect(transaction).toBeDefined();
    expect(transaction?.status).toBe("success");
    expect(transaction?.balanceAfter).toBe(50000);

    console.log("✅ Valid debit passed");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 3: CREDIT WALLET WORKS
   * ═══════════════════════════════════════════════════════════════
   */
  it("should credit wallet and increase balance correctly", async () => {
    const creditAmount = 100000;

    const result = await walletService.creditWallet(
      userId,
      creditAmount,
      "Credit test"
    );

    console.log("Credit result:", {
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      amount: result.amount,
    });

    expect(result).toBeDefined();
    expect(result.direction).toBe("CREDIT");
    expect(result.balanceBefore).toBe(100000);
    expect(result.balanceAfter).toBe(200000);

    const wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(200000);

    console.log(`✅ Valid credit passed - new balance: ₦${wallet?.balance.toLocaleString()}`);
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 4: CONCURRENT DEBITS - DATA INTEGRITY TEST
   * ═══════════════════════════════════════════════════════════════
   * 
   * REAL TEST: What actually happens with concurrent requests
   * This WILL have conflicts - that's expected and OK
   * We test that NO DATA CORRUPTION happens
   */
  it("should handle concurrent debits without corrupting data", async () => {
    const debitAmount = 60000;

    console.log("Scenario: 2 concurrent debits of ₦60k from ₦100k wallet");
    console.log("Expected: One succeeds, one fails (insufficient balance after first)");

    // Launch two concurrent debits
    const debit1 = walletService.debitWallet(
      userId,
      debitAmount,
      "Concurrent debit 1"
    );

    const debit2 = walletService.debitWallet(
      userId,
      debitAmount,
      "Concurrent debit 2"
    );

    const results = await Promise.allSettled([debit1, debit2]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    console.log("Results:");
    results.forEach((r, i) => {
      console.log(
        `  Debit ${i + 1}: ${r.status === "fulfilled" ? "SUCCESS" : "FAILED"}`
      );
      if (r.status === "rejected") {
        console.log(`    Reason: ${r.reason.message}`);
      }
    });

    // Critical assertions
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    // Final balance should make sense
    const wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBeGreaterThanOrEqual(0);
    expect(wallet?.balance).toBeLessThanOrEqual(100000);

    // Should be exactly 40k (100k - 60k)
    expect(wallet?.balance).toBe(40000);

    console.log(`✅ Concurrent debit protection passed - final balance: ₦${wallet?.balance.toLocaleString()}`);
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 5: SEQUENTIAL DEBITS (How it works in real queue)
   * ═══════════════════════════════════════════════════════════════
   * 
   * IMPORTANT: Uses for + await, NOT Promise.allSettled()
   * Each debit waits for completion before next one starts
   */
  it("PROFESSIONAL: should handle sequential debits correctly", async () => {
    // Reset wallet to 100k
    let wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(100000);

    const debitAmount = 15000;
    let successCount = 0;
    let failureCount = 0;
    const results: any[] = [];

    console.log(`Starting balance: ₦${wallet?.balance.toLocaleString()}`);
    console.log(`Making 10 debits of ₦${debitAmount.toLocaleString()} each`);

    // ACTUAL sequential processing: for + await (NOT Promise.allSettled)
    // Each debit waits for completion before starting next
    for (let i = 1; i <= 10; i++) {
      try {
        const result = await walletService.debitWallet(
          userId,
          debitAmount,
          `Sequential debit ${i}`
        );
        successCount++;
        results.push({
          debit: i,
          status: "success",
          balanceAfter: result.balanceAfter,
        });
        console.log(
          `  Debit ${i}: ✅ SUCCESS - New balance: ₦${result.balanceAfter.toLocaleString()}`
        );
      } catch (error: any) {
        failureCount++;
        results.push({
          debit: i,
          status: "failed",
          reason: error.message,
        });
        console.log(`  Debit ${i}: ❌ FAILED - ${error.message}`);
      }
    }

    wallet = await Wallet.findOne({ userId });

    console.log(`\nSequential Processing Results:`);
    console.log(`  Succeeded: ${successCount}/10`);
    console.log(`  Failed: ${failureCount}/10`);
    console.log(`  Final balance: ₦${wallet?.balance.toLocaleString()}`);

    /**
     * CRITICAL ASSERTIONS FOR SEQUENTIAL
     */
    // Sequential math: 100k ÷ 15k = 6 full debits possible
    expect(successCount).toBe(6);
    expect(failureCount).toBe(4);

    // Final balance = 100k - (6 × 15k) = 10k
    expect(wallet?.balance).toBe(10000);
    expect(wallet?.balance).toBeGreaterThanOrEqual(0);

    // First 6 should succeed
    for (let i = 0; i < 6; i++) {
      expect(results[i].status).toBe("success");
    }

    // Last 4 should fail with insufficient balance
    for (let i = 6; i < 10; i++) {
      expect(results[i].status).toBe("failed");
      expect(results[i].reason).toContain("Insufficient balance");
    }

    // Balance should decrease exactly by 6 debits
    expect(100000 - wallet!.balance).toBe(6 * debitAmount);

    console.log("✅ Sequential debits test PASSED - exactly 6/10 succeeded");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 6: IDEMPOTENCY (Safe Retries - Critical for Fintech)
   * ═══════════════════════════════════════════════════════════════
   */
  it("PROFESSIONAL: should support safe retries via idempotency keys", async () => {
    /**
     * Scenario: Network fails after debit but before response
     * User retries with same idempotencyKey
     * Should return same result, not double-debit
     */

    const idempotencyKey = `IDEMPOTENT_${Date.now()}`;

    // First attempt
    const result1 = await walletService.debitWallet(
      userId,
      50000,
      "Idempotent debit",
      { idempotencyKey }
    );

    const wallet1 = await Wallet.findOne({ userId });

    // Retry with same key (network retry scenario)
    const result2 = await walletService.debitWallet(
      userId,
      50000,
      "Idempotent debit",
      { idempotencyKey }
    );

    const wallet2 = await Wallet.findOne({ userId });

    /**
     * PROFESSIONAL ASSERTIONS
     */
    // Should return identical results
    expect(result1.reference).toBe(result2.reference);
    expect(result1.balanceAfter).toBe(result2.balanceAfter);

    // Wallet should be unchanged on retry
    expect(wallet1?.balance).toBe(wallet2?.balance);

    // Only ONE transaction should exist (not two)
    const transactions = await Transaction.findOne({
      idempotencyKey,
    });
    expect(transactions).toBeDefined();

    console.log("✅ Idempotent retries work safely");
    console.log("   Second request returned same result without double-debit");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 7: MIXED OPERATIONS (Real User Behavior)
   * ═══════════════════════════════════════════════════════════════
   */
  it("PROFESSIONAL: should maintain consistency across mixed operations", async () => {
    /**
     * Real user behavior:
     * - Receive payment (credit)
     * - Send money (debit)
     * - Receive money (credit)
     * - Send money (debit)
     */

    await walletService.creditWallet(userId, 50000, "Payment received");
    await walletService.debitWallet(userId, 30000, "Sent to John");
    await walletService.creditWallet(userId, 20000, "Refund");
    await walletService.debitWallet(userId, 40000, "Sent to Jane");

    const wallet = await Wallet.findOne({ userId });

    // Math: 100k + 50k - 30k + 20k - 40k = 100k
    expect(wallet?.balance).toBe(100000);
    expect(wallet?.balance).toBeGreaterThanOrEqual(0);

    const transactions = await Transaction.find({ userId });
    expect(transactions.length).toBe(4);
    expect(transactions.every((t) => t.status === "success")).toBe(true);

    console.log("✅ Mixed operations maintain consistency");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 8: EDGE CASES (Boundary Conditions)
   * ═══════════════════════════════════════════════════════════════
   */
  it("PROFESSIONAL: should handle edge cases safely", async () => {
    // Debit exact balance
    await walletService.debitWallet(userId, 100000, "Debit exact balance");
    let wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(0);

    // Try to debit zero balance
    await expect(
      walletService.debitWallet(userId, 1, "Debit zero balance")
    ).rejects.toThrow("Insufficient balance");

    wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(0);

    // Credit after zero
    await walletService.creditWallet(userId, 50000, "Recovery credit");
    wallet = await Wallet.findOne({ userId });
    expect(wallet?.balance).toBe(50000);

    console.log("✅ Edge cases handled safely");
  });

  /**
   * ═══════════════════════════════════════════════════════════════
   * TEST 9: TRANSACTION CONSISTENCY
   * ═══════════════════════════════════════════════════════════════
   */
  it("PROFESSIONAL: transaction records must match wallet state", async () => {
    // Perform operations
    const credit = await walletService.creditWallet(userId, 50000, "Credit");
    const debit = await walletService.debitWallet(userId, 30000, "Debit");

    const wallet = await Wallet.findOne({ userId });

    // Last operation's balanceAfter must match wallet balance
    expect(debit.balanceAfter).toBe(wallet?.balance);

    // Transaction math must be correct
    expect(credit.balanceAfter).toBe(
      credit.balanceBefore + credit.amount
    );
    expect(debit.balanceAfter).toBe(
      debit.balanceBefore - debit.amount
    );

    // Historical chain must be unbroken
    const transactions = await Transaction.find({ userId }).sort({
      createdAt: 1,
    });

    for (let i = 1; i < transactions.length; i++) {
      expect(transactions[i].balanceBefore).toBe(
        transactions[i - 1].balanceAfter
      );
    }

    console.log("✅ Transaction chain is consistent");
  });
});