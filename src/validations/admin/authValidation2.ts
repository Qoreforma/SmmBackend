import Joi from 'joi';

export const adminLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const verify2FASchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
});

export const resend2FASchema = Joi.object({
  email: Joi.string().email().required(),
});

export const toggle2FASchema = Joi.object({
  enable: Joi.boolean().required(),
});

export const sendPasswordResetSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const verifyPasswordResetSchema = Joi.object({
  email: Joi.string().email().required(),
  token: Joi.string().required(),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  token: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

export const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

export const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).optional(),
  lastName: Joi.string().min(2).optional(),
  phone: Joi.string().optional(),
  department: Joi.string().optional(),
});
