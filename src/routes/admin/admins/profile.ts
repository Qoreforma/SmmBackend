import { ProfileController } from "@/controllers/admin/ProfileController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { validateRequest } from "@/middlewares/shared/validation";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import {
  updateAdminProfileSchema,
  toggle2FASchema,
} from "@/validations/admin/accountValidation";
import { changePasswordSchema } from "@/validations/admin/authValidation";
import { Router } from "express";

const router = Router();
const profileController = new ProfileController();

router.use(adminAuth);

router.patch(
  "/change-password",
  validateRequest(changePasswordSchema),
  (req, res, next) =>
    profileController.changePassword(
      req as AuthenticatedAdminRequest,
      res,
      next
    )
);

router.patch("/", validateRequest(updateAdminProfileSchema), (req, res, next) =>
  profileController.updateProfile(req as AuthenticatedAdminRequest, res, next)
);

router.patch("/toggle-2fa", validateRequest(toggle2FASchema), (req, res) =>
  profileController.toggle2FA(req as AuthenticatedAdminRequest, res)
);

router.get("/", (req, res, next) =>
  profileController.getProfile(req as AuthenticatedAdminRequest, res, next)
);

export default router;
