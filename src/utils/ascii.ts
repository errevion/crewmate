/**
 * ASCII art frames for the live workflow dashboard animation panel.
 */

export const SPINNERS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const LEFT_LABEL = 'FRONTMAN';
const SCENE_WIDTH = 46;

function railWithPackage(progress: number): string {
  const railLen = SCENE_WIDTH - LEFT_LABEL.length - 8;
  const maxPos = Math.max(1, railLen - 2);
  const paperPos = Math.round(Math.max(0, Math.min(1, progress)) * maxPos);

  let rail = '';
  for (let i = 0; i < railLen; i++) {
    if (i === paperPos) {
      rail += '( )';
    } else if (i === railLen - 1) {
      rail += '>';
    } else {
      rail += '-';
    }
  }
  return rail;
}

/**
 * Builds a single frame of the "Frontman hands off to a subagent" animation
 *
 * @param progress 0..1 position of the package along the rail
 * @param target The subagent the task is being handed to
 */
export function buildDispatchFrame(progress: number, target: string): string {
  const targetLabel = target.toUpperCase().slice(0, 10).padEnd(10);
  const rail = railWithPackage(progress);

  const row1 = ` ${LEFT_LABEL} ${rail} ${targetLabel}`;
  const row2 = `   (o)${' '.repeat(rail.length + 2)}(o)`;
  const row3 = `  /|\\${' '.repeat(rail.length + 4)}/|\\`;
  const row4 = ` / | \\${' '.repeat(rail.length + 4)}/ | \\`;

  return [row1, row2, row3, row4].join('\n');
}

/**
 * Builds the scene shown while work is underway (spinner per active worker)
 *
 * @param activeWork Entries describing currently active subagents
 */
export function buildWorkScene(activeWork: Array<{ label: string; spinner: string }>): string {
  const lines: string[] = [];
  if (activeWork.length === 0) {
    lines.push('   FRONTMAN                    EXECUTOR');
    lines.push('     (o)                        (o)');
    lines.push('    /|\\                        /|\\');
    lines.push('   / | \\                      / | \\');
    lines.push('');
    lines.push('   No active tasks — waiting for dispatch...');
    return lines.join('\n');
  }

  lines.push(`   FRONTMAN                    EXECUTOR`);
  lines.push(`     (o)                        (o)`);
  lines.push(`    /|\\                        /|\\`);
  lines.push(`   / | \\                      / | \\`);
  lines.push('');
  for (const work of activeWork) {
    lines.push(`   ${work.spinner} ${work.label}`);
  }
  return lines.join('\n');
}
