// Owner: Yared (Engine). Makes a finished run self-contained: writes run_demo.py that exercises the final
// code with realistic sample data, verifies it runs in a Daytona sandbox, and returns it for the download.
import { callText } from './llm';
import { openSandbox } from './sandbox';

const SYSTEM = `You write run_demo.py for a small finished Python project so a user can SEE it working with one command.
- Use only the project's modules and the Python standard library. No network, no input().
- Exercise every main feature with realistic sample data and print clear, readable, nicely formatted output
  (headings, aligned tables where it fits). If the project is "live"/streaming, simulate a short stream in a loop
  with small sleeps that FINISHES within 10 seconds.
- Must exit with status 0. Show errors handled gracefully where the project raises them.
Reply with ONLY the file inside <file path="run_demo.py"> ... </file>.`;

export async function buildDemo(
  taskPrompt: string,
  files: Record<string, string>,
): Promise<{ demo: string; output: string } | null> {
  const code = Object.entries(files)
    .map(([p, c]) => `<file path="${p}">\n${c}\n</file>`)
    .join('\n\n');
  let feedback = '';
  for (const tier of ['sonnet', 'opus'] as const) {
    const res = await callText({
      tier,
      functionId: 'demo',
      system: SYSTEM,
      prompt: `TASK:\n${taskPrompt}\n\nPROJECT FILES:\n${code}${feedback}`,
      maxOutputTokens: 8000,
    });
    const demo = res.text.match(/<file path="run_demo\.py">\n?([\s\S]*?)\n?<\/file>/)?.[1];
    if (!demo) {
      feedback = '\n\nYour previous reply had no <file path="run_demo.py"> block.';
      continue;
    }
    const sandbox = await openSandbox();
    try {
      const run = await sandbox.test({ ...files, 'run_demo.py': `${demo}\n` }, {}, 'timeout 30 python run_demo.py', { maxOutput: 20_000 });
      if (run.passed) return { demo: `${demo}\n`, output: run.output };
      feedback = `\n\nYour previous run_demo.py failed when run:\n${run.output.slice(-1200)}\nFix it.`;
    } finally {
      await sandbox.close();
    }
  }
  return null;
}
