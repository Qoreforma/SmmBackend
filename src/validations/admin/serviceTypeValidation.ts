import Joi from "joi";

export const createServiceTypeSchema = Joi.object({
  name: Joi.string().required().max(100).trim(),
  description: Joi.string().max(500).trim(),
  icon: Joi.string().max(200).trim(),
  status: Joi.string().valid("active", "coming-soon", "deactivated", "temporary-deactivated").default("active"),
});

export const updateServiceTypeSchema = Joi.object({
  name: Joi.string().max(100).trim(),
  description: Joi.string().max(500).trim(),
  icon: Joi.string().max(200).trim(),
});

export const updateServiceTypeStatusSchema = Joi.object({
  status: Joi.string().valid("active", "coming-soon", "deactivated", "temporary-deactivated").required(),
});
