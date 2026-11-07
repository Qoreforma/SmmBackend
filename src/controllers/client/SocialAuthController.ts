import { Request, Response, NextFunction } from "express";
import { SocialAuthService } from "@/services/client/core/SocialAuthService";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendSuccessResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import ServiceContainer from "@/services/client/container";

export class SocialAuthController {
  private socialAuthService: SocialAuthService;

  constructor() {
    this.socialAuthService = ServiceContainer.getSocialAuthService();
  }


  googleSignIn = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { googleIdToken, fcmToken } = req.body;

      if (!googleIdToken) {
        return sendSuccessResponse(
          res,
          null,
          "Google ID token is required",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      const result = await this.socialAuthService.googleSignIn({
        googleIdToken,
        fcmToken,
      });

      const message = result.isNewUser
        ? "Account created and signed in successfully"
        : "Signed in successfully";

      return sendSuccessResponse(res, result, message);
    } catch (error) {
      next(error);
    }
  };

  appleSignIn = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { appleIdentityToken, appleRefreshToken, fcmToken } = req.body;

      if (!appleIdentityToken) {
        return sendSuccessResponse(
          res,
          null,
          "Apple identity token is required",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      const result = await this.socialAuthService.appleSignIn({
        appleIdentityToken,
        appleRefreshToken,
        fcmToken,
      });

      const message = result.isNewUser
        ? "Account created and signed in successfully"
        : "Signed in successfully";

      return sendSuccessResponse(res, result, message);
    } catch (error) {
      next(error);
    }
  };

  linkGoogleAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const { googleIdToken } = req.body;

      if (!googleIdToken) {
        return sendSuccessResponse(
          res,
          null,
          "Google ID token is required",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      await this.socialAuthService.linkGoogleAccount(userId, googleIdToken);

      return sendSuccessResponse(
        res,
        null,
        "Google account linked successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  linkAppleAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const { appleIdentityToken } = req.body;

      if (!appleIdentityToken) {
        return sendSuccessResponse(
          res,
          null,
          "Apple identity token is required",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      await this.socialAuthService.linkAppleAccount(userId, appleIdentityToken);

      return sendSuccessResponse(
        res,
        null,
        "Apple account linked successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
