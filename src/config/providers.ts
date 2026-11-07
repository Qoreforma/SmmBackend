// "" (unset) => legacy SafeHaven OTP flow. "xixapay" => /accounts/initiate skips OTP.
export const SUBACCOUNT_PROVIDER = (process.env.SUBACCOUNT_PROVIDER || "xixapay").toLowerCase();

export const PROVIDERS = {
  SAVEHAVEN: {
    name: "SafeHaven",
    baseUrl: process.env.SAFEHAVEN_BASE_URL || "https://api.safehavenmfb.com",
    apiKey: process.env.SAFEHAVEN_API_KEY || "",
    clientId: process.env.SAFEHAVEN_CLIENT_ID,
    clientAssertion: process.env.SAFEHAVEN_CLIENT_ASSERTION,
    isSandBox: process.env.SAFEHAVEN_SANDBOX,
  },
  FLUTTERWAVE: {
    name: "Flutterwave",
    baseUrl:
      process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
  },
  MONNIFY: {
    name: "Monnify",
    baseUrl: process.env.MONNIFY_BASE_URL || "https://api.monnify.com",
    apiKey: process.env.MONNIFY_API_KEY || "",
    secretKey: process.env.MONNIFY_SECRET_KEY || "",
    contractCode: process.env.MONNIFY_CONTRACT_CODE || "",
    walletAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER || "",
  },
  PAYSTACK: {
    name: "Paystack",
    baseUrl: "https://api.paystack.co",
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
  },
  DOJAH: {
    baseUrl: process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io",
    appId: process.env.DOJAH_APP_ID,
    secretKey: process.env.DOJAH_SECRET_KEY,
  },
  QOREID: {
    name: "QoreID",
    baseUrl: process.env.QOREID_BASE_URL || "https://api.qoreid.com",
    clientId: process.env.QOREID_CLIENT_ID || "",
    secret: process.env.QOREID_SECRET || "",
  },
  NIGERIASMM: {
    name: "Nigeria SMM",
    baseUrl: process.env.NIGERIASMM_BASE_URL || "https://nigeriasmm.com/api/v2",
    apiKey: process.env.NIGERIASMM_API_KEY || "",
  },
  OWLET: {
    name: "Owlet",
    // Endpoint: POST https://the-owlet.com/api/v2 — no trailing slash.
    baseUrl: process.env.OWLET_BASE_URL || "https://the-owlet.com/api/v2",
    apiKey: process.env.OWLET_API_KEY || "",
  },
  SMMFOLLOWS: {
    name: "SmmFollows",
    baseUrl: process.env.SMMFOLLOWS_BASE_URL || "https://smmfollows.com/api/v2",
    apiKey: process.env.SMMFOLLOWS_API_KEY || "",
  },
  SMMRESELLERPANEL: {
    name: "SmmResellerPanel",
    baseUrl: process.env.SMMRESELLERPANEL_BASE_URL || "https://smmresellerpanel.net/api/v2",
    apiKey: process.env.SMMRESELLERPANEL_API_KEY || "",
  },
  FIVESIM: {
    name: "5SIM",
    baseUrl: process.env.FIVESIM_BASE_URL || "https://5sim.net/v1",
    apiKey: process.env.FIVESIM_API_KEY || "",
  },
  FLEEXA: {
    name: "Fleexa",
    baseUrl: process.env.FLEEXA_BASE_URL || "https://fleexa.com.ng/developer",
    apiKey: process.env.FLEEXA_API_KEY || "",
  },
  TEXTVERIFIED: {
    name: "Textverified",
    baseUrl: process.env.TEXTVERIFIED_BASE_URL || "https://www.textverified.com",
    apiKey: process.env.TEXTVERIFIED_API_KEY || "",
    apiUsername: process.env.TEXTVERIFIED_API_USERNAME || "",
    webhookSecret: process.env.TEXTVERIFIED_WEBHOOK_SECRET || "",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

export const SERVICE_PROVIDER_CONFIG = {
  savehaven: {
    code: "savehaven",
    name: "SafeHaven",
    supportedMethods: ["IMMEDIATE", "POLLING"],
    preferredMethod: "IMMEDIATE",
    pollingIntervalMs: 15000,
    pollingTimeoutMinutes: 30,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/vas/transaction/{reference}",
    note: "SafeHaven integration for virtual accounts & wallet operations.",
  },
  nigeriasmm: {
    code: "nigeriasmm",
    name: "Nigeria SMM",
    // No webhook mechanism — status must be polled via action=status
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 30000,    // 30 seconds
    pollingTimeoutMinutes: 4320, // 72 hours
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/api/v2?action=status&order={orderId}",
    note: "SMM panel reseller (social media engagement). Supports batch status queries (comma-separated order IDs). addOrder has no idempotency key — never auto-retry.",
  },
  owlet: {
    code: "owlet",
    name: "Owlet",
    // Unified provider (SMM, Game Topup, Number Rental, Proxies).
    supportedMethods: ["POLLING", "IMMEDIATE"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 30000,    // 30 seconds
    pollingTimeoutMinutes: 4320, // 72 hours
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://the-owlet.com/api/v2?action=status&order={orderId}",
    note: "Owlet unified API. Supports SMM (batch multi-status), Number rental (poll_otp), Game topups, Proxies.",
  },
  // Backward compatibility alias for legacy transactions
  owlet_talktiyu: {
    code: "owlet_talktiyu",
    name: "Owlet Talktiyu",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 15000,    // 15 seconds
    pollingTimeoutMinutes: 20,   // 20 minutes
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://the-owlet.com/api/v2?action=poll_otp&order={orderId}",
    note: "Legacy reference preserved for backward-compatibility.",
  },
  smmfollows: {
    code: "smmfollows",
    name: "SmmFollows",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 30000,    // 30 seconds
    pollingTimeoutMinutes: 4320, // 72 hours
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://smmfollows.com/api/v2?action=status&order={orderId}",
    note: "SMM panel reseller (https://smmfollows.com). Supports batch status queries, refills, and cancellations. addOrder has no idempotency key — never auto-retry.",
  },
  smmresellerpanel: {
    code: "smmresellerpanel",
    name: "SmmResellerPanel",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 30000,    // 30 seconds
    pollingTimeoutMinutes: 4320, // 72 hours
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://smmresellerpanel.net/api/v2?action=status&order={orderId}",
    note: "SMM panel reseller (https://smmresellerpanel.net). Supports batch status queries, refills, and cancellations. addOrder has no idempotency key — never auto-retry.",
  },
  fivesim: {
    code: "fivesim",
    name: "5SIM",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 15000,    // 15 seconds
    pollingTimeoutMinutes: 20,   // 20 minutes
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://5sim.net/v1/user/check/{orderId}",
    note: "5SIM virtual phone number & SMS activation provider. Supports order verification, finish order rating boost, and cancellations.",
  },
  fleexa: {
    code: "fleexa",
    name: "Fleexa",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING",
    pollingIntervalMs: 20000,    // 20 seconds
    pollingTimeoutMinutes: 20,   // 20 minutes
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://fleexa.com.ng/developer/sms4/check/{orderId}",
    note: "Fleexa US virtual numbers, SMS verification, rentals, and disposable Email OTP.",
  },
  textverified: {
    code: "textverified",
    name: "Textverified",
    supportedMethods: ["POLLING", "WEBHOOK"],
    preferredMethod: "WEBHOOK",
    pollingIntervalMs: 15000,    // 15 seconds
    pollingTimeoutMinutes: 20,   // 20 minutes
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "https://www.textverified.com/api/pub/v2/verifications/{orderId}",
    note: "Textverified US Non-VoIP real carrier mobile numbers & SMS verifications.",
  },
};

// Backward-compatibility alias
export const BILL_PAYMENT_PROVIDER_CONFIG = SERVICE_PROVIDER_CONFIG;

export function getProviderConfig(providerCode: string) {
  let code = providerCode.toLowerCase();
  if (code === "safehaven") code = "savehaven";
  if (code === "5sim") code = "fivesim";
  if (code === "flexa") code = "fleexa";
  return SERVICE_PROVIDER_CONFIG[
    code as keyof typeof SERVICE_PROVIDER_CONFIG
  ];
}

export function shouldPollProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("POLLING") ?? false;
}

export function shouldUseWebhookProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("WEBHOOK") ?? false;
}

export function isImmediateResponseProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("IMMEDIATE") ?? false;
}

export function requiresImmediateFirstPoll(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return (config as any)?.immediateFirstPoll === true;
}
