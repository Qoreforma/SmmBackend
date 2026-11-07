import { Request, Response, NextFunction } from "express";
import { DailyStreakSetting } from "@/models/system/DailyStreakSetting";
import { HTTP_STATUS } from "@/utils/constants";

export class DailyStreakSettingController {
  getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let setting = await DailyStreakSetting.findOne();
      if (!setting) {
        setting = await DailyStreakSetting.create({
          isEnabled: false,
          rewardAmount: 0,
          description: "Daily login check-in streak reward",
        });
      }

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: setting,
      });
    } catch (error) {
      next(error);
    }
  };

  updateSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { isEnabled, rewardAmount, description } = req.body;

      let setting = await DailyStreakSetting.findOne();
      if (!setting) {
        setting = new DailyStreakSetting();
      }

      if (isEnabled !== undefined) setting.isEnabled = Boolean(isEnabled);
      if (rewardAmount !== undefined) setting.rewardAmount = Math.max(0, Number(rewardAmount));
      if (description !== undefined) setting.description = description;

      await setting.save();

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "Daily streak settings updated successfully",
        data: setting,
      });
    } catch (error) {
      next(error);
    }
  };
}
