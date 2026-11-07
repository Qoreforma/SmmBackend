import { Request, Response, NextFunction } from "express";
import { BiometricV2Service } from "@/services/client/core/BiometricV2Service";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class BiometricV2Controller {
  private biometricV2Service: BiometricV2Service;

  constructor(biometricV2Service?: BiometricV2Service) {
    this.biometricV2Service =
      biometricV2Service || ServiceContainer.getBiometricV2Service();
  }

  // ─── SETUP FLOW ──────────────────────────────────────────────────────────

  initiateSetup = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { deviceId, biometricType } = req.body;
      const result = await this.biometricV2Service.initiateSetup(
        userId,
        deviceId,
        biometricType,
      );
      return sendSuccessResponse(
        res,
        result,
        "Biometric setup challenge generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  completeSetup = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.biometricV2Service.completeSetup(
        userId,
        req.body,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // ─── LOGIN FLOW ──────────────────────────────────────────────────────────

  initiateLogin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { email, deviceId } = req.body;
      const result = await this.biometricV2Service.initiateLogin(
        email,
        deviceId,
      );
      return sendSuccessResponse(
        res,
        result,
        "Biometric login challenge generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyLogin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const loginIdentifier = (req as any).loginIdentifier || req.body.email;
      const ipIdentifier = (req as any).ipIdentifier;

      const result = await this.biometricV2Service.verifyLogin(
        req.body,
        loginIdentifier,
        ipIdentifier,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // ─── TRANSACTION FLOW ────────────────────────────────────────────────────

  initiateTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { deviceId } = req.body;
      const result = await this.biometricV2Service.initiateTransaction(
        userId,
        deviceId,
      );
      return sendSuccessResponse(
        res,
        result,
        "Transaction biometric challenge generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { deviceId, signature } = req.body;
      const result = await this.biometricV2Service.verifyTransaction(
        userId,
        deviceId,
        signature,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // ─── DEVICE MANAGEMENT FLOW ──────────────────────────────────────────────

  listDevices = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const devices = await this.biometricV2Service.listDevices(userId);
      return sendSuccessResponse(
        res,
        devices,
        "Enrolled biometric devices retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  revokeDevice = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { deviceId } = req.params;
      const result = await this.biometricV2Service.revokeDevice(
        userId,
        deviceId,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  revokeAllDevices = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.biometricV2Service.revokeAllDevices(userId);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // ─── PURPOSE TOGGLE ───────────────────────────────────────────────────────

  togglePurpose = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { deviceId } = req.params;
      const { purpose, enabled } = req.body;
      const result = await this.biometricV2Service.togglePurpose(
        userId,
        deviceId,
        purpose,
        enabled,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
}
