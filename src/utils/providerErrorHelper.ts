/**
 * Extensible Provider Error Helper
 *
 * Scans upstream third-party service provider responses for specific user-actionable patterns
 * (e.g. ineligible offers, invalid numbers, product mismatches) and maps them
 * into clean, friendly messages for users.
 *
 * For all technical, sensitive, or unrecognized errors, it returns a safe generic message.
 */

export interface ProviderErrorRule {
  id: string;
  description?: string;
  patterns: (string | RegExp)[];
  userMessage: string;
}

/**
 * Open, extensible array of user-friendly error mapping rules.
 * To add new error patterns in the future, simply append a new rule object here.
 */
export const USER_FRIENDLY_ERROR_RULES: ProviderErrorRule[] = [
  {
    id: "ineligible_offer",
    description: "Plan or offer not available for this phone number / SIM type",
    patterns: [
      /not eligible/i,
      /ineligible/i,
      /eligibility/i,
      /not allowed to buy/i,
      /user is not allowed/i,
      /not allowed/i,
      /product mismatch/i,
      /mismatched/i,
      /try another plan/i,
      /try another number/i,
      /offer not available/i,
      /cannot buy this product/i,
      /plan not supported/i,
      /plan does not belong/i,
    ],
    userMessage:
      "You are not eligible for this offer. Please try another plan or another phone number.",
  },
  {
    id: "network_mismatch",
    description: "Phone number belongs to a different network or is ported",
    patterns: [
      /wrong network/i,
      /ported/i,
      /does not belong to/i,
      /network mismatch/i,
      /different network/i,
      /invalid network/i,
    ],
    userMessage:
      "This phone number does not belong to the selected network. Please check the network and try again.",
  },
  {
    id: "barred_number",
    description: "Phone number is barred, blocked, or restricted by the telco",
    patterns: [
      /barred/i,
      /blacklisted/i,
      /blocked/i,
      /restricted from receiving/i,
      /dnd active/i,
    ],
    userMessage:
      "This phone number is currently barred from receiving data on this network. Please contact your network provider.",
  },
  {
    id: "invalid_phone",
    description: "Invalid phone number format or length",
    patterns: [
      /invalid phone/i,
      /invalid number/i,
      /invalid mobile/i,
      /invalid msisdn/i,
      /number not found/i,
      /unregistered number/i,
      /phone number is invalid/i,
    ],
    userMessage:
      "The phone number entered is invalid. Please check the number and try again.",
  },
  {
    id: "daily_limit_exceeded",
    description: "User/MSISDN exceeded maximum allowable transfers or purchase limits",
    patterns: [
      /daily limit/i,
      /limit exceeded/i,
      /maximum limit/i,
      /quota exceeded/i,
    ],
    userMessage:
      "Daily transaction limit reached for this number. Please try again tomorrow or try another number.",
  },
];

/**
 * Extracts raw string error text from diverse provider response payloads.
 */
export function getRawProviderErrorMessage(responseData: any): string | undefined {
  if (!responseData) return undefined;

  if (typeof responseData === "string" && responseData.trim()) {
    return responseData.replace(/\s*Transaction ID:\s*[\w-]*$/i, "").trim();
  }

  if (typeof responseData !== "object") return undefined;

  const candidate =
    responseData.response ??
    responseData.message ??
    responseData.errorMsg ??
    responseData.error_msg ??
    responseData.response_description ??
    responseData.remark ??
    responseData.detail ??
    responseData.api_response ??
    responseData.msg ??
    responseData.desc ??
    (typeof responseData.error === "string"
      ? responseData.error
      : Array.isArray(responseData.error)
      ? responseData.error.map(String).join("; ")
      : typeof responseData.error === "object" && responseData.error !== null
      ? responseData.error.message || responseData.error.response
      : undefined) ??
    (typeof responseData.data === "string" ? responseData.data : undefined);

  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.replace(/\s*Transaction ID:\s*[\w-]*$/i, "").trim();
  }

  return undefined;
}

/**
 * Extracts and translates upstream provider error into a clean, friendly user message.
 *
 * 1. Checks if the raw error matches any pattern in `USER_FRIENDLY_ERROR_RULES`.
 * 2. If a rule matches, returns the polished `userMessage`.
 * 3. If no rule matches (internal provider error, sensitive leak, unknown status code),
 *    returns the safe generic message (`"${fallbackOperation} failed. Please try again later."`).
 */
export function extractUserFriendlyErrorMessage(
  responseData: any,
  fallbackOperation: string = "Data purchase",
): string {
  const genericFallback = `${fallbackOperation} failed. Please try again later.`;

  const rawMessage = getRawProviderErrorMessage(responseData);
  if (!rawMessage) {
    return genericFallback;
  }

  // Safety filter: never allow internal infrastructure leaks to reach users
  const lower = rawMessage.toLowerCase();
  const isSensitiveInternalError =
    lower.includes("api key") ||
    lower.includes("apikey") ||
    lower.includes("secret") ||
    lower.includes("bearer") ||
    lower.includes("whitelist") ||
    lower.includes("sql") ||
    lower.includes("database") ||
    lower.includes("syntax error") ||
    lower.includes("stack trace") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("cannot read property") ||
    lower.includes("undefined is not");

  if (isSensitiveInternalError) {
    return genericFallback;
  }

  // Check rules in order
  for (const rule of USER_FRIENDLY_ERROR_RULES) {
    for (const pattern of rule.patterns) {
      const matches =
        typeof pattern === "string"
          ? lower.includes(pattern.toLowerCase())
          : pattern.test(rawMessage);

      if (matches) {
        return rule.userMessage;
      }
    }
  }

  return genericFallback;
}
