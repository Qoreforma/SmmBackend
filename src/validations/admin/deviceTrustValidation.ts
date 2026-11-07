import Joi from "joi";
import ipaddr from "ipaddr.js";

// Custom Joi validator for CIDR
const cidrValidator = (value: string, helpers: Joi.CustomHelpers) => {
  try {
    ipaddr.parseCIDR(value);
    return value;
  } catch (err) {
    return helpers.message({ custom: "Invalid CIDR notation (e.g. 192.168.1.1/32)" });
  }
};

export const approveRequestSchema = Joi.object({
  action: Joi.string().valid("approve", "deny").required(),
  // For denial, optionally block the IP globally
  blockIpGlobally: Joi.boolean().default(false),
  reason: Joi.string().max(255).optional(),
});

export const addBlocklistSchema = Joi.object({
  cidr: Joi.string().custom(cidrValidator).required(),
  reason: Joi.string().max(255).optional(),
});

export const removeBlocklistSchema = Joi.object({
  cidr: Joi.string().required(), // exact match string
});

export const getPendingRequestsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});
