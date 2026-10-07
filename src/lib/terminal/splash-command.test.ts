import { describe, expect, it } from 'vitest';
import { CommandLineError, buildSplashCommandLaunch, splitCommandLine } from './splash-command';

describe('splitCommandLine', () => {
  it('splits on whitespace', () => {
    expect(splitCommandLine('  serve   --model  a/b ')).toEqual(['serve', '--model', 'a/b']);
    expect(splitCommandLine('')).toEqual([]);
  });

  it('handles quotes and escapes like a shell', () => {
    expect(splitCommandLine(`claude -p 'say "hi"'`)).toEqual(['claude', '-p', 'say "hi"']);
    expect(splitCommandLine(`a "b \\"c\\" \\n" d\\ e`)).toEqual(['a', 'b "c" \\n', 'd e']);
    expect(splitCommandLine(`x '' ""`)).toEqual(['x', '', '']);
    expect(splitCommandLine('a \\\nb')).toEqual(['a', 'b']);
    expect(splitCommandLine('--x=$HOME;rm')).toEqual(['--x=$HOME;rm']);
  });

  it('rejects an unclosed quote', () => {
    expect(() => splitCommandLine(`serve 'oops`)).toThrow(CommandLineError);
  });
});

describe('buildSplashCommandLaunch', () => {
  it('runs through the splash binary, with or without the leading word', () => {
    expect(buildSplashCommandLaunch('splash serve --help')).toEqual({
      kind: 'splash',
      args: ['serve', '--help'],
    });
    expect(buildSplashCommandLaunch('/opt/homebrew/bin/splash --version').args).toEqual([
      '--version',
    ]);
    expect(buildSplashCommandLaunch(['models', 'list']).args).toEqual(['models', 'list']);
  });

  it('passes cwd and env', () => {
    expect(buildSplashCommandLaunch('pi', { cwd: '/tmp/p', env: { SPLASH_PORT: '8001' } })).toEqual(
      { kind: 'splash', args: ['pi'], cwd: '/tmp/p', env: { SPLASH_PORT: '8001' } },
    );
  });

  it('needs a command', () => {
    expect(() => buildSplashCommandLaunch('splash')).toThrow(CommandLineError);
    expect(() => buildSplashCommandLaunch('   ')).toThrow(CommandLineError);
  });
});
