export interface EmailColors {
  primary: string;
  secondary: string;
  success: string;
  error: string;
  warning: string;
  critical: string;
  textPrimary: string;
  textSecondary: string;
  bgPrimary: string;
  bgLight: string;
  bgLighter: string;
}

export const emailColors: EmailColors = {
  primary: process.env.EMAIL_COLOR_PRIMARY || "0066CC", // Blue
  secondary: process.env.EMAIL_COLOR_SECONDARY || "FF9900", // Orange
  success: process.env.EMAIL_COLOR_SUCCESS || "00AA00", // Green
  error: process.env.EMAIL_COLOR_ERROR || "CC0000", // Red
  warning: process.env.EMAIL_COLOR_WARNING || "FFAA00", // Yellow/Amber
  critical: process.env.EMAIL_COLOR_CRITICAL || "990000", // Dark Red
  textPrimary: process.env.EMAIL_COLOR_TEXT_PRIMARY || "000000", // Black
  textSecondary: process.env.EMAIL_COLOR_TEXT_SECONDARY || "666666", // Gray
  bgPrimary: process.env.EMAIL_COLOR_BG_PRIMARY || "FFFFFF", // White
  bgLight: process.env.EMAIL_COLOR_BG_LIGHT || "F5F5F5", // Light Gray
  bgLighter: process.env.EMAIL_COLOR_BG_LIGHTER || "EEEEEE", // Lighter Gray
};
