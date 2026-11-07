 
import request from "supertest";
import { User } from "@/models/core/User";
import { Wallet } from "@/models/wallet/Wallet";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { Transaction } from "@/models/wallet/Transaction";
import { Express } from "express";
import app from "../../app";


describe("Webhook Controller - General Behavior", () => {
  let userId: string;
  let walletId: string;
  let virtualAccountId: string;

  beforeEach(async () => {
    // Create test user
    const user = await User.create({
      firstname: "Webhook",
      lastname: "Test",
      email: "webhook@test.com",
      password: "test123",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    userId = user._id.toString();

    // Create wallet
    const wallet = await Wallet.create({
      userId: user._id,
      balance: 10000,
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    walletId = wallet._id.toString();

    // Create virtual accounts for both providers
    const safeHavenAccount = await VirtualAccount.create({
      userId: user._id,
      provider: "saveHaven",
      accountNumber: "1111111111",
      accountName: "SaveHaven Account",
      bankName: "SaveHaven Bank",
      type: "permanent",
      isActive: true,
    });

    const monnifyAccount = await VirtualAccount.create({
      userId: user._id,
      provider: "monnify",
      accountNumber: "2222222222",
      accountName: "Monnify Account",
      bankName: "Monnify Bank",
      type: "permanent",
      isActive: true,
    });

    virtualAccountId = safeHavenAccount._id.toString();
  });

  describe("SaveHaven Webhook Routing", () => {
    it("should accept SaveHaven webhook and return 200 OK", async () => {
      const payload = {
        type: "transfer",
        data: {
          _id: "SH-TEST-001",
          type: "Inwards",
          sessionId: "s-test",
          nameEnquiryReference: "ner-test",
          paymentReference: "PAY-TEST-001",
          creditAccountNumber: "1111111111",
          creditAccountName: "SaveHaven Account",
          debitAccountNumber: "0000000000",
          debitAccountName: "Sender",
          amount: 5000,
          fees: 50,
          vat: 0,
          stampDuty: 0,
          status: "Completed",
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Test transfer",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      // Import your app here
      // const app = require("@/app").default;

      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .send(payload);

      // Should always return 200 OK
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "success" });

      // Verify webhook was processed
      const wallet = await Wallet.findById(walletId);
      const netAmount = 5000 - 50;
      expect(wallet?.balance).toBe(10000 + netAmount);
    });

    it("should handle invalid SaveHaven payload gracefully", async () => {
      const invalidPayload = {
        type: "transfer",
        data: {
          // Missing required fields
          _id: "SH-INVALID",
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .send(invalidPayload);

      // Should still return 200 (acknowledged)
      expect(response.status).toBe(200);

      // Wallet should NOT be credited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(10000);
    });

    it("should handle malformed JSON in SaveHaven webhook", async () => {
      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .set("Content-Type", "application/json")
        .send("{ invalid json");

      // Should handle gracefully (4xx or 200)
       expect(response.status).toBe(200);
    });
  });

  describe("Monnify Webhook Routing", () => {
    it("should accept Monnify virtual account deposit webhook", async () => {
      const payload = {
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          product: {
            reference: "PAY-MON-TEST-001",
            type: "RESERVED_ACCOUNT",
          },
          transactionReference: "MON-TXN-001",
          paymentReference: "MON-PAY-001",
          paidOn: new Date().toISOString(),
          paymentDescription: "Test deposit",
          paymentSourceInformation: [
            {
              bankCode: "058",
              amountPaid: 8000,
              accountName: "Test",
              sessionId: "SES-TEST",
              accountNumber: "0000000000",
            },
          ],
          destinationAccountInformation: {
            bankCode: "999999",
            bankName: "Monnify",
            accountNumber: "2222222222",
          },
          amountPaid: 8000,
          totalPayable: 8000,
          cardDetails: null,
          paymentMethod: "withdrawal",
          currency: "NGN",
          settlementAmount: 7920,
          paymentStatus: "PAID",
          customer: {
            name: "Test User",
            email: "webhook@test.com",
          },
          metaData: {},
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/monnify")
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "success" });

      // Verify wallet credited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(10000 + 7920);
    });

    it("should accept Monnify disbursement webhook", async () => {
      // Create withdrawal transaction first
      const withdrawalRef = "WTH_MON_GEN_" + Date.now();
      await Transaction.create({
        walletId: walletId,
        userId: userId,
        sourceId: userId,
        reference: withdrawalRef,
        amount: 3000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: 10000,
        balanceAfter: 7000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 10000 });

      const payload = {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        eventData: {
          amount: 3000,
          transactionReference: "MON-DISB-GEN-001",
          fee: 30,
          transactionDescription: "Withdrawal successful",
          destinationAccountNumber: "0000000000",
          sessionId: "SES-DISB",
          createdOn: new Date().toISOString(),
          destinationAccountName: "Account",
          reference: withdrawalRef,
          destinationBankCode: "058",
          completedOn: new Date().toISOString(),
          narration: "Withdrawal",
          currency: "NGN",
          destinationBankName: "Bank",
          status: "SUCCESS",
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/monnify")
        .send(payload);

      expect(response.status).toBe(200);

      // Verify transaction updated
      const transaction = await Transaction.findOne({
        reference: withdrawalRef,
      });
      expect(transaction?.status).toBe("success");
    });

    it("should handle Monnify disbursement failure", async () => {
      const withdrawalRef = "WTH_MON_FAIL_" + Date.now();
      await Transaction.create({
        walletId: walletId,
        userId: userId,
        sourceId: userId,
        reference: withdrawalRef,
        amount: 2000,
        direction: "DEBIT",
        type: "withdrawal",
        provider: "monnify",
        status: "processing",
        balanceBefore: 10000,
        balanceAfter: 8000,
      });

      await Wallet.updateOne({ _id: walletId }, { balance: 8000 });  // ← Debit to balanceAfter

      const payload = {
        eventType: "FAILED_DISBURSEMENT",
        eventData: {
          amount: 2000,
          transactionReference: "MON-DISB-FAIL-001",
          fee: 20,
          transactionDescription: "Insufficient funds",
          destinationAccountNumber: "0000000000",
          sessionId: "SES-FAIL",
          createdOn: new Date().toISOString(),
          destinationAccountName: "Account",
          reference: withdrawalRef,
          destinationBankCode: "058",
          completedOn: new Date().toISOString(),
          narration: "Failed",
          currency: "NGN",
          destinationBankName: "Bank",
          status: "FAILED",
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/monnify")
        .send(payload);

      expect(response.status).toBe(200);

      // Verify wallet refunded
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(10000);
    });

    it("should handle invalid Monnify payload gracefully", async () => {
      const invalidPayload = {
        eventType: "UNKNOWN_EVENT",
        eventData: {},
      };

      const response = await request(app)
        .post("/api/v1/webhooks/monnify")
        .send(invalidPayload);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("should return 200 even if webhook processing fails", async () => {
      const payload = {
        type: "transfer",
        data: {
          _id: "SH-ERROR-001",
          type: "Inwards",
          sessionId: "s-err",
          nameEnquiryReference: "ner-err",
          paymentReference: "PAY-ERROR-001",
          creditAccountNumber: "9999999999", // Non-existent account
          creditAccountName: "Unknown",
          debitAccountNumber: "0000000000",
          debitAccountName: "Sender",
          amount: 1000,
          fees: 10,
          vat: 0,
          stampDuty: 0,
          status: "Completed",
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Error test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .send(payload);

      // Should return 200 OK (acknowledged) even on error
      expect(response.status).toBe(200);

      // Wallet should not be credited
      const wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(10000);
    });

    it("should handle null/undefined payload", async () => {
      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .send(undefined);

      // Should handle gracefully
      expect([200, 400, 500].includes(response.status)).toBe(true);
    });
  });

  describe("Concurrency", () => {
    it("should handle concurrent webhook requests", async () => {
      const payload1 = {
        type: "transfer",
        data: {
          _id: "SH-CONC-001",
          type: "Inwards",
          sessionId: "s-conc-1",
          nameEnquiryReference: "ner-conc-1",
          paymentReference: "PAY-CONC-001",
          creditAccountNumber: "1111111111",
          creditAccountName: "SaveHaven Account",
          debitAccountNumber: "0000000001",
          debitAccountName: "Sender 1",
          amount: 2000,
          fees: 20,
          vat: 0,
          stampDuty: 0,
          status: "Completed",
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Concurrent 1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const payload2 = {
        type: "transfer",
        data: {
          _id: "SH-CONC-002",
          type: "Inwards",
          sessionId: "s-conc-2",
          nameEnquiryReference: "ner-conc-2",
          paymentReference: "PAY-CONC-002",
          creditAccountNumber: "1111111111",
          creditAccountName: "SaveHaven Account",
          debitAccountNumber: "0000000002",
          debitAccountName: "Sender 2",
          amount: 3000,
          fees: 30,
          vat: 0,
          stampDuty: 0,
          status: "Completed",
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "Concurrent 2",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      // Send both webhooks concurrently
      const results = await Promise.all([
        request(app).post("/api/v1/webhooks/savehaven").send(payload1),
        request(app).post("/api/v1/webhooks/savehaven").send(payload2),
      ]);

      // Both should return 200
      expect(results.every((r) => r.status === 200)).toBe(true);

      // Verify both transactions processed
      const wallet = await Wallet.findById(walletId);
      const expectedBalance =
        10000 + (2000 - 20) + (3000 - 30);
      expect(wallet?.balance).toBe(expectedBalance);

      // Verify both transactions exist
      const transactions = await Transaction.find({ userId });
      expect(transactions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Response Format", () => {
    it("should always return JSON response", async () => {
      const payload = {
        type: "transfer",
        data: {
          _id: "SH-JSON-001",
          type: "Inwards",
          sessionId: "s-json",
          nameEnquiryReference: "ner-json",
          paymentReference: "PAY-JSON-001",
          creditAccountNumber: "1111111111",
          creditAccountName: "SaveHaven Account",
          debitAccountNumber: "0000000000",
          debitAccountName: "Sender",
          amount: 1000,
          fees: 10,
          vat: 0,
          stampDuty: 0,
          status: "Completed",
          isReversed: false,
          responseCode: "00",
          responseMessage: "Success",
          provider: "SaveHaven",
          providerChannel: "withdrawal",
          providerChannelCode: "020",
          destinationInstitutionCode: "999999",
          transactionLocation: "Lagos",
          narration: "JSON test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const response = await request(app)
        .post("/api/v1/webhooks/savehaven")
        .set("Accept", "application/json")
        .send(payload);

      expect(response.type).toContain("application/json");
      expect(typeof response.body).toBe("object");
    });
  });
});