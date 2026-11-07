import { CountryRepository } from "@/repositories/shared/CountryRepository";
import { StateRepository } from "@/repositories/shared/StateRepository";
import { CityRepository } from "@/repositories/shared/CityRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_TTL,
  TransactionType,
} from "@/utils/constants";
import { SaveHavenService } from "./providers/payments/SaveHavenService";
import { BannerRepository } from "@/repositories/admin/BannerRepository";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { Contact } from "@/models/system/Contact";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { DiscountRepository } from "@/repositories/shared/DiscountRepository";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { EmailService } from "../core/EmailService";
import logger from "@/logger";
import { emailConfig } from "@/config";
import { Types } from "mongoose";
import { CacheService } from "../core/CacheService";
import { Service } from "@/models/reference/Service";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";

export class ReferenceDataService {
  constructor(
    private countryRepository: CountryRepository,
    private stateRepository: StateRepository,
    private cityRepository: CityRepository,
    private providerRepository: ProviderRepository,
    private serviceRepository: ServiceRepository,
    private productRepository: ProductRepository,
    private bankAccountRepository: BankAccountRepository,
    private saveHavenService: SaveHavenService,
    private bankRepository: BankRepository,
    private bannerRepository: BannerRepository,
    private serviceChargeRepository: ServiceChargeRepository,
    private systemBankAccountRepository: SystemBankAccountRepository,
    private serviceTypeRepository: ServiceTypeRepository,
    private appVersionRepository: AppVersionRepository,
    private cashbackRuleRepository: CashbackRuleRepository,
    private emailService: EmailService,
    private cacheService: CacheService,
  ) {}

  // Countries
  async getAllCountries(
    page: number = 1,
    limit: number = 50,
    search?: string,
  ): Promise<any> {
    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { iso2: { $regex: search, $options: "i" } },
        { iso3: { $regex: search, $options: "i" } },
      ];
    }
    const { data, total } = await this.countryRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { countries: data, total, page, limit };
  }

  async getCountryById(id: string): Promise<any> {
    const country = await this.countryRepository.findById(id);
    if (!country) {
      throw new AppError(
        "Country not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return country;
  }

  async searchCountries(
    query: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter = {
      $or: [
        { name: { $regex: query, $options: "i" } },
        { iso2: { $regex: query, $options: "i" } },
        { iso3: { $regex: query, $options: "i" } },
      ],
    };
    const { data, total } = await this.countryRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { countries: data, total, page, limit };
  }

  // States
  async getStatesByCountry(
    countryId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const { data, total } = await this.stateRepository.findWithPagination(
      { country_id: countryId },
      page,
      limit,
      { name: 1 },
    );
    return { states: data, total, page, limit };
  }

  async getStateById(id: string): Promise<any> {
    const state = await this.stateRepository.findById(id);
    if (!state) {
      throw new AppError(
        "State not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return state;
  }

  async searchStates(
    countryId: string,
    query: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter = {
      countryId,
      name: { $regex: query, $options: "i" },
    };
    const { data, total } = await this.stateRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { states: data, total, page, limit };
  }

  // Cities
  async getCitiesByState(
    stateId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const { data, total } = await this.cityRepository.findWithPagination(
      { state_id: stateId },
      page,
      limit,
      { name: 1 },
    );
    return { cities: data, total, page, limit };
  }

  async getCityById(id: string): Promise<any> {
    const city = await this.cityRepository.findById(id);
    if (!city) {
      throw new AppError(
        "City not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return city;
  }

  async searchCities(
    stateId: string,
    query: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter = {
      stateId,
      name: { $regex: query, $options: "i" },
    };
    const { data, total } = await this.cityRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { cities: data, total, page, limit };
  }

  // Providers
  async getProviders(
    productType?: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter: any = { active: true };
    if (productType) {
      filter.productType = productType;
    }
    const { data, total } = await this.providerRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { providers: data, total, page, limit };
  }

  async getProviderById(id: string): Promise<any> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      throw new AppError(
        "Provider not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return provider;
  }

  // Services
  async getServices(
    productType?: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter: any = { active: true };
    if (productType) {
      filter.productType = productType;
    }
    const { data, total } = await this.serviceRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { services: data, total, page, limit };
  }

  async getServiceById(id: string): Promise<any> {
    const service = await this.serviceRepository.findById(id);
    if (!service) {
      throw new AppError(
        "Service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return service;
  }

  // Products
  async getProducts(filters: {
    providerId?: string;
    serviceId?: string;
    productType?: string;
    dataType?: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const {
      providerId,
      serviceId,
      productType,
      dataType,
      page = 1,
      limit = 50,
    } = filters;

    const filter: any = { active: true };
    if (providerId) filter.providerId = providerId;
    if (serviceId) filter.serviceId = serviceId;
    if (productType) filter.productType = productType;
    if (dataType && dataType !== "all") filter.dataType = dataType;

    const { data, total } = await this.productRepository.findWithPagination(
      filter,
      page,
      limit,
      { amount: 1 },
    );
    return { products: data, total, page, limit };
  }

  async getProductById(id: string): Promise<any> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        "Product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return product;
  }

  async searchProducts(
    query: string,
    productType?: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    const filter: any = {
      active: true,
      name: { $regex: query, $options: "i" },
    };
    if (productType) {
      filter.productType = productType;
    }
    const { data, total } = await this.productRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );
    return { products: data, total, page, limit };
  }

  // Banks
  async getBanks(page: number = 1, limit: number = 100): Promise<any> {
    const { data, total } = await this.bankRepository.findWithPagination(
      { isActive: true },
      page,
      limit,
      { name: 1 }
    );

    const transformed = data.map((bank) => {
      const code = bank.savehavenCode || bank.flutterwaveCode || bank.monnifyCode || bank.universalCode || "";
      return {
        name: bank.name,
        routingKey: code,
        logoImage: bank.icon || null,
        bankCode: code,
        categoryId: "",
        nubanCode: null,
      };
    });

    return { banks: transformed, total, page, limit };
  }

  async getBanners(): Promise<any> {
    const banners = await this.bannerRepository.findActiveBanners();
    return banners;
  }

  async getServiceCharge(type: TransactionType): Promise<any> {
    const query = {} as any;
    if (type) query.code = type;
    const serviceCharge = await this.serviceChargeRepository.find(query);
    return serviceCharge;
  }

  async getSystemBankAccounts(): Promise<any> {
    const result = await this.systemBankAccountRepository.find();
    const data = await Promise.all(
      result.map(async (account) => {
        const bank = await this.bankRepository.findBySavehavenCode(
          account.bankCode,
        );
        return {
          ...account.toObject(),
          bankName: bank ? bank.name : "Unknown Bank",
          icon: bank ? bank.icon : null,
        };
      }),
    );
    return data;
  }

  async getServiceTypesCode() {
    const result = await this.serviceTypeRepository.find();
    let serviceTypes: string[] = [];
    result.map((serviceType) => {
      serviceTypes.push(serviceType.code);
    });

    return serviceTypes;
  }

  async getServiceTypes(): Promise<any> {
    const result = await this.serviceTypeRepository.find();

    const data = Object.assign(
      {},
      ...(await Promise.all(
        result.map(async (item) => ({
          [item.code]: {
            _id: item._id,
            status: item.status,
            message: await this.getStatusMessage(item.status, item.name),
          },
        })),
      )),
    );

    return data;
  }

  async getSupportContact(): Promise<any> {
    const result = await Contact.findOne({}).lean().exec();

    return result;
  }

  async getAppVersion(): Promise<any> {
    const result = await this.appVersionRepository.find();
    return result;
  }

  async getCashbackRules(filters: any): Promise<any> {
    const { serviceTypeId, active, type } = filters;

    const ruleCacheKey = [
      "cashbacks",
      serviceTypeId,
      type ?? "all",
      active ?? "all",
    ].join(":");

    const cached = await this.cacheService.get<any>(ruleCacheKey);
    if (cached) {
      logger.debug(`Using cached cashbacks: ${ruleCacheKey}`);
      return cached;
    }

    const query: Record<string, any> = {};
    if (serviceTypeId) {
      query.serviceTypeId = {
        $in: [new Types.ObjectId(serviceTypeId), null],
      };
    }

    if (active !== undefined)
      query.active = active === "true" || active === true;
    if (type) query.type = type;

    let result = await this.cashbackRuleRepository.find(query);

    // If serviceTypeId was requested, prioritize specific rules over global fallback rules
    if (serviceTypeId && Array.isArray(result)) {
      result = result.sort((a: any, b: any) => {
        if (a.serviceTypeId && !b.serviceTypeId) return -1;
        if (!a.serviceTypeId && b.serviceTypeId) return 1;
        return 0;
      });
    }

    this.cacheService
      .set(ruleCacheKey, result, CACHE_TTL.SERVICE_CHARGE)
      .catch((err) => {
        logger.error(`Failed to cache cashbacks: ${ruleCacheKey}`, {
          error: err.message,
        });
      });

    return result;
  }

  async invalidateCashbackCache(): Promise<void> {
    await this.cacheService.deletePattern("cashbacks:*").catch((err) => {
      logger.error("Failed to invalidate cashbacks cache", err);
    });
  }

  async contactForm(data: {
    name: string;
    email: string;
    message: string;
  }): Promise<any> {
    let email;

    const result = await this.getSupportContact();

    if (result && result.emailAddress) {
      email = result.emailAddress;
    } else {
      email = emailConfig.supportContactEmail;
    }

    if (!result) {
      throw new AppError(
        "Contact not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!result.email) {
      logger.error("Contact email not found");
    }

    await this.emailService.sendContactEmail(email, data);
    return;
  }

  private async getStatusMessage(status: string, name: string): Promise<string | null> {
    switch (status) {
      case "active":
        return null;
      case "coming-soon":
        return `${name} is coming soon.`;
      case "deactivated":
        return "The service  is no longer available.";
      case "temporary-deactivated":
        return `This service is unavailable at the moment. Please try again later.`;
      default:
        return "Unknown status.";
    }
  }

  async getDiscounts(filters: any): Promise<any> {
    const { serviceId, active, type, code, name, productType, providerId, dataType } = filters;
    const match: any = {};
    if (active !== undefined) match.isActive = active === "true";
    if (type) match.type = type;
    if (code) match.code = { $regex: code, $options: "i" };
    if (name) match.name = { $regex: name, $options: "i" };
    if (serviceId) match.serviceId = new (require("mongoose").Types.ObjectId)(serviceId);
    if (providerId) match.providerId = new (require("mongoose").Types.ObjectId)(providerId);
    if (productType) match.productType = productType;
    if (dataType) match.dataType = dataType;
    const discounts = await require("@/models/products/Discount").Discount.find(match);
    return discounts;
  }
}