import Joi from 'joi';

export const declineDepositSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});

export const approveDepositSchema = Joi.object({
  otp: Joi.string().length(6).required(),
});
