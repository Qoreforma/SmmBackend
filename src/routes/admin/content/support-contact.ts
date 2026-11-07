import logger from "@/logger";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { validateRequest } from "@/middlewares/shared/validation";
import { Contact } from "@/models/system/Contact";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

import { HTTP_STATUS } from "@/utils/constants";
import {
  generateWhatsAppLink,
  sendErrorResponse,
  sendSuccessResponse,
} from "@/utils/helpers";
import { Router } from "express";
import Joi from "joi";

const router = Router();

router.use(adminAuth);

// Validation schema for contact form
const contactValidationSchema = Joi.object({
  phoneNumber: Joi.string()
    .required()
    .label("Phone number")
    .max(13)
    .custom((value, helpers) => {
      const digits = value.replace(/\D/g, "");

      // Transform based on format
      let normalized;
      if (digits.startsWith("0") && digits.length === 11) {
        normalized = "234" + digits.slice(1);
      } else if (digits.startsWith("234") && digits.length === 13) {
        normalized = digits;
      } else if (digits.length === 10) {
        normalized = "234" + digits;
      } else {
        return helpers.error("any.invalid");
      }

      return normalized;
    })
    .messages({
      "any.invalid": "Phone number must be a valid Nigerian number",
      "string.max": "Phone number must not exceed {#limit} characters",
      "string.empty": "Phone number is required",
      "any.required": "Phone number is required",
    }),

  whatsappNumber: Joi.string()
    .required()
    .label("Whatsapp number")
    .max(13)
    .custom((value, helpers) => {
      const digits = value.replace(/\D/g, "");

      // Transform based on format
      let normalized;
      if (digits.startsWith("0") && digits.length === 11) {
        normalized = "+234" + digits.slice(1);
      } else if (digits.startsWith("234") && digits.length === 13) {
        normalized = "+" + digits;
      } else if (digits.length === 10) {
        normalized = "+234" + digits;
      } else {
        return helpers.error("any.invalid");
      }

      return normalized;
    })
    .messages({
      "any.invalid": "WhatsApp number must be a valid Nigerian number",
      "string.max": "WhatsApp number must not exceed {#limit} characters",
      "string.empty": "WhatsApp number is required",
      "any.required": "WhatsApp number is required",
    }),

  emailAddress: Joi.string().email().required().messages({
    "string.email": "Email address must be a valid email",
    "string.empty": "Email address is required",
  }),
  instagramLink: Joi.string().allow(null, "").optional(),
  linkedinLink: Joi.string().allow(null, "").optional(),
  tiktokLink: Joi.string().allow(null, "").optional(),
  facebookLink: Joi.string().allow(null, "").optional(),
  twitterLink: Joi.string().allow(null, "").optional(),
});

const formatToLocal = (num: string) => {
  if (!num) return num;
  const digits = num.replace(/\D/g, "");

  if (digits.startsWith("234") && digits.length === 13) {
    return "0" + digits.slice(3);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return digits;
  }
  return num;
};

router.put(
  "/",
  validateRequest(contactValidationSchema),
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.UPDATE_CONTACT_SUPPORT),
  async (req: AuthenticatedAdminRequest, res) => {
    try {
      const whatsappLink = generateWhatsAppLink(req.body.whatsappNumber);

      const result = await Contact.findOneAndUpdate(
        {},
        {
          phoneNumber: req.body.phoneNumber,
          whatsappNumber: req.body.whatsappNumber,
          whatsappLink, 
          emailAddress: req.body.emailAddress,
          instagramLink: req.body.instagramLink,
          linkedinLink: req.body.linkedinLink,
          tiktokLink: req.body.tiktokLink,
          facebookLink: req.body.facebookLink,
          twitterLink: req.body.twitterLink,
        },
        { upsert: true, new: true },
      );

      const formattedContact = {
        ...result.toObject(),
        phoneNumber: formatToLocal(result.phoneNumber.toString()),
        whatsappNumber: formatToLocal(result.whatsappNumber),
      };

      sendSuccessResponse(
        res,
        formattedContact,
        "Contact information updated successfully",
      );
    } catch (error: any) {
      sendErrorResponse(
        res,
        "Error updating contact information",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
      logger.error("Error updating contact information", {
        error: error.message,
        adminId: req.admin?.id,
        adminEmail: req.admin?.email,
      });
    }
  },
);

router.get("/", async (req: AuthenticatedAdminRequest, res) => {
  try {
    const result = await Contact.findOne({});

    if (!result) {
      sendErrorResponse(
        res,
        "Kindly create contact information first",
        HTTP_STATUS.NOT_FOUND,
      );
      return;
    }

    const formattedContact = {
      ...result.toObject(),
      phoneNumber: formatToLocal(result.phoneNumber.toString()),
      whatsappNumber: formatToLocal(result.whatsappNumber),
      whatsappLink: result.whatsappLink, 
    };

    sendSuccessResponse(
      res,
      formattedContact,
      "Contact information retrieved successfully",
    );
  } catch (error: any) {
    sendErrorResponse(
      res,
      "Error retrieving contact information",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
    logger.error("Error retrieving contact information", {
      error: error.message,
      adminId: req.admin?.id,
      adminEmail: req.admin?.email,
    });
  }
});

export default router;