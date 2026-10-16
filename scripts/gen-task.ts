// Owner: Yared. Generate a decomposed task from a description: npx tsx scripts/gen-task.ts "description"
import '../core/env';
import { generateTask } from '../core/taskgen';

generateTask({ description: process.argv.slice(2).join(' ') }, (m) => console.log(`… ${m}`))
  .then((t) => console.log(`\n${t.id}\n${t.subtasks?.map((s, i) => `  ${i + 1}. [${s.kind} d${s.difficulty}] ${s.title}`).join('\n')}`))
  .catch((e) => { console.error(e); process.exit(1); });
