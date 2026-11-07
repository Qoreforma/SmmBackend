import Joi from "joi";

// Create Service Validation
export const createServiceValidation = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.base": "Service name must be a string",
      "string.empty": "Service name is required",
      "string.min": "Service name must be at least 2 characters",
      "string.max": "Service name must not exceed 100 characters",
      "any.required": "Service name is required",
    }),
  logo: Joi.string()
    .uri()
    .allow("")
    .optional()
    .messages({
      "string.uri": "Logo must be a valid URL",
    }),
  serviceTypeId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "Invalid service type ID format",
      "any.required": "Service type ID is required",
    }),
  isActive: Joi.boolean().optional().default(true),
  displayOrder: Joi.number()
    .integer()
    .min(0)
    .optional()
    .default(0)
    .messages({
      "number.base": "Display order must be a number",
      "number.integer": "Display order must be an integer",
      "number.min": "Display order must be a positive number",
    }),
});

// Update Service Validation
export const updateServiceValidation = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.base": "Service name must be a string",
      "string.empty": "Service name is required",
      "string.min": "Service name must be at least 2 characters",
      "string.max": "Service name must not exceed 100 characters",
      "any.required": "Service name is required",
    }),

  logo: Joi.string()
    .uri()
    .allow("")
    .optional()
    .messages({
      "string.uri": "Logo must be a valid URL",
    }),
  serviceTypeId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Invalid service type ID format",
      "any.required": "Service type ID is required",
    }),
  displayOrder: Joi.number()
    .integer()
    .min(0)
    .optional()
    .messages({
      "number.base": "Display order must be a number",
      "number.integer": "Display order must be an integer",
      "number.min": "Display order must be a positive number",
    }),
});

// Update Service Status Validation
export const updateServiceStatusValidation = Joi.object({
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive status is required",
    "boolean.base": "isActive must be a boolean",
  }),
  forceDeactivate: Joi.boolean().optional().default(false),
});
