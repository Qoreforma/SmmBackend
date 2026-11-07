import Joi from 'joi';

// FAQ Validations
export const createFaqValidation = Joi.object({
  question: Joi.string().required().max(500).trim().messages({
    'string.empty': 'Question is required',
    'string.max': 'Question must not exceed 500 characters',
  }),
  answer: Joi.string().required().max(2000).trim().messages({
    'string.empty': 'Answer is required',
    'string.max': 'Answer must not exceed 2000 characters',
  }),
  faqCategoryId: Joi.string().required().messages({
    'string.empty': 'FAQ category is required',
  }),

  isActive: Joi.boolean().default(true),
});

export const updateFaqValidation = Joi.object({
  question: Joi.string().max(500).trim().messages({
    'string.max': 'Question must not exceed 500 characters',
  }),
  answer: Joi.string().max(2000).trim().messages({
    'string.max': 'Answer must not exceed 2000 characters',
  }),
  faqCategoryId: Joi.string(),

  isActive: Joi.boolean(),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});

// FAQ Category Validations
export const createFaqCategoryValidation = Joi.object({
  name: Joi.string().required().max(100).trim().messages({
    'string.empty': 'Category name is required',
    'string.max': 'Category name must not exceed 100 characters',
  }),

  isActive: Joi.boolean().default(true),
});

export const updateFaqCategoryValidation = Joi.object({
  name: Joi.string().max(100).trim().messages({
    'string.max': 'Category name must not exceed 100 characters',
  }),

  isActive: Joi.boolean(),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});