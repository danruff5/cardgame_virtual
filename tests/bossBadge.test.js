import { describe, expect, it } from 'vitest';
import { renderMonsterCard } from '../src/ui/cardView.js';
import { BOSSES, MONSTERS } from '../src/data/index.js';

describe('boss card badge (virtual_26)', () => {
  const bossId = BOSSES[0].id;

  it('defaults to FLOOR 1 BOSS', () => {
    expect(renderMonsterCard(bossId, { size: 'mini', isBoss: true })).toContain('FLOOR 1 BOSS');
  });

  it.each([2, 3])('reflects floor %i', (n) => {
    const html = renderMonsterCard(bossId, { size: 'mini', isBoss: true, floorNumber: n });
    expect(html).toContain(`FLOOR ${n} BOSS`);
    expect(html).not.toContain('FLOOR 1 BOSS');
  });

  it('keeps MONSTER badge for non-boss cards', () => {
    expect(renderMonsterCard(MONSTERS[0].id, { size: 'mini', floorNumber: 2 })).not.toContain('BOSS');
  });
});
