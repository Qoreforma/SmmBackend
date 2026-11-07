import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { NumberRentalService } from "@/services/client/NumberRentalService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class NumberRentalController {
  private numberRentalService: NumberRentalService;

  constructor() {
    this.numberRentalService = ServiceContainer.getNumberRentalService();
  }

  getCountries = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = req.query.provider as string | undefined;
      const countries = await this.numberRentalService.getCountries(provider);
      return sendSuccessResponse(res, countries, "Available countries retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getServices = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const country = (req.query.country as string) || "any";
      const provider = req.query.provider as string | undefined;
      const operator = (req.query.operator as string) || "any";
      const services = await this.numberRentalService.getServices(country, provider, operator);
      return sendSuccessResponse(res, services, "Number services retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  rentNumber = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { country, service, operator, provider, channel, areaCode } = req.body;
      const result = await this.numberRentalService.rentNumber({
        userId: req.user!.id,
        country,
        service,
        operator,
        provider,
        channel,
        areaCode,
      } as any);
      return sendSuccessResponse(res, result, "Number rented successfully. Awaiting OTP.");
    } catch (error) {
      next(error);
    }
  };

  checkOtp = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const result = await this.numberRentalService.checkOtp(reference, req.user!.id);
      return sendSuccessResponse(res, result, "OTP status checked");
    } catch (error) {
      next(error);
    }
  };

  cancelRental = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const result = await this.numberRentalService.cancelRental(reference, req.user!.id);
      return sendSuccessResponse(res, result, "Rental cancelled and wallet refunded");
    } catch (error) {
      next(error);
    }
  };

  banRental = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const result = await this.numberRentalService.banRental(reference, req.user!.id);
      return sendSuccessResponse(res, result, "Number reported as banned and wallet refunded");
    } catch (error) {
      next(error);
    }
  };
}
