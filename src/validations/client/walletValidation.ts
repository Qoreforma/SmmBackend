import {
  PaymentMethod,
  PaymentProvider,
  PROVIDER_PAYMENT_METHODS,
} from "@/types/payment";
import { TRANSACTION_LIMITS } from "@/utils/constants";
import Joi, { date } from "joi";

export const walletTypeSchema = Joi.object({
  type: Joi.string().valid("main", "bonus", "commission").optional(),
});

export const creditWalletSchema = Joi.object({
  amount: Joi.number().positive().required(),
  reason: Joi.string().required(),
  walletType: Joi.string().valid("main", "bonus", "commission").optional(),
});

export const debitWalletSchema = Joi.object({
  amount: Joi.number().positive().required(),
  reason: Joi.string().required(),
  walletType: Joi.string().valid("main", "bonus", "commission").optional(),
});

export const generateVirtualAccountSchema = Joi.object({
  identificationType: Joi.string().valid("bvn", "nin").required(),
  type: Joi.string().valid("permanent", "temporary").default("permanent"),
  value: Joi.string().required(),
  firstname: Joi.string().required(),
  lastname: Joi.string().required(),
  dateOfBirth: Joi.date().required(),
});

export const withdrawalSchema = Joi.object({
  amount: Joi.number()
    .positive()
    .min(100)
    .max(TRANSACTION_LIMITS.MAX_WITHDRAWAL_AMOUNT)
    .required()
    .messages({
      "any.required": "Amount is required",
      "number.positive": "Amount must be positive",
      "number.min": "Minimum withdrawal amount is ₦100",
      "number.max": `Maximum withdrawal amount is ₦${TRANSACTION_LIMITS.MAX_WITHDRAWAL_AMOUNT.toLocaleString()}`,
    }),

  bankAccountId: Joi.string().required().messages({
    "any.required": "Bank account ID is required",
  }),

  provider: Joi.string()
    .valid("monnify", "flutterwave", "saveHaven", "xixapay")
    .optional()
    .messages({
      "any.only": "Provider must be one of: monnify, flutterwave, saveHaven",
    }),

  pin: Joi.string().length(4).pattern(/^\d+$/).messages({
    "string.length": "Pin must be exactly 4 digits",
    "string.pattern.base": "Pin must contain only numbers",
  }),
  pinToken: Joi.string(),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const bankTransferSchema = Joi.object({
  amount: Joi.number()
    .positive()
    .min(100)
    .max(TRANSACTION_LIMITS.MAX_WITHDRAWAL_AMOUNT)
    .required()
    .messages({
      "any.required": "Amount is required",
      "number.min": "Minimum bank transfer amount is ₦100",
      "number.max": `Maximum bank transfer amount is ₦${TRANSACTION_LIMITS.MAX_WITHDRAWAL_AMOUNT.toLocaleString()}`,
    }),
  bankCode: Joi.string().required().messages({
    "any.required": "Bank code is required",
  }),
  accountName: Joi.string().required().messages({
    "any.required": "Account name is required",
  }),
  accountNumber: Joi.string().required().messages({
    "any.required": "Account number is required",
  }),
  pin: Joi.string().length(4).pattern(/^\d+$/).messages({
    "string.length": "Pin must be exactly 4 digits",
    "string.pattern.base": "Pin must contain only numbers",
  }),
  pinToken: Joi.string(),
  provider: Joi.string()
    .valid("monnify", "flutterwave", "saveHaven", "xixapay")
    .default("saveHaven")
    .messages({
      "any.required": "Provider is required",
    }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const fundWalletSchema = Joi.object({
  amount: Joi.number()
    .min(100)
    .max(TRANSACTION_LIMITS.MAX_DEPOSIT_AMOUNT)
    .required()
    .messages({
      "number.base": "Amount must be a number",
      "number.min": "Minimum amount is ₦100",
      "number.max": `Maximum deposit amount is ₦${TRANSACTION_LIMITS.MAX_DEPOSIT_AMOUNT.toLocaleString()}`,
      "any.required": "Amount is required",
    }),

  method: Joi.string()
    .valid(...Object.values(PaymentMethod))
    .required()
    .messages({
      "string.base": "Payment method must be a string",
      "any.only": `Payment method must be one of: ${Object.values(
        PaymentMethod,
      ).join(", ")}`,
      "any.required": "Payment method is required",
    }),
  provider: Joi.string()
    .valid(...Object.values(PaymentProvider))
    .required()
    .messages({
      "string.base": "Provider must be a string",
      "any.only": `Provider must be one of: ${Object.values(
        PaymentProvider,
      ).join(", ")}`,
      "any.required": "Provider is required",
    }),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
}).custom((value, helpers) => {
  const { method, provider } = value;

  // Check if provider supports the payment method
  const supportedMethods =
    PROVIDER_PAYMENT_METHODS[provider as PaymentProvider];

  if (
    !supportedMethods ||
    !supportedMethods.includes(method as PaymentMethod)
  ) {
    return helpers.error("any.invalid", {
      message: `Provider '${provider}' does not support payment method '${method}'. Supported methods: ${supportedMethods.join(
        ", ",
      )}`,
    });
  }

  return value;
});

export const identificationSchema = Joi.object({
  identificationType: Joi.string().valid("bvn", "nin").required().messages({
    "any.required": "identificationType is required",
    "any.only": "identificationType must be either 'bvn' or 'nin'",
  }),

  value: Joi.string().trim().pattern(/^\d+$/).length(11).required().messages({
    "any.required": "value is required",
    "string.pattern.base": "{{#label}} must contain only digits",
    "string.length": "{{#label}} must be exactly 11 digits",
  }),

  firstname: Joi.string()
    .pattern(/^[a-zA-Z\s\-']+$/)
    .required()
    .messages({
      "any.required": "firstname is required",
      "string.pattern.base": "firstname contains invalid characters",
    }),

  middlename: Joi.string()
    .allow(null, "")
    .pattern(/^[a-zA-Z\s\-']+$/)
    .messages({
      "string.pattern.base": "middlename contains invalid characters",
    }),

  lastname: Joi.string()
    .pattern(/^[a-zA-Z\s\-']+$/)
    .required()
    .messages({
      "any.required": "lastname is required",
      "string.pattern.base": "lastname contains invalid characters",
    }),

  // fullname: Joi.string()
  //   .pattern(/^[a-zA-Z\s\-']+$/)
  //   .required()
  //   .messages({
  //     "any.required": "fullname is required",
  //     "string.pattern.base": "fullname contains invalid characters",
  //   }),

  dateOfBirth: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .custom((value, helpers) => {
      const birthDate = new Date(value);
      const now = new Date();

      if (isNaN(birthDate.getTime())) {
        return helpers.error("any.invalid", { message: "Invalid date format" });
      }

      if (birthDate > now) {
        return helpers.error("any.invalid", {
          message: "dateOfBirth cannot be in the future",
        });
      }

      const age = now.getFullYear() - birthDate.getFullYear();
      const hasBirthdayPassed =
        now.getMonth() > birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() &&
          now.getDate() >= birthDate.getDate());
      const actualAge = hasBirthdayPassed ? age : age - 1;

      if (actualAge < 18) {
        return helpers.error("any.invalid", {
          message: "You must be at least 18 years old to create an account",
        });
      }

      return value;
    })
    .messages({
      "any.required": "dateOfBirth is required",
      "string.pattern.base":
        "dateOfBirth must be in format YYYY-MM-DD (e.g., 1990-01-15)",
      "any.invalid": "{{#message}}",
    }),

  address: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  city: Joi.string().trim().optional(),
  postalCode: Joi.string().trim().optional(),
});

export const verifyOtpAndCreateAccountSchema = Joi.object({
  identityId: Joi.string().trim().required().messages({
    "any.required": "identityId is required (from previous step)",
  }),
  otp: Joi.string().trim().required().messages({
    "any.required": "OTP is required",
  }),
  type: Joi.string().valid("permanent", "temporary").default("permanent"),
  identificationType: Joi.string().valid("bvn", "nin").required().messages({
    "any.required": "identificationType is required",
    "any.only": "identificationType must be either 'bvn' or 'nin'",
  }),
});
export const transferSchema = Joi.object({
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
  }),
  beneficiary: Joi.string().required().messages({
    "any.required": "beneficiary is required",
  }),
  pin: Joi.string().length(4).pattern(/^\d+$/).messages({
    "string.length": "Pin must be exactly 4 digits",
    "string.pattern.base": "Pin must contain only numbers",
  }),
  pinToken: Joi.string().messages({}),
  remark: Joi.string().allow("", null),
  channel: Joi.string().valid("ios", "android", "web", "api").optional(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const xixapayCreateAccountSchema = Joi.object({
  identificationType: Joi.string()
    .valid("bvn", "nin")
    .insensitive()
    .required()
    .messages({
      "any.required": "identificationType is required",
      "any.only": "identificationType must be either 'bvn' or 'nin'",
    }),

  // All optional here — VirtualAccountService.createXixapayVirtualAccount
  // falls back to user.xixapayKyc.* and the generic profile fields if these
  // aren't sent, and returns a clear PROFILE_INCOMPLETE error naming exactly
  // what's missing if nothing can be resolved.
  address: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  city: Joi.string().trim().optional(),
  postalCode: Joi.string().trim().optional(),
});
