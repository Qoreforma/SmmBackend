import Joi from "joi";

export const updateEmailBannerValidation = Joi.object({
  logoUrl: Joi.string().uri().allow('', null),
  headerBannerUrl: Joi.string().uri().allow('', null),
  footerBannerUrl: Joi.string().uri().allow('', null),
}).min(1);
