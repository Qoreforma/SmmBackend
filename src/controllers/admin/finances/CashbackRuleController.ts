import { Request, Response } from "express";
import { CashbackRuleService } from "@/services/admin/finances/CashbackRuleService";
import { HTTP_STATUS } from "@/utils/constants";
import {
  createCashbackRuleValidation,
  updateCashbackRuleValidation,
  bulkUpdateCashbackRuleValidation,
} from "@/validations/admin/cashbackRuleValidation";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";

export class CashbackRuleController {
  constructor(private cashbackRuleService: CashbackRuleService) {}

  async create(req: Request, res: Response) {
    const { error, value } = createCashbackRuleValidation.validate(req.body);
    if (error) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ status: "error", message: error.details[0].message });
    }

    const rule = await this.cashbackRuleService.create(value);
    return sendSuccessResponse(res, rule, "Cashback rule created", HTTP_STATUS.CREATED);
  }

  async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    // allow filtering by status
    const filters: any = {};
    if (req.query.active !== undefined) {
      filters.active = req.query.active === 'true';
    }

    const rules = await this.cashbackRuleService.getAll(page, limit, filters);
    return sendPaginatedResponse(
      res,
      rules.data,
      { total: rules.total, page, limit },
      "Cashback rules retrieved"
    );
  }

  async getById(req: Request, res: Response) {
    const rule = await this.cashbackRuleService.getById(req.params.id);
    return sendSuccessResponse(res, rule, "Cashback rule retrieved", HTTP_STATUS.OK);
  }

  async update(req: Request, res: Response) {
    const { error, value } = updateCashbackRuleValidation.validate(req.body);
    if (error) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ status: "error", message: error.details[0].message });
    }

    const rule = await this.cashbackRuleService.update(req.params.id, value);
    return sendSuccessResponse(res, rule, "Cashback rule updated", HTTP_STATUS.OK);
  }

  async delete(req: Request, res: Response) {
    await this.cashbackRuleService.delete(req.params.id);
    return sendSuccessResponse(res, null, "Cashback rule deleted", HTTP_STATUS.OK);
  }

  async bulkUpdate(req: Request, res: Response) {
    const { error, value } = bulkUpdateCashbackRuleValidation.validate(req.body);
    if (error) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ status: "error", message: error.details[0].message });
    }

    const result = await this.cashbackRuleService.bulkUpdate(value.ids, value.data);
    return sendSuccessResponse(res, result, result.message, HTTP_STATUS.OK);
  }
}
