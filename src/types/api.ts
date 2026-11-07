export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface AuthResponse {
  user: {
    id: string;
    firstname: string;
    lastname: string;
    email: string;
    username?: string;
    refCode?: string;
  };
  accessToken: string;
  refreshToken: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  details?: any;
  timestamp: string;
  path: string;
}
