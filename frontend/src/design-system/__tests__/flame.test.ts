import {
  flameColors,
  getFlameColor,
  getFlameSize,
  getFlameGlow,
} from '../tokens/flame';

describe('getFlameColor', () => {
  it('returns cold color for very low consistency', () => {
    expect(getFlameColor(0)).toBe(flameColors.cold);
    expect(getFlameColor(5)).toBe(flameColors.cold);
    expect(getFlameColor(10)).toBe(flameColors.cold);
  });

  it('returns cool color for low consistency', () => {
    expect(getFlameColor(11)).toBe(flameColors.cool);
    expect(getFlameColor(25)).toBe(flameColors.cool);
  });

  it('returns warm color for moderate consistency', () => {
    expect(getFlameColor(26)).toBe(flameColors.warm);
    expect(getFlameColor(45)).toBe(flameColors.warm);
  });

  it('returns hot color for good consistency', () => {
    expect(getFlameColor(46)).toBe(flameColors.hot);
    expect(getFlameColor(65)).toBe(flameColors.hot);
  });

  it('returns blazing color for high consistency', () => {
    expect(getFlameColor(66)).toBe(flameColors.blazing);
    expect(getFlameColor(85)).toBe(flameColors.blazing);
  });

  it('returns inferno color for top consistency', () => {
    expect(getFlameColor(86)).toBe(flameColors.inferno);
    expect(getFlameColor(100)).toBe(flameColors.inferno);
  });
});

describe('getFlameSize', () => {
  it('returns xs for very low consistency', () => {
    expect(getFlameSize(0)).toBe('xs');
    expect(getFlameSize(15)).toBe('xs');
  });

  it('returns sm for low consistency', () => {
    expect(getFlameSize(16)).toBe('sm');
    expect(getFlameSize(35)).toBe('sm');
  });

  it('returns md for moderate consistency', () => {
    expect(getFlameSize(36)).toBe('md');
    expect(getFlameSize(60)).toBe('md');
  });

  it('returns lg for high consistency', () => {
    expect(getFlameSize(61)).toBe('lg');
    expect(getFlameSize(85)).toBe('lg');
  });

  it('returns xl for top consistency', () => {
    expect(getFlameSize(86)).toBe('xl');
    expect(getFlameSize(100)).toBe('xl');
  });
});

describe('getFlameGlow', () => {
  it('returns 0 for 0% consistency', () => {
    expect(getFlameGlow(0)).toBe(0);
  });

  it('returns 0.3 for 50% consistency', () => {
    expect(getFlameGlow(50)).toBe(0.3);
  });

  it('returns 0.6 for 100% consistency', () => {
    expect(getFlameGlow(100)).toBe(0.6);
  });

  it('clamps values above 100', () => {
    expect(getFlameGlow(200)).toBe(0.6);
  });
});
