import Joi from "joi";

export const createDiscountValidation = Joi.object({
  code: Joi.string().required().uppercase().max(50).trim(),
  type: Joi.string().valid("percentage", "flat").required(),
  value: Joi.number().required().min(0),
  cap: Joi.when('type', {
    is: 'percentage',
    then: Joi.number().min(0).optional(),
    otherwise: Joi.number().valid(0).optional().strip()
  }),
  serviceId: Joi.string(),
  providerId: Joi.string(),
  name: Joi.string().max(100).trim(),
  active: Joi.boolean(),
});

export const updateDiscountValidation = Joi.object({
  code: Joi.string().uppercase().max(50).trim(),
  type: Joi.string().valid("percentage", "flat"),
  value: Joi.number().min(0),
  cap: Joi.when('type', {
    is: 'percentage',
    then: Joi.number().min(0).optional(),
    otherwise: Joi.number().valid(0).optional().strip()
  }),
  serviceId: Joi.string(),
  providerId: Joi.string(),
  active: Joi.boolean(),
  name: Joi.string().max(100).trim(),
});

export const bulkUpdateDiscountValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  data: Joi.object({
    type: Joi.string().valid("percentage", "flat"),
    value: Joi.number().min(0),
    cap: Joi.when('type', {
      is: 'percentage',
      then: Joi.number().min(0).optional(),
      otherwise: Joi.number().valid(0).optional().strip()
    }),
    serviceId: Joi.string(),
    providerId: Joi.string(),
    active: Joi.boolean(),
    // code intentionally excluded — bulk payload can't set one code across many discounts
  }).min(1).required(),
});