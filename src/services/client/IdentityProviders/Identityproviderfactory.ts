import { MonnifyService } from "@/services/client/providers/payments/MonnifyService";
import logger from "@/logger";
import { IIdentityProvider } from "@/utils/Iidentityprovider";
import { DojahService } from "../providers/identityVerification/DojahService";
import { DojahIdentityProvider } from "./Dojahidentityprovider";
import { MonnifyIdentityProvider } from "./Monnifyidentityprovider";
import { QoreIDService } from "../providers/identityVerification/QoreidService";
import { QoreIDIdentityProvider } from "./Qoreididentityprovider";

export class IdentityProviderFactory {
  private static instance: IdentityProviderFactory;
  private provider: IIdentityProvider | null = null;
  private selectedProviderName: string | null = null;

  private constructor() {
    this.initializeProvider();
  }

  static getInstance(): IdentityProviderFactory {
    if (!IdentityProviderFactory.instance) {
      IdentityProviderFactory.instance = new IdentityProviderFactory();
    }
    return IdentityProviderFactory.instance;
  }

  private initializeProvider(): void {
    const providerName = (
      process.env.IDENTITY_VALIDATION_PROVIDER || ""
    ).toLowerCase();

    logger.info(
      `[IdentityProviderFactory] Initializing provider: ${providerName || "none (will skip validation)"}`,
    );

    switch (providerName) {
      case "dojah":
        this.provider = new DojahIdentityProvider(new DojahService());
        this.selectedProviderName = "dojah";
        logger.info("[IdentityProviderFactory] Dojah provider initialized");
        break;

      case "monnify":
        this.provider = new MonnifyIdentityProvider(new MonnifyService());
        this.selectedProviderName = "monnify";
        logger.info("[IdentityProviderFactory] Monnify provider initialized");
        break;

      case "qoreid":
        this.provider = new QoreIDIdentityProvider(new QoreIDService());
        this.selectedProviderName = "qoreid";
        logger.info("[IdentityProviderFactory] QoreID provider initialized");
        break;

      default:
        if (providerName) {
          logger.warn(
            `[IdentityProviderFactory] Unknown provider: ${providerName}. Skipping validation.`,
          );
        }
        this.provider = null;
        this.selectedProviderName = null;
        logger.info(
          "[IdentityProviderFactory] No provider configured. Identity validation will be skipped.",
        );
    }
  }

  //Get the configured identity provider
  //@returns The provider instance or null if no provider is configured
  getProvider(): IIdentityProvider | null {
    return this.provider;
  }

  //Check if a provider is configured
  hasProvider(): boolean {
    return this.provider !== null;
  }

  //Get the name of the selected provider
  getProviderName(): string | null {
    return this.selectedProviderName;
  }

  //Reinitialize the provider (useful for testing or dynamic configuration)
  reinitialize(): void {
    logger.info("[IdentityProviderFactory] Reinitializing provider");
    this.initializeProvider();
  }
}
