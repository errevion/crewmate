import { Command } from 'commander';
import { registerBriefCommand } from './commands/brief.js';
import { registerInitCommand } from './commands/init.js';
import { registerTaskCommand } from './commands/task.js';
import { registerLockCommand } from './commands/lock.js';
import { registerArtifactCommand } from './commands/artifact.js';

const program = new Command();

program.name('crewmate').description('AI agent workflow CLI tool').version('0.1.0');

registerBriefCommand(program);
registerInitCommand(program);
registerTaskCommand(program);
registerLockCommand(program);
registerArtifactCommand(program);

program.parse();
