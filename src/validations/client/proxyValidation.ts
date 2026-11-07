import Joi from "joi";

export const buyProxySchema = Joi.object({
  product: Joi.string().trim().required().messages({
    "string.empty": "Product code is required",
    "any.required": "Product code is required",
  }),
  plan: Joi.string().trim().required().messages({
    "string.empty": "Plan code is required",
    "any.required": "Plan code is required",
  }),
  quantity: Joi.number().integer().min(1).max(100).required().messages({
    "number.base": "Quantity must be a number",
    "number.min": "Quantity must be at least 1",
    "number.max": "Maximum 100 proxies per order",
    "any.required": "Quantity is required",
  }),
  location: Joi.string().optional().allow(""),
  pin: Joi.string().length(4).optional().messages({
    "string.empty": "PIN cannot be empty",
    "string.length": "PIN must be exactly 4 characters",
  }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
});
