import Joi from "joi";
import { TRANSACTION_TYPES } from "@/utils/constants";

export const createAlertValidation = Joi.object({
  title: Joi.string().required().max(200).trim(),
  body: Joi.string().required().max(50000).trim(),
  target: Joi.string()
    .valid(
      "all",
      "specific",
      "verified",
      "phone-verified",
      "email-verified",
      "profile-completed",
    )
    .required(),
  users: Joi.when("target", {
    is: "specific",
    then: Joi.array()
      .items(Joi.string().regex(/^[0-9a-fA-F]{24}$/))
      .required(),
    otherwise: Joi.array()
      .items(Joi.string().regex(/^[0-9a-fA-F]{24}$/))
      .optional(),
  }),
  channels: Joi.array()
    .items(Joi.string().valid("email", "sms", "push", "in_app"))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TRANSACTION_TYPES), "general", "alert", "announcement")
    .optional()
    .allow(null, ""),
  dispatchTime: Joi.date().optional().allow(null),
  isImmediate: Joi.boolean().default(false),
  isPersonalised: Joi.boolean().default(false),
  status: Joi.string()
    .valid("pending", "dispatching", "sent", "failed")
    .default("pending"),
}).custom((value) => {
  if (
    value.target === "specific" &&
    (!value.users || value.users.length === 0)
  ) {
    throw new Error('Users array is required when target is "specific"');
  }
  if (!value.channels || value.channels.length === 0) {
    throw new Error("At least one channel is required");
  }
  if (value.channels.includes("email") && value.channels.length > 1) {
    throw new Error(
      "Email cannot be combined with other channels — select email alone, or choose other channels without email",
    );
  }
  if (value.channels.includes("sms") && value.body && value.body.length > 160) {
    throw new Error(
      "Message body must be 160 characters or fewer when SMS is included in channels",
    );
  }
  return value;
});

export const updateAlertValidation = Joi.object({
  title: Joi.string().max(200).trim(),
  body: Joi.string().max(50000).trim(),
  target: Joi.string().valid(
    "all",
    "specific",
    "verified",
    "phone-verified",
    "email-verified",
    "profile-completed",
  ),
  users: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)),
  channels: Joi.array().items(
    Joi.string().valid("email", "sms", "push", "in_app"),
  ),
  type: Joi.string()
    .valid(...Object.values(TRANSACTION_TYPES), "general", "alert", "announcement")
    .optional()
    .allow(null, ""),
  isImmediate: Joi.boolean().default(false),
  isPersonalised: Joi.boolean().default(false),
  dispatchTime: Joi.date().optional().allow(null),
  status: Joi.string().valid("pending", "dispatching", "sent", "failed"),
})
  .min(1)
  .custom((value) => {
    if (value.channels?.includes("email") && value.channels.length > 1) {
      throw new Error(
        "Email cannot be combined with other channels — select email alone, or choose other channels without email",
      );
    }
    if (
      value.channels?.includes("sms") &&
      value.body &&
      value.body.length > 160
    ) {
      throw new Error(
        "Message body must be 160 characters or fewer when SMS is included in channels",
      );
    }
    return value;
  });
