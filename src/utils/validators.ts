export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  const phoneRegex = /^\+?[\d\s-()]+$/;
  return phoneRegex.test(phone);
};

export const isValidPassword = (password: string): boolean => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  return passwordRegex.test(password);
};

export const isValidUsername = (username: string): boolean => {
  // Alphanumeric and underscores, 3-20 characters
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

import dns from "dns";
import net from "net";

const isPrivateOrReservedIp = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
    if (lower.startsWith("::ffff:")) {
      const embedded = lower.split(":").pop()!;
      if (net.isIPv4(embedded)) return isPrivateOrReservedIp(embedded);
    }
    return false;
  }
  return true; // not a recognizable IP → treat as unsafe
};

// Rejects localhost, private ranges, link-local, and the cloud metadata
// address for any hostname a partner submits as a webhook URL.
// Re-run this at send time too, since DNS can change between save and send.
export const isSafeWebhookUrl = async (rawUrl: string): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    return false;
  }

  if (net.isIP(hostname)) {
    return !isPrivateOrReservedIp(hostname);
  }

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((addr) => !isPrivateOrReservedIp(addr.address));
  } catch {
    return false; // can't resolve → reject rather than risk it
  }
};
