import Joi from 'joi';


export const updateSettingsSchema = Joi.object({
  value: Joi.string().required().max(1000).trim(),
});
