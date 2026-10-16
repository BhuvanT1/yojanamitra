/**
 * Create or update a reviewer account.
 *
 * Usage:
 *   npm run reviewer:add -- bhuvan
 *   npm run reviewer:add -- bhuvan --reset
 *
 * The password is read from stdin without echoing and never written to disk in
 * plain form, never logged, and never passed as an argument (argv is visible to
 * other processes on the machine).
 */

import { createInterface } from 'node:readline';
import { createUser, setPassword, listUsernames } from '../src/auth/users';

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdout = process.stdout as unknown as { write: (s: string) => boolean; _write?: unknown };
    const original = stdout.write.bind(stdout);
    let muted = false;
    (stdout as { write: (s: string) => boolean }).write = (s: string) => {
      if (muted && !s.includes(prompt)) return true;
      return original(s);
    };
    rl.question(prompt, (answer) => {
      (stdout as { write: (s: string) => boolean }).write = original;
      original('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const username = args.find((a) => !a.startsWith('--'));

  if (!username) {
    console.log('usage: npm run reviewer:add -- <username> [--reset]');
    console.log('existing reviewers:', listUsernames().join(', ') || '(none)');
    process.exit(1);
  }

  const password = await askHidden(`password for "${username}" (min 8 chars): `);
  const again = await askHidden('confirm: ');
  if (password !== again) {
    console.error('passwords did not match');
    process.exit(1);
  }

  try {
    if (reset) {
      setPassword(username, password);
      console.log(`password reset for "${username}" — all existing sessions revoked`);
    } else {
      createUser(username, password);
      console.log(`reviewer "${username}" created`);
    }
    console.log('sign in at http://localhost:5173/en/login');
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
