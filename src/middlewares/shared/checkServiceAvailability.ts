import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuthRequest } from "@/middlewares/client/auth";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_TTL,
  CACHE_KEYS,
} from "@/utils/constants";
import { ServiceType } from "@/models/reference/ServiceType";
import logger from "@/logger";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import cacheService from "@/services/core/CacheService";
import { AppError } from "./errorHandler";
import { Types } from "mongoose";
import { getEnviroment } from "@/utils/helpers";

declare global {
  namespace Express {
    interface Request {
      serviceProvider?: any;
      serviceProviders?: any;
    }
  }
}

const enviroment = getEnviroment();
export interface ProviderDTO {
  _id: Types.ObjectId;
  code: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  logo?: string;
  serviceType?: Types.ObjectId[];
  hasSync?: boolean;
}

export const checkServiceAvailability = (
  serviceTypeCode: string,
  options: { multiProvider?: boolean } = {},
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const cacheKey = CACHE_KEYS.SERVICE_BY_CODE(serviceTypeCode);
      const cached = await cacheService.get<any>(cacheKey);

      if (cached) {
        req.serviceProvider = options.multiProvider ? undefined : cached;
        req.serviceProviders = options.multiProvider ? cached : undefined;
        return next();
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        deletedAt: null,
      });

      if (!serviceType) {
        throw new AppError(
          `Service '${serviceTypeCode}' not found`,
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      switch (serviceType.status) {
        case "coming-soon":
          try {
            Sentry.captureMessage(
              `Service access attempt: coming-soon service`,
              {
                level: "info",
                tags: {
                  serviceCode: serviceTypeCode,
                  serviceStatus: "coming-soon",
                  event: "service_coming_soon",
                },
              },
            );
          } catch (sentryErr) {
            logger.error(
              "[Sentry] Failed to capture coming-soon access:",
              sentryErr,
            );
          }

          throw new AppError(
            `${serviceType.name} service is coming soon. Stay tuned!`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "deactivated":
          try {
            Sentry.captureMessage(
              `Service access attempt: deactivated service`,
              {
                level: "warning",
                tags: {
                  serviceCode: serviceTypeCode,
                  serviceStatus: "deactivated",
                  event: "service_deactivated",
                },
              },
            );
          } catch (sentryErr) {
            logger.error(
              "[Sentry] Failed to capture deactivated access:",
              sentryErr,
            );
          }

          throw new AppError(
            `${serviceType.name} service is currently unavailable`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "temporary-deactivated":
          try {
            Sentry.captureMessage(
              `Service access attempt: temporarily deactivated service`,
              {
                level: "warning",
                tags: {
                  serviceCode: serviceTypeCode,
                  serviceStatus: "temporary-deactivated",
                  event: "service_temporary_outage",
                },
              },
            );
          } catch (sentryErr) {
            logger.error("[Sentry] Failed to capture temp outage:", sentryErr);
          }

          throw new AppError(
            `${serviceType.name} service is temporarily unavailable. Please try again later`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "active":
          break;
        default:
          throw new AppError(
            `${serviceType.name} service is currently unavailable`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
      }

      if (options.multiProvider) {
        // Fetch ALL active providers sorted by priority
        const providerMappings = await ServiceTypeProvider.find({
          serviceTypeId: serviceType._id,
          isActive: true,
          deletedAt: null,
        })
          .sort({ priority: 1 })
          .populate({
            path: "providerId",
            match: { isActive: true, deletedAt: null },
          })
          .lean();

        const providers = providerMappings
          .map((m) => m.providerId as unknown as ProviderDTO)
          .filter((p) => p && typeof p === "object" && p.code);

        if (!providers.length) {
          try {
            Sentry.captureMessage(
              `Service available but no active providers configured`,
              {
                level: "error",
                tags: {
                  serviceCode: serviceTypeCode,
                  event: "service_no_providers",
                },
              },
            );
          } catch (sentryErr) {
            logger.error("[Sentry] Failed to capture no providers:", sentryErr);
          }

          throw new AppError(
            enviroment === "production"
              ? `${serviceType.name} service is currently unavailable`
              : `${serviceType.name} service is currently unavailable. No active provider configured`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }

        cacheService
          .set(cacheKey, providers, CACHE_TTL.ONE_HOUR)
          .catch((err) =>
            logger.error(
              `Failed to cache service availability for ${serviceTypeCode}`,
              { error: err.message },
            ),
          );

        req.serviceProviders = providers; // Array on request
        logger.debug(
          `Service ${serviceTypeCode} is available with ${providers.length} providers`,
        );
      } else {
        // Original single-provider logic
        const providerMapping = await ServiceTypeProvider.findOne({
          serviceTypeId: serviceType._id,
          isActive: true,
          deletedAt: null,
        })
          .sort({ priority: 1 })
          .populate({
            path: "providerId",
            match: { isActive: true, deletedAt: null },
          })
          .lean();

        if (!providerMapping || !providerMapping.providerId) {
          try {
            Sentry.captureMessage(
              `Service available but no provider configured`,
              {
                level: "error",
                tags: {
                  serviceCode: serviceTypeCode,
                  event: "service_no_provider",
                },
              },
            );
          } catch (sentryErr) {
            logger.error("[Sentry] Failed to capture no provider:", sentryErr);
          }

          throw new AppError(
            enviroment === "production"
              ? `${serviceType.name} service is currently unavailable`
              : `${serviceType.name} service is currently unavailable. No active providers configured`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }

        const provider = providerMapping.providerId as unknown as ProviderDTO;

        if (!provider || typeof provider !== "object" || !provider.code) {
          throw new AppError(
            `${serviceType.name} service configuration error`,
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }

        cacheService
          .set(cacheKey, provider, CACHE_TTL.ONE_HOUR)
          .catch((err) =>
            logger.error(
              `Failed to cache service availability for ${serviceTypeCode}`,
              { error: err.message },
            ),
          );

        req.serviceProvider = provider;
        logger.debug(
          `Service ${serviceTypeCode} is available with provider: ${provider.code}`,
        );
      }

      next();
    } catch (error: any) {
      if (error instanceof AppError) return next(error);

      logger.error(
        `Error checking service availability for ${serviceTypeCode}`,
        {
          error: error.message,
          userId: req.user?.id,
        },
      );

      next(
        new AppError(
          "Unable to process request at this time",
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ),
      );
    }
  };
};

export const checkServiceTypeStatus = (serviceTypeCode: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const cacheKey = CACHE_KEYS.SERVICE_BY_STATUS(serviceTypeCode);

      const cached = await cacheService.get<{ status: string; name: string }>(
        cacheKey,
      );

      const serviceType =
        cached ??
        (await ServiceType.findOne({
          code: serviceTypeCode,
          deletedAt: null,
        }).lean());

      if (!serviceType) {
        throw new AppError(
          `Service '${serviceTypeCode}' not found`,
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      switch (serviceType.status) {
        case "coming-soon":
          throw new AppError(
            `${serviceType.name} service is coming soon. Stay tuned!`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "deactivated":
          throw new AppError(
            `${serviceType.name} service is currently unavailable`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "temporary-deactivated":
          throw new AppError(
            `${serviceType.name} service is temporarily unavailable. Please try again later`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        case "active":
          break;
        default:
          throw new AppError(
            `${serviceType.name} service is currently unavailable`,
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
      }

      if (!cached) {
        cacheService
          .set(
            cacheKey,
            { status: serviceType.status, name: serviceType.name },
            CACHE_TTL.ONE_HOUR,
          )
          .catch((err) =>
            logger.error(`Failed to cache service type status`, {
              error: err.message,
            }),
          );
      }

      next();
    } catch (error: any) {
      if (error instanceof AppError) return next(error);
      next(
        new AppError(
          "Unable to process request at this time",
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ),
      );
    }
  };
};

export const resolveServiceProvider = (serviceTypeCode: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const cacheKey = CACHE_KEYS.SERVICE_BY_CODE(serviceTypeCode);
      const cached = await cacheService.get<ProviderDTO>(cacheKey);

      if (cached) {
        req.serviceProvider = cached;
        return next();
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        deletedAt: null,
      });

      // Service type missing or not active — set null and continue
      if (!serviceType || serviceType.status !== "active") {
        req.serviceProvider = null;
        logger.info(
          `resolveServiceProvider: service type '${serviceTypeCode}' is not active (status: ${serviceType?.status ?? "not found"}). Continuing without provider.`,
        );
        return next();
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
        })
        .lean();

      const provider =
        providerMapping?.providerId as unknown as ProviderDTO | null;

      if (!provider || typeof provider !== "object" || !provider.code) {
        // No active provider configured — set null and continue
        req.serviceProvider = null;
        logger.info(
          `resolveServiceProvider: no active provider found for '${serviceTypeCode}'. Continuing without provider.`,
        );
        return next();
      }

      cacheService
        .set(cacheKey, provider, CACHE_TTL.ONE_HOUR)
        .catch((err) =>
          logger.error(
            `resolveServiceProvider: failed to cache provider for ${serviceTypeCode}`,
            { error: err.message },
          ),
        );

      req.serviceProvider = provider;
      logger.debug(
        `resolveServiceProvider: resolved provider '${provider.code}' for '${serviceTypeCode}'`,
      );

      next();
    } catch (error: any) {
      // Even on unexpected errors — don't block the request, just log and continue
      logger.error(
        `resolveServiceProvider: unexpected error for '${serviceTypeCode}': ${error.message}`,
      );
      req.serviceProvider = null;
      next();
    }
  };
};
