import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { EmailOtpService } from "@/services/client/EmailOtpService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class EmailOtpController {
  private emailOtpService: EmailOtpService;

  constructor() {
    this.emailOtpService = ServiceContainer.getEmailOtpService();
  }

  getProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = req.query.provider as string | undefined;
      const products = await this.emailOtpService.getProducts(provider);
      return sendSuccessResponse(res, products, "Available Email OTP services retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getDomains = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const site = req.query.site as string;
      const provider = req.query.provider as string | undefined;
      const domains = await this.emailOtpService.getDomains(site, provider);
      return sendSuccessResponse(res, domains, "Available email domains retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  searchSite = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const q = req.query.q as string;
      const provider = req.query.provider as string | undefined;
      const result = await this.emailOtpService.searchSite(q, provider);
      return sendSuccessResponse(res, result, "Site search results retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  buyEmailOtp = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { site, domain, provider, channel } = req.body;
      const result = await this.emailOtpService.buyEmailOtp({
        userId: req.user!.id,
        site,
        domain,
        provider,
        channel,
      });
      return sendSuccessResponse(res, result, "Email address purchased successfully. Awaiting OTP code.");
    } catch (error) {
      next(error);
    }
  };

  checkEmailOtp = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const result = await this.emailOtpService.checkEmailOtp(reference, req.user!.id);
      return sendSuccessResponse(res, result, "Email OTP status retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  cancelEmailOtp = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const result = await this.emailOtpService.cancelEmailOtp(reference, req.user!.id);
      return sendSuccessResponse(res, result, "Email OTP order cancelled and wallet refunded");
    } catch (error) {
      next(error);
    }
  };
}
