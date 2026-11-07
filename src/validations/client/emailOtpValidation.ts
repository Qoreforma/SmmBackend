import Joi from "joi";

export const buyEmailOtpSchema = Joi.object({
  site: Joi.string().trim().required().messages({
    "string.empty": "Site (e.g. 'telegram', 'facebook') is required",
    "any.required": "Site is required",
  }),
  domain: Joi.string().trim().required().messages({
    "string.empty": "Domain (e.g. '@outlook.com', '@gmail.com') is required",
    "any.required": "Domain is required",
  }),
  provider: Joi.string().trim().optional(),
  pin: Joi.string().length(4).optional().messages({
    "string.empty": "PIN cannot be empty",
    "string.length": "PIN must be exactly 4 characters",
  }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
});
