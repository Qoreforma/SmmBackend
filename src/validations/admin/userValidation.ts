import Joi from "joi";

export const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid("active", "inactive", "suspended", "shadow-banned").required(),
});

export const markFraudulentSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});

export const manageUserWalletSchema = Joi.object({
  amount: Joi.number().positive().required(),
  remark: Joi.string().required(),
  type: Joi.string().valid("credit", "debit").required(),
  otp: Joi.string().length(6).required(),
});

export const sendWalletActionOTPSchema = Joi.object({
  amount: Joi.number().positive().required(),
  type: Joi.string().valid("credit", "debit").required(),
});

export const updateUserTypeSchema = Joi.object({
  userType: Joi.string()
    .valid("regular", "influencer", "micro-influencer")
    .required(),
  influencerRules: Joi.object({
    accountCompletion: Joi.object({
      isActive: Joi.boolean().required(),
      rewardAmount: Joi.number().min(0).required(),
    }).optional(),
    firstBillPayment: Joi.object({
      isActive: Joi.boolean().required(),
      rewardAmount: Joi.number().min(0).required(),
    }).optional(),
    transactionVolume: Joi.object({
      isActive: Joi.boolean().required(),
      rewardAmount: Joi.number().min(0).required(),
      targetVolume: Joi.number().min(0).required(),
    }).optional(),
    kycCompletion: Joi.object({
      isActive: Joi.boolean().required(),
      rewardAmount: Joi.number().min(0).required(),
    }).optional(),
    refereeFirstTransaction: Joi.object({
      isActive: Joi.boolean().required(),
      discountPercentage: Joi.number().min(1).max(100).default(10),
      cap: Joi.number().min(0).default(200),
    }).optional(),
  }).optional(),
});

export const updateUserTierSchema = Joi.object({
  tierCode: Joi.string().trim().lowercase().required(),
  isTierLocked: Joi.boolean().default(true),
});
