import Joi from 'joi';

export const updateTransactionStatusSchema = Joi.object({
  note: Joi.string().optional(),
});

export const reverseTransactionSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});
