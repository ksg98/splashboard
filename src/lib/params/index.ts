/**
 * Splash parameter catalog: typed docs/splash-params.json, version gating,
 * validation, presets, the engine_start ServeRequest contract and form models.
 */
export * from './types';
export {
  CatalogError,
  SECRET_ENV,
  getCatalog,
  isSecretEntry,
  parseCatalog,
  requestEntry,
  serveEntriesForServe,
  serveEntry,
} from './catalog';
export { compareVersions, isAvailable, unavailableReason, versionAtLeast } from './version';
export {
  GiB,
  KiB,
  MiB,
  effectiveServeValue,
  formatBytes,
  formatServeValue,
  formatSizeCli,
  formatTokensCli,
  isDefaultServeValue,
  normalizeServeValue,
  parseSize,
  parseTokens,
  serveDefaults,
} from './values';
export { parseModelId, resolveServeState, type FieldState, type ModelId } from './state';
export {
  gpuMemoryCapBytes,
  validateServeValues,
  type Issue,
  type IssueCode,
  type IssueLevel,
  type ValidationContext,
  type ValidationResult,
} from './validate';
export {
  DEFAULT_PORT,
  REDACTED,
  SECRET_ENV_ORDER,
  ServeRequestError,
  buildServeRequest,
  renderCommand,
  renderServe,
  secretsInValues,
  shellQuote,
  tryBuildServeRequest,
  type EnvVar,
  type FlagValue,
  type RenderOptions,
  type RenderedServe,
  type SecretEnvName,
  type ServeFlag,
  type ServeRequest,
} from './serve';
export {
  applyPreset,
  applyRequestPreset,
  diffRequestValues,
  diffServeValues,
  generateApiKey,
  listPresets,
  placeholderResolver,
  presetMinVersion,
  presetsForMac,
  previewPreset,
  ramGbFromBytes,
  ramTierFor,
  type ApplyResult,
  type ChangeSet,
  type MacPresets,
  type PendingInput,
  type PlaceholderResolver,
  type PresetOption,
  type SettingChange,
} from './presets';
export {
  defaultsFromCatalog,
  requestDefaultsFor,
  requestFieldsFor,
  validateRequestValues,
  type ModelCapabilities,
  type RequestFieldInfo,
} from './request-fields';
export {
  toFormModel,
  toFormModels,
  type FormBounds,
  type FormGroup,
  type FormModel,
  type FormOptions,
  type FormRow,
  type FormScope,
} from './form';
