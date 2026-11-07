import Joi from "joi";

export const bulkUpdateCommissionValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  data: Joi.object({
    type: Joi.string().valid("flat", "percentage"),
    value: Joi.number().min(0),
    name: Joi.string().max(100).trim(),
    active: Joi.boolean(),
    // providerId/serviceId intentionally excluded — they form a unique compound
    // index, so a bulk payload can't set the same pair across many commissions
  }).min(1).required(),
});