/**
 * The "run a splash command" escape hatch: any `splash ...` command line in a
 * terminal, for flags the UI does not offer yet. Rust only ever runs the
 * splash binary for it (`pty_spawn_splash`).
 */
import type { PtyLaunch } from './pty';

export class CommandLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandLineError';
  }
}

/**
 * Splits a command line the way a POSIX shell splits words: whitespace,
 * 'single quotes', "double quotes" (with \" \\ \$ \` escapes) and backslash
 * escapes. No expansion, globbing, pipes or variables: the result is argv.
 */
export function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < input.length && '"\\$`'.includes(input.charAt(i + 1))) {
        word += input.charAt(++i);
      } else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\') {
      if (i + 1 < input.length) {
        const next = input.charAt(++i);
        // A backslash-newline continues the line.
        if (next !== '\n') word += next;
        inWord = true;
      }
    } else if (/\s/.test(c)) {
      if (inWord) out.push(word);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quote) throw new CommandLineError(`unclosed ${quote} quote`);
  if (inWord) out.push(word);
  return out;
}

export interface SplashCommandOptions {
  cwd?: string | null;
  env?: Record<string, string>;
}

/**
 * The launch for a typed splash command. A leading `splash` (or a path to
 * it) is optional: "serve --help" and "splash serve --help" are the same.
 */
export function buildSplashCommandLaunch(
  input: string | string[],
  options: SplashCommandOptions = {},
): PtyLaunch {
  const argv = typeof input === 'string' ? splitCommandLine(input) : [...input];
  const first = argv[0];
  if (first !== undefined && (first === 'splash' || first.endsWith('/splash'))) argv.shift();
  if (argv.length === 0) throw new CommandLineError('enter a splash command, e.g. "--help"');
  const launch: PtyLaunch = { kind: 'splash', args: argv };
  if (options.cwd) launch.cwd = options.cwd;
  if (options.env && Object.keys(options.env).length > 0) launch.env = { ...options.env };
  return launch;
}
