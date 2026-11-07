import Joi from "joi";

export const updateServiceChargeValidationSchema = Joi.object({
  type: Joi.string().valid("percentage", "flat"),
  name: Joi.string().max(100).trim(),
  value: Joi.number().min(0).max(100).required(),
  cap: Joi.when('type', {
    is: 'percentage',
    then: Joi.number().min(0).optional(),
    otherwise: Joi.number().valid(0).optional().strip()
  }),
  details: Joi.string().max(500).allow(null, "").trim(),
});

export const bulkUpdateServiceChargeValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  data: Joi.object({
    type: Joi.string().valid("percentage", "flat"),
    value: Joi.number().min(0).max(100),
    cap: Joi.when('type', {
      is: 'percentage',
      then: Joi.number().min(0).optional(),
      otherwise: Joi.number().valid(0).optional().strip()
    }),
    details: Joi.string().max(500).allow(null, ""),
    // code intentionally excluded — bulk payload can't set one code across many charges
  }).min(1).required(),
});