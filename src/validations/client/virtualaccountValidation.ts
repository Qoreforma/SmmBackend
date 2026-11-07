import Joi from 'joi';

export const createVirtualAccountSchema = Joi.object({
  type: Joi.string().valid('permanent', 'temporary').default('permanent'),
  provider: Joi.string().default('monnify'),
});

export const virtualAccountQuerySchema = Joi.object({
  type: Joi.string().valid('permanent', 'temporary').optional(),
  provider: Joi.string().optional(),
});
