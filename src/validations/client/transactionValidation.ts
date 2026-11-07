import { TRANSACTION_TYPES } from "@/utils/constants";
import Joi from "joi";

export const createTransactionSchema = Joi.object({
  amount: Joi.number().positive().required(),
  type: Joi.string().required(),
  provider: Joi.string().required(),
  remark: Joi.string().optional(),
  purpose: Joi.string().optional(),
  meta: Joi.object().optional(),
});

export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  type: Joi.string()
    .valid(
      // Service transaction types
      TRANSACTION_TYPES.SMM,
      TRANSACTION_TYPES.GAME_TOPUP,
      TRANSACTION_TYPES.NUMBER_RENTAL,
      TRANSACTION_TYPES.PROXY,
      TRANSACTION_TYPES.EMAIL_OTP,
      // Wallet operations
      TRANSACTION_TYPES.WALLET_TRANSFER,
      TRANSACTION_TYPES.WALLET_CREDIT,
      TRANSACTION_TYPES.WALLET_DEBIT,
      TRANSACTION_TYPES.DEPOSIT,
      TRANSACTION_TYPES.WITHDRAWAL,
      // Misc
      TRANSACTION_TYPES.REFUND,
      TRANSACTION_TYPES.CASHBACK_EARNED,
      TRANSACTION_TYPES.CASHBACK_SPENT,
    )
    .optional(),
  status: Joi.string()
    .valid("pending", "success", "failed", "reversed")
    .optional(),
  date: Joi.date().optional(),
  transactionType: Joi.string().valid("bills", "wallet").optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  reference: Joi.string().optional(),
  direction: Joi.string().valid("DEBIT", "CREDIT").optional(),
  purpose: Joi.string().optional(),
  startPrice: Joi.number().positive().optional(),
  endPrice: Joi.number().positive().optional(),
});

