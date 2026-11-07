import Joi from "joi";

export const createSystemBankAccountSchema = Joi.object({
  accountNumber: Joi.string().required().max(50).trim(),
  accountName: Joi.string().required().max(200).trim(),
  bankCode: Joi.string().max(20).trim(),
  isActive: Joi.boolean().default(true),
});

export const updateSystemBankAccountStatusSchema = Joi.object({
  isActive: Joi.string().valid("active", "inactive").required(),
});
