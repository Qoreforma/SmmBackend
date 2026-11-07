import { Router } from "express";
import { ProfileController } from "@/controllers/client/ProfileController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  updateProfileSchema,
  toogleBiometricSchema,
  updateAvatarSchema,
} from "@/validations/client/profileValidation";

const router = Router();

// Initialize dependencies
const profileController = new ProfileController();

// Routes (all protected)
router.use(authenticate);
router.get("/", profileController.getProfile);
router.get("/tier", profileController.getUserTier);
router.put(
  "/",
  validateRequest(updateProfileSchema),
  profileController.updateProfile
);
router.put(
  "/biometric",
  validateRequest(toogleBiometricSchema),
  profileController.toogleBiometric
);
router.post("/deactivate", profileController.deactivateAccount);

router.put(
  "/avatar",
  validateRequest(updateAvatarSchema),
  authenticate,
  profileController.updateAvatar
);

export default router;
