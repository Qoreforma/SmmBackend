import { Router } from "express";
import { NumberRentalController } from "@/controllers/client/NumberRentalController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import { rentNumberSchema } from "@/validations/client/numberRentalValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const numberRentalController = new NumberRentalController();

// Get available countries catalog (100+ countries supported via 5SIM)
router.get("/countries", authenticate, numberRentalController.getCountries);

// Get available services for a country (e.g. WA, TG, FB, etc.)
router.get("/services", authenticate, numberRentalController.getServices);

// Rent a virtual phone number
router.post(
  "/rent",
  authenticate,
  validateRequest(rentNumberSchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.NUMBER_RENTAL),
  walletLock,
  detectChannel,
  numberRentalController.rentNumber,
);

// Check / Poll OTP status for a rented number
router.get("/otp/:reference", authenticate, numberRentalController.checkOtp);

// Cancel a pending rental — triggers an immediate wallet refund and releases number
router.delete("/cancel/:reference", authenticate, numberRentalController.cancelRental);

// Ban / report an already-registered or burned number — triggers refund
router.post("/ban/:reference", authenticate, numberRentalController.banRental);

export default router;
