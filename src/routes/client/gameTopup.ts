import { Router } from "express";
import { GameTopupController } from "@/controllers/client/GameTopupController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import { orderGameTopupSchema } from "@/validations/client/gameTopupValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const gameTopupController = new GameTopupController();

// Get games
router.get("/games", authenticate, gameTopupController.getGames);

// Get packages for a game
router.get("/packages/:serviceCode", authenticate, gameTopupController.getPackages);

// Place a game top-up order
router.post(
  "/order",
  authenticate,
  validateRequest(orderGameTopupSchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.GAME_TOPUP),
  walletLock,
  detectChannel,
  gameTopupController.orderTopup,
);

export default router;
