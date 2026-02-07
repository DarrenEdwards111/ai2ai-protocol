#!/usr/bin/env node

/**
 * ai2ai — The open protocol for AI agents to talk to each other
 *
 * Usage:
 *   ai2ai init                    Interactive setup wizard
 *   ai2ai start                   Start the AI2AI server
 *   ai2ai connect <endpoint>      Connect to another agent
 *   ai2ai send <contact> <msg>    Send a message to a contact
 *   ai2ai pending                 Show pending messages
 *   ai2ai approve <id> [reply]    Approve a pending message
 *   ai2ai reject <id>             Reject a pending message
 *   ai2ai contacts                List known contacts
 *   ai2ai status                  Show server & agent status
 */

'use strict';

const HELP = `
🦞 ai2ai — Agent-to-Agent Communication Protocol

Usage:
  ai2ai init                       Set up your AI2AI identity
  ai2ai start                      Start the AI2AI server
  ai2ai connect <endpoint>         Connect to another agent
  ai2ai send <contact> <message>   Send a message to a contact
  ai2ai pending                    Show pending messages
  ai2ai approve <id> [reply]       Approve a pending message
  ai2ai reject <id>                Reject a pending message
  ai2ai contacts                   List known contacts
  ai2ai status                     Show server & agent status

Examples:
  ai2ai init
  ai2ai start
  ai2ai connect http://friend.example.com:18800/ai2ai
  ai2ai send alex "dinner next Thursday?"
  ai2ai pending
  ai2ai approve 1 "Thursday works for me"

Options:
  --help, -h     Show this help message
  --version, -v  Show version number
`;

const VERSION = '0.1.0';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(`ai2ai v${VERSION}`);
  process.exit(0);
}

const commands = {
  init:     () => require('../lib/init').run(),
  start:    () => require('../lib/start').run(),
  connect:  () => require('../lib/connect').run(args.slice(1)),
  send:     () => require('../lib/send').run(args.slice(1)),
  pending:  () => require('../lib/pending').run(),
  approve:  () => require('../lib/approve').run(args.slice(1)),
  reject:   () => require('../lib/approve').runReject(args.slice(1)),
  contacts: () => require('../lib/contacts').run(),
  status:   () => require('../lib/status').run(),
};

if (!commands[command]) {
  console.error(`\n❌ Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

// Run the command
Promise.resolve(commands[command]()).catch(err => {
  console.error(`\n❌ Error: ${err.message}\n`);
  if (process.env.AI2AI_DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
