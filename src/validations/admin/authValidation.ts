// import { ADMIN_PERMISSIONS } from "@/types";
import Joi from "joi";

const getAllPermissions = () => {
  // return Object.values(ADMIN_PERMISSIONS).flatMap((category) =>
  //     Object.values(category)
  // );
  return [];
};

const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .required()
  .messages({
    "string.min": "Password must be at least 8 characters long",
    "string.max": "Password cannot exceed 128 characters",
    "string.pattern.base":
      "Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character",
    "any.required": "Password is required",
  });

const nameSchema = Joi.string()
  .trim()
  .min(2)
  .max(50)
  .pattern(/^[a-zA-Z\s]+$/)
  .messages({
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name cannot exceed 50 characters",
    "string.pattern.base": "Name can only contain letters and spaces",
  });

const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .lowercase()
  .trim()
  .required()
  .messages({
    "string.email": "Please enter a valid email address",
    "any.required": "Email is required",
  });

const phoneSchema = Joi.string()
  .pattern(/^\+?[\d\s\-\(\)]{10,}$/)
  .allow(null, "")
  .messages({
    "string.pattern.base": "Please enter a valid phone number",
  });

const adminLevelSchema = Joi.string().required().messages({
  "any.only": "Admin level is required",
  "any.required": "Admin level is required",
});

const statusSchema = Joi.string()
  .valid("active", "pending_verification", "suspended", "deactivated")
  .default("active")
  .messages({
    "any.only":
      "Status must be one of: active, pending_verification, suspended, deactivated",
  });

const departmentSchema = Joi.string().max(50).allow(null, "").messages({
  "string.max": "Department cannot exceed 50 characters",
});

const permissionsSchema = Joi.array()
  .items(Joi.string().valid(...getAllPermissions().filter((p) => p !== "*")))
  .optional()
  .messages({
    "array.includes": "Invalid permission specified",
  });

export const createAdminSchema = Joi.object({
  firstName: nameSchema.required().messages({
    "any.required": "First name is required",
  }),

  lastName: nameSchema.required().messages({
    "any.required": "Last name is required",
  }),

  email: emailSchema,

  adminLevel: adminLevelSchema,

  permissions: permissionsSchema,

  phone: phoneSchema,

  status: statusSchema,
}).options({
  abortEarly: false,
  stripUnknown: true,
});

export const updateAdminSchema = Joi.object({
  firstName: nameSchema.optional(),

  lastName: nameSchema.optional(),

  adminLevel: adminLevelSchema.optional(),

  permissions: permissionsSchema.optional(),

  department: departmentSchema.optional(),

  phone: phoneSchema.optional(),

  status: statusSchema.optional(),
})
  .options({
    abortEarly: false,
    stripUnknown: true,
  })
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Query Parameters Validation for Get All Admins
export const getAdminsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    "number.min": "Page must be at least 1",
    "number.integer": "Page must be an integer",
  }),

  limit: Joi.number().integer().min(1).max(100).default(10).messages({
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 100",
    "number.integer": "Limit must be an integer",
  }),

  adminLevel: Joi.string()
    .valid("super_admin", "admin", "moderator")
    .optional(),

  status: Joi.string()
    .valid("active", "pending_verification", "suspended", "deactivated")
    .optional(),

  department: Joi.string().max(50).optional(),

  search: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Search term must be at least 2 characters",
    "string.max": "Search term cannot exceed 100 characters",
  }),
}).options({
  abortEarly: false,
  stripUnknown: true,
});

export const mongoIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    "string.pattern.base": "Invalid admin ID format",
    "any.required": "Admin ID is required",
  });

export const adminIdParamSchema = Joi.object({
  adminId: mongoIdSchema,
}).options({
  abortEarly: false,
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
  }),

  password: Joi.string().required().messages({
    "string.empty": "Password is required",
  }),
});
export const verify2FA = Joi.object({
  email: emailSchema,
  otp: Joi.string().required().messages({
    "any.required": "Otp is required",
  }),
});
export const verifyOTPSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
  }),

  otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "string.pattern.base": "OTP must contain only numbers",
  }),
});

export const resendOTPSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
  }),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    "string.empty": "Refresh token is required",
  }),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
  }),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
  }),

  otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "string.pattern.base": "OTP must contain only numbers",
  }),

  newPassword: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters long",
      "string.max": "Password cannot exceed 128 characters",
      "string.pattern.base":
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    }),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "any.required": "Current Password is required",
  }),
  newPassword: passwordSchema,
});
