import Joi from "joi";


export const updateAdminProfileSchema = Joi.object({
  firstName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s]+$/)
    .optional()
    .messages({
      "string.base": "First name must be a string",
      "string.empty": "First name cannot be empty",
      "string.min": "First name must be at least 2 characters long",
      "string.max": "First name cannot exceed 50 characters",
      "string.pattern.base": "First name can only contain letters and spaces",
    }),

  lastName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s]+$/)
    .optional()
    .messages({
      "string.base": "Last name must be a string",
      "string.empty": "Last name cannot be empty",
      "string.min": "Last name must be at least 2 characters long",
      "string.max": "Last name cannot exceed 50 characters",
      "string.pattern.base": "Last name can only contain letters and spaces",
    }),

  phone: Joi.string()
    .pattern(/^\+?[\d\s\-\(\)]+$/)
    .min(10)
    .max(20)
    .optional()
    .messages({
      "string.base": "Phone number must be a string",
      "string.empty": "Phone number cannot be empty",
      "string.pattern.base": "Please provide a valid phone number",
      "string.min": "Phone number must be at least 10 characters",
      "string.max": "Phone number cannot exceed 20 characters",
    }),

  profilePicture: Joi.string().uri().optional().messages({
    "string.base": "Profile picture must be a string",
    "string.uri": "Profile picture must be a valid URL",
  }),
}).messages({
  "object.base": "Profile data must be an object",
});

export const mongoIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    "string.pattern.base": "Invalid ID format",
  });

export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

export const sortingSchema = Joi.object({
  sortBy: Joi.string()
    .valid(
      "createdAt",
      "updatedAt",
      "firstName",
      "lastName",
      "email",
      "lastLogin",
      "averageRating"
    )
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
});

export const dateRangeSchema = Joi.object({
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")),
  period: Joi.string().valid("1d", "7d", "1m", "custom"),
});

export const getAllAccountsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  role: Joi.string().valid("user", "vendor"),
  status: Joi.string().valid(
    "active",
    "pending_verification",
    "suspended",
    "deactivated",
    "incomplete_profile",
    "deleted"
  ),
  isVerified: Joi.string().valid("true", "false"),
  search: Joi.string().max(100),
  sortBy: Joi.string()
    .valid(
      "createdAt",
      "updatedAt",
      "firstName",
      "lastName",
      "email",
      "lastLogin",
      "averageRating"
    )
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")),
  period: Joi.string().valid("1d", "7d", "1m", "custom"),
  businessCategory: Joi.string().max(50),
  location: Joi.string().max(100),
  subscriptionPlan: Joi.string().valid("free", "standard"),
});

export const getAccountsByRoleSchema = Joi.object({
  role: Joi.string().valid("user", "vendor").required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid(
    "active",
    "pending_verification",
    "suspended",
    "deactivated",
    "incomplete_profile",
    "deleted"
  ),
  isVerified: Joi.string().valid("true", "false"),
  search: Joi.string().max(100),
  sortBy: Joi.string()
    .valid(
      "createdAt",
      "updatedAt",
      "firstName",
      "lastName",
      "email",
      "lastLogin",
      "averageRating"
    )
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
});

export const getAccountByIdSchema = mongoIdSchema;

export const updateAccountSchema = Joi.object({
  firstName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s]+$/),
  lastName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s]+$/),
  email: Joi.string().email().lowercase(),
  phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,}$/),
  profilePicture: Joi.string().uri(),
  // Vendor-specific fields
  businessName: Joi.string().min(2).max(100),
  businessPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,}$/),
  businessCategory: Joi.string().max(50),
  businessAddress: Joi.string().max(200),
  location: Joi.string().max(100),
  orderNotifications: Joi.boolean(),
}).min(2);

export const updateAccountStatusSchema = Joi.object({
  status: Joi.string()
    .valid(
      "active",
      "pending_verification",
      "deactivated",
      "incomplete_profile"
    )
    .required(),
});

export const verifyAccountSchema = Joi.object({
  verified: Joi.boolean().default(true),
});

export const suspendAccountSchema = Joi.object({
  duration: Joi.number().integer().min(1).max(365).optional(), // days
});

export const updateBusinessInfoSchema = Joi.object({
  businessName: Joi.string().min(2).max(100),
  businessPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,}$/),
  businessCategory: Joi.string().max(50),
  businessAddress: Joi.string().max(200),
  location: Joi.string().max(100),
  orderNotifications: Joi.boolean(),
}).min(1);

export const updateSubscriptionSchema = Joi.alternatives().try(
  // Standard plan schema
  Joi.object({
    subscriptionPlan: Joi.string().valid("standard").required().messages({
      "any.required": "Subscription plan is required.",
      "any.only": "Subscription plan must be either 'free' or 'standard'.",
      "string.base": "Subscription plan must be a string.",
    }),
    billingCycle: Joi.string().valid("monthly", "annual").required().messages({
      "any.required": "Billing cycle is required.",
      "any.only":
        "For a standard plan, billing cycle must be either 'monthly' or 'annual'.",
      "string.base": "Billing cycle must be a string.",
    }),
  }),

  // Free plan schema
  Joi.object({
    subscriptionPlan: Joi.string().valid("free").required().messages({
      "any.required": "Subscription plan is required.",
      "any.only": "Subscription plan must be either 'free' or 'standard'.",
      "string.base": "Subscription plan must be a string.",
    }),
    billingCycle: Joi.string().valid("none").required().messages({
      "any.required": "Billing cycle is required.",
      "any.only": "For a free plan, billing cycle must be 'none'.",
      "string.base": "Billing cycle must be a string.",
    }),
  })
);

export const resetPasswordSchema = Joi.object({
  sendEmail: Joi.boolean().default(true),
});

export const unlockAccountSchema = Joi.object({
  id: mongoIdSchema,
});

export const toggle2FASchema = Joi.object({
  enabled: Joi.boolean().required(),
  currentPassword: Joi.string().optional(),
});

export const bulkUpdateStatusSchema = Joi.object({
  accountIds: Joi.array().items(mongoIdSchema).min(1).max(50).required(),
  status: Joi.string()
    .valid(
      "active",
      "pending_verification",
      "suspended",
      "deactivated",
      "incomplete_profile",
      "deleted"
    )
    .required(),
});

export const bulkDeleteSchema = Joi.object({
  accountIds: Joi.array().items(mongoIdSchema).min(1).max(20).required(),
});

export const permanentDeleteSchema = Joi.object({
  confirmationCode: Joi.string().required().messages({
    "any.required": "Confirmation code is required for permanent deletion",
  }),
});

export const getActivityLogsSchema = Joi.object({
  id: mongoIdSchema,
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")),
  period: Joi.string().valid("1d", "7d", "1m", "custom"),
  activityType: Joi.string().valid(
    "account_created",
    "account_updated",
    "status_updated",
    "account_verified",
    "account_suspended",
    "account_reactivated",
    "password_reset",
    "login_attempt",
    "login_success",
    "logout",
    "2fa_enabled",
    "2fa_disabled",
    "profile_updated",
    "business_updated",
    "subscription_updated"
  ),
});

export const exportAccountsSchema = Joi.object({
  format: Joi.string().valid("csv", "excel").required(),
  role: Joi.string().valid("user", "vendor"),
  status: Joi.string().valid(
    "active",
    "pending_verification",
    "suspended",
    "deactivated",
    "incomplete_profile",
    "deleted"
  ),
  isVerified: Joi.string().valid("true", "false"),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")),
  period: Joi.string().valid("1d", "7d", "1m", "custom"),
  businessCategory: Joi.string().max(50),
  location: Joi.string().max(100),
});

export const getPendingVendorsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  sortBy: Joi.string()
    .valid("createdAt", "firstName", "lastName", "businessName")
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
});

export const advancedSearchSchema = Joi.object({
  filters: Joi.object({
    role: Joi.string().valid("user", "vendor"),
    status: Joi.array().items(
      Joi.string().valid(
        "active",
        "pending_verification",
        "suspended",
        "deactivated",
        "incomplete_profile",
        "deleted"
      )
    ),
    isVerified: Joi.boolean(),
    hasPhone: Joi.boolean(),
    has2FA: Joi.boolean(),
    loginAttemptsMin: Joi.number().integer().min(0),
    loginAttemptsMax: Joi.number()
      .integer()
      .min(0)
      .when("loginAttemptsMin", {
        is: Joi.exist(),
        then: Joi.number().integer().min(Joi.ref("loginAttemptsMin")),
        otherwise: Joi.number().integer().min(0),
      }),
    lastLoginBefore: Joi.date().iso(),
    lastLoginAfter: Joi.date().iso(),
    createdBefore: Joi.date().iso(),
    createdAfter: Joi.date().iso(),
    // Vendor-specific filters
    businessCategories: Joi.array().items(Joi.string().max(50)),
    locations: Joi.array().items(Joi.string().max(100)),
    subscriptionPlans: Joi.array().items(
      Joi.string().valid("free", "standard")
    ),
    minRating: Joi.number().min(0).max(5),
    minReviews: Joi.number().integer().min(0),
    hasExpiredSubscription: Joi.boolean(),
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string()
    .valid(
      "createdAt",
      "updatedAt",
      "firstName",
      "lastName",
      "email",
      "lastLogin",
      "loginAttempts",
      "averageRating",
      "totalReviews"
    )
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
});

export const getAccountAnalyticsSchema = Joi.object({
  timeframe: Joi.string()
    .valid("7d", "30d", "90d", "6m", "1y", "all")
    .default("30d"),
  groupBy: Joi.string().valid("day", "week", "month").default("day"),
  metrics: Joi.array()
    .items(
      Joi.string().valid(
        "registrations",
        "verifications",
        "logins",
        "suspensions",
        "deletions"
      )
    )
    .default(["registrations"]),
});

export const compareAccountsSchema = Joi.object({
  accountIds: Joi.array().items(mongoIdSchema).min(2).max(5).required(),
  metrics: Joi.array()
    .items(
      Joi.string().valid(
        "basic_info",
        "activity_stats",
        "security_info",
        "business_metrics",
        "subscription_info"
      )
    )
    .default(["basic_info", "activity_stats"]),
});

export const batchOperationSchema = Joi.object({
  operation: Joi.string()
    .valid(
      "verify_accounts",
      "send_notifications",
      "update_subscriptions",
      "generate_reports",
      "cleanup_inactive"
    )
    .required(),
  targetCriteria: Joi.object({
    role: Joi.string().valid("user", "vendor"),
    status: Joi.array().items(Joi.string()),
    isVerified: Joi.boolean(),
    inactiveDays: Joi.number().integer().min(1),
    subscriptionPlan: Joi.string().valid("free", "standard"),
  }),
  operationData: Joi.object().optional(),
  dryRun: Joi.boolean().default(false),
});
