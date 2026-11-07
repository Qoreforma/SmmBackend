import Joi from "joi";

export const createRouteAction = Joi.object({
  route: Joi.string().required().max(200).trim(),
  module: Joi.string().required().max(100).trim(),
  action: Joi.string().required().max(100).trim(),
  description: Joi.string().max(500).trim(),
  requiredPermissions: Joi.array().items(Joi.string()),
  allowedRoles: Joi.array().items(Joi.string()),
  status: Joi.string().valid("active", "inactive").default("active"),
});
export const updateRouteAction = Joi.object({
  route: Joi.string().max(200).trim(),
  module: Joi.string().max(100).trim(),
  action: Joi.string().max(100).trim(),
  description: Joi.string().max(500).trim(),
  requiredPermissions: Joi.array().items(Joi.string()),
  allowedRoles: Joi.array().items(Joi.string()),
  status: Joi.string().valid("active", "inactive"),
});
