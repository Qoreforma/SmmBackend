import Joi from "joi";

export const createProviderValidation = Joi.object({
  name: Joi.string().required().max(100).trim(),
  logo: Joi.string().max(200).trim(),
  isActive: Joi.boolean().default(true),
  hasSync: Joi.boolean().default(false),
  serviceTypes: Joi.array().items(Joi.string()).default([]),
  usd_ngn_rate: Joi.number().positive().allow(null).optional(),
  usdNgnRate: Joi.number().positive().allow(null).optional(),
  markup_percent: Joi.number().min(0).allow(null).optional(),
  markupPercent: Joi.number().min(0).allow(null).optional(),
}).unknown(true);

export const updateProviderValidation = Joi.object({
  name: Joi.string().max(100).trim(),
  logo: Joi.string().max(200).trim(),
  isActive: Joi.boolean(),
  hasSync: Joi.boolean(),
  serviceTypes: Joi.array().items(Joi.string()),
  usd_ngn_rate: Joi.number().positive().allow(null).optional(),
  usdNgnRate: Joi.number().positive().allow(null).optional(),
  markup_percent: Joi.number().min(0).allow(null).optional(),
  markupPercent: Joi.number().min(0).allow(null).optional(),
}).unknown(true);

export const syncProductsValidation = Joi.object({
  serviceTypeId: Joi.string().optional(),
  forceUpdate: Joi.boolean().default(false),
});

export const toggleProductsValidation = Joi.object({
  isActive: Joi.boolean().required(),
});