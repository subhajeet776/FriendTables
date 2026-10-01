/**
 * Utility functions for Phone Number Normalization and Masking
 */

export function normalizePhoneNumber(raw: string): string {
  if (!raw) return "";

  // Strip all whitespace, hyphens, parentheses
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, "").trim();

  // If starts with 0 and has 11 digits (Indian domestic with trunk prefix 0)
  if (/^0\d{10}$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }

  // If starts with 91 and has 12 digits (Indian without plus)
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // If 10 digits (standard Indian mobile number without country code)
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // If already starts with plus and digits
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // Fallback: prepend plus
  return `+${cleaned}`;
}

export function isValidPhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  // Standard E.164 format: + followed by 10 to 15 digits
  return /^\+[1-9]\d{9,14}$/.test(normalized);
}

export function maskPhoneNumber(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length <= 6) return normalized;
  const prefix = normalized.slice(0, 3); // e.g. +91
  const suffix = normalized.slice(-4);   // last 4 digits
  const maskedLength = normalized.length - prefix.length - suffix.length;
  const stars = "*".repeat(Math.max(2, maskedLength));
  return `${prefix}${stars}${suffix}`;
}
