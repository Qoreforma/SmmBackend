import { BaseRepository } from "../BaseRepository";
import { ITreasuryEntry, TreasuryEntry } from "@/models/system/TreasuryEntry";

export class TreasuryRepository extends BaseRepository<ITreasuryEntry> {
  constructor() {
    super(TreasuryEntry);
  }

  // Add any custom database queries for treasury here if needed
}
