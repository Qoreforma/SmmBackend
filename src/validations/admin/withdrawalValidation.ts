import Joi from 'joi';

export const declineWithdrawalSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});

export const processWithdrawalSchema = Joi.object({
  transactionId: Joi.string().required(),
});
