import Joi from "joi";

export const rentNumberSchema = Joi.object({
  country: Joi.string().trim().required().messages({
    "string.empty": "Country is required",
    "any.required": "Country is required",
  }),
  service: Joi.string().trim().required().messages({
    "string.empty": "Service code (e.g. 'wa', 'tg', 'facebook') is required",
    "any.required": "Service code is required",
  }),
  operator: Joi.string().trim().optional(),
  provider: Joi.string().trim().optional(),
  areaCode: Joi.string().trim().optional(),
  carrier: Joi.string().trim().optional(),
  pin: Joi.string().length(4).optional().messages({
    "string.empty": "PIN cannot be empty",
    "string.length": "PIN must be exactly 4 characters",
  }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
});
