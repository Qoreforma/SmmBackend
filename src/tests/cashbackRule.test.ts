import { clearTestDB } from "./setup";
import { CashbackRuleService } from "@/services/admin/finances/CashbackRuleService";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import "@/models/reference/ServiceType";
import "@/models/reference/Service";
import "@/models/reference/Provider";

import { Types } from "mongoose";

jest.setTimeout(30000);

describe("CashbackRule CRUD", () => {
  let cashbackService: CashbackRuleService;
  let ruleRepo: CashbackRuleRepository;
  let serviceRepo: ServiceRepository;
  let providerRepo: ProviderRepository;

  beforeAll(async () => {
    ruleRepo = new CashbackRuleRepository();
    serviceRepo = new ServiceRepository();
    providerRepo = new ProviderRepository();
    cashbackService = new CashbackRuleService(ruleRepo);
  });

  afterAll(async () => {
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it("should create a cashback rule", async () => {
    const adminId = new Types.ObjectId().toString();
    const serviceId = new Types.ObjectId().toString();

    const rule = await cashbackService.create({
      name: "10% Airtime Cashback",
      type: "percentage",
      value: 10,
      serviceId: serviceId,
      createdBy: new Types.ObjectId(adminId)
    });

    expect(rule).toBeDefined();
    expect(rule.type).toBe("percentage");
    expect(rule.value).toBe(10);
    expect(rule.active).toBe(true);
  });

  it("should update a cashback rule", async () => {
    const adminId = new Types.ObjectId().toString();
    const rule = await ruleRepo.create({
      name: "Old Rule",
      type: "flat",
      value: 50,
      active: true,
      createdBy: new Types.ObjectId(adminId)
    } as any);

    const updated = await cashbackService.update(rule.id, {
      name: "New Rule",
      value: 100
    });

    expect(updated).toBeDefined();
    expect(updated.value).toBe(100);
    expect(updated.type).toBe("flat");
  });

  it("should list cashback rules", async () => {
    const adminId = new Types.ObjectId().toString();
    await ruleRepo.create({
      name: "Rule 1",
      type: "flat",
      value: 50,
      active: true,
      createdBy: new Types.ObjectId(adminId)
    } as any);

    const rules = await cashbackService.getAll(1, 10, {});
    expect(rules.data.length).toBeGreaterThan(0);
  });

  it("should disable a cashback rule", async () => {
    const adminId = new Types.ObjectId().toString();
    const rule = await ruleRepo.create({
      name: "Rule to disable",
      type: "flat",
      value: 50,
      active: true,
      createdBy: new Types.ObjectId(adminId)
    } as any);

    const updated = await cashbackService.update(rule.id, {
      active: false
    });

    expect(updated.active).toBe(false);
  });
});
