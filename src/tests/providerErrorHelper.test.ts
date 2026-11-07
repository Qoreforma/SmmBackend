import {
  extractUserFriendlyErrorMessage,
  getRawProviderErrorMessage,
  USER_FRIENDLY_ERROR_RULES,
} from "../utils/providerErrorHelper";

describe("Provider Error Helper & User-Friendly Translation", () => {
  describe("Bilalsadasub Real-World Error Shapes", () => {
    it("should translate 'Product mismatched. User is not allowed to buy this product' into friendly eligibility message", () => {
      const response = {
        system: "API",
        wallet_vending: "WALLET",
        plan_type: "GIFTING",
        response:
          "Product mismatched. User is not allowed to buy this product Transaction ID: ",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe(
        "You are not eligible for this offer. Please try another plan or another phone number.",
      );
    });

    it("should translate 'Dear customer, you are not eligible for this offer...' into friendly eligibility message", () => {
      const response = {
        oldbal: 5924.2,
        newbal: 5674.2,
        system: "API",
        wallet_vending: "WALLET",
        plan_type: "GIFTING",
        response:
          "Dear customer, you are not eligible for this offer. please try another plan, or another number",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe(
        "You are not eligible for this offer. Please try another plan or another phone number.",
      );
    });
  });

  describe("Network Mismatch & Ported Numbers", () => {
    it("should detect wrong network errors and map to friendly network message", () => {
      const response = {
        message: "This phone number does not belong to MTN. Number is ported.",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe(
        "This phone number does not belong to the selected network. Please check the network and try again.",
      );
    });
  });

  describe("Barred & Restricted Phone Numbers", () => {
    it("should map barred phone number errors to friendly carrier barred message", () => {
      const response = {
        message: "MSISDN is barred from receiving data bundles",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe(
        "This phone number is currently barred from receiving data on this network. Please contact your network provider.",
      );
    });
  });

  describe("Invalid Phone Numbers", () => {
    it("should map invalid phone errors to friendly validation message", () => {
      const response = {
        error: "Invalid phone number provided",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe(
        "The phone number entered is invalid. Please check the number and try again.",
      );
    });
  });

  describe("Technical & Sensitive Error Protection (Safe Generic Fallback)", () => {
    it("should return generic message for SQL and database errors", () => {
      const response = {
        message: "Database connection failure: SQL syntax error near SELECT",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe("Data purchase failed. Please try again later.");
    });

    it("should return generic message for API credentials or IP whitelist errors", () => {
      const response = {
        message: "Invalid API key or IP address not whitelisted",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Data purchase");
      expect(friendlyMessage).toBe("Data purchase failed. Please try again later.");
    });

    it("should return generic message for internal provider wallet balance issues", () => {
      const response = {
        message: "Insufficient wallet balance in provider account",
      };

      const friendlyMessage = extractUserFriendlyErrorMessage(response, "Airtime purchase");
      expect(friendlyMessage).toBe("Airtime purchase failed. Please try again later.");
    });

    it("should handle null or undefined payloads safely", () => {
      expect(extractUserFriendlyErrorMessage(null, "Data purchase")).toBe(
        "Data purchase failed. Please try again later.",
      );
      expect(extractUserFriendlyErrorMessage(undefined, "Airtime purchase")).toBe(
        "Airtime purchase failed. Please try again later.",
      );
    });
  });

  describe("Raw Message Extraction Helper", () => {
    it("should strip trailing Transaction ID artifacts from raw messages", () => {
      const raw = getRawProviderErrorMessage({
        response: "Product mismatched. User is not allowed to buy this product Transaction ID: 12345",
      });
      expect(raw).toBe(
        "Product mismatched. User is not allowed to buy this product",
      );
    });
  });

  describe("Extensibility of Rules", () => {
    it("should allow inspecting the configured rules list", () => {
      expect(Array.isArray(USER_FRIENDLY_ERROR_RULES)).toBe(true);
      expect(USER_FRIENDLY_ERROR_RULES.some((r) => r.id === "ineligible_offer")).toBe(
        true,
      );
    });
  });
});
