import Joi from "joi";

export const registerSchema = Joi.object({
  firstname: Joi.string().min(2).max(50).required(),
  lastname: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  phone: Joi.string().max(10).optional(),
  phoneCode: Joi.string().optional(),
  username: Joi.string().alphanum().min(3).max(20).optional(),
  referralCode: Joi.string().optional().allow(""),
  gender: Joi.string().valid("male", "female", "other").optional(),
  country: Joi.string().optional().allow(""),
  state: Joi.string().optional().allow(""),
  city: Joi.string().optional().allow(""),
  address: Joi.string().optional().allow(""),
  postalCode: Joi.string().optional().allow(""),
  fcmToken: Joi.string().optional().messages({
    "any.required": "FCM token is required",
  }),
});


export const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .when("biometricToken", {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.required(),
    })
    .messages({
      "any.required": "Email is required",
      "string.empty": "Email is required",
    }),
  password: Joi.string()
    .when("biometricToken", {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.required(),
    })
    .messages({
      "any.required": "Password is required",
      "string.empty": "Password is required",
    }),
  rememberMe: Joi.boolean().optional().default(false),
  fcmToken: Joi.string().optional().messages({
    "any.required": "FCM token is required",
  }),
  biometricToken: Joi.string().optional(),
  isAppTokensNeed: Joi.boolean().optional().default(false),
  ipAddress: Joi.string().optional(),
  device: Joi.string().optional(),
  location: Joi.string().optional(),
  version: Joi.string().optional().allow("", null),
  appVersion: Joi.string().optional().allow("", null),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  otp: Joi.string().required(),
  password: Joi.string().min(8).required(),
  gmail: Joi.string().email().optional(),
});

export const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    "any.required": "Old password is required",
  }),
  newPassword: Joi.string().min(8).required().messages({
    "string.min": "New password must be at least 8 characters long",
    "any.required": "New password is required",
  }),
});

export const changeAppPasswordSchema = Joi.object({
  newPassword: Joi.string().min(8).required(),
  email: Joi.string().email().required(),
});

export const changeEmailSchema = Joi.object({
  oldEmail: Joi.string().email().required(),
  newEmail: Joi.string().required(),
});

export const verifyOTPAppSchema = Joi.object({
  otp: Joi.string().length(6).required(),
  email: Joi.string().email().required(),
});
export const verifyOTPSchema = Joi.object({
  otp: Joi.string().length(6).required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  phoneCode: Joi.string().optional(),
});

export const phoneNumberVerificationSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required",
  }),
  phoneCode: Joi.string().required().messages({
    "any.required": "Phone code is required",
  }),
});

export const updatePinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required(),
  password: Joi.string().required(),
});

export const changePinSchema = Joi.object({
  oldPin: Joi.string().length(4).pattern(/^\d+$/).required(),
  newPin: Joi.string().length(4).pattern(/^\d+$/).required(),
});

export const setPinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required(),
});

export const verifyPinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required(),
});

export const resetPinSchema = Joi.object({
  newPin: Joi.string().length(4).pattern(/^\d+$/).required().messages({
    "string.length": "Pin must be exactly 4 digits",
    "string.pattern.base": "Pin must contain only numbers",
  }),
  otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "string.pattern.base": "OTP must contain only numbers",
  }),
});

export const verifyPinOtpSchema = Joi.object({
  otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "string.pattern.base": "OTP must contain only numbers",
  }),
});

export const toggle2FASchema = Joi.object({
  enable: Joi.boolean().required(),
});
