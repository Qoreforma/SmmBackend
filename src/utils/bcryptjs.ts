import bcrypt from "bcrypt";

class BcryptUtil {
  private saltRounds: number;

  constructor() {
    this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12");
  }

  async hashPassword(password: string): Promise<string> {
    try {
      const salt = await bcrypt.genSalt(this.saltRounds);
      return await bcrypt.hash(password, salt);
    } catch (error) {
      throw new Error("Failed to hash password");
    }
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      throw new Error("Failed to compare password");
    }
  }

  async isPasswordInHistory(
    newPassword: string,
    passwordHistory: string[]
  ): Promise<boolean> {
    for (const hashedPassword of passwordHistory) {
      if (await this.comparePassword(newPassword, hashedPassword)) {
        return true;
      }
    }
    return false;
  }

  updatePasswordHistory(
    passwordHistory: string[],
    newPasswordHash: string,
    maxHistory: number = 5
  ): string[] {
    const updatedHistory = [newPasswordHash, ...passwordHistory];
    return updatedHistory.slice(0, maxHistory);
  }
}

export const bcryptUtil = new BcryptUtil();
export default bcryptUtil;
