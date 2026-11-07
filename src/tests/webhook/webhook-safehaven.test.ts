import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { Deposit } from "@/models/banking/Deposit";
import { User } from "@/models/core/User";

import { SaveHavenWebhookService } from "@/services/client/webhooks/SaveHavenWebhookService";
import ServiceContainer from "@/services/client/container";
import { Types } from "mongoose";
import logger from "@/logger";
import { SafeHavenWebhookProcessor } from "@/services/client/webhooks/SafeHavenWebhookProcessor";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";

describe("SaveHaven Webhook Integration", () => {
  let processor: SafeHavenWebhookProcessor;
  let webhookService: SaveHavenWebhookService;
  let userId: string;
  let walletId: string;
  let virtualAccountId: string;

  beforeEach(async () => {
    processor = new SafeHavenWebhookProcessor();
    webhookService = new SaveHavenWebhookService(
      ServiceContainer.getNotificationService(),
    );

    // Every deposit now gets verified directly against SafeHaven before
    // crediting (see SaveHavenWebhookService.handleWalletFunding) instead
    // of trusting the webhook's own claim. Default to "found, not
    // reversed" here so existing tests keep exercising the success path
    // unless a specific test overrides this with mockResolvedValueOnce.
    jest
      .spyOn(SaveHavenService.prototype, "getAccountStatement")
      .mockResolvedValue({ found: true, isReversal: false });

    // Create test user
    const user = await User.create({
      firstname: "SaveHaven",
      lastname: "Test",
      email: "savehaven@test.com",
      password: "test123",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    userId = user._id.toString();

    // Create wallet
    const wallet = await Wallet.create({
      userId: user._id,
      balance: 0,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    walletId = wallet._id.toString();

    // Create virtual account
    const virtualAccount = await VirtualAccount.create({
      userId: user._id,
      provider: "saveHaven",
      accountNumber: "1234567890",
      accountName: "SaveHaven Virtual Account",
      bankName: "SaveHaven Bank",
      type: "permanent",
      isActive: true,
      // Real permanent sub-accounts always have this set (see
      // VirtualAccountService) - it's required for the new statement-based
      // verification call to even be attempted.
      meta: {
        providerAccountId: "SH-PROVIDER-ACC-001",
      },
    });

    virtualAccountId = virtualAccount._id.toString();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Inwards Transfer (Wallet Funding)", () => {
    it("should process successful wallet funding webhook", async () => {
      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-12345",
          client: "test-client",
          type: "Inwards" as const,
          sessionId: "session-123",
          nameEnquiryReference: "ner-123",
          paymentReference: "PAY-FUND-001",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0123456789",
          debitAccountName: "Test Sender",
          amount: 50000,
          fees: 500,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Wallet funding",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      // Validate payload
      const isValid = processor.validatePayload(webhookPayload);
      expect(isValid).toBe(true);

      // Process webhook
      const result = await processor.process(webhookPayload);
      expect(result.reference).toBe("PAY-FUND-001");
      expect(result.status).toBe("success");
      expect(result.metadata.amount).toBe(50000);

      // Execute webhook service
      await webhookService.processWebhook(result);

      // Verify wallet credited
      const updatedWallet = await Wallet.findById(walletId);
      const netAmount = 50000 - 500; // amount - fees
      expect(updatedWallet?.balance).toBe(netAmount);

      // Verify transaction created
      const transaction = await Transaction.findOne({
        reference: /TXN/,
        userId,
        type: "deposit",
      });
      expect(transaction?.status).toBe("success");
      expect(transaction?.direction).toBe("CREDIT");
      expect(transaction?.amount).toBe(netAmount);
      expect(transaction?.balanceAfter).toBe(netAmount);

      // Verify deposit created
      const deposit = await Deposit.findOne({
        userId,
        provider: "saveHaven",
      });
      expect(deposit?.status).toBe("success");
      expect(deposit?.amount).toBe(netAmount);
    });

    it("should reject duplicate wallet funding webhook", async () => {
      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-DUP-001",
          type: "Inwards" as const,
          sessionId: "session-dup",
          paymentReference: "PAY-DUP-001",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          amount: 30000,
          status: "Completed" as const,
          isReversed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Optional fields omitted
        },
      };

      const result = await processor.process(webhookPayload);
      await webhookService.processWebhook(result);

      const walletAfterFirst = await Wallet.findById(walletId);
      const firstBalance = walletAfterFirst?.balance;

      // Retry webhook (should not double-credit)
      const result2 = await processor.process(webhookPayload);
      await webhookService.processWebhook(result2);

      const walletAfterSecond = await Wallet.findById(walletId);
      expect(walletAfterSecond?.balance).toBe(firstBalance);

      // Verify only one transaction
      const transactions = await Transaction.find({
        providerReference: "PAY-DUP-001",
      });
      expect(transactions.length).toBe(1);
    });

    it("should handle failed inwards transfer", async () => {
      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-FAIL-001",
          type: "Inwards" as const,
          sessionId: "session-fail",
          nameEnquiryReference: "ner-fail",
          paymentReference: "PAY-FAIL-001",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0123456789",
          debitAccountName: "Test Sender",
          amount: 25000,
          fees: 250,
          vat: 0,
          stampDuty: 0,
          status: "Failed" as const,
          isReversed: false,
          responseCode: "99",
          responseMessage: "Transfer failed",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Failed transfer",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await processor.process(webhookPayload);
      expect(result.status).toBe("failed");

      // A genuinely failed inward transfer never produces a statement
      // ledger entry at all - there's nothing to positively confirm as
      // "failed" (only "found" or "not found yet"). So this webhook's own
      // "Failed" claim is deliberately NOT trusted - it defers to pending,
      // same as an inconclusive/not-yet-settled case, and only becomes
      // admin_review after SafeHavenPendingVerificationJob's timeout.
      jest
        .spyOn(SaveHavenService.prototype, "getAccountStatement")
        .mockResolvedValueOnce({ found: false });

      await webhookService.processWebhook(result);

      // Wallet should NOT be credited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(0);

      // Transaction is deferred pending verification, not marked failed
      const transaction = await Transaction.findOne({
        providerReference: "PAY-FAIL-001",
      });
      expect(transaction?.status).toBe("pending");
      expect(transaction?.direction).toBe("CREDIT");
      expect(transaction?.meta?.verificationStatus).toBe(
        "pending_verification",
      );

      // No deposit until the outcome is actually known
      const deposit = await Deposit.findOne({
        userId,
        provider: "saveHaven",
        "meta.providerReference": "PAY-FAIL-001",
      });
      expect(deposit).toBeNull();
    });

    it("should handle reversed inwards transfer", async () => {
      // First fund wallet
      const fundPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-REV-FUND", // ← Different ID
          type: "Inwards" as const,
          sessionId: "session-rev",
          nameEnquiryReference: "ner-rev",
          paymentReference: "PAY-REV-001",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0123456789",
          debitAccountName: "Test Sender",
          amount: 40000,
          fees: 400,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Initial transfer",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const fundResult = await processor.process(fundPayload);
      await webhookService.processWebhook(fundResult);

      // Now process REVERSAL with DIFFERENT transaction ID
      const reversalPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-REV-002", // ← DIFFERENT ID = new transaction
          type: "Inwards" as const,
          sessionId: "session-rev",
          nameEnquiryReference: "ner-rev",
          paymentReference: "PAY-REV-001", // Same reference is OK
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0123456789",
          debitAccountName: "Test Sender",
          amount: 40000,
          fees: 400,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: true, // ← This is the reversal
          reversalReference: "REV-12345",
          responseCode: "00",
          responseMessage: "Reversed",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Reversal",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const reversalResult = await processor.process(reversalPayload);
      expect(reversalResult.status).toBe("reversed");

      // The fund step above already consumed the default beforeEach mock.
      // This call's own verification is what actually confirms the
      // reversal - simulate the statement now showing this payment's line
      // as isReversal: true.
      jest
        .spyOn(SaveHavenService.prototype, "getAccountStatement")
        .mockResolvedValueOnce({ found: true, isReversal: true });

      await webhookService.processWebhook(reversalResult);

      // Verify SECOND transaction (the reversal) has reversed status
      const reversedTransaction = await Transaction.findOne({
        _id: { $ne: undefined }, // Get the reversal transaction
        status: "reversed",
      });
      expect(reversedTransaction?.status).toBe("reversed");
    });

    it("should reject webhook with invalid payload", async () => {
      const invalidPayload = {
        type: "transfer",
        data: {
          _id: "SH-TXN-INVALID",
          // Missing required fields
        },
      };

      const isValid = processor.validatePayload(invalidPayload);
      expect(isValid).toBe(false);
    });

    it("should reject webhook for expired virtual account", async () => {
      // Create expired virtual account
      const expiredAccount = await VirtualAccount.create({
        userId: new Types.ObjectId(userId),
        provider: "saveHaven",
        accountNumber: "9999999999",
        accountName: "Expired Account",
        bankName: "SaveHaven Bank",
        type: "temporary",
        isActive: false,
        expiredAt: new Date(Date.now() - 86400000), // Yesterday
      });

      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-EXP-001",
          type: "Inwards" as const,
          sessionId: "session-exp",
          nameEnquiryReference: "ner-exp",
          paymentReference: "PAY-EXP-001",
          creditAccountNumber: "9999999999",
          creditAccountName: "Expired Account",
          debitAccountNumber: "0123456789",
          debitAccountName: "Test Sender",
          amount: 20000,
          fees: 200,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Expired account test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await processor.process(webhookPayload);

      // Should still process but fail to find account
      await expect(webhookService.processWebhook(result)).rejects.toThrow(
        "Virtual account not found",
      );
    });
  });

  describe("Outwards Transfer (Withdrawal) — not handled via webhook", () => {
    // SafeHaven does not send webhooks for withdrawals in this system:
    // withdrawals settle synchronously via the initiateTransfer response
    // (WithdrawalService's settledInstantly check) or are picked up by the
    // polling job in jobs/dailyproviderreconciliation.ts. These tests
    // confirm an Outwards webhook is safely ignored — no transaction or
    // wallet mutation — rather than exercising withdrawal-processing logic
    // that's no longer wired up.
    it("should not modify the transaction or wallet for a Completed Outwards webhook", async () => {
      const transactionRef = "WTH_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: transactionRef,
        amount: 15000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "saveHaven",
        status: "processing",
        balanceBefore: 50000,
        balanceAfter: 35000,
        meta: {
          accountNumber: "0123456789",
          bankName: "Test Bank",
        },
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 35000 });

      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-WTH-001",
          type: "Outwards" as const,
          sessionId: "session-wth",
          nameEnquiryReference: "ner-wth",
          paymentReference: "PAY-WTH-001",
          creditAccountNumber: "0123456789",
          creditAccountName: "Test User",
          debitAccountNumber: "MERCHANT-ACC",
          debitAccountName: "Merchant Account",
          amount: 15000,
          fees: 150,
          vat: 15,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Successful",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: `Withdrawal - ${transactionRef}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await processor.process(webhookPayload);
      // Processor parsing itself is unchanged by this cleanup — still
      // expected to correctly report success for a Completed payload.
      expect(result.status).toBe("success");

      await expect(
        webhookService.processWebhook(result),
      ).resolves.not.toThrow();

      // Transaction stays exactly as the (synchronous/polling) withdrawal
      // flow left it — the webhook must not touch it.
      const updatedTxn = await Transaction.findOne({
        reference: transactionRef,
      });
      expect(updatedTxn?.status).toBe("processing");

      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(35000);
    });

    it("should not modify the transaction or wallet for a Failed Outwards webhook", async () => {
      const transactionRef = "WTH_FAIL_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: transactionRef,
        amount: 20000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "saveHaven",
        status: "processing",
        balanceBefore: 50000,
        balanceAfter: 30000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 30000 });

      const webhookPayload = {
        type: "transfer" as const,
        data: {
          _id: "SH-TXN-WTH-FAIL",
          type: "Outwards" as const,
          sessionId: "session-wth-fail",
          nameEnquiryReference: "ner-wth-fail",
          paymentReference: "PAY-WTH-FAIL",
          creditAccountNumber: "0123456789",
          creditAccountName: "Test User",
          debitAccountNumber: "MERCHANT-ACC",
          debitAccountName: "Merchant Account",
          amount: 20000,
          fees: 200,
          vat: 20,
          stampDuty: 0,
          status: "Failed" as const,
          isReversed: false,
          responseCode: "99",
          responseMessage: "Insufficient funds",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: `Withdrawal - ${transactionRef}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await processor.process(webhookPayload);
      // Processor parsing itself is unchanged by this cleanup — still
      // expected to correctly report failed for a Failed payload.
      expect(result.status).toBe("failed");

      await expect(
        webhookService.processWebhook(result),
      ).resolves.not.toThrow();

      // No refund, no status change — this must be handled by the
      // synchronous initiateTransfer check or the reconciliation job, not
      // by this webhook.
      const txn = await Transaction.findOne({ reference: transactionRef });
      expect(txn?.status).toBe("processing");

      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(30000);
    });
  });

  describe("Balance Reconciliation", () => {
    it("should maintain accurate balance through multiple transactions", async () => {
      const initialBalance = 100000;
      await Wallet.updateOne({ _id: walletId }, { balance: initialBalance });

      // Transaction 1: +50k
      const txn1Payload = {
        type: "transfer" as const,
        data: {
          _id: "SH-BAL-1",
          type: "Inwards" as const,
          sessionId: "s1",
          nameEnquiryReference: "n1",
          paymentReference: "PAY-BAL-1",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0001",
          debitAccountName: "Sender 1",
          amount: 50000,
          fees: 500,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Txn 1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result1 = await processor.process(txn1Payload);
      await webhookService.processWebhook(result1);

      let wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(initialBalance + 50000 - 500);

      // Transaction 2: -30k
      const txn2Payload = {
        type: "transfer" as const,
        data: {
          _id: "SH-BAL-2",
          type: "Inwards" as const,
          sessionId: "s2",
          nameEnquiryReference: "n2",
          paymentReference: "PAY-BAL-2",
          creditAccountNumber: "1234567890",
          creditAccountName: "SaveHaven Virtual Account",
          debitAccountNumber: "0002",
          debitAccountName: "Sender 2",
          amount: 30000,
          fees: 300,
          vat: 0,
          stampDuty: 0,
          status: "Completed" as const,
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Txn 2",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result2 = await processor.process(txn2Payload);
      await webhookService.processWebhook(result2);

      wallet = await Wallet.findById(walletId);
      const expected = initialBalance + 50000 - 500 + 30000 - 300;
      expect(wallet?.balance).toBe(expected);

      // Verify transaction chain integrity
      const transactions = await Transaction.find({ userId }).sort({
        createdAt: 1,
      });
      for (let i = 1; i < transactions.length; i++) {
        expect(transactions[i].balanceBefore).toBe(
          transactions[i - 1].balanceAfter,
        );
      }
    });
  });
});