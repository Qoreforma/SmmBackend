import Joi from 'joi';

export const createEmailTemplateValidation = Joi.object({
  name: Joi.string().required().max(200).trim(),
  slug: Joi.string().required().max(100).trim().lowercase(),
  subject: Joi.string().required().max(500).trim(),
  body: Joi.string().required(),
  category: Joi.string().valid('transactional', 'notification', 'marketing').required(),
  variables: Joi.array().items(Joi.string()).default([]),
  status: Joi.string().valid('active', 'inactive').default('active'),
});

export const updateEmailTemplateValidation = Joi.object({
  name: Joi.string().max(200).trim(),
  slug: Joi.string().max(100).trim().lowercase(),
  subject: Joi.string().max(500).trim(),
  body: Joi.string(),
  category: Joi.string().valid('transactional', 'notification', 'marketing'),
  variables: Joi.array().items(Joi.string()),
  status: Joi.string().valid('active', 'inactive'),
});