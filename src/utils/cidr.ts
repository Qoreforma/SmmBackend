import ipaddr from "ipaddr.js";

export const isIpInCidrs = (ip: string, cidrs: string[]): boolean => {
  if (!cidrs || cidrs.length === 0) return false;

  try {
    const parsedIp = ipaddr.parse(ip);
    for (const cidr of cidrs) {
      try {
        const parsedCidr = ipaddr.parseCIDR(cidr);
        if (parsedIp.kind() === parsedCidr[0].kind() && (parsedIp as any).match(parsedCidr)) {
          return true;
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    return false;
  }
  return false;
};

export const getClientIp = (req: any): string => {
  // SECURITY (H5): previously read the client-supplied X-Forwarded-For
  // header directly, which is fully attacker-controlled (trivial to spoof
  // with curl/Postman) and defeated the admin mid-session IP-allowlist
  // recheck in adminAuth.ts. req.ip is trust-proxy aware (app.ts sets
  // `app.set("trust proxy", 1)`) and resolves the real client IP safely.
  return req.ip || req.socket.remoteAddress || "unknown";
};
