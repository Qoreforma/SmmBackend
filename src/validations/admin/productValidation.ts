import Joi from "joi";

const MAX_DISCOUNT_PERCENT = 0.03; // 3% maximum allowed discount below provider amount

const validateSellingAmountMargin = (value: any, helpers: any) => {
  if (value.amount !== undefined && value.providerAmount !== undefined) {
    if (value.amount < value.providerAmount) {
      if (!value.allowBelowCost) {
        return helpers.message({
          custom:
            "Selling amount cannot be less than provider cost unless 'allowBelowCost' is enabled",
        });
      }
      const minAllowed =
        Math.floor(value.providerAmount * (1 - MAX_DISCOUNT_PERCENT) * 100) / 100;
      if (value.amount < minAllowed) {
        return helpers.message({
          custom: `Selling amount cannot be more than 3% below provider cost (minimum ₦${minAllowed.toLocaleString()})`,
        });
      }
    }
  }
  return value;
};

export const createProductValidation = Joi.object({
  // Required fields
  serviceId: Joi.string().required().messages({
    "string.empty": "Service ID is required",
    "any.required": "Service ID is required",
  }),

  providerId: Joi.string().required().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),

  name: Joi.string().required().max(200).trim().messages({
    "string.empty": "Product name is required",
    "any.required": "Product name is required",
    "string.max": "Product name cannot exceed 200 characters",
  }),

  code: Joi.string().required().max(100).trim().messages({
    "string.empty": "Product code is required",
    "any.required": "Product code is required",
    "string.max": "Product code cannot exceed 100 characters",
  }),

  providerAmount: Joi.number().positive().required().messages({
    "number.base": "Provider amount must be a number",
    "number.positive": "Provider amount must be greater than 0",
    "any.required": "Provider amount is required",
  }),

  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),

  // Optional fields
  logo: Joi.string().allow("").trim().messages({
    "string.base": "Logo must be a string",
  }),

  validity: Joi.string().max(100).trim().messages({
    "string.max": "Validity cannot exceed 100 characters",
  }),
  dataSize: Joi.number().positive().messages({
    "number.base": "Data size must be a number",
    "number.positive": "Data size must be greater than 0",
  }),

  dataSizeDisplay: Joi.string().max(50).trim().messages({
    "string.max": "Data size display cannot exceed 50 characters",
  }),
  description: Joi.string().max(500).trim().messages({
    "string.max": "Description cannot exceed 500 characters",
  }),

  category: Joi.string().allow("", null).trim().messages({
    "string.base": "Category must be a string",
  }),
  productType: Joi.string().allow("", null).trim().messages({
    "string.base": "Product type must be a string",
  }),

  attributes: Joi.object().default({}).messages({
    "object.base": "Attributes must be an object",
  }),

  isActive: Joi.boolean().default(true).messages({
    "boolean.base": "isActive must be a boolean",
  }),

  isHot: Joi.boolean().default(false).messages({
    "boolean.base": "isHot must be a boolean",
  }),

  allowBelowCost: Joi.boolean().default(false).messages({
    "boolean.base": "allowBelowCost must be a boolean",
  }),
}).custom(validateSellingAmountMargin);

export const updateProductValidation = Joi.object({
  // All fields optional for update
  serviceId: Joi.string().messages({
    "string.empty": "Service ID cannot be empty",
  }),

  providerId: Joi.string().messages({
    "string.empty": "Provider ID cannot be empty",
  }),

  name: Joi.string().max(200).trim().messages({
    "string.empty": "Product name cannot be empty",
    "string.max": "Product name cannot exceed 200 characters",
  }),

  code: Joi.string().max(100).trim().messages({
    "string.empty": "Product code cannot be empty",
    "string.max": "Product code cannot exceed 100 characters",
  }),

  providerAmount: Joi.number().positive().messages({
    "number.base": "Provider amount must be a number",
    "number.positive": "Provider amount must be greater than 0",
  }),

  amount: Joi.number().positive().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
  }),

  logo: Joi.string().allow("").trim().messages({
    "string.base": "Logo must be a string",
  }),

  validity: Joi.string().max(100).trim().messages({
    "string.max": "Validity cannot exceed 100 characters",
  }),

  description: Joi.string().max(500).trim().messages({
    "string.max": "Description cannot exceed 500 characters",
  }),

  dataSize: Joi.number().positive().messages({
    "number.base": "Data size must be a number",
    "number.positive": "Data size must be greater than 0",
  }),

  dataSizeDisplay: Joi.string().max(50).trim().messages({
    "string.max": "Data size display cannot exceed 50 characters",
  }),

  category: Joi.string().allow("", null).trim().messages({
    "string.base": "Category must be a string",
  }),
  productType: Joi.string().allow("", null).trim().messages({
    "string.base": "Product type must be a string",
  }),

  attributes: Joi.object().messages({
    "object.base": "Attributes must be an object",
  }),

  isActive: Joi.boolean().messages({
    "boolean.base": "isActive must be a boolean",
  }),

  isHot: Joi.boolean().messages({
    "boolean.base": "isHot must be a boolean",
  }),

  allowBelowCost: Joi.boolean().messages({
    "boolean.base": "allowBelowCost must be a boolean",
  }),
}).custom(validateSellingAmountMargin);

// Validation for status update endpoint
export const updateProductStatusValidation = Joi.object({
  status: Joi.boolean().required().messages({
    "boolean.base": "Status must be a boolean",
    "any.required": "Status is required",
  }),
});

// Validation for hot status update endpoint
export const updateProductHotStatusValidation = Joi.object({
  isHot: Joi.boolean().required().messages({
    "boolean.base": "isHot must be a boolean",
    "any.required": "isHot is required",
  }),
});

// Validation for fetch provider products endpoint
export const fetchProviderProductsValidation = Joi.object({
  serviceId: Joi.string().required().messages({
    "string.empty": "Service ID is required",
    "any.required": "Service ID is required",
  }),
});
