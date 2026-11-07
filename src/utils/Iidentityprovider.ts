export interface ValidationData {
  identificationType: "bvn" | "nin";
  value: string;
  firstname: string;
  lastname: string;
  middlename?: string;
  dateOfBirth: string; // YYYY-MM-DD
  phoneNumber?: string;
  selfieImageBase64?: string; // Optional for NIN verification with selfie
}

export interface ProviderKYCData {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  phoneNumber?: string;
  bvn?: string;
  nin?: string;
  gender?: string;
}

export interface ProviderValidationResponse {
  success: boolean;
  message: string;
  kycData?: ProviderKYCData;
}

export interface IIdentityProvider {
  validateIdentity(data: ValidationData): Promise<ProviderValidationResponse>;

  getProviderName(): string;
}
