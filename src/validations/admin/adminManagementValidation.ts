import Joi from 'joi';

export const createAdminValidation = Joi.object({
  firstName: Joi.string().required().max(100).trim(),
  lastName: Joi.string().required().max(100).trim(),
  email: Joi.string().email().required().lowercase().trim(),
  phone: Joi.string().max(20).trim(),
  adminLevel: Joi.string().required(),
  permissions: Joi.array().items(Joi.string()).default([]),
  department: Joi.string().max(100).trim(),
});

export const updateAdminValidation = Joi.object({
  status: Joi.string().valid('active', 'pending_verification', 'suspended', 'deactivated'),
  adminLevel: Joi.string(),
  permissions: Joi.array().items(Joi.string()),
  department: Joi.string().max(100).trim(),
});