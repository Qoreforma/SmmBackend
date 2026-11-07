import { Response } from "express";
import { HTTP_STATUS } from "./constants";
import crypto from "crypto";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { error } from "console";
import { string, boolean } from "joi";
import mongoose from "mongoose";

export interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  timestamp: string;
  path: string;
}

export const getEnviroment = (): string => {
  return process.env.NODE_ENV || "development";
};

export interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
  details?: any;
  timestamp: string;
  path: string;
}

export interface PaginatedResponse<T> {
  success: true;
  message: string;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  timestamp: string;
  path: string;
}

export const sendSuccessResponse = <T>(
  res: Response,
  data: T,
  message: string = "Success",
  statusCode: number = HTTP_STATUS.OK,
): Response => {
  const response: SuccessResponse<T> = {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
    path: res.req.originalUrl,
  };
  return res.status(statusCode).json(response);
};

export const sendErrorResponse = (
  res: Response,
  message: string,
  statusCode: number = HTTP_STATUS.BAD_REQUEST,
  error?: string,
  details?: any,
): Response => {
  const response: ErrorResponse = {
    success: false,
    message,
    error,
    details,
    timestamp: new Date().toISOString(),
    path: res.req.originalUrl,
  };
  return res.status(statusCode).json(response);
};

export const sendPaginatedResponse = <T>(
  res: Response,
  data: T[],
  pagination: {
    total: number;
    page: number;
    limit: number;
  },
  message: string = "Success",
): Response => {
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const response: PaginatedResponse<T> = {
    success: true,
    message,
    data,
    pagination: {
      ...pagination,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
    timestamp: new Date().toISOString(),
    path: res.req.originalUrl,
  };
  return res.status(HTTP_STATUS.OK).json(response);
};

// Reference generation helper
export const generateReference = (prefix: string = "TXN"): string => {
  const timestampPart = Date.now().toString().slice(-6);

  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let i = 0; i < 3; i++) {
    randomPart += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }

  return `${prefix}-${timestampPart}${randomPart}`;
};

// RefCode generation helper
export const generateRefCode = (length: number = 8): string => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export const generatePasswordCrypto = (length = 8) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }

  return password;
};

// Round amount to 2 decimal places (kobo precision)
// Prevents floating point precision issues
//
// Examples:
// 15.000000001 -> 15.00
// 100.999 -> 101.00
// 50.5555 -> 50.56
export const roundAmount = (amount: number | string): number => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  if (isNaN(num)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  // Round to 2 decimal places (kobo)
  return Math.round(num * 100) / 100;
};

// Safely add amounts with kobo precision
export const addAmounts = (...amounts: number[]): number => {
  const sum = amounts.reduce((acc, curr) => acc + curr, 0);
  return roundAmount(sum);
};

// Safely subtract amounts with kobo precision
export const subtractAmounts = (amount1: number, amount2: number): number => {
  return roundAmount(amount1 - amount2);
};

// Safely multiply amount with kobo precision
export const multiplyAmount = (amount: number, multiplier: number): number => {
  return roundAmount(amount * multiplier);
};

// Calculate percentage of amount with kobo precision
// @param amount - Base amount
// @param percentage - Percentage (e.g., 1.5 for 1.5%)
export const calculatePercentage = (
  amount: number,
  percentage: number,
): number => {
  return roundAmount((amount * percentage) / 100);
};

// Format amount for display (with currency)
export const formatAmount = (
  amount: number,
  currency: string = "NGN",
): string => {
  const rounded = roundAmount(amount);
  return `${currency} ${rounded.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Validate amount is positive and within limits
export const validateAmount = (
  amount: number,
  min: number = 0.01,
  max: number = 10000000,
): { valid: boolean; error?: string } => {
  const rounded = roundAmount(amount);

  if (rounded < min) {
    return {
      valid: false,
      error: `Amount must be at least ${formatAmount(min)}`,
    };
  }

  if (rounded > max) {
    return { valid: false, error: `Amount cannot exceed ${formatAmount(max)}` };
  }

  return { valid: true };
};

// Compare amounts with kobo precision
export const compareAmounts = (a: number, b: number): number => {
  const diff = roundAmount(a - b);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
};

export const formatPhoneNumber = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, "");

  // strip a leading 234 if it's already there, so we don't double it up
  if (cleaned.startsWith("234")) {
    cleaned = cleaned.substring(3);
  }

  // strip a leading 0 (local format)
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  return "234" + cleaned;
};

export const toLocalPhoneFormat = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, "");

  // Handle Nigerian country codes
  if (cleaned.startsWith("234")) {
    cleaned = cleaned.substring(3); // Strip '234'
  }

  if (cleaned.length === 10) {
    cleaned = "0" + cleaned;
  }

  return cleaned;
};

// Mask phone number - show first 4 and last 2 digits
export const maskPhone = (phone: string): string => {
  if (!phone || phone.length < 6) {
    return "****";
  }
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 6) {
    return "****";
  }
  return cleaned.slice(0, 4) + "****" + cleaned.slice(-2);
};

// Mask email - show first 3 and last 2 characters of the local part
export const maskEmail = (email: string): string => {
  if (!email || !email.includes("@")) {
    return "****";
  }

  const [local, domain] = email.split("@");

  if (!local || local.length < 3) {
    return "****@" + domain;
  }

  if (local.length <= 5) {
    return local.slice(0, 1) + "****" + local.slice(-1) + "@" + domain;
  }

  return local.slice(0, 3) + "****" + local.slice(-2) + "@" + domain;
};

export const generateWhatsAppLink = (whatsappNumber: string): string => {
  if (!whatsappNumber) return "";

  // Remove all non-digits
  const digits = whatsappNumber.replace(/\D/g, "");

  // WhatsApp links use international format without + sign
  // Format: https://wa.me/[country_code][phone_number]
  return `https://wa.me/${digits}`;
};

export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 50,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isWriteConflict = error.code === 112;
      const isTransientError =
        error.errorLabels?.includes("TransientTransactionError") ||
        error.hasErrorLabel?.("TransientTransactionError") ||
        error.errorLabelSet?.TransientTransactionError === true;
      const isNoSuchTransaction = error.code === 251;

      const isRetryable =
        isWriteConflict || isTransientError || isNoSuchTransaction;
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      logger.debug(
        `[Retry ${attempt}/${maxRetries}] Operation failed with ${
          error.codeName || error.code
        }. Retrying in ${delayMs * Math.pow(2, attempt - 1)}ms...`,
      );

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)),
      );
    }
  }

  throw lastError!;
}

export async function retrySessionOperation<T>(
  operationWithSession: (session: any) => Promise<T>,
  mongoClient: any,
  maxRetries: number = 3,
  delayMs: number = 50,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const session = mongoClient.startSession();

    try {
      const result = await operationWithSession(session);
      return result;
    } catch (error: any) {
      lastError = error;

      // Detect retryable MongoDB errors
      const isWriteConflict = error.code === 112;
      const isTransientError = error.errorLabels?.includes(
        "TransientTransactionError",
      );
      const isRetryable = isWriteConflict || isTransientError;

      // Clean up session
      try {
        await session.endSession();
      } catch (e) {
        // Session already closed, ignore
      }

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      logger.debug(
        `[Session Retry ${attempt}/${maxRetries}] Operation failed with ${
          error.codeName || error.code
        }. Retrying in ${delayMs * Math.pow(2, attempt - 1)}ms...`,
      );

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)),
      );
    }
  }

  throw lastError!;
}
export function checkProviderConfig(
  providerName: string,
  config: Record<string, any>,
  options?: {
    skipKeys?: string[]; // Keys to skip (e.g., ['name', 'isSandBox'])
    required?: string[]; // If provided, only check these keys
  },
): void {
  const errors: string[] = [];
  const skipKeys = options?.skipKeys || ["name"];
  const requiredKeys = options?.required;

  const keysToCheck = requiredKeys || Object.keys(config);

  for (const key of keysToCheck) {
    if (skipKeys.includes(key)) continue;

    const value = config[key];

    if (!value || (typeof value === "string" && value.trim() === "")) {
      const readableKey = key
        .replace(/([A-Z])/g, " $1")
        .toUpperCase()
        .trim()
        .replace(/\s+/g, "_");

      errors.push(`${readableKey}`);
    }
  }

  if (errors.length > 0) {
    const errorMessage = `${providerName} Configuration Error: Missing or empty required fields: ${errors.map((e) => `  - ${e}`).join("\n")} Please check your .env file and ensure all ${providerName} credentials are set. `;
    logger.error(errorMessage);
    throw new Error(`${providerName} configuration incomplete`);
  }

  logger.info(`${providerName} configuration validated successfully`);
}

// Check a single environment variable

export function checkEnv(
  envName: string,
  validator?: (value: string) => boolean,
  errorMessage?: string,
): void {
  const value = process.env[envName];

  // Check if missing
  if (!value || value.trim() === "") {
    const message = ` Environment Variable Missing: ${envName} is not set or is empty. Please add ${envName} to your .env file.`;
    logger.error(message);
    throw new Error(`Missing required environment variable: ${envName}`);
  }

  // Check validation if provided
  if (validator && !validator(value)) {
    const message = ` Environment Variable Invalid: ${envName} = "${value}"
  ${errorMessage || "Value does not meet validation requirements"} Please update ${envName} in your .env file. `;
    logger.error(message);
    throw new Error(`Invalid environment variable: ${envName}`);
  }
}

// Check multiple environment variables at once

export function checkEnvs(
  envVars: Array<{
    name: string;
    validator?: (value: string) => boolean;
    message?: string;
    optional?: boolean;
  }>,
): void {
  const errors: string[] = [];

  for (const env of envVars) {
    const value = process.env[env.name];

    // Skip if optional and not set
    if (env.optional && !value) continue;

    // Check if missing
    if (!value || value.trim() === "") {
      errors.push(`  ${env.name}${env.message ? ` - ${env.message}` : ""}`);
      continue;
    }

    // Check validation
    if (env.validator && !env.validator(value)) {
      errors.push(
        `  ⚠️  ${env.name} is invalid${env.message ? ` - ${env.message}` : ""}`,
      );
    }
  }

  if (errors.length > 0) {
    const errorMessage = ` Environment Variable Errors: ${errors.join("\n")} Please check your .env file.`;
    logger.error(errorMessage);
    throw new Error("Environment variables validation failed");
  }

  logger.info(`All environment variables validated successfully`);
}

export function validateStartupEnvironment(): void {
  logger.info("\n🔍 Validating critical environment variables...\n");

  const errors: string[] = [];

  // SERVER CONFIGURATION
  checkRequired("NODE_ENV", errors);
  checkRequired("PORT", errors, { optional: true }); // Defaults to 5000

  checkRequired("BASE_URL", errors, {
    validator: (v) => v.startsWith("http"),
    message: "must start with http:// or https://",
  });

  checkRequired("FRONTEND_URL", errors, {
    validator: (v) => v.startsWith("http"),
    message: "must start with http:// or https://",
  });

  // DATABASE (CRITICAL)

  checkRequired("MONGODB_URI", errors, {
    validator: (v) => v.includes("mongodb"),
    message: "must be a valid MongoDB connection string (currently empty!)",
  });

  // Redis - optional, but validate if present
  checkRequired("REDIS_URL", errors, { optional: true });

  // AUTHENTICATION (CRITICAL)

  checkRequired("JWT_SECRET", errors, {
    validator: (v) => v.length >= 32,
    message: "must be at least 32 characters for security (currently empty!)",
  });

  checkRequired("JWT_REFRESH_SECRET", errors, {
    validator: (v) => v.length >= 32,
    message: "must be at least 32 characters for security",
  });

  // PAYMENT PROVIDERS (CRITICAL - Money Movement & Reconciliation)

  logger.info("  Checking SafeHaven configuration...");
  checkRequired("SAFEHAVEN_BASE_URL", errors, {
    validator: (v) => v.startsWith("http"),
    message: "must be a valid URL",
  });
  checkRequired("SAFEHAVEN_CLIENT_ID", errors);
  checkRequired("SAFEHAVEN_CLIENT_ASSERTION", errors, {
    message: "required for OAuth authentication",
  });
  checkRequired("SAFEHAVEN_SWEEP_ACCOUNT", errors, {
    message: "CRITICAL - required for withdrawals and reconciliation",
  });

  logger.info("  Checking Monnify configuration...");
  checkRequired("MONNIFY_BASE_URL", errors, {
    validator: (v) => v.startsWith("http"),
    message:
      "must be a valid URL (currently empty! Should be https://api.monnify.com)",
  });
  checkRequired("MONNIFY_API_KEY", errors);
  checkRequired("MONNIFY_SECRET_KEY", errors);
  checkRequired("MONNIFY_CONTRACT_CODE", errors);
  checkRequired("MONNIFY_WALLET_ACCOUNT_NUMBER", errors, {
    message: "CRITICAL - required for withdrawals and reconciliation",
  });

  logger.info("  Checking Flutterwave configuration...");
  checkRequired("FLUTTERWAVE_BASE_URL", errors, {
    validator: (v) => v.startsWith("http"),
    message: "must be a valid URL",
  });
  checkRequired("FLUTTERWAVE_SECRET_KEY", errors);
  checkRequired("FLUTTERWAVE_PUBLIC_KEY", errors);
  checkRequired("FLUTTERWAVE_ENCRYPTION_KEY", errors);

  // EMAIL (CRITICAL - For OTP, notifications, etc.)

  logger.info("  Checking Email configuration...");

  // You have Gmail configured, so check those
  checkRequired("EMAIL_USER", errors, {
    validator: (v) => v.includes("@"),
    message: "must be a valid email address",
  });
  checkRequired("EMAIL_PASSWORD", errors, {
    message: "Gmail app password required",
  });
  checkRequired("EMAIL_FROM", errors, {
    validator: (v) => v.includes("@"),
    message: "must be a valid email address",
  });

  // SMS (CRITICAL - For OTP)

  logger.info("  Checking SMS configuration (Termii)...");
  checkRequired("TERMII_API_KEY", errors);
  checkRequired("TERMII_SENDER_ID", errors);

  // IMAGEKIT (If using for file uploads)

  // Uncomment if ImageKit is critical for your app
  checkRequired("IMAGEKIT_PUBLIC_KEY", errors);
  checkRequired("IMAGEKIT_PRIVATE_KEY", errors);
  checkRequired("IMAGEKIT_URL_ENDPOINT", errors);

  // ADMIN ACCOUNT (CRITICAL - For initial setup)

  checkRequired("SUPER_ADMIN_EMAIL", errors, {
    validator: (v) => v.includes("@"),
    message: "must be a valid email address",
  });
  checkRequired("SUPER_ADMIN_PASSWORD", errors, {
    validator: (v) => v.length >= 8,
    message: "must be at least 8 characters",
  });
  checkRequired("SUPER_ADMIN_FIRST_NAME", errors);
  checkRequired("SUPER_ADMIN_LAST_NAME", errors);

  // OPTIONAL BUT RECOMMENDED

  // Firebase (for push notifications)
  checkRequired("FIREBASE_PROJECT_ID", errors, { optional: true });

  // Google OAuth (for social login)
  checkRequired("GOOGLE_OAUTH_CLIENT_ID", errors, { optional: true });

  // REPORT RESULTS

  if (errors.length > 0) {
    logger.error("\n CRITICAL ENVIRONMENT VARIABLES MISSING OR INVALID:\n");
    errors.forEach((error) => logger.error(`  ${error}`));
    logger.error(
      "\n💡 Please fix these in your .env file before starting the server.",
    );
    logger.error("📄 Check env-file-analysis.txt for detailed fixes.\n");
    throw new Error(
      "Critical environment variables missing - cannot start server",
    );
  }

  logger.info("All critical environment variables validated successfully!\n");
}

function checkRequired(
  envName: string,
  errors: string[],
  options?: {
    optional?: boolean;
    validator?: (value: string) => boolean;
    message?: string;
  },
): void {
  const value = process.env[envName];

  if (options?.optional && !value) {
    return;
  }

  if (!value || value.trim() === "") {
    const errorMsg = options?.message
      ? ` ${envName} - ${options.message}`
      : ` ${envName} is missing`;
    errors.push(errorMsg);
    return;
  }

  // Validate if validator provided
  if (options?.validator && !options.validator(value)) {
    const errorMsg = options?.message
      ? `⚠️  ${envName} is invalid - ${options.message}`
      : `⚠️  ${envName} has invalid format`;
    errors.push(errorMsg);
  }
}

export function checkServiceConfig(
  serviceName: string,
  requiredEnvVars: string[],
): void {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    if (!value || value.trim() === "") {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    const errorMessage = `
 ${serviceName} Service Configuration Error:
Missing required environment variables:
${missing.map((e) => `  - ${e}`).join("\n")}

Please configure ${serviceName} in your .env file to use this service.
`;
    logger.error(errorMessage);
    throw new Error(`${serviceName} service not configured`);
  }

  logger.info(`${serviceName} configuration validated`);
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function generateUniqueSlug(
  Model: mongoose.Model<any>,
  source: string,
  excludeId?: string,
): Promise<string> {
  const baseSlug = slugify(source);
  let candidate = baseSlug;
  let counter = 1;

  while (
    await Model.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  return candidate;
}

const PROVIDER_ALIASES: Record<string, string> = {
  savehaven: "saveHaven",
  safehaven: "saveHaven",
  "nigeria-smm": "nigeriasmm",
  nigeria_smm: "nigeriasmm",
  theowlet: "owlet",
  "the-owlet": "owlet",
  "smm-follows": "smmfollows",
  smm_follows: "smmfollows",
  "smm-reseller-panel": "smmresellerpanel",
  smm_reseller_panel: "smmresellerpanel",
  smmreseller: "smmresellerpanel",
};

export const normalizeProviderName = (provider?: string): string | undefined => {
  if (!provider) return provider;
  const key = provider.toLowerCase();
  return PROVIDER_ALIASES[key] || provider;
};


const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  saveHaven: "safeHaven",
  nigeriasmm: "Nigeria SMM",
  owlet: "The Owlet",
  smmfollows: "SMMFollows",
  smmresellerpanel: "SMM Reseller Panel",
};

export const toDisplayProviderName = (provider?: string): string | undefined => {
  if (!provider) return provider;
  return PROVIDER_DISPLAY_NAMES[provider] || provider;
};

export const buildExplorerUrl = (
  baseUrl: string | undefined | null,
  txHash: string | undefined | null,
): string | undefined => {
  if (!baseUrl || !txHash) return undefined;
  const trimmedBase = baseUrl.trim();
  if (!trimmedBase) return undefined;
  const separator = trimmedBase.endsWith("/") ? "" : "/";
  return `${trimmedBase}${separator}${txHash}`;
};
