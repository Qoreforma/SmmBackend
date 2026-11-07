import Joi from "joi";

export const createReferralBonusValidation = Joi.object({
  userType: Joi.string()
    .valid("regular", "influencer", "micro-influencer")
    .optional(),
  bonusType: Joi.string().valid("flat", "percentage").required(),
  value: Joi.number().min(0).required(),
  threshold: Joi.number().min(0).required(),
  description: Joi.string().max(500).trim().optional(),
  isActive: Joi.boolean().default(true),
  name: Joi.string().required().max(100).trim(),
});

export const updateReferralBonusValidation = Joi.object({
  userType: Joi.string().valid("regular", "influencer", "micro-influencer"),
  bonusType: Joi.string().valid("flat", "percentage"),
  value: Joi.number().min(0),
  threshold: Joi.number().min(0),
  description: Joi.string().max(500).trim(),
  isActive: Joi.boolean(),
  name: Joi.string().max(100).trim(),
});

export const updateReferralBonusTermsValidation = Joi.object({
  terms: Joi.string().required().max(5000).trim(),
  status: Joi.string().valid("active", "inactive"),
});
