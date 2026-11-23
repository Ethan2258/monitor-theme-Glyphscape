import { clsx, type ClassValue } from "clsx"

/**
 * Class names joined, the false and empty ones dropped. No conflict merging:
 * tailwind-merge was 27 kB of the first load for four components whose
 * defaults callers overrode, and those now take every contested property --
 * direction, gap, padding, colour, size -- from the caller instead. Two classes
 * for the same property on one element are a bug here, as their order in the
 * stylesheet, not in the attribute, decides.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
