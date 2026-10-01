/**
 * City normalization and matching utilities for Frientables.
 */

export function normalizeCityName(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (lower === "bangalore" || lower === "bengaluru") return "Bengaluru";
  if (lower === "bombay" || lower === "mumbai") return "Mumbai";
  if (lower === "madras" || lower === "chennai") return "Chennai";
  if (lower === "calcutta" || lower === "kolkata") return "Kolkata";
  if (lower === "delhi ncr" || lower === "delhi" || lower === "new delhi") return "Delhi NCR";

  // Title-case capitalization for words (e.g. "phagwara" -> "Phagwara", "ludhiana" -> "Ludhiana")
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Returns candidate string variants for database queries to ensure 100% case-insensitive matching.
 */
export function getCityMatchCandidates(city: string): string[] {
  const normalized = normalizeCityName(city);
  const trimmed = city.trim();
  const lower = trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();

  const candidates = new Set<string>([normalized, trimmed, lower, upper]);

  if (normalized === "Bengaluru") {
    candidates.add("Bangalore");
    candidates.add("bangalore");
    candidates.add("bengaluru");
  } else if (normalized === "Mumbai") {
    candidates.add("Bombay");
    candidates.add("bombay");
    candidates.add("mumbai");
  } else if (normalized === "Chennai") {
    candidates.add("Madras");
    candidates.add("madras");
    candidates.add("chennai");
  } else if (normalized === "Kolkata") {
    candidates.add("Calcutta");
    candidates.add("calcutta");
    candidates.add("kolkata");
  } else if (normalized === "Delhi NCR") {
    candidates.add("Delhi");
    candidates.add("delhi");
    candidates.add("New Delhi");
  }

  return Array.from(candidates);
}
