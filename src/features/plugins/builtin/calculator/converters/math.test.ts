import { describe, it, expect } from 'vitest';
import { evaluateMathExpression } from './math';

describe('evaluateMathExpression', () => {
  describe('basic arithmetic', () => {
    it('adds', () => {
      expect(evaluateMathExpression('2+2')).toBe(4);
      expect(evaluateMathExpression('1.5 + 2.5')).toBe(4);
    });

    it('subtracts', () => {
      expect(evaluateMathExpression('10-3')).toBe(7);
      expect(evaluateMathExpression('5-10')).toBe(-5);
    });

    it('multiplies', () => {
      expect(evaluateMathExpression('3*4')).toBe(12);
    });

    it('divides', () => {
      expect(evaluateMathExpression('20/4')).toBe(5);
    });

    it('returns null for division by zero', () => {
      expect(evaluateMathExpression('5/0')).toBe(null);
    });

    it('handles modulo', () => {
      expect(evaluateMathExpression('10%3')).toBe(1);
    });

    it('returns null for modulo by zero', () => {
      expect(evaluateMathExpression('5%0')).toBe(null);
    });

    it('respects operator precedence', () => {
      expect(evaluateMathExpression('2+3*4')).toBe(14);
      expect(evaluateMathExpression('(2+3)*4')).toBe(20);
    });

    it('supports exponentiation with ^', () => {
      expect(evaluateMathExpression('2^10')).toBe(1024);
    });

    it('handles nested parentheses', () => {
      expect(evaluateMathExpression('((2+3)*(4-1))')).toBe(15);
    });
  });

  describe('scientific functions', () => {
    it('evaluates sqrt', () => {
      expect(evaluateMathExpression('sqrt(16)')).toBe(4);
      expect(evaluateMathExpression('sqrt(2)')).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('evaluates sin (degrees)', () => {
      expect(evaluateMathExpression('sin(0)')).toBeCloseTo(0, 5);
      expect(evaluateMathExpression('sin(90)')).toBeCloseTo(1, 5);
    });

    it('evaluates cos (degrees)', () => {
      expect(evaluateMathExpression('cos(0)')).toBeCloseTo(1, 5);
      expect(evaluateMathExpression('cos(180)')).toBeCloseTo(-1, 5);
    });

    it('evaluates tan (degrees)', () => {
      expect(evaluateMathExpression('tan(45)')).toBeCloseTo(1, 5);
    });

    it('evaluates log (base 10)', () => {
      expect(evaluateMathExpression('log(100)')).toBeCloseTo(2, 5);
      expect(evaluateMathExpression('log(1000)')).toBeCloseTo(3, 5);
    });

    it('evaluates ln (natural log)', () => {
      expect(evaluateMathExpression('ln(1)')).toBe(0);
    });

    it('evaluates abs', () => {
      expect(evaluateMathExpression('abs(10-20)')).toBe(10);
    });

    it('handles nested scientific functions', () => {
      expect(evaluateMathExpression('sqrt(abs(0-16))')).toBe(4);
    });
  });

  describe('constants', () => {
    it('substitutes pi', () => {
      expect(evaluateMathExpression('pi')).toBeCloseTo(Math.PI, 5);
    });

    it('substitutes e', () => {
      expect(evaluateMathExpression('e')).toBeCloseTo(Math.E, 5);
    });
  });

  describe('invalid input', () => {
    it('rejects non-math strings', () => {
      expect(evaluateMathExpression('hello world')).toBe(null);
    });

    it('rejects unbalanced parentheses', () => {
      expect(evaluateMathExpression('(2+3')).toBe(null);
      expect(evaluateMathExpression('2+3)')).toBe(null);
    });

    it('rejects dangerous patterns', () => {
      expect(evaluateMathExpression('2//3')).toBe(null);
      expect(evaluateMathExpression('2/*3')).toBe(null);
    });

    it('rejects attempts at code injection', () => {
      expect(evaluateMathExpression('alert(1)')).toBe(null);
      expect(evaluateMathExpression('process.exit')).toBe(null);
    });
  });
});
