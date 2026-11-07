import Joi from "joi";

export const mediaSchemaValidation = Joi.object({
  folder: Joi.string().min(3).max(50).required().messages({
    "string.min": "Folder name must be at least 3 characters long",
    "string.max": "Folder name cannot exceed 50 characters",
    "any.required": "Folder name is required",
  }),
  fileName: Joi.string().min(3).max(50).required().messages({
    "string.min": "File name must be at least 3 characters long",
    "string.max": "File name cannot exceed 50 characters",
    "any.required": "File name is required",
  }),
});
