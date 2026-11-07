import Joi, { link } from 'joi';

export const createBannerValidation = Joi.object({
  previewImageUrl: Joi.string().uri().required(),
  featuredImageUrl: Joi.string().uri().required(),
  target: Joi.string().uri().allow('', null),
  link: Joi.string().uri().allow('', null),
  name: Joi.string().max(100).trim(),
});

export const updateBannerValidation = Joi.object({
  previewImageUrl: Joi.string().uri(),
  featuredImageUrl: Joi.string().uri(),
  target: Joi.string().uri().allow('', null),
  link: Joi.string().uri().allow('', null),
  name: Joi.string().max(100).trim(),
}).min(1); 

export const reorderBannersValidation = Joi.object({
  bannerIds: Joi.array().items(Joi.string().required()).min(1).required(),
});