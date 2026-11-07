export type StatsPeriod =
  | "1d"
  | "7d"
  | "1m"
  | "1y"
  | "today"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "all"
  | "custom";

export interface PeriodFilter {
  period?: StatsPeriod | string;
  startDate?: string | Date;
  endDate?: string | Date;
}

// Returns a Mongo-ready { $gte, $lte } object, or undefined for "all time".
// Non-breaking: every existing caller passes {} today and gets undefined back,
// identical to current behavior (no createdAt filter applied).
export function resolveDateRange(filters: PeriodFilter = {}): { $gte: Date; $lte: Date } | undefined {
  const now = new Date();

  if (filters.period && filters.period !== "custom" && filters.period !== "all") {
    const periodLower = filters.period.toLowerCase();

    if (periodLower === "1d" || periodLower === "today" || periodLower === "daily") {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      return { $gte: startOfToday, $lte: now };
    }

    if (periodLower === "7d" || periodLower === "weekly" || periodLower === "1w") {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { $gte: start, $lte: now };
    }

    if (periodLower === "1m" || periodLower === "monthly" || periodLower === "30d") {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { $gte: start, $lte: now };
    }

    if (periodLower === "1y" || periodLower === "yearly" || periodLower === "365d") {
      const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      return { $gte: start, $lte: now };
    }
  }

  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    // If end date has no time set (00:00:00), expand to end of that day (23:59:59.999)
    if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
      end.setHours(23, 59, 59, 999);
    }
    return { $gte: start, $lte: end };
  }

  return undefined;
}