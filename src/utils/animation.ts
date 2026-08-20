/**
 * Easing and animation timing functions for smooth visual transitions
 */

/**
 * Standard cubic ease-in-out curve
 * Accelerates from zero velocity, peaks in the middle, and decelerates to zero
 */
export function easeInOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Quadratic ease-in-out curve for slightly gentler acceleration
 */
export function easeInOutQuad(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}
