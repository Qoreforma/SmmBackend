import Joi from "joi";

export const orderGameTopupSchema = Joi.object({
  productId: Joi.string().optional(),
  packageId: Joi.string().optional(),
  fields: Joi.object().pattern(Joi.string(), Joi.any()).optional().default({}),
  pin: Joi.string().length(4).optional().messages({
    "string.empty": "PIN cannot be empty",
    "string.length": "PIN must be exactly 4 characters",
  }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
})
  .or("productId", "packageId")
  .unknown(true)
  .messages({
    "object.missing": "Either productId or packageId is required",
  });
