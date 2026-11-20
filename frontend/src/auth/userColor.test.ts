import { describe, expect, it } from 'vitest';
import { COLLABORATOR_COLORS, colorForUser, NEUTRAL_USER_COLOR } from './userColor';

describe('colorForUser', () => {
  it('gives the same user the same palette color every time', () => {
    const id = '408029ea-c974-4312-9a73-d29bb748bfff';
    expect(colorForUser(id)).toBe(colorForUser(id));
    expect(COLLABORATOR_COLORS).toContain(colorForUser(id));
  });

  it('spreads different users across the palette', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, index) => colorForUser(`user-${index}`)));
    expect(colors.size).toBeGreaterThan(3);
  });

  it('uses a neutral color before sign-in', () => {
    expect(colorForUser('')).toBe(NEUTRAL_USER_COLOR);
  });
});
