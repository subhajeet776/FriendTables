import crypto from "crypto";

const OTP_SECRET = process.env.JWT_SECRET || "frientables_otp_salt_2026";

/**
 * Generate a cryptographically secure 6-digit OTP code string using CSPRNG
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP string securely using SHA-256 HMAC
 */
export function hashOtp(otp: string): string {
  return crypto
    .createHmac("sha256", OTP_SECRET)
    .update(otp.trim())
    .digest("hex");
}

/**
 * Compare raw OTP with stored OTP hash securely in constant time
 */
export function verifyOtpHash(rawOtp: string, storedHash: string): boolean {
  if (!rawOtp || !storedHash) return false;
  const computedHash = hashOtp(rawOtp);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}
