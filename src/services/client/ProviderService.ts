import { Product } from "@/models/reference/Product";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import { Provider } from "@/models/reference/Provider";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_TTL,
  CACHE_KEYS,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import logger from "@/logger";
import { CacheService } from "../core/CacheService";
import { SaveHavenService } from "./providers/payments/SaveHavenService";
import { NigeriaSmmService } from "./providers/smm/NigeriaSmmService";
import { SmmFollowsService } from "./providers/smm/SmmFollowsService";
import { SmmResellerPanelService } from "./providers/smm/SmmResellerPanelService";
import {
  OwletService,
  OwletGameProduct,
  OwletGamePackage,
  OwletGameTopupResult,
  OwletProxyProduct,
  OwletBuyProxyResult,
  OwletNumberService,
  OwletRentNumberResult,
  OwletOtpResult,
} from "./providers/owlet/OwletService";
import { FiveSimService } from "./providers/fivesim/FiveSimService";
import { FleexaService } from "./providers/fleexa/FleexaService";
import { TextverifiedService } from "./providers/textverified/TextverifiedService";
import {
  FiveSimProfileResponse,
  FiveSimCountriesResponse,
  FiveSimProductsResponse,
  FiveSimOrderResponse,
} from "@/types/fivesim";
import {
  FleexaSms4Country,
  FleexaSms4App,
  FleexaSms4PriceData,
  FleexaSms4BuyData,
  FleexaSms4CheckData,
  FleexaEmailProduct,
  FleexaEmailDomain,
  FleexaEmailBuyData,
  FleexaEmailCheckData,
} from "@/types/fleexa";
import {
  TextverifiedServiceItem,
  TextverifiedVerificationResponse,
  TextverifiedSmsItem,
} from "@/types/textverified";
import {
  NigeriaSmmOrderStatus,
  NigeriaSmmMultiOrderStatus,
  NigeriaSmmBalance,
  NigeriaSmmRefillResponse,
  NigeriaSmmCancelResponse,
  NigeriaSmmServiceItemNormalised,
  OwletSmmRefillStatusResponse,
  OwletSmmProofsResponse,
  SmmSabiOrderFields,
} from "@/types/smm";
import { getEnviroment } from "@/utils/helpers";

export class ProviderService {
  constructor(
    private nigeriaSmmService: NigeriaSmmService,
    private cacheService: CacheService,
    private saveHavenService?: SaveHavenService,
    private owletService?: OwletService,
    private smmFollowsService?: SmmFollowsService,
    private smmResellerPanelService?: SmmResellerPanelService,
    private fiveSimService?: FiveSimService,
    private fleexaService?: FleexaService,
    private textverifiedService?: TextverifiedService,
  ) {}

  private handleProviderDispatchError(error: any, context: string): never {
    logger.error(`ProviderService Error in ${context}:`, error);
    if (error instanceof AppError) throw error;
    throw new AppError(
      error?.message || `Operation failed during ${context}`,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  // Get active API provider for service type code
  public async getActiveApiProvider(serviceTypeCode: string): Promise<any> {
    try {
      const environment = getEnviroment();
      const cacheKey = `provider:active:${serviceTypeCode}`;
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached provider for ${serviceTypeCode}`);
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
      });

      if (!serviceType) {
        throw new AppError(
          `Service type '${serviceTypeCode}' not found or inactive`,
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const providerMapping = await ServiceTypeProvider.findOne({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      })
        .sort({ priority: 1 })
        .populate({
          path: "providerId",
          match: { isActive: true, deletedAt: null },
        });

      if (!providerMapping || !providerMapping.providerId) {
        throw new AppError(
          environment === "production"
            ? "Service is currently unavailable"
            : `No active provider configured for '${serviceTypeCode}'`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      this.cacheService
        .set(cacheKey, providerMapping.providerId, CACHE_TTL.ONE_HOUR)
        .catch((err) => {
          logger.error("Failed to cache provider:", err);
        });

      return providerMapping.providerId;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error(`Error getting active provider for ${serviceTypeCode}`, error);
      throw new AppError(
        `Failed to get provider for ${serviceTypeCode}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getServicesByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const cacheKey = `services:type:${serviceTypeCode}`;
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: null,
      });
      if (!serviceType) return [];

      const services = await Service.find({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      })
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      const result = services.map((service) => ({
        id: service._id,
        name: service.name,
        code: service.code,
        logo: service.logo,
        serviceTypeCode: serviceTypeCode,
      }));

      this.cacheService
        .set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES)
        .catch((err) => {
          logger.error("Failed to cache services:", err);
        });

      return result;
    } catch (error: any) {
      logger.error(`Error fetching services for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch services",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getProvidersByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const cacheKey = CACHE_KEYS.PROVIDERS_BY_TYPE(serviceTypeCode);
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: { $in: [null] },
      });
      if (!serviceType) return [];

      const providers = await Provider.find({
        serviceType: serviceType._id,
        isActive: true,
        deletedAt: { $in: [null] },
      }).lean();

      const result = providers.map((provider) => ({
        id: provider._id,
        name: provider.name,
        code: provider.code,
        logo: provider.logo,
        serviceTypeCode: serviceTypeCode,
      }));

      this.cacheService
        .set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES)
        .catch((err) => {
          logger.error("Failed to cache providers:", err);
        });

      return result;
    } catch (error: any) {
      logger.error(`Error fetching providers for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch providers",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SMM ROUTING (NigeriaSMM & Owlet)
  // ---------------------------------------------------------------------------

  async orderSmm(params: {
    providerCode: string;
    service: number;
    link: string;
    quantity: number;
    comments?: string;
    runs?: number;
    interval?: number;
    answer_number?: string | number;
    usernames?: string;
    sabiFields?: SmmSabiOrderFields;
  }): Promise<{ success: true; orderId: number } | { success: false; ambiguous: true; message: string }> {
    try {
      const code = params.providerCode?.toLowerCase();
      const comments = params.comments || params.sabiFields?.comments;
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.addOrder({
            service: params.service,
            link: params.link,
            quantity: params.quantity,
            comments,
            runs: params.runs,
            interval: params.interval,
            answer_number: params.answer_number,
            usernames: params.usernames,
          });
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.addOrder({
            service: params.service,
            link: params.link,
            quantity: params.quantity,
            sabiFields: params.sabiFields,
          });
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.addOrder({
            service: params.service,
            link: params.link,
            quantity: params.quantity,
            comments,
            runs: params.runs,
            interval: params.interval,
            answer_number: params.answer_number,
            usernames: params.usernames,
          });
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.addOrder({
            service: params.service,
            link: params.link,
            quantity: params.quantity,
            comments,
            runs: params.runs,
            interval: params.interval,
            answer_number: params.answer_number,
            usernames: params.usernames,
          });
        default:
          throw new AppError(
            `Unsupported SMM provider: ${params.providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "SMM order placement");
    }
  }

  async getSmmOrderStatus(
    providerCode: string,
    orderId: number | string,
  ): Promise<NigeriaSmmOrderStatus> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.getOrderStatus(Number(orderId));
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.getOrderStatus(orderId);
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.getOrderStatus(orderId);
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.getOrderStatus(orderId);
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SMM order status");
    }
  }

  async getSmmMultiOrderStatus(
    providerCode: string,
    orderIds: (number | string)[],
  ): Promise<NigeriaSmmMultiOrderStatus> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.getMultiOrderStatus(orderIds);
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.getMultiOrderStatus(orderIds);
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.getMultiOrderStatus(orderIds);
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.getMultiOrderStatus(orderIds);
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SMM multi-order status");
    }
  }

  async getSmmBalance(providerCode: string): Promise<NigeriaSmmBalance> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.getBalance();
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.getBalance();
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.getBalance();
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.getBalance();
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SMM balance");
    }
  }

  async refillSmmOrder(
    providerCode: string,
    orderId: number | string,
  ): Promise<NigeriaSmmRefillResponse> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.refill(Number(orderId));
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.refill(orderId);
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.refill(orderId);
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.refill(orderId);
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Refill SMM order");
    }
  }

  async cancelSmmOrder(
    providerCode: string,
    orderId: number | string,
  ): Promise<NigeriaSmmCancelResponse> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.cancel(Number(orderId));
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.cancel(orderId);
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.cancel(orderId);
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.cancel(orderId);
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Cancel SMM order");
    }
  }

  async getSmmRefillStatus(
    providerCode: string,
    refillId: number | string,
  ): Promise<OwletSmmRefillStatusResponse> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.getRefillStatus(refillId);
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.getRefillStatus(refillId);
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.getRefillStatus(refillId);
        case "nigeriasmm":
          throw new AppError(
            "Refill status is not supported by Nigeria SMM",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SMM refill status");
    }
  }

  async getSabiProofs(orderId: number | string): Promise<OwletSmmProofsResponse> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getSabiProofs(orderId);
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SABI proofs");
    }
  }

  async getSmmServices(
    providerCode: string,
  ): Promise<NigeriaSmmServiceItemNormalised[]> {
    try {
      const code = providerCode?.toLowerCase();
      switch (code) {
        case "nigeriasmm":
          return await this.nigeriaSmmService.getServices();
        case "owlet":
          if (!this.owletService) {
            throw new AppError("Owlet service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.owletService.getServices();
        case "smmfollows":
          if (!this.smmFollowsService) {
            throw new AppError("SmmFollows service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmFollowsService.getServices();
        case "smmresellerpanel":
          if (!this.smmResellerPanelService) {
            throw new AppError("SmmResellerPanel service not configured", HTTP_STATUS.INTERNAL_SERVER_ERROR);
          }
          return await this.smmResellerPanelService.getServices();
        default:
          throw new AppError(
            `Unsupported SMM provider: ${providerCode}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleProviderDispatchError(error, "Get SMM services catalog");
    }
  }

  // ---------------------------------------------------------------------------
  // OWLET — Gamerzone (Game Top-ups)
  // ---------------------------------------------------------------------------

  async getOwletGameProducts(): Promise<OwletGameProduct[]> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getGameProducts();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Owlet game products");
    }
  }

  async getOwletGamePackages(product: string): Promise<OwletGamePackage[]> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getGamePackages(product);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Owlet game packages for ${product}`);
    }
  }

  async buyOwletGameTopup(params: {
    product: string;
    sku: string;
    fields: Record<string, string>;
    reference: string;
  }): Promise<OwletGameTopupResult> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      logger.info("ProviderService: buyOwletGameTopup", { product: params.product, sku: params.sku });
      return await this.owletService.buyGameTopup(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Owlet game top-up");
    }
  }

  // ---------------------------------------------------------------------------
  // OWLET — Talktiyu (Phone Number Rental & OTP)
  // ---------------------------------------------------------------------------

  async getOwletNumberServices(country: string): Promise<OwletNumberService[]> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getNumberServices(country);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Owlet number services for ${country}`);
    }
  }

  async rentOwletNumber(params: {
    country: string;
    service: string;
    reference: string;
  }): Promise<OwletRentNumberResult> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      logger.info("ProviderService: rentOwletNumber", { country: params.country, service: params.service });
      return await this.owletService.rentNumber(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Owlet number rental");
    }
  }

  async pollOwletOtp(owletOrder: string): Promise<OwletOtpResult> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getOtp(owletOrder);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Poll Owlet OTP for order ${owletOrder}`);
    }
  }

  // ---------------------------------------------------------------------------
  // OWLET — Rhombus (Proxies)
  // ---------------------------------------------------------------------------

  async getOwletProxyCatalog(): Promise<OwletProxyProduct[]> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.owletService.getProxyCatalog();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Owlet proxy catalog");
    }
  }

  async buyOwletProxy(params: {
    product: string;
    plan: string;
    quantity: number;
    location?: string;
    reference: string;
  }): Promise<OwletBuyProxyResult> {
    try {
      if (!this.owletService) {
        throw new AppError("Owlet service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      logger.info("ProviderService: buyOwletProxy", { product: params.product, quantity: params.quantity });
      return await this.owletService.buyProxy(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Owlet proxy purchase");
    }
  }

  // ---------------------------------------------------------------------------
  // 5SIM — Virtual Phone Numbers & SMS Verification
  // ---------------------------------------------------------------------------

  async getFiveSimProfile(): Promise<FiveSimProfileResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.getProfile();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get 5SIM profile");
    }
  }

  async getFiveSimCountries(): Promise<FiveSimCountriesResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.getCountries();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get 5SIM countries");
    }
  }

  async getFiveSimProducts(
    country: string = "any",
    operator: string = "any",
  ): Promise<FiveSimProductsResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.getProducts(country, operator);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get 5SIM products for ${country}/${operator}`);
    }
  }

  async getFiveSimPrices(country?: string, product?: string): Promise<any> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.getPrices(country, product);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get 5SIM prices");
    }
  }

  async buyFiveSimNumber(params: {
    country: string;
    operator?: string;
    product: string;
    maxPrice?: number;
    reference: string;
  }): Promise<FiveSimOrderResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      logger.info("ProviderService: buyFiveSimNumber", {
        country: params.country,
        operator: params.operator,
        product: params.product,
        reference: params.reference,
      });
      return await this.fiveSimService.buyActivationNumber({
        country: params.country,
        operator: params.operator,
        product: params.product,
        maxPrice: params.maxPrice,
      });
    } catch (error: any) {
      this.handleProviderDispatchError(error, "5SIM activation number purchase");
    }
  }

  async checkFiveSimOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.checkOrder(orderId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Check 5SIM order ${orderId}`);
    }
  }

  async finishFiveSimOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.finishOrder(orderId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Finish 5SIM order ${orderId}`);
    }
  }

  async cancelFiveSimOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.cancelOrder(orderId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Cancel 5SIM order ${orderId}`);
    }
  }

  async banFiveSimOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    try {
      if (!this.fiveSimService) {
        throw new AppError("5SIM service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fiveSimService.banOrder(orderId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Ban 5SIM order ${orderId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // FLEEXA — US SMS OTP & Disposable Email OTP
  // ---------------------------------------------------------------------------

  async getFleexaSmsCountries(): Promise<FleexaSms4Country[]> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.getSms4Countries();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Fleexa SMS countries");
    }
  }

  async getFleexaSmsApps(): Promise<FleexaSms4App[]> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.getSms4Apps();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Fleexa SMS apps");
    }
  }

  async getFleexaSmsPrice(serviceName: string, areaCode?: boolean): Promise<FleexaSms4PriceData> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.getSms4Price(serviceName, areaCode);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Fleexa SMS price for ${serviceName}`);
    }
  }

  async buyFleexaSmsNumber(params: {
    serviceName: string;
    maxPrice?: string | number;
    areaCode?: string;
  }): Promise<FleexaSms4BuyData> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.buySms4Number(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Buy Fleexa SMS number for ${params.serviceName}`);
    }
  }

  async checkFleexaSmsStatus(requestId: string | number): Promise<FleexaSms4CheckData> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.checkSms4Status(requestId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Check Fleexa SMS status for ${requestId}`);
    }
  }

  async cancelFleexaSms(requestId: string | number): Promise<any> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.cancelSms4({ requestId });
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Cancel Fleexa SMS ${requestId}`);
    }
  }

  // ---- Fleexa Email OTP ----

  async getFleexaEmailProducts(): Promise<FleexaEmailProduct[]> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.getEmailProducts();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Fleexa Email OTP products");
    }
  }

  async getFleexaEmailDomains(site: string): Promise<FleexaEmailDomain[]> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.getEmailDomains(site);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Fleexa Email domains for ${site}`);
    }
  }

  async buyFleexaEmail(params: {
    site: string;
    domain: string;
  }): Promise<FleexaEmailBuyData> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.buyEmail(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Buy Fleexa Email OTP for ${params.site}`);
    }
  }

  async checkFleexaEmailStatus(emailId: string): Promise<FleexaEmailCheckData> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.checkEmailStatus(emailId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Check Fleexa Email OTP status for ${emailId}`);
    }
  }

  async cancelFleexaEmail(emailId: string): Promise<any> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.cancelEmail(emailId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Cancel Fleexa Email OTP ${emailId}`);
    }
  }

  async searchFleexaEmailSite(q: string): Promise<any> {
    try {
      if (!this.fleexaService) {
        throw new AppError("Fleexa service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.fleexaService.searchEmailSite(q);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Search Fleexa Email site for ${q}`);
    }
  }

  // ---------------------------------------------------------------------------
  // TEXTVERIFIED — US Real Mobile Carriers & SMS Verifications
  // ---------------------------------------------------------------------------

  async getTextverifiedServices(): Promise<TextverifiedServiceItem[]> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.getServices();
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get Textverified services");
    }
  }

  async getTextverifiedPrice(
    serviceName: string,
    options?: { areaCode?: boolean; carrier?: boolean },
  ): Promise<number> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.getPrice(serviceName, options);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Textverified price for ${serviceName}`);
    }
  }

  async getTextverifiedInventory(serviceName: string): Promise<number> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.getInventory(serviceName);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Textverified inventory for ${serviceName}`);
    }
  }

  async buyTextverifiedNumber(params: {
    serviceName: string;
    areaCode?: string;
    carrier?: string;
    maxPrice?: number;
    idempotencyKey?: string;
  }): Promise<TextverifiedVerificationResponse> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.createVerification(params);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Buy Textverified number for ${params.serviceName}`);
    }
  }

  async checkTextverifiedStatus(id: string): Promise<TextverifiedVerificationResponse> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.getVerification(id);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Check Textverified status for ${id}`);
    }
  }

  async getTextverifiedSms(reservationId: string): Promise<TextverifiedSmsItem[]> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.getSms(reservationId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Get Textverified SMS for ${reservationId}`);
    }
  }

  async cancelTextverified(id: string): Promise<void> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.cancelVerification(id);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Cancel Textverified ${id}`);
    }
  }

  async reportTextverified(id: string): Promise<void> {
    try {
      if (!this.textverifiedService) {
        throw new AppError("Textverified service not available", HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      return await this.textverifiedService.reportVerification(id);
    } catch (error: any) {
      this.handleProviderDispatchError(error, `Report Textverified ${id}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Active Providers Query
  // ---------------------------------------------------------------------------

  async getActiveProvidersByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const cacheKey = CACHE_KEYS.ACTIVE_PROVIDERS_BY_SERVICE_TYPE(serviceTypeCode);
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        deletedAt: null,
      });

      if (!serviceType) {
        return [];
      }

      const providerMappings = await ServiceTypeProvider.find({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      })
        .populate({
          path: "providerId",
          match: { isActive: true, deletedAt: null },
          select: "_id name code logo paymentOptions",
        })
        .sort({ priority: 1 })
        .lean();

      const result = providerMappings
        .filter((mapping: any) => mapping.providerId !== null)
        .map((mapping: any) => ({
          id: mapping.providerId._id,
          name: mapping.providerId.name,
          code: mapping.providerId.code,
          logo: mapping.providerId.logo,
          serviceTypeCode: serviceTypeCode,
          paymentOptions: mapping.providerId.paymentOptions,
          isActive: true,
          priority: mapping.priority,
        }));

      await this.cacheService.set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES);
      return result;
    } catch (error: any) {
      logger.error(`Error fetching active providers for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch active providers",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }
}

