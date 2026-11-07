 
import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { Deposit } from "@/models/banking/Deposit";
import { User } from "@/models/core/User";
import { MonnifyWebhookProcessor } from "@/services/client/webhooks/MonnifyWebhookProcessor";
import { MonnifyWebhookService } from "@/services/client/webhooks/MonnifyWebhookService";
import ServiceContainer from "@/services/client/container";
import { Types } from "mongoose";
import crypto from "crypto";

describe("Monnify Webhook Integration", () => {
  let processor: MonnifyWebhookProcessor;
  let webhookService: MonnifyWebhookService;
  let userId: string;
  let walletId: string;
  let virtualAccountId: string;

  beforeEach(async () => {
    // Initialize with test secret
    processor = new MonnifyWebhookProcessor(process.env.MONNIFY_SECRET_KEY);
    webhookService = new MonnifyWebhookService();

    // Type helper function
    const typedPayload = <T>(payload: any): T => payload as T;

    // Create test user
    const user = await User.create({
      firstname: "Monnify",
      lastname: "Test",
      email: "monnify@test.com",
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
      provider: "monnify",
      accountNumber: "5123456789",
      accountName: "Monnify Virtual Account",
      bankName: "Monnify Test Bank",
      bankCode: "999999",
      type: "permanent",
      isActive: true,
    });

    virtualAccountId = virtualAccount._id.toString();
  });

  describe("SUCCESSFUL_TRANSACTION (Wallet Funding)", () => {
    it("should process virtual account deposit successfully", async () => {
      const webhookPayload = {
        eventType: "SUCCESSFUL_TRANSACTION" as const,
        eventData: {
          product: {
            reference: "PAY-VA-DEPOSIT-001",
            type: "RESERVED_ACCOUNT",
          },
          transactionReference: "MON-TXN-12345",
          paymentReference: "MON-PAY-12345",
          paidOn: new Date().toISOString(),
          paymentDescription: "Virtual account deposit",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 50000,
              accountName: "Test Sender",
              sessionId: "SES-123",
              accountNumber: "0123456789",
            },
          ],
          destinationAccountInformation: {
            bankCode: "999999",
            bankName: "Monnify Test Bank",
            accountNumber: "5123456789",
          },
          amountPaid: 50000,
          totalPayable: 50000,
          cardDetails: null,
          paymentMethod: "WITHDRAWAL",
          currency: "NGN",
          settlementAmount: 49500, // After fees
          paymentStatus: "PAID" as const,
          customer: {
            name: "Test User",
            email: "monnify@test.com",
          },
          metaData: {},
        },
      };

      // Validate payload
      const isValid = processor.validatePayload(webhookPayload);
      expect(isValid).toBe(true);

      // Process webhook
      const result = await processor.process(webhookPayload);
      expect(result.reference).toBe("PAY-VA-DEPOSIT-001");
      expect(result.status).toBe("success");
      expect(result.metadata.amountPaid).toBe(50000);

      // Execute webhook service
      await webhookService.processWebhook(result);

      // Verify wallet credited with settlement amount
      const updatedWallet = await Wallet.findById(walletId);
      expect(updatedWallet?.balance).toBe(49500);

      // Verify transaction created
      const transaction = await Transaction.findOne({
        type: "deposit",
        provider: "monnify",
      });
      expect(transaction?.status).toBe("success");
      expect(transaction?.direction).toBe("CREDIT");
      expect(transaction?.amount).toBe(49500);

      // Verify deposit created
      const deposit = await Deposit.findOne({
        userId,
        provider: "monnify",
      });
      expect(deposit?.status).toBe("success");
      expect(deposit?.amount).toBe(49500);
    });

    it.skip("should process card payment successfully", async () => {
      const paymentRef = "MON-CARD-PAYMENT-001";
      const userId_ObjId = new Types.ObjectId(userId);

      // Simulate cache storing userId for card payment
      const cacheService = ServiceContainer.getCacheService();
      await cacheService.set(`payment:${paymentRef}`, userId);

      const webhookPayload = {
        eventType: "SUCCESSFUL_TRANSACTION" as const,
        eventData: {
          product: {
            reference: paymentRef,
            type: "CARD_PAYMENT",
          },
          transactionReference: "MON-CARD-TXN-123",
          paymentReference: paymentRef,
          paidOn: new Date().toISOString(),
          paymentDescription: "Card payment for wallet funding",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 35000,
              accountName: "Test Card",
              sessionId: "SES-CARD-123",
              accountNumber: "4111111111111111",
            },
          ],
          destinationAccountInformation: {}, // Empty for card payments
          amountPaid: 35000,
          totalPayable: 35000,
          cardDetails: {
            cardBrand: "VISA",
            lastFourDigits: "1111",
          },
          paymentMethod: "CARD",
          currency: "NGN",
          settlementAmount: 34500,
          paymentStatus: "PAID" as const,
          customer: {
            name: "Test User",
            email: "monnify@test.com",
          },
          metaData: {},
        },
      };

      const result = await processor.process(webhookPayload);
      expect(result.status).toBe("success");
      expect(result.metadata.paymentMethod).toBe("CARD");

      await webhookService.processWebhook(result);

      // Verify wallet credited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(34500);

      // Verify transaction marked with payment method
      const transaction = await Transaction.findOne({
        provider: "monnify",
        type: "deposit",
      });
      expect(transaction?.meta?.paymentMethod).toBe("CARD");
    });

    it("should reject duplicate virtual account deposit", async () => {
      const webhookPayload = {
        eventType: "SUCCESSFUL_TRANSACTION" as const,
        eventData: {
          product: {
            reference: "PAY-VA-DUP-001",
            type: "RESERVED_ACCOUNT",
          },
          transactionReference: "MON-TXN-DUP-001",
          paymentReference: "MON-PAY-DUP-001",
          paidOn: new Date().toISOString(),
          paymentDescription: "Virtual account deposit",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 30000,
              accountName: "Test Sender",
              sessionId: "SES-123",
              accountNumber: "0123456789",
            },
          ],
          destinationAccountInformation: {
            bankCode: "999999",
            bankName: "Monnify Test Bank",
            accountNumber: "5123456789",
          },
          amountPaid: 30000,
          totalPayable: 30000,
          cardDetails: null,
          paymentMethod: "WITHDRAWAL",
          currency: "NGN",
          settlementAmount: 29700,
          paymentStatus: "PAID" as "PAID" | "PENDING" | "FAILED",
          customer: {
            name: "Test User",
            email: "monnify@test.com",
          },
          metaData: {},
        },
      };

      const result = await processor.process(webhookPayload);
      await webhookService.processWebhook(result);

      const walletAfterFirst = await Wallet.findById(walletId);
      const balanceAfterFirst = walletAfterFirst?.balance;

      // Retry webhook (should not double-credit)
      const result2 = await processor.process(webhookPayload);
      await webhookService.processWebhook(result2);

      const walletAfterSecond = await Wallet.findById(walletId);
      expect(walletAfterSecond?.balance).toBe(balanceAfterFirst);

      // Verify only one transaction
      const transactions = await Transaction.find({
        providerReference: "MON-TXN-DUP-001",
      });
      expect(transactions.length).toBe(1);
    });

    it("should handle invalid payload gracefully", async () => {
      const invalidPayload = {
        eventType: "SUCCESSFUL_TRANSACTION" as const,
        eventData: {
          // Missing required fields
          transactionReference: "MON-TXN-INVALID",
        },
      };

      const isValid = processor.validatePayload(invalidPayload);
      expect(isValid).toBe(false);
    });
  });

  describe("SUCCESSFUL_DISBURSEMENT", () => {
    it("should process successful withdrawal", async () => {
      // First create withdrawal transaction
      const transactionRef = "WTH_MON_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: transactionRef,
        amount: 25000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: 50000,
        balanceAfter: 25000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 25000 }); // balanceAfter from transaction

      const webhookPayload = {
        eventType: "SUCCESSFUL_DISBURSEMENT" as const,
        eventData: {
          amount: 25000,
          transactionReference: "MON-DISB-SUC-001",
          fee: 250,
          transactionDescription: "Withdrawal successful",
          destinationAccountNumber: "0123456789",
          sessionId: "SES-DISB-001",
          createdOn: new Date().toISOString(),
          destinationAccountName: "Test Account",
          reference: transactionRef,
          destinationBankCode: "058",
          completedOn: new Date().toISOString(),
          narration: "Withdrawal",
          currency: "NGN",
          destinationBankName: "Test Bank",
          status: "SUCCESS" as const,
        },
      };

      const result = await processor.process(webhookPayload);
      expect(result.status).toBe("success");

      await webhookService.processWebhook(result);

      // Verify transaction updated
      const transaction = await Transaction.findOne({
        reference: transactionRef,
      });
      expect(transaction?.status).toBe("success");

      // Wallet should remain debited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(25000);
    });
  });

  describe("FAILED_DISBURSEMENT", () => {
    it("should handle failed disbursement and refund wallet", async () => {
      const transactionRef = "WTH_FAIL_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: transactionRef,
        amount: 20000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: 50000,
        balanceAfter: 30000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 30000 }); // balanceAfter from transaction

      const webhookPayload = {
        eventType: "FAILED_DISBURSEMENT" as const,
        eventData: {
          amount: 20000,
          transactionReference: "MON-DISB-FAIL-001",
          fee: 200,
          transactionDescription: "Insufficient liquidity",
          destinationAccountNumber: "0123456789",
          sessionId: "SES-DISB-FAIL",
          createdOn: new Date().toISOString(),
          destinationAccountName: "Test Account",
          reference: transactionRef,
          destinationBankCode: "058",
          completedOn: new Date().toISOString(),
          narration: "Withdrawal failed",
          currency: "NGN",
          destinationBankName: "Test Bank",
          status: "FAILED" as const,
        },
      };

      const result = await processor.process(webhookPayload);
      expect(result.status).toBe("failed");

      await webhookService.processWebhook(result);

      // Verify transaction marked as failed
      const transaction = await Transaction.findOne({
        reference: transactionRef,
      });
      expect(transaction?.status).toBe("failed");

      // Verify wallet refunded
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(50000); // Fully refunded
    });
  });

  describe("REVERSED_DISBURSEMENT", () => {
    it("should handle reversed disbursement and refund wallet", async () => {
      const transactionRef = "WTH_REV_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: transactionRef,
        amount: 15000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: 50000,
        balanceAfter: 35000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 35000 }); // balanceAfter from transaction

      const webhookPayload = {
        eventType: "REVERSED_DISBURSEMENT" as const,
        eventData: {
          transactionReference: "MON-DISB-REV-001",
          reference: transactionRef,
          narration: "Withdrawal reversed",
          currency: "NGN",
          amount: 15000,
          status: "REVERSED" as const,
          fee: 150,
          destinationAccountNumber: "0123456789",
          destinationAccountName: "Test Account",
          destinationBankCode: "058",
          sessionId: "SES-DISB-REV",
          createdOn: new Date().toISOString(),
          completedOn: new Date().toISOString(),
        },
      };

      const result = await processor.process(webhookPayload);
      expect(result.status).toBe("reversed");

      await webhookService.processWebhook(result);

      // Verify transaction marked as reversed
      const transaction = await Transaction.findOne({
        reference: transactionRef,
      });
      expect(transaction?.status).toBe("reversed");

      // Verify wallet refunded
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(50000); // Fully refunded
    });
  });

  describe("Signature Validation", () => {
    it("should validate HMAC-SHA512 signature correctly", async () => {
      const webhookPayload = {
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          product: {
            reference: "PAY-SIG-001",
            type: "RESERVED_ACCOUNT",
          },
          transactionReference: "MON-TXN-SIG-001",
          paymentReference: "MON-PAY-SIG-001",
          paidOn: new Date().toISOString(),
          paymentDescription: "Signature test",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 10000,
              accountName: "Test",
              sessionId: "SES-SIG",
              accountNumber: "0001",
            },
          ],
          destinationAccountInformation: {
            bankCode: "999999",
            bankName: "Monnify",
            accountNumber: "5123456789",
          },
          amountPaid: 10000,
          totalPayable: 10000,
          cardDetails: null,
          paymentMethod: "WITHDRAWAL",
          currency: "NGN",
          settlementAmount: 9900,
          paymentStatus: "PAID",
          customer: {
            name: "Test",
            email: "test@test.com",
          },
          metaData: {},
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const secret = process.env.MONNIFY_SECRET_KEY || "test-secret";

      // Generate valid signature
      const validSignature = crypto
        .createHmac("sha512", secret)
        .update(payloadString)
        .digest("hex");

      // Valid signature should pass
      const isValid = processor.validateSignature(
        payloadString,
        validSignature,
        secret,
      );
      expect(isValid).toBe(true);

      // Invalid signature should fail
      const invalidSignature = "invalid_signature_hash";
      const isInvalid = processor.validateSignature(
        payloadString,
        invalidSignature,
        secret,
      );
      expect(isInvalid).toBe(false);
    });
  });

  describe("IP Validation", () => {
    it("should validate Monnify IP address", async () => {
      const monnifyIP = "35.242.133.146";
      const localIP = "127.0.0.1";
      const randomIP = "192.168.1.1";

      expect(processor.validateIP(monnifyIP)).toBe(true);
      expect(processor.validateIP(localIP)).toBe(true); // For testing
      expect(processor.validateIP(randomIP)).toBe(false);
    });
  });

  describe("Complete Transaction Flow", () => {
    it("should handle complete deposit lifecycle", async () => {
      const initialBalance = 100000;
      await Wallet.updateOne({ _id: walletId }, { balance: initialBalance });

      //  Deposit via virtual account
      const depositPayload = {
        eventType: "SUCCESSFUL_TRANSACTION" as const,
        eventData: {
          product: {
            reference: "PAY-FLOW-001",
            type: "RESERVED_ACCOUNT",
          },
          transactionReference: "MON-TXN-FLOW-001",
          paymentReference: "MON-PAY-FLOW-001",
          paidOn: new Date().toISOString(),
          paymentDescription: "Flow test deposit",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 75000,
              accountName: "Flow Test Sender",
              sessionId: "SES-FLOW",
              accountNumber: "0001",
            },
          ],
          destinationAccountInformation: {
            bankCode: "999999",
            bankName: "Monnify",
            accountNumber: "5123456789",
          },
          amountPaid: 75000,
          totalPayable: 75000,
          cardDetails: null,
          paymentMethod: "WITHDRAWAL",
          currency: "NGN",
          settlementAmount: 74250,
          paymentStatus: "PAID" as const,
          customer: {
            name: "Flow Test",
            email: "flow@test.com",
          },
          metaData: {},
        },
      };

      const depositResult = await processor.process(depositPayload);
      await webhookService.processWebhook(depositResult);

      let wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(initialBalance + 74250);

      //  Withdrawal
      const withdrawalRef = "WTH_FLOW_" + Date.now();
      await Transaction.create({
        walletId: new Types.ObjectId(walletId),
        userId: new Types.ObjectId(userId),
        sourceId: new Types.ObjectId(userId),
        reference: withdrawalRef,
        amount: 40000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: wallet?.balance || 0,
        balanceAfter: (wallet?.balance || 0) - 40000,
      });

      const withdrawalBefore = wallet?.balance || 0;
      await Wallet.updateOne(
        { _id: walletId },
        { balance: withdrawalBefore - 40000 },
      );

      const withdrawalPayload = {
        eventType: "SUCCESSFUL_DISBURSEMENT" as const,
        eventData: {
          amount: 40000,
          transactionReference: "MON-DISB-FLOW-001",
          fee: 400,
          transactionDescription: "Withdrawal successful",
          destinationAccountNumber: "0123456789",
          sessionId: "SES-DISB-FLOW",
          createdOn: new Date().toISOString(),
          destinationAccountName: "Flow Account",
          reference: withdrawalRef,
          destinationBankCode: "058",
          completedOn: new Date().toISOString(),
          narration: "Flow withdrawal",
          currency: "NGN",
          destinationBankName: "Test Bank",
          status: "SUCCESS" as const,
        },
      };

      const withdrawalResult = await processor.process(withdrawalPayload);
      await webhookService.processWebhook(withdrawalResult);

      wallet = await Wallet.findById(walletId);
      const expectedFinalBalance = withdrawalBefore - 40000;
      expect(wallet?.balance).toBe(expectedFinalBalance);

      // Verify all transactions exist
      const allTransactions = await Transaction.find({ userId });
      expect(allTransactions.length).toBeGreaterThan(0);
    });
  });
});
