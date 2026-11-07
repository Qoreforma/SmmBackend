import Joi from 'joi';

export const bulkUpdateUserStatusValidation = Joi.object({
  userIds: Joi.array().items(Joi.string()).min(1).required(),
  status: Joi.string().valid('active', 'suspended', 'deactivated').required(),
});

export const bulkDeleteUsersValidation = Joi.object({
  userIds: Joi.array().items(Joi.string()).min(1).required(),
});

export const bulkSendNotificationValidation = Joi.object({
  userIds: Joi.array().items(Joi.string()).min(1).required(),
  notification: Joi.object({
    title: Joi.string().required().max(200).trim(),
    message: Joi.string().required().max(1000).trim(),
    type: Joi.string().valid('info', 'warning', 'success', 'error').default('info'),
  }).required(),
});

export const bulkUpdateTransactionStatusValidation = Joi.object({
  transactionIds: Joi.array().items(Joi.string()).min(1).required(),
  status: Joi.string().valid('pending', 'processing', 'completed', 'failed', 'cancelled').required(),
});

export const bulkImportUsersValidation = Joi.object({
  users: Joi.array().items(
    Joi.object({
      firstName: Joi.string().required().max(100).trim(),
      lastName: Joi.string().required().max(100).trim(),
      email: Joi.string().email().required().lowercase().trim(),
      phone: Joi.string().max(20).trim(),
      password: Joi.string().min(8),
    })
  ).min(1).required(),
});