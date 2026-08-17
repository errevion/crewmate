import { Command } from 'commander';
import { registerBriefCommand } from './commands/brief.js';
import { registerInitCommand } from './commands/init.js';

const program = new Command();

program.name('crewmate').description('AI agent workflow CLI tool').version('0.1.0');

registerBriefCommand(program);
registerInitCommand(program);

program.parse();
