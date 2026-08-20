import { describe, it, expect } from 'vitest';
import { easeInOutCubic, easeInOutQuad } from '../src/utils/animation.js';

describe('animation easing functions', () => {
  describe('easeInOutCubic', () => {
    it('should start at 0 and end at 1', () => {
      expect(easeInOutCubic(0)).toBe(0);
      expect(easeInOutCubic(1)).toBe(1);
    });

    it('should pass through 0.5 at t=0.5', () => {
      expect(easeInOutCubic(0.5)).toBe(0.5);
    });

    it('should accelerate slowly at the beginning (t=0.1 has progress < 0.1)', () => {
      const progress = easeInOutCubic(0.1);
      expect(progress).toBeLessThan(0.1);
      expect(progress).toBeCloseTo(0.004, 3);
    });

    it('should decelerate at the end (t=0.9 has progress > 0.9)', () => {
      const progress = easeInOutCubic(0.9);
      expect(progress).toBeGreaterThan(0.9);
      expect(progress).toBeCloseTo(0.996, 3);
    });

    it('should clamp values below 0 and above 1', () => {
      expect(easeInOutCubic(-0.5)).toBe(0);
      expect(easeInOutCubic(1.5)).toBe(1);
    });
  });

  describe('easeInOutQuad', () => {
    it('should start at 0 and end at 1', () => {
      expect(easeInOutQuad(0)).toBe(0);
      expect(easeInOutQuad(1)).toBe(1);
    });

    it('should pass through 0.5 at t=0.5', () => {
      expect(easeInOutQuad(0.5)).toBe(0.5);
    });
  });
});
