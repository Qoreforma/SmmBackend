export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ProviderResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  statusCode?: number;
  error?: string;
  reference?: string;
  pending?: boolean;
  status?: string;
  providerCode?: string;
  providerReference?: string;
  token?: string;
  meta?: any;
}

export interface PaginatedData<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}
