import Joi from "joi";

export const createCashbackRuleValidation = Joi.object({
  serviceTypeId: Joi.string().required(),
  type: Joi.string().valid("flat", "percentage").required(),
  value: Joi.number().min(0).required(),
  active: Joi.boolean().default(true),
});

export const updateCashbackRuleValidation = Joi.object({
  serviceTypeId: Joi.string().allow(null, ""),
  type: Joi.string().valid("flat", "percentage"),
  value: Joi.number().min(0),
  active: Joi.boolean(),
});

export const bulkUpdateCashbackRuleValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  data: Joi.object({
    type: Joi.string().valid("flat", "percentage"),
    value: Joi.number().min(0),
    active: Joi.boolean(),
    serviceTypeId: Joi.string().allow(null, ""),
  })
    .min(1)
    .required(),
});

