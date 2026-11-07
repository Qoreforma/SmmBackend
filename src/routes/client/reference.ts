import { Router } from "express";
import { ReferenceDataController } from "@/controllers/client/ReferenceDataController";
import { ReferenceDataService } from "@/services/client/ReferenceDataService";
import ServiceContainer from "@/services/client/container";

import { authenticate } from "@/middlewares/client/auth";

const router = Router();

const referenceDataService = ServiceContainer.getReferenceDataService();

const referenceDataController = new ReferenceDataController(
  referenceDataService
);

// Countries
router.get("/countries", referenceDataController.getAllCountries);
router.get("/countries/search", referenceDataController.searchCountries);
router.get("/countries/:id", referenceDataController.getCountryById);

// States
router.get("/states/:countryId", referenceDataController.getStatesByCountry);
router.get("/states/:id", referenceDataController.getStateById);

// Cities
router.get("/cities/:stateId", referenceDataController.getCitiesByState);
router.get("/cities/:id", referenceDataController.getCityById);

// Providers
router.get("/providers", referenceDataController.getProviders);
router.get("/providers/:id", referenceDataController.getProviderById);

// Services
router.get("/services", referenceDataController.getServices);
router.get("/services/:id", referenceDataController.getServiceById);

// Products
router.get("/products", referenceDataController.getProducts);
router.get("/products/search", referenceDataController.searchProducts);
router.get("/products/:id", referenceDataController.getProductById);

// Banks
router.get("/banks", referenceDataController.getBanks);

// Banners
router.get("/banners", referenceDataController.getBanners);

// admin settings
router.get("/system-bank", referenceDataController.getSystemBankAccounts);
router.get("/service-charge", referenceDataController.getServiceCharge);
router.get("/service-types", referenceDataController.getServiceTypesCode);
router.get("/service-types-status", referenceDataController.getServiceTypes);

// router.get("/wallet-types-status", referenceDataController.getWalletTypes);
router.get("/support", referenceDataController.getSupportContact);
router.get("/app-version", referenceDataController.getAppVersion);

//Discounts
router.get("/cashback-rules", referenceDataController.getCashbackRules);
router.get("/discounts", referenceDataController.getDiscounts);

router.post("/contact-form", referenceDataController.contactForm);

export default router;
