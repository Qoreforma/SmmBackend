import Joi from "joi";

export const pricingRuleRowValidation = Joi.object({
  providerId: Joi.string().required(),
  serviceId: Joi.string().required(),
  name: Joi.string().max(100).trim().required(),
  typeValue: Joi.string().valid("percentage", "flat"),
  partnerTypeValue: Joi.string().valid("percentage", "flat"),
  discountValue: Joi.number().min(0),
  partnerDiscountValue: Joi.number().min(0),
  cap: Joi.number().min(0).default(0),
  partnerCap: Joi.number().min(0).default(0),
  active: Joi.boolean().required(),
}).or("discountValue", "partnerDiscountValue").or("typeValue", "partnerTypeValue");

export const bulkUpsertPricingRuleValidation = Joi.object({
  rows: Joi.array().items(pricingRuleRowValidation).min(1).required(),
});

export const setPricingRuleStatusValidation = Joi.object({
  active: Joi.boolean().required(),
});