import { Request, Response, NextFunction } from "express";
import { AuthService } from "@/services/client/core/AuthService";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendErrorResponse, sendSuccessResponse } from "@/utils/helpers";
import { ERROR_CODES, HTTP_STATUS } from "@/utils/constants";
import ServiceContainer from "@/services/client/container";

export class AuthController {
  private authService: AuthService;
  constructor() {
    this.authService = ServiceContainer.getAuthService();
  }

  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.authService.register(req.body);
      return sendSuccessResponse(
        res,
        result,
        `${result.message || "Registration successful"}`,
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loginIdentifier = (req as any).loginIdentifier || req.body.email;
      const ipIdentifier = (req as any).ipIdentifier;
      const ipAddress = req.ip;
      const result = await this.authService.login(
        req.body,
        loginIdentifier,
        ipIdentifier,
        ipAddress,
      );

      if (result.twofaSuccess) {
        return res.status(HTTP_STATUS.OK).json({
          success: false,
          message: result.message,
          error: ERROR_CODES.TWO_FA_REQUIRED,
          data: {
            user: result.user,
          },
          timestamp: new Date().toISOString(),
          path: res.req.originalUrl,
        });
      }
      return sendSuccessResponse(res, result, "Login successful");
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const token = req.headers.authorization?.substring(7) || "";
      await this.authService.logout(userId, token);
      return sendSuccessResponse(res, null, "Logout successful");
    } catch (error) {
      next(error);
    }
  };

  refreshToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const result = await this.authService.refreshToken(refreshToken);
      return sendSuccessResponse(res, result, "Token refreshed successfully");
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.authService.forgotPassword(req.body);
      return sendSuccessResponse(
        res,
        null,
        "Kindly enter the otp sent to your email to reset your password",
      );
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.authService.resetPassword(req.body);
      return sendSuccessResponse(res, null, "Password reset successful");
    } catch (error) {
      next(error);
    }
  };

  verifyResetOTP = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { otp, email } = req.body;
      const result = await this.authService.verifyResetOTP(otp, email);
      return sendSuccessResponse(res, result, "OTP verified successfully");
    } catch (error) {
      next(error);
    }
  };
  changeAppPassword = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { newPassword, email } = req.body;
      await this.authService.changeAppPassword(newPassword, email);
      return sendSuccessResponse(res, null, "Password changed successfully");
    } catch (error) {
      next(error);
    }
  };

  changeEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { oldEmail, newEmail } = req.body;

      if (oldEmail === newEmail) {
        return sendErrorResponse(
          res,
          "New email cannot be the same as the old email",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      await this.authService.changeEmail(oldEmail, newEmail);
      return sendSuccessResponse(res, null, "Email changed successfully, Kindly Verify your Email");
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      await this.authService.changePassword({ ...req.body, userId });
      return sendSuccessResponse(res, null, "Password changed successfully");
    } catch (error) {
      next(error);
    }
  };

  verifyEmail = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp, email } = req.body;
      const result = await this.authService.verifyEmail(otp, email);
      return sendSuccessResponse(res, result, "Email verified successfully");
    } catch (error) {
      next(error);
    }
  };

  resendEmailVerification = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { email } = req.body;
      await this.authService.resendEmailVerification(email);
      return sendSuccessResponse(
        res,
        null,
        "Verification code resent to your email",
      );
    } catch (error) {
      next(error);
    }
  };

  sendPhoneVerification = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { phoneCode, phone } = req.body;
      await this.authService.sendPhoneVerification({
        userId,
        phoneCode,
        phone,
      });
      /*
      // --- Original SMS response message (commented out while SMS is down) ---
      // return sendSuccessResponse(
      //   res,
      //   null,
      //   "Verification code sent to your phone",
      // );
      */
      return sendSuccessResponse(
        res,
        null,
        "Verification code sent to your email",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyPhone = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.verifyPhone({
        ...req.body,
        userId,
      });
      return sendSuccessResponse(res, result, "Phone verified successfully");
    } catch (error) {
      next(error);
    }
  };

  updatePin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.updatePin({ ...req.body, userId });
      return sendSuccessResponse(res, result, "PIN updated successfully");
    } catch (error) {
      next(error);
    }
  };

  changePin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.changePin({ ...req.body, userId });
      return sendSuccessResponse(res, result, "PIN changed successfully");
    } catch (error) {
      next(error);
    }
  };

  verifyPin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const isValid = await this.authService.verifyPin({ ...req.body, userId });
      return sendSuccessResponse(
        res,
        { valid: isValid },
        isValid ? "Pin verified" : "Invalid PIN",
      );
    } catch (error) {
      next(error);
    }
  };

  setPin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { pin } = req.body;
      const result = await this.authService.setPin({ pin, userId });
      return sendSuccessResponse(res, result, "PIN set successfully");
    } catch (error) {
      next(error);
    }
  };

  resendPinVerification = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      await this.authService.resendPinVerification(userId);
      return sendSuccessResponse(
        res,
        null,
        "Verification code resent to your email",
      );
    } catch (error) {
      next(error);
    }
  };

  resetPin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { newPin, otp } = req.body;

      const data = await this.authService.resetPin(userId, newPin, otp);
      return sendSuccessResponse(res, data, "Pin reset successfully");
    } catch (error) {
      next(error);
    }
  };

  verifyPinOtp = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { otp } = req.body;
      await this.authService.verifyPinOtp(otp, userId);
      return sendSuccessResponse(res, null, "Pin verified successfully");
    } catch (error) {
      next(error);
    }
  };

  appResetPin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { pin } = req.body;
      const result = await this.authService.appResetPin({ pin, userId });
      return sendSuccessResponse(res, result, "Pin reset successfully");
    } catch (error) {
      next(error);
    }
  };

  toggle2FA = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { enable } = req.body;
      const result = await this.authService.toggle2FA({ enable, userId });
      return sendSuccessResponse(
        res,
        result,
        `2FA ${enable ? "enabled" : "disabled"} successfully`,
      );
    } catch (error) {
      next(error);
    }
  };

  verify2FA = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.authService.verify2FA({ ...req.body });
      return sendSuccessResponse(res, result, "2FA verified successfully");
    } catch (error) {
      next(error);
    }
  };

  resend2FA = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      await this.authService.resend2FA(email);
      return sendSuccessResponse(res, null, "2FA code resent successfully");
    } catch (error) {
      next(error);
    }
  };

  setupLoginBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.setupLoginBiometric(userId);
      return sendSuccessResponse(
        res,
        { frontendToken: result.frontendToken, user: result.user },
        result.message || "Login biometric setup successful",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyLoginBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { frontendToken } = req.body;
      const result = await this.authService.verifyLoginBiometric(
        userId,
        frontendToken,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  disableLoginBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.disableLoginBiometric(userId);
      return sendSuccessResponse(
        res,
        result,
        "Login biometric disabled successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getLoginBiometricStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const status = await this.authService.getLoginBiometricStatus(userId);
      return sendSuccessResponse(
        res,
        status,
        "Login biometric status retrieved",
      );
    } catch (error) {
      next(error);
    }
  };

  // Transaction Biometric

  setupTransactionBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.setupTransactionBiometric(userId);
      return sendSuccessResponse(
        res,
        { frontendToken: result.frontendToken, user: result.user },
        result.message || "Transaction biometric setup successful",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyTransactionBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { frontendToken } = req.body;
      const result = await this.authService.verifyTransactionBiometric(
        userId,
        frontendToken,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  disableTransactionBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.disableTransactionBiometric(userId);
      return sendSuccessResponse(
        res,
        result,
        "Transaction biometric disabled successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getTransactionBiometricStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const status =
        await this.authService.getTransactionBiometricStatus(userId);
      return sendSuccessResponse(
        res,
        status,
        "Transaction biometric status retrieved",
      );
    } catch (error) {
      next(error);
    }
  };

  setupBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.setupBiometric(userId);
      return sendSuccessResponse(
        res,
        { frontendToken: result.frontendToken, user: result.user },
        result.message || "Biometric setup successful",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { frontendToken } = req.body;
      const result = await this.authService.verifyBiometric(
        userId,
        frontendToken,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  disableBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const result = await this.authService.disableBiometric(userId);
      return sendSuccessResponse(
        res,
        result,
        "Biometric disabled successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getBiometricStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const status = await this.authService.getBiometricStatus(userId);
      return sendSuccessResponse(res, status, "Biometric status retrieved");
    } catch (error) {
      next(error);
    }
  };
}
