import Joi from "joi";

export const createBankAccountSchema = Joi.object({
  bankCode: Joi.string().required(),
  bankId: Joi.string().optional(),
  accountNumber: Joi.string().min(10).max(10).required(),
  accountName: Joi.string().required(),
  recipientCode: Joi.string().optional(),
});

export const verifyBankAccountSchema = Joi.object({
  bankCode: Joi.any().required().messages({
    "any.required": "Bank code is required", 
  }),
  accountNumber: Joi.string().required().messages({
    "any.required": "Account number is required",
  }),
});
