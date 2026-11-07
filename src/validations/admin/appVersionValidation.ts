import Joi from "joi";

export const createAppVersionValidation = Joi.object({
  version: Joi.string().max(20).trim(),
  buildNumber: Joi.number(),
  isForceUpdate: Joi.boolean(),
  storeLink: Joi.string().max(200).trim(),
  isRequired: Joi.boolean(),
  platform: Joi.string().valid("Android", "iOS").required(),
});

export const updateAppVersionValidation = Joi.object({
  version: Joi.string().max(20).trim(),
  buildNumber: Joi.number(),
  isForceUpdate: Joi.boolean(),
  storeLink: Joi.string().max(200).trim(),
  isRequired: Joi.boolean(),
});
