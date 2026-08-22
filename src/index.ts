import { Command } from 'commander';
import { registerBriefCommand } from './commands/brief.js';
import { registerInitCommand } from './commands/init.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerTaskCommand } from './commands/task.js';
import { registerLockCommand } from './commands/lock.js';
import { registerArtifactCommand } from './commands/artifact.js';
import { registerEventCommand } from './commands/event.js';
import { registerActivityCommand } from './commands/activity.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerSessionCommand } from './commands/session.js';

const program = new Command();

program.name('crewmate').description('AI agent workflow CLI tool').version('0.2.1');

registerBriefCommand(program);
registerInitCommand(program);
registerUpdateCommand(program);
registerTaskCommand(program);
registerLockCommand(program);
registerArtifactCommand(program);
registerEventCommand(program);
registerActivityCommand(program);
registerWatchCommand(program);
registerSessionCommand(program);

program.parse();
