// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = resolve(import.meta.dir, '../..');
const target = 'crates/screenpipe-core/assets/extensions/orphan-guard.ts';
function source(ref) {
  const result = spawnSync('git', ['show', `${ref}:${target}`], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
const parent = source('3aea8df68f66d3a20e19093be47432b3bee476cf');
const fixed = source('686a2c9058f702ae9f6acfbf97c306281272d7b8');
const current = readFileSync(join(repo, target), 'utf8');
const controls = [
 ['parent', parent, false], ['fix', fixed, true], ['current', current, true],
 ['unused-correct-helper', parent + '\nfunction unused(){return true;}\n', false],
 ['no-op', 'export default function () {}', false],
 ['all-stdin-disabled', fixed.replace('if (isRpcMode)', 'if (false)'), false],
 ['pid-change-disabled', fixed.replace('process.ppid !== parentPid', 'false'), false],
 ['missing-parent-disabled', fixed.replace('process.kill(parentPid, 0);', ''), false],
 ['equivalent-named-default', fixed.replace('export default function (pi: ExtensionAPI)', 'export default function guard(pi: ExtensionAPI)'), true],
 ['equivalent-mode-selector', fixed.replace('process.argv.includes("--mode") &&\n    process.argv[process.argv.indexOf("--mode") + 1] === "rpc"', 'process.argv.some((arg, i) => arg === "--mode" && process.argv[i + 1] === "rpc")'), true],
];
const fixture = readFileSync(join(import.meta.dir, 'graders/orphan-guard-stdin.test.ts.txt'));
for (const [name, body, accepted] of controls) test(name, () => {
  const dir = mkdtempSync(join(tmpdir(), 'orphan-calibration-'));
  try {
    mkdirSync(join(dir, 'crates/screenpipe-core/assets/extensions'), { recursive: true });
    writeFileSync(join(dir, target), body);
    writeFileSync(join(dir, 'eval-hidden-orphan.test.ts'), fixture);
    const result = spawnSync(process.execPath, ['test', './eval-hidden-orphan.test.ts'], { cwd: dir, encoding: 'utf8', timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stderr).toMatch(/8 expect\(\) calls/);
    expect(result.status === 0).toBe(accepted);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
