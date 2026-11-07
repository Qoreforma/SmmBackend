import Joi from "joi";

export const initiateSetupSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
  biometricType: Joi.string()
    .valid("faceId", "touchId", "fingerprint", "biometric")
    .optional()
    .default("biometric"),
});

export const completeSetupSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
  deviceName: Joi.string().trim().optional().default("Mobile Device"),
  publicKey: Joi.string().trim().required().messages({
    "any.required": "Public key is required",
    "string.empty": "Public key cannot be empty",
  }),
  signature: Joi.string().trim().required().messages({
    "any.required": "Cryptographic signature is required",
    "string.empty": "Signature cannot be empty",
  }),
  algorithm: Joi.string()
    .valid("ES256", "RS256")
    .optional()
    .default("ES256"),
  biometricType: Joi.string()
    .valid("faceId", "touchId", "fingerprint", "biometric")
    .optional()
    .default("biometric"),
  purpose: Joi.string()
    .valid("login", "transaction", "all")
    .optional()
    .default("all"),
});

export const initiateLoginSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    "any.required": "Email is required",
    "string.empty": "Email cannot be empty",
    "string.email": "Must be a valid email address",
  }),
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
});

export const verifyLoginSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    "any.required": "Email is required",
    "string.empty": "Email cannot be empty",
  }),
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
  signature: Joi.string().trim().required().messages({
    "any.required": "Cryptographic signature is required",
    "string.empty": "Signature cannot be empty",
  }),
  fcmToken: Joi.string().optional(),
  rememberMe: Joi.boolean().optional().default(false),
  ipAddress: Joi.string().optional(),
  device: Joi.string().optional(),
  location: Joi.string().optional(),
  version: Joi.string().optional().allow("", null),
  appVersion: Joi.string().optional().allow("", null),
});

export const initiateTxnSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
  transactionType: Joi.string().optional(),
  amount: Joi.number().optional(),
});

export const verifyTxnSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID is required",
    "string.empty": "Device ID cannot be empty",
  }),
  signature: Joi.string().trim().required().messages({
    "any.required": "Cryptographic signature is required",
    "string.empty": "Signature cannot be empty",
  }),
});

export const revokeDeviceParamsSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID parameter is required",
  }),
});

export const togglePurposeParamsSchema = Joi.object({
  deviceId: Joi.string().trim().required().messages({
    "any.required": "Device ID parameter is required",
  }),
});

export const togglePurposeBodySchema = Joi.object({
  purpose: Joi.string().valid("login", "transaction").required().messages({
    "any.required": "Purpose is required",
    "any.only": "Purpose must be 'login' or 'transaction'",
  }),
  enabled: Joi.boolean().required().messages({
    "any.required": "Enabled flag is required",
    "boolean.base": "Enabled must be a boolean",
  }),
});
