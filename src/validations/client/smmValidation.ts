import Joi from "joi";

export const placeSmmOrderSchema = Joi.object({
  productId: Joi.string().required().messages({
    "string.empty": "Product ID is required",
    "any.required": "Product ID is required",
  }),
  link: Joi.string().min(1).required().messages({
    "string.empty": "Link or username is required",
    "any.required": "Link or username is required",
  }),
  quantity: Joi.number().integer().min(1).optional().messages({
    "number.base": "Quantity must be a number",
    "number.min": "Quantity must be at least 1",
  }),
  pin: Joi.string().length(4).optional().messages({
    "string.empty": "PIN cannot be empty",
    "string.length": "PIN must be exactly 4 characters",
  }),
  target: Joi.string().optional(),
  gender: Joi.string().valid("male", "female", "all", "any").optional(),
  region: Joi.string().optional(),
  comments: Joi.string().optional(),
  comment_gender: Joi.string().valid("male", "female", "all", "any").optional(),
  comment_instructions: Joi.string().optional(),
  duration: Joi.number().integer().min(0).optional(),
  start_count: Joi.number().integer().min(0).optional(),
  start_screenshot: Joi.string().optional().allow(""),
  channel: Joi.string().optional(),
  answer_number: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  usernames: Joi.string().optional(),
  runs: Joi.number().integer().min(1).optional(),
  interval: Joi.number().integer().min(0).optional(),
});
