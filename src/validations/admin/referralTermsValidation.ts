import Joi from "joi";

export const createReferralTermsValidation = Joi.object({
  title: Joi.string().required().max(200).trim(),
  body: Joi.string().required().max(5000).trim(),
});

export const updateReferralTermsValidation = Joi.object({
  title: Joi.string().max(200).trim(),
  body: Joi.string().max(5000).trim(),
});