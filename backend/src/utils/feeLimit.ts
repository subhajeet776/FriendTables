export type HostLevel = "NEW" | "RISING" | "TRUSTED" | "EXPERIENCED" | "ELITE";

export const HOST_FEE_LIMITS: Record<string, number> = {
  NEW: 99,
  RISING: 129,
  TRUSTED: 149,
  EXPERIENCED: 179,
  ELITE: 199,
};

/**
 * Returns the maximum allowed joining fee in INR for a given Host level.
 * Server-side source of truth for fee limits.
 */
export function getMaximumJoiningFee(hostLevel?: string | null): number {
  if (!hostLevel) return HOST_FEE_LIMITS.NEW;
  const levelUpper = hostLevel.toUpperCase();
  return HOST_FEE_LIMITS[levelUpper] ?? HOST_FEE_LIMITS.NEW;
}
