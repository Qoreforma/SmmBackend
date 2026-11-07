import {
  DepositRepository,
  DepositRequestRepository,
} from "@/repositories/client/DepositRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletService } from "./WalletService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SYSTEM,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import mongoose, { Types } from "mongoose";
import {
  generateReference,
  normalizeProviderName,
  toDisplayProviderName,
} from "@/utils/helpers";
import logger from "@/logger";
import { HelperService } from "@/services/client/utility/HelperService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { EmailService } from "@/services/core/EmailService";
import { NotificationService } from "../notifications/NotificationService";

export class DepositService {
  constructor(
    private depositRepository: DepositRepository,
    private depositRequestRepository: DepositRequestRepository,
    private virtualAccountRepository: VirtualAccountRepository,
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private helperService: HelperService,
  ) {}

  // User: Submit Manual Deposit Request

  async createDepositRequest(data: {
    userId: string;
    amount: number;
    proof: string;
    provider?: string;
    accountNumber?: string;
    providerReference?: string;
    channel?: "ios" | "android" | "web" | "api";
  }) {
    const reference = generateReference("DEPREQ");
    const session = await mongoose.startSession();
    session.startTransaction();
    return SentryHelper.trackCriticalOperation(
      "deposit_request_creation",
      async () => {
        try {
          const wallet = await this.walletService.getWallet(data.userId);
          if (!wallet) {
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.RESOURCE_NOT_FOUND,
            );
          }

          // Create DepositRequest (status: pending)
          const depositRequest = await this.depositRequestRepository.create({
            userId: new Types.ObjectId(data.userId),
            reference,
            provider: data.provider || SYSTEM.PROVIDER,
            amount: data.amount,
            proof: data.proof,
            accountNumber: data.accountNumber,
            providerReference: data.providerReference,
            status: "pending",
          });

          const balanceBefore = wallet.balance;

          // Create Transaction (pending — wallet not touched yet)
          const transaction = await this.transactionRepository.create({
            walletId: wallet.id,
            sourceId: new Types.ObjectId(data.userId),
            userId: new Types.ObjectId(data.userId),
            transactableType: "DepositRequest",
            transactableId: depositRequest.id,
            reference,
            amount: data.amount,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            provider: data.provider || SYSTEM.PROVIDER,
            status: "pending",
            approvalStatus: "pending",
            channel: data.channel || "web",
            purpose: "Manual deposit request",
            balanceBefore,
            balanceAfter: balanceBefore, // no change until approved
            initiatedBy: new Types.ObjectId(data.userId),
            initiatedByType: "user",
            meta: {
              depositRequestId: depositRequest._id,
              proof: data.proof,
              accountNumber: data.accountNumber,
              providerReference: data.providerReference,
            },
          });

          await session.commitTransaction();

          const adminEmail =
            process.env.ADMIN_EMAIL ||
            `admin@${process.env.APP_NAME?.toLowerCase()}.com`;

          this.emailService
            .sendSystemNotificationToAdmin(
              adminEmail,
              `⚠️ Manual Deposit Required - ${reference}`,
              {
                reference,
                userId: data.userId,
                amount: data.amount,
                proof: data.proof,
                timestamp: new Date().toISOString(),
                action: "MANUAL_DEPOSIT_REQUIRED",
              },
              ` Manual deposit processing required.`,
            )
            .catch((err: any) =>
              logger.error(
                `Failed to notify admin for manual deposit: ${reference}`,
                err.message,
              ),
            );

          return { depositRequest, transaction };
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      },
      data.userId,
    );
  }

  // Automated Deposit (Webhook)
  async handleDepositWebhook(data: {
    reference: string;
    amount: number;
    accountNumber: string;
    meta?: any;
  }) {
    return SentryHelper.trackCriticalOperation(
      "deposit_webhook_processing",
      async () => {
        const virtualAccount =
          await this.virtualAccountRepository.findByAccountNumber(
            data.accountNumber,
          );
        if (!virtualAccount) {
          throw new AppError(
            "Virtual account not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        const existing = await this.depositRepository.findByReference(
          data.reference,
        );
        if (existing) {
          return existing;
        }

        const wallet = await this.walletService.getWallet(
          virtualAccount.userId.toString(),
        );

        const deposit = await this.depositRepository.create({
          userId: virtualAccount.userId,
          walletId: wallet.id,
          reference: data.reference,
          provider: virtualAccount.provider,
          amount: data.amount,
          status: "success",
          meta: data.meta,
        });

        const updatedWallet = await this.walletService.creditWallet(
          virtualAccount.userId.toString(),
          data.amount,
          `Deposit`,
          {
            type: TRANSACTION_TYPES.DEPOSIT,
            provider: virtualAccount.provider,
            providerReference: data.reference,
            transactableType: "Deposit",
            transactableId: deposit.id,
            initiatedBy: virtualAccount.userId,
            initiatedByType: "user",
            meta: data.meta,
            remark: `Wallet funding via ${data.reference}`,
          },
        );

        return deposit;
      },
      data.reference,
    );
  }

  // Queries
  async getDeposits(
    userId: string,
    filters: any = {},
    page: number = 1,
    limit: number = 10,
  ) {
    const query: any = {};
    if (filters.status) query.status = filters.status;
    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }
    const result = await this.depositRepository.findByUserId(
      userId,
      query,
      page,
      limit,
    );
    return {
      ...result,
      data: result.data.map((deposit: any) => {
        const plain = deposit.toObject ? deposit.toObject() : deposit;
        return { ...plain, provider: toDisplayProviderName(plain.provider) };
      }),
    };
  }

  async getDepositById(depositId: string) {
    const deposit = await this.depositRepository.findById(depositId);
    if (!deposit) {
      throw new AppError(
        "Deposit not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }
    const plain = (deposit as any).toObject
      ? (deposit as any).toObject()
      : deposit;
    return { ...plain, provider: toDisplayProviderName(plain.provider) };
  }
}
