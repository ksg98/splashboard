export {
  DESKTOP_ONLY_MESSAGE,
  TerminalController,
  binaryStringToBytes,
  createTerminalController,
  type ClipboardLike,
  type DisposeOptions,
  type TerminalControllerOptions,
  type TerminalStatus,
} from './controller';
export {
  ALLOWED_PROGRAMS,
  PtyError,
  decodePtyMessage,
  tauriPty,
  type AllowedProgram,
  type PtyApi,
  type PtyEvent,
  type PtyExit,
  type PtyLaunch,
  type PtySessionInfo,
  type PtySize,
} from './pty';
export {
  CommandLineError,
  buildSplashCommandLaunch,
  splitCommandLine,
  type SplashCommandOptions,
} from './splash-command';
