export enum PaymentMethod {
  BANK_TRANSFER = "bank_transfer",
  CARD = "card",
  MOBILE_MONEY = "mobile_money",
}

export enum PaymentProvider {
  SAVEHAVEN = "saveHaven",
  MONNIFY = "monnify",
  FLUTTERWAVE = "flutterwave",
  XIXAPAY = "xixapay",
  MANUAL = "manual",
}

// Provider capabilities mapping
export const PROVIDER_PAYMENT_METHODS: Record<
  PaymentProvider,
  PaymentMethod[]
> = {
  [PaymentProvider.SAVEHAVEN]: [
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.CARD,
  ],
  [PaymentProvider.MONNIFY]: [PaymentMethod.BANK_TRANSFER, PaymentMethod.CARD],
  [PaymentProvider.FLUTTERWAVE]: [
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.CARD,
    PaymentMethod.MOBILE_MONEY,
  ],
   [PaymentProvider.XIXAPAY]: [PaymentMethod.BANK_TRANSFER],
  [PaymentProvider.MANUAL]: [PaymentMethod.BANK_TRANSFER],
};

// Payment response interfaces
export interface BankTransferPaymentResponse {
  method: PaymentMethod.BANK_TRANSFER;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode?: string;
  expiresAt?: string;
  reference: string;
}

export interface CardPaymentResponse {
  method: PaymentMethod.CARD;
  paymentUrl: string;
  reference: string;
  expiresAt?: string;
}

export interface MobileMoneyPaymentResponse {
  method: PaymentMethod.MOBILE_MONEY;
  paymentUrl: string;
  reference: string;
  provider: string;
}

export type PaymentMethodResponse =
  | BankTransferPaymentResponse
  | CardPaymentResponse
  | MobileMoneyPaymentResponse;

export interface InitializePaymentDTO {
  userId: string;
  amount: number;
  method: PaymentMethod;
  provider: PaymentProvider;
}

export interface PaymentInitializationResult {
  reference: string;
  amount: number;
  serviceCharge: number;
  amountYouWillReceive: number;
  provider: PaymentProvider;
  paymentDetails: PaymentMethodResponse;
  chargeInfo: {
    serviceCharge: number;
    chargeType?: string;
    chargeValue?: number;
    isServiceChargeCapped?: boolean;
  };
}
