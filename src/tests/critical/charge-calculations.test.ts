
import { WalletService } from "../../services/client/wallet/WalletService";
import ServiceContainer from "../../services/client/container";
import { User } from "../../models/core/User";
import { Wallet } from "../../models/wallet/Wallet";
import { Transaction } from "../../models/wallet/Transaction";
import { ServiceCharge } from "../../models/billing/fees/ServiceCharge";
import { HelperService } from "@/services/client/utility/HelperService";

describe("CRITICAL 3: Charge Calculations - Financial Accuracy", () => {
  let walletService: WalletService;
  let helperService: HelperService;
  let senderId: string;
  let recipientId: string;

  beforeEach(async () => {
    // Get services from container
    walletService = ServiceContainer.getWalletService();
    helperService = ServiceContainer.getHelperService();

    // Create service charge configuration
    await ServiceCharge.create({
      code: "withdrawal", // ✅ Must match the transactionType parameter
      name: "Transfer Charge",
      type: "percentage",
      value: 5,
      details: "Standard transfer charge",
    });

    // For wallet transfers
    await ServiceCharge.create({
      code: "wallet_transfer", // ✅ Must match TRANSACTION_TYPES.WALLET_TRANSFER
      name: "Wallet Transfer Charge",
      type: "percentage",
      value: 5,
      details: "Wallet to wallet transfer charge",
    });
    // Create test users
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

    // Create wallets with sufficient balance
    await Wallet.create({
      userId: sender._id,
      balance: 500000, // ₦500,000
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

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

  it("should calculate charges correctly for standard amounts", async () => {
    /**
     * SCENARIO: Test real charge calculations for common amounts
     * Expected: 5% charge on each amount
     */

    const testCases = [
      { amount: 10000, expectedCharge: 500, expectedTotal: 10500 },
      { amount: 50000, expectedCharge: 2500, expectedTotal: 52500 },
      { amount: 100000, expectedCharge: 5000, expectedTotal: 105000 },
    ];

    for (const testCase of testCases) {
      const result = await helperService.calculateAmountWithCharge(
        testCase.amount,
        "withdrawal"
      );

      console.log(`Amount: ₦${testCase.amount.toLocaleString()}`);
      console.log(`  Base: ₦${result.baseAmount.toLocaleString()}`);
      console.log(`  Charge: ₦${result.chargeAmount.toLocaleString()}`);
      console.log(`  Total: ₦${result.totalAmount.toLocaleString()}`);

      /**
       * CRITICAL ASSERTIONS
       */
      expect(result.baseAmount).toBe(testCase.amount);
      expect(result.chargeAmount).toBe(testCase.expectedCharge);
      expect(result.totalAmount).toBe(testCase.expectedTotal);

      // Verify math: base + charge = total
      expect(result.baseAmount + result.chargeAmount).toBe(result.totalAmount);
    }

    console.log("✅ Standard charge calculation test passed");
  });

  it("should handle decimal amounts with kobo precision", async () => {
    /**
     * SCENARIO: Real-world amounts with kobo (cents)
     * Nigerian Naira uses kobo (1/100 of Naira)
     * Must not lose precision in calculations
     */

    const testCases = [
      { amount: 10000.5, expectedCharge: 500.03 }, // 5% of 10000.50 = 500.025 → rounds to 500.03
      { amount: 50000.75, expectedCharge: 2500.04 }, // 5% of 50000.75 = 2500.0375 → rounds to 2500.04
    ];

    for (const testCase of testCases) {
      const result = await helperService.calculateAmountWithCharge(
        testCase.amount,
        "withdrawal"
      );

      console.log(`Amount: ₦${testCase.amount}`);
      console.log(`  Charge: ₦${result.chargeAmount}`);
      console.log(`  Total: ₦${result.totalAmount}`);

      /**
       * CRITICAL ASSERTIONS: Use toBeCloseTo for floating point
       */
      expect(result.baseAmount).toBeCloseTo(testCase.amount, 2);
      expect(result.chargeAmount).toBeCloseTo(testCase.expectedCharge, 2);

      // Verify no money is lost
      expect(result.baseAmount + result.chargeAmount).toBeCloseTo(
        result.totalAmount,
        2
      );
    }

    console.log("✅ Decimal precision test passed");
  });

  it("should never lose money in charge calculations (conservation of money)", async () => {
    /**
     * SCENARIO: Test that money is never lost in calculations
     * The sum of parts must always equal the whole
     */

    const testAmounts = [1000, 5555, 50000, 99999, 100000, 250000];

    for (const amount of testAmounts) {
      const result = await helperService.calculateAmountWithCharge(
        amount,
        "withdrawal"
      );

      /**
       * CRITICAL ASSERTION: Conservation of money
       * base + charge MUST equal total (no money disappears)
       */
      const calculatedTotal = result.baseAmount + result.chargeAmount;
      expect(calculatedTotal).toEqual(result.totalAmount);

      // Total should always be >= original amount (we're adding charges)
      expect(result.totalAmount).toBeGreaterThanOrEqual(amount);

      // Charge should never be negative
      expect(result.chargeAmount).toBeGreaterThanOrEqual(0);

      console.log(
        `₦${amount}: base(${result.baseAmount}) + charge(${result.chargeAmount}) = total(${result.totalAmount}) ✓`
      );
    }

    console.log("✅ Money conservation test passed");
  });

  it("should apply correct charges in real transfers", async () => {
    /**
     * SCENARIO: Perform actual transfer and verify charge is applied
     * This tests the entire flow with real database operations
     */

    const transferAmount = 50000;
    const expectedCharge = 2500; // 5% of 50000
    const expectedTotal = 52500;

    // Perform transfer
    const result = await walletService.transferFunds(
      senderId,
      "recipient",
      transferAmount,
      "Test transfer with charge verification"
    );

    console.log("Transfer result:", {
      amount: result.amount,
      serviceCharge: result.serviceCharge,
      totalDebited: result.amountSent,
    });

    /**
     * CRITICAL ASSERTIONS: Real transfer charge verification
     */
    expect(result.amount).toBe(transferAmount); // Recipient receives this
    expect(result.serviceCharge).toBe(expectedCharge);
    expect(result.amountSent).toBe(expectedTotal); // Sender pays this

    // Verify wallet balances
    const senderWallet = await Wallet.findOne({ userId: senderId });
    const recipientWallet = await Wallet.findOne({ userId: recipientId });

    // Sender should be debited the total (amount + charge)
    expect(senderWallet?.balance).toBe(500000 - expectedTotal);

    // Recipient should receive only the base amount (no charge)
    expect(recipientWallet?.balance).toBe(transferAmount);

    // Verify transaction records
    const transactions = await Transaction.find({ userId: senderId });
    const debitTxn = transactions.find((t) => t.direction === "DEBIT");

    expect(debitTxn?.amount).toBe(expectedTotal);
    expect(debitTxn?.meta?.chargeInfo?.serviceCharge).toBe(expectedCharge);

    console.log("✅ Real transfer charge verification passed");
  });

  it("should handle edge cases: very small amounts", async () => {
    /**
     * SCENARIO: Test charge calculation for small amounts (₦10, ₦100)
     * Edge case: charge might round to 0 or very small values
     */

    const smallAmounts = [10, 100, 500];

    for (const amount of smallAmounts) {
      const result = await helperService.calculateAmountWithCharge(
        amount,
        "withdrawal"
      );

      console.log(
        `₦${amount}: charge = ₦${result.chargeAmount}, total = ₦${result.totalAmount}`
      );

      /**
       * ASSERTIONS
       */
      // Even for small amounts, charge should be non-negative
      expect(result.chargeAmount).toBeGreaterThanOrEqual(0);

      // Total should always be >= base amount
      expect(result.totalAmount).toBeGreaterThanOrEqual(amount);

      // Money conservation
      expect(result.baseAmount + result.chargeAmount).toBeCloseTo(
        result.totalAmount,
        2
      );
    }

    console.log("✅ Small amount edge case test passed");
  });

  it("should handle edge cases: very large amounts", async () => {
    /**
     * SCENARIO: Test charge calculation for large amounts
     * Edge case: ensure no overflow or precision loss
     */

    const largeAmounts = [1000000, 5000000, 10000000]; // Up to ₦10M

    for (const amount of largeAmounts) {
      const result = await helperService.calculateAmountWithCharge(
        amount,
        "withdrawal"
      );

      console.log(
        `₦${amount.toLocaleString()}: charge = ₦${result.chargeAmount.toLocaleString()}, total = ₦${result.totalAmount.toLocaleString()}`
      );

      /**
       * ASSERTIONS
       */
      // Charge should be reasonable (5% of amount)
      const expectedCharge = amount * 0.05;
      expect(result.chargeAmount).toBeCloseTo(expectedCharge, 2);

      // Money conservation
      expect(result.baseAmount + result.chargeAmount).toBeCloseTo(
        result.totalAmount,
        2
      );

      // No overflow
      expect(result.totalAmount).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }

    console.log("✅ Large amount edge case test passed");
  });
});
