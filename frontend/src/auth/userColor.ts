/** Muted, readable colors that sit well on the cream UI. Each collaborator keeps the same color across sessions. */
export const COLLABORATOR_COLORS = ['#4f7d39', '#2f6f8f', '#a35f2c', '#7a4f9a', '#b0476a', '#3d7a6f'] as const;

export const NEUTRAL_USER_COLOR = '#726b5c';

export function colorForUser(userId: string): string {
  if (!userId) {
    return NEUTRAL_USER_COLOR;
  }
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length];
}
