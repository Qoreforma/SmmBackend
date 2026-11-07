import { Router } from "express";

// Auth & Profile
import authRoutes from "./auth";
import profileRoutes from "./profile";
import biometricsV2Routes from "./biometricsV2";

// Wallet & Transactions
import walletRoutes from "./wallet";
import transactionRoutes from "./transactions";

// SMM & Owlet Services
import smmRoutes from "./smm";
import gameTopupRoutes from "./gameTopup";
import proxyRoutes from "./proxy";
import numberRentalRoutes from "./numberRental";
import emailOtpRoutes from "./emailOtp";

// Banking
import bankAccountRoutes from "./bankaccounts";
import depositRoutes from "./deposit";

// System & Support
import notificationRoutes from "./notifications";
import referralRoutes from "./referral";
import referenceRoutes from "./reference";
import faqRoutes from "./faqs";


// Webhooks
import webhookRoutes from "./webhooks";

import mediaRoutes from "./media";
import telegramRoutes from "./telegram";
import rewardsRoutes from "./rewards";

const router = Router();

//  AUTHENTICATED ROUTES

// Auth & Profile
router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/biometrics/v2", biometricsV2Routes);

// Wallet & Transactions
router.use("/wallet", walletRoutes);
router.use("/transactions", transactionRoutes);

// SMM & Owlet Services
router.use("/smm", smmRoutes);
router.use("/game-topup", gameTopupRoutes);
router.use("/proxies", proxyRoutes);
router.use("/number-rental", numberRentalRoutes);
router.use("/email-otp", emailOtpRoutes);

// Banking
router.use("/bank-accounts", bankAccountRoutes);
router.use("/deposits", depositRoutes);

// System & Support
router.use("/notifications", notificationRoutes);
router.use("/referrals", referralRoutes);
router.use("/reference", referenceRoutes);
router.use("/faqs", faqRoutes);

// Webhooks
router.use("/webhooks", webhookRoutes);

// Telegram Bot & Mini-App
router.use("/telegram", telegramRoutes);

// Daily Streak Rewards
router.use("/rewards", rewardsRoutes);

// MEDIA
router.use("/media", mediaRoutes);

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "client-api",
  });
});

export default router;
