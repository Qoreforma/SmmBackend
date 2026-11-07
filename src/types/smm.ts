// ============================================================================
// Nigeria SMM — Type Definitions
// ============================================================================

/**
 * A single service item returned by action=services.
 * Note: the provider uses both "service" and "services" as the id field — both
 * are handled by the adapter.
 */
export interface NigeriaSmmServiceItem {
  service?: number | string;   // id field (may be "service" OR "services")
  services?: number | string;  // id field (alternate casing in some responses)
  category?: string;           // actual key returned by Nigeria SMM API v2
  Category?: string;           // capitalized fallback
  name: string;                // product display name
  type: string;                // e.g. "Default", "Custom Comments", "Subscriptions"
  rate: string | number;       // price per 1,000 units (native provider currency, e.g. NGN)
  min: string | number;        // minimum order quantity
  max: string | number;        // maximum order quantity
  description?: string;
  dripfeed?: boolean;
  refill?: boolean;
  cancel?: boolean;
}

/** Normalised service item with the id resolved to a single field. */
export interface NigeriaSmmServiceItemNormalised {
  id: number;                  // resolved from service || services
  category: string;
  name: string;
  type: string;
  rate: number;                // parsed from rate
  rateUsd: number;             // parsed from rate (kept for backward compatibility)
  rateNgn?: number;            // parsed from rate for NGN-native providers (Owlet)
  min: number;                 // parsed from min
  max: number;                 // parsed from max
  refill?: boolean;
  cancel?: boolean;
}

/** Request payload for action=add (place order). */
export interface NigeriaSmmOrderRequest {
  service: number;             // Nigeria SMM numeric service id (legacyProductId)
  link: string;                // target URL / handle
  quantity: number;            // number of units (must be within min/max)
}

/** Response for a successful action=add. */
export interface NigeriaSmmOrderResponse {
  order: number;               // Nigeria SMM order id
}

/** Single order status returned by action=status. */
export interface NigeriaSmmOrderStatus {
  charge: string | number;     // USD amount charged for this order
  start_count: string | number;
  status: NigeriaSmmStatus;
  remains: string | number;
  currency: string;            // should be "USD"
}

/** Keyed by order id when multi-status is used (comma-separated ids). */
export interface NigeriaSmmMultiOrderStatus {
  [orderId: string]: NigeriaSmmOrderStatus | { error: string };
}

/** All status values documented by Nigeria SMM. */
export type NigeriaSmmStatus =
  | "Pending"
  | "In progress"
  | "Processing"
  | "Completed"
  | "Partial"
  | "Canceled";

/** Response for action=balance. */
export interface NigeriaSmmBalance {
  balance: string | number;   // USD balance
  currency: string;
}

/** Response for action=refill. */
export interface NigeriaSmmRefillResponse {
  success: string;
}

/** Response for action=cancel. */
export interface NigeriaSmmCancelResponse {
  success: string;
}

// ============================================================================
// SMM Checkout DTO — used by SmmService.placeOrder()
// ============================================================================

export interface SmmOrderData {
  userId: string;
  productId: string;          // MongoDB Product._id
  link: string;               // target social media URL / handle
  quantity: number;           // user-supplied; validated against product min/max
  channel?: string;
  target?: string;
  gender?: "male" | "female" | "all" | "any";
  region?: string;
  comments?: string;
  comment_gender?: "male" | "female" | "all" | "any";
  comment_instructions?: string;
  duration?: number;
  start_count?: number;
  start_screenshot?: string;
  answer_number?: string | number;
  usernames?: string;
  runs?: number;
  interval?: number;
  sabiFields?: SmmSabiOrderFields;
}

export interface SmmOrderResult {
  transaction: any;
  providerOrderId: number;
  totalNgn: number;
  status: "success" | "pending" | "pending_manual";
}

// ============================================================================
// SMM Platforms & Product Types Definitions
// ============================================================================

export interface SmmPlatformDefinition {
  name: string;
  code: string;
  logo: string;
  displayOrder: number;
}

export const SMM_PLATFORMS: SmmPlatformDefinition[] = [
  {
    name: "Instagram",
    code: "smm-instagram",
    logo: "https://img.icons8.com/color/480/instagram-new--v1.png",
    displayOrder: 1,
  },
  {
    name: "Facebook",
    code: "smm-facebook",
    logo: "https://img.icons8.com/color/480/facebook-new.png",
    displayOrder: 2,
  },
  {
    name: "Threads",
    code: "smm-threads",
    logo: "https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/threads-app-icon.png",
    displayOrder: 3,
  },
  {
    name: "TikTok",
    code: "smm-tiktok",
    logo: "https://img.icons8.com/color/480/tiktok--v1.png",
    displayOrder: 4,
  },
  {
    name: "Twitter / X",
    code: "smm-twitter",
    logo: "https://img.icons8.com/color/480/twitterx--v1.png",
    displayOrder: 5,
  },
  {
    name: "YouTube",
    code: "smm-youtube",
    logo: "https://img.icons8.com/color/480/youtube-play.png",
    displayOrder: 6,
  },
  {
    name: "Telegram",
    code: "smm-telegram",
    logo: "https://img.icons8.com/color/480/telegram-app.png",
    displayOrder: 7,
  },
  {
    name: "Spotify",
    code: "smm-spotify",
    logo: "https://img.icons8.com/color/480/spotify--v1.png",
    displayOrder: 8,
  },
  {
    name: "LinkedIn",
    code: "smm-linkedin",
    logo: "https://img.icons8.com/color/480/linkedin.png",
    displayOrder: 9,
  },
];

export function resolveSmmPlatformCode(category: string = "", name: string = ""): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes("threads")) return "smm-threads";
  if (text.includes("instagram") || text.includes(" ig ") || text.startsWith("ig ")) return "smm-instagram";
  if (text.includes("facebook") || text.includes(" fb ") || text.startsWith("fb ")) return "smm-facebook";
  if (text.includes("tiktok")) return "smm-tiktok";
  if (text.includes("twitter") || /\bx\b/.test(text)) return "smm-twitter";
  if (text.includes("youtube") || text.includes("yt")) return "smm-youtube";
  if (text.includes("telegram") || text.includes("tg")) return "smm-telegram";
  if (text.includes("spotify")) return "smm-spotify";
  if (text.includes("linkedin")) return "smm-linkedin";
  return "smm-instagram";
}

export function resolveSmmProductType(category: string = "", name: string = ""): string {
  const text = `${category} ${name}`.toLowerCase();
  if (/follower|subscriber/.test(text)) return "Followers";
  if (/like/.test(text)) return "Likes";
  if (/reaction/.test(text)) return "Reactions";
  if (/view|reel|story|live|impression/.test(text)) return "Views";
  if (/comment/.test(text)) return "Comments";
  if (/share|save|mention|repost/.test(text)) return "Shares & Saves";
  if (/member|group/.test(text)) return "Members";
  return "Other";
}

// ============================================================================
// Owlet API — Extended Type Definitions
// Owlet uses the same v2 SMM API shape as NigeriaSMM with additions for SABI.
// ============================================================================

/**
 * Owlet service item — extends NigeriaSmmServiceItem with SABI engagement fields.
 * mode:"engagement" + proof:true + targetable:true marks a SABI real-people service.
 */
export interface OwletSmmServiceItem extends NigeriaSmmServiceItem {
  mode?: "engagement" | string;   // "engagement" for SABI real-people services
  proof?: boolean;                // true if delivery screenshots are available
  targetable?: boolean;           // true if target/gender/region params are accepted
}

/**
 * Normalised Owlet service item — extends the base normalised type with SABI fields.
 */
export interface OwletSmmServiceItemNormalised extends NigeriaSmmServiceItemNormalised {
  mode?: string;
  proof?: boolean;
  targetable?: boolean;
}

/**
 * Optional SABI targeting fields that can be sent with an Owlet add order.
 * All fields are optional — omitting them produces a standard (nationwide) order.
 */
export interface SmmSabiOrderFields {
  target?: string;                // Handle, post URL, or contestant to target / vote for
  gender?: "male" | "female" | "any" | "all";
  region?: string;                // City or state (e.g. "Lagos", "Abuja")
  comments?: string;              // Custom comment text, one per line
  comment_gender?: "male" | "female" | "any" | "all";
  comment_instructions?: string;  // Brief for what commenters should say
  duration?: number;              // Live/watch minutes (where service supports it)
  start_count?: number;           // Current count before the order
  start_screenshot?: string;      // URL of "before" screenshot
}

/**
 * Owlet refill status response.
 * action=refill_status, refill=<id>
 */
export interface OwletSmmRefillStatusResponse {
  status: string; // "Pending" | "Completed" | "In progress" etc.
}

/**
 * A single proof entry returned by action=proofs (SABI orders).
 */
export interface OwletSmmProofEntry {
  status: "approved" | "pending" | string;
  count_before: string;
  count_after: string;
  image: string;        // Full URL served from Owlet
  before_image: string | null;
}

/**
 * Owlet proofs response.
 * action=proofs, order=<id>
 */
export interface OwletSmmProofsResponse {
  order: string | number;
  proofs: OwletSmmProofEntry[];
}

// ============================================================================
// SMMFollows API — Type Definitions
// ============================================================================

export interface SmmFollowsServiceItem {
  service: number | string;
  name: string;
  type: string;
  category: string;
  rate: string | number;
  min: string | number;
  max: string | number;
  refill?: boolean;
  cancel?: boolean;
}

export interface SmmFollowsOrderStatus {
  charge: string | number;
  start_count: string | number;
  status: string;
  remains: string | number;
  currency: string;
}

export interface SmmFollowsMultiOrderStatus {
  [orderId: string]: SmmFollowsOrderStatus | { error: string };
}

export interface SmmFollowsBalance {
  balance: string | number;
  currency: string;
}

export interface SmmFollowsRefillResponse {
  refill: string | number;
}

export interface SmmFollowsRefillStatusResponse {
  status: string;
}

export interface SmmFollowsCancelResponse {
  order: number | string;
  cancel?: string | number | { error: string };
}

// ============================================================================
// SMMResellerPanel API — Type Definitions
// ============================================================================

export interface SmmResellerPanelServiceItem {
  service: number | string;
  name: string;
  type: string;
  category: string;
  rate: string | number;
  min: string | number;
  max: string | number;
  refill?: boolean;
  cancel?: boolean;
}

export interface SmmResellerPanelOrderStatus {
  charge: string | number;
  start_count: string | number;
  status: string;
  remains: string | number;
  currency: string;
}

export interface SmmResellerPanelMultiOrderStatus {
  [orderId: string]: SmmResellerPanelOrderStatus | { error: string };
}

export interface SmmResellerPanelBalance {
  balance: string | number;
  currency: string;
}

export interface SmmResellerPanelRefillResponse {
  refill: string | number;
}

export interface SmmResellerPanelRefillStatusResponse {
  status: string;
}

export interface SmmResellerPanelCancelResponse {
  order: number | string;
  cancel?: string | number | { error: string };
}

