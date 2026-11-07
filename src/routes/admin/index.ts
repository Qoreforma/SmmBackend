import { Router } from "express";
import authRoutes from "./auth/auth";
import deviceTrustRoutes from "./auth/device-trust";
import emailBannerRoutes from "./content/emailBanners";
import discountRoutes from "./finances/discounts";
import userRoutes from "./users/users";
import adminManageent from "./admins/admin-management";
import transactionRoutes from "./transactions/transactions";
import withdrawalRoutes from "./transactions/withdrawals";
import dashboardRoutes from "./system/dashboard";
import alertRoutes from "./content/alerts";
import profileRoutes from "./admins/profile";
import bannerRoutes from "./content/banners";
import providerRoutes from "./products/providers";
import productRoutes from "./products/products";
import roleRoutes from "./admins/roles";
import faqRoutes from "./content/faqs";
import auditLogRoutes from "./system/auditlogs";
import systemBankAccountRoutes from "./finances/system-bank-accounts";
import appVersionRoutes from "./system/app-versions";
import serviceChargeRoutes from "./finances/service-charges";
import cashbackRoutes from "./finances/cashbacks";
import serviceTypeRoutes from "./products/service-types";
import serviceRoutes from "./products/service";
import mediaRoutes from "./media";
import referralBonusRoutes from "./finances/referral-bonus";
import referralTermsRoutes from "./content/referral-terms";
import supportContactRoutes from "./content/support-contact";
import providerRateConfigRoute from "./configs/providerRateConfigRoute";
import phonePrefixConfigRoute from "./configs/phonePrefixConfigRoutes";
import manualWithdrawal from "./finances/manual-withdrawal";
import manualDeposits from "./finances/manual-deposits";
import pricingRuleRoutes from "./finances/pricing-rules";
import cacheRoutes from "./system/cache";
import analyticsRoutes from "./system/analytics";
import treasuryRoutes from "./system/treasury";
import telegramSettingsRoutes from "./system/telegram-settings";
import userTierRoutes from "./finances/user-tiers";
import dailyStreakSettingsRoutes from "./system/daily-streak-settings";

const router = Router();

// Admin routes
router.use("/auth/device-trust", deviceTrustRoutes);
router.use("/auth", authRoutes);
router.use("/admins", adminManageent);
router.use("/profile", profileRoutes);
router.use("/users", userRoutes);
router.use("/transactions", transactionRoutes);
router.use("/withdrawals", withdrawalRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/alerts", alertRoutes);
router.use("/banners", bannerRoutes);
router.use("/email-banners", emailBannerRoutes);
router.use("/providers", providerRoutes);
router.use("/products", productRoutes);
router.use("/roles", roleRoutes);
router.use("/faqs", faqRoutes);
router.use("/auditlogs", auditLogRoutes);
router.use("/bank-accounts", systemBankAccountRoutes);
router.use("/app-versions", appVersionRoutes);
router.use("/service-charges", serviceChargeRoutes);
router.use("/cashbacks", cashbackRoutes);
router.use("/discounts", discountRoutes);
router.use("/service-types", serviceTypeRoutes);
router.use("/services", serviceRoutes);
router.use("/media", mediaRoutes);
router.use("/referral-bonuses", referralBonusRoutes);
router.use("/referral-terms", referralTermsRoutes);
router.use("/support-contact", supportContactRoutes);
router.use("/configs/phone-prefix", phonePrefixConfigRoute);
router.use("/configs/provider-rate", providerRateConfigRoute);
router.use("/manual-withdrawals", manualWithdrawal);
router.use("/manual-deposits", manualDeposits);
router.use("/pricing-rules", pricingRuleRoutes);
router.use("/cache", cacheRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/treasury", treasuryRoutes);
router.use("/telegram-settings", telegramSettingsRoutes);
router.use("/user-tiers", userTierRoutes);
router.use("/streak-settings", dailyStreakSettingsRoutes);

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "admin-api",
  });
});

export default router;