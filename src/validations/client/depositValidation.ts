import Joi from 'joi';

export const createDepositRequestSchema = Joi.object({
  amount: Joi.number().positive().required(),
  proof: Joi.string().required(),
  provider: Joi.string().default('manual'),
});

export const depositWebhookSchema = Joi.object({
  reference: Joi.string().required(),
  amount: Joi.number().positive().required(),
  accountNumber: Joi.string().required(),
  meta: Joi.object().optional(),
});

export const depositQuerySchema = Joi.object({
  status: Joi.string().valid('pending', 'success', 'failed', 'approved', 'declined').optional(),
  provider: Joi.string().optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
