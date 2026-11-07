import Joi from 'joi';

export const referralQuerySchema = Joi.object({
  paid: Joi.boolean().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
