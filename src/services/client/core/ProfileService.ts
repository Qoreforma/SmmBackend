import { UserRepository } from "@/repositories/client/UserRepository";
import { CacheService } from "../../core/CacheService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { IUser, IUserResponse } from "@/models/core/User";
import { generateRefCode } from "@/utils/helpers";

export interface UpdateProfileDTO {
  firstname?: string;
  lastname?: string;
  username?: string;
  phone?: string;
  phoneCode?: string;
  gender?: "male" | "female" | "other";
  country?: string;
  state?: string;
  avatar?: string;
  fcmToken?: string;
}

export class ProfileService {
  constructor(
    private userRepository: UserRepository,
    private cacheService: CacheService,
  ) { }

  async getProfile(userId: string): Promise<any> {
    // Check cache first
    const cached = await this.cacheService.get(CACHE_KEYS.USER_PROFILE(userId));
    if (cached) {
      return cached;
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const profile = await this.formatUserDetails(user);
    // Cache profile
    await this.cacheService.set(CACHE_KEYS.USER_PROFILE(userId), profile);

    return profile;
  }

  async updateProfile(userId: string, data: UpdateProfileDTO): Promise<any> {

    const userDetail = await this.userRepository.findById(userId)
    if (!userDetail) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    const updateData: any = { ...data };
    if (data.fcmToken !== undefined) {
      delete updateData.fcmToken;
      updateData.fcmTokens = data.fcmToken ? [data.fcmToken] : [];
    }
    if (!userDetail.refCode) {
      updateData.refCode = data.username || userDetail.username || generateRefCode();
    }

    const user = await this.userRepository.update(userId, updateData);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const userDetails = await this.formatUserDetails(user);
    if (!userDetails) {
      throw new AppError(
        "User update failed",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Update cache with new data
    await this.cacheService.set(CACHE_KEYS.USER_PROFILE(userId), userDetails);

    return { userDetails };
  }

  async toogleBiometric(
    userId: string,
    enable: boolean,
    type: "login" | "transaction",
  ): Promise<IUserResponse | null> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (type === "transaction") {
      user.transactionBiometricEnabled = enable;
    } else if (type === "login") {
      user.loginBiometricEnabled = enable;
    }

    // Save changes
    await user.save();

    const userDetails = await this.formatUserDetails(user);
    if (!userDetails) {
      throw new AppError(
        "User update failed",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Update cache with new data
    await this.cacheService.set(CACHE_KEYS.USER_PROFILE(userId), userDetails);

    return { ...userDetails };
  }

  async deactivateAccount(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    user.status = "inactive";
    user.deletedAt = new Date();
    await user.save();

    // Invalidate cache for deactivated account
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
  }

  async updateAvatar(userId: string, avatar: string): Promise<void> {
    await this.userRepository.update(userId, { avatar });
    await this.refreshUserCache(userId);
  }

  // Utility method to refresh user cache after updates in other services
  // Call this method from other services after updating user data
  async refreshUserCache(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      // Invalidate cache if user doesn't exist
      await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
      return;
    }

    const userDetails = await this.formatUserDetails(user);
    if (userDetails) {
      await this.cacheService.set(CACHE_KEYS.USER_PROFILE(userId), userDetails);
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
  }

  private async formatUserDetails(user: IUser): Promise<IUserResponse | null> {
    if (!user) return null;

    // if (user.country || user.state) {
    //   await user.populate(["country", "state"]);
    // }

    return {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone || null,
      phoneCode: user.phoneCode || null,
      username: user.username || null,
      gender: user.gender || null,
      refCode: user.refCode || null,
      referredBy: user.referredBy || null,
      avatar: user.avatar || null,
      country: user.country || null,
      state: user.state || null,
      city: user.city || null,
      address: user.address || null,
      postalCode: user.postalCode || null,
      status: user.status,
      authType: user.authType,
      fcmTokens: user.fcmTokens,
      virtualAccount: user.virtualAccount || null,
      dateOfBirth: user.dateOfBirth || null,
      bvnVerified: user.bvnVerified,
      bvnValidated: user.bvnValidated,
      biometricEnabled: user.biometricEnabled || false,
      loginBiometricEnabled: user.loginBiometricEnabled || false,
      transactionBiometricEnabled: user.transactionBiometricEnabled || false,
      twofactorEnabled: user.twofactorEnabled || false,
      emailVerifiedAt: user.emailVerifiedAt || null,
      phoneVerifiedAt: user.phoneVerifiedAt || null,
      pinActivatedAt: user.pinActivatedAt || null,
      twoFactorEnabledAt: user.twoFactorEnabledAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      appVersion: user.appVersion || null,
    };
  }
}
