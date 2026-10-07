/*
 * Stateful demos for the form primitives, shown by forms.gallery.tsx.
 * Each one is a slice of a real form (Launch settings, Settings) so the
 * primitives are judged in context, light and dark.
 */
import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';
import { FormActionRow, FormGroup, FormRow, FormSection, FormTextButton, FormValue } from './Form';
import { PopUpButton } from './PopUpButton';
import { SearchField } from './SearchField';
import { SecureField } from './SecureField';
import { Segmented } from './Segmented';
import { Slider } from './Slider';
import { Stepper } from './Stepper';
import { Switch } from './Switch';
import { TextField } from './TextField';
import {
  appearanceOptions,
  cacheFootnote,
  commandFootnote,
  draftHelp,
  draftOptions,
  formatContext,
  formatGigabytes,
  formatMegapixels,
  formatSampling,
  hfTokenSample,
  kvOptions,
  listenOptions,
  maskedApiKey,
  memoryFootnote,
  memoryLimitOptions,
  modelOptions,
  networkFootnote,
  presetFootnote,
  presetOptions,
  replyShareSteps,
  revisionOptions,
  serveCommand,
  sheetSubtitle,
  thinkingOptions,
  timeLimitOptions,
  type AppearanceId,
  type DraftId,
  type KvFormat,
  type ListenId,
  type MemoryLimitId,
  type ModelId,
  type PresetId,
  type RevisionId,
  type ThinkingId,
  type TimeLimitId,
} from './forms.fixtures';

/** The sheet surface the forms sit on (640px, 24px padding), with its header. */
function Sheet({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100%',
        padding: '32px 16px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        background: 'var(--bg-window)',
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        style={{
          width: 640,
          maxWidth: '100%',
          padding: '20px 24px 24px',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--bg-sheet)',
          boxShadow: 'var(--shadow-sheet)',
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--text-title-3)',
              fontWeight: 'var(--weight-semibold)',
              lineHeight: '24px',
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)' }}>{subtitle}</p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Launch settings, part 1: preset, model, memory and context                  */
/* -------------------------------------------------------------------------- */

export function LaunchModelDemo() {
  const [preset, setPreset] = useState<PresetId>('recommended');
  const [model, setModel] = useState<ModelId>('qwen38-27b');
  const [draft, setDraft] = useState<DraftId>('auto');
  const [thinking, setThinking] = useState<ThinkingId>('default');
  const [textOnly, setTextOnly] = useState(false);
  const [offline, setOffline] = useState(false);
  const [memory, setMemory] = useState<MemoryLimitId>('auto');
  const [context, setContext] = useState(128);
  const [image, setImage] = useState(4.2);

  return (
    <Sheet title="Launch settings" subtitle={sheetSubtitle}>
      <FormSection footnote={presetFootnote}>
        <FormGroup>
          <FormRow
            label="Preset"
            control={
              <PopUpButton
                aria-label="Preset"
                value={preset}
                options={presetOptions}
                onChange={setPreset}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Model">
        <FormGroup>
          <FormRow
            label="Model"
            control={
              <PopUpButton
                aria-label="Model"
                value={model}
                options={modelOptions}
                onChange={setModel}
              />
            }
          />
          <FormRow
            label="Draft model"
            help={draftHelp}
            control={
              <PopUpButton
                aria-label="Draft model"
                value={draft}
                options={draftOptions}
                onChange={setDraft}
              />
            }
          />
          <FormRow
            label="Default thinking"
            help="Used when an app doesn’t ask for a level."
            control={
              <PopUpButton
                aria-label="Default thinking"
                value={thinking}
                options={thinkingOptions}
                onChange={setThinking}
              />
            }
          />
          <FormRow
            label="Text only"
            help="Frees memory for a longer context. Images and PDFs are turned off."
            control={
              <Switch aria-label="Text only" checked={textOnly} onCheckedChange={setTextOnly} />
            }
          />
          <FormRow
            label="Start offline"
            help="Skip the update check at start. Works for installed models only."
            control={
              <Switch aria-label="Start offline" checked={offline} onCheckedChange={setOffline} />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Memory & context" footnote={memoryFootnote}>
        <FormGroup>
          <FormRow
            label="GPU memory limit"
            control={
              <PopUpButton
                aria-label="GPU memory limit"
                value={memory}
                options={memoryLimitOptions}
                onChange={setMemory}
              />
            }
          />
          <FormRow
            label="Context length"
            help={context === 256 ? 'Automatic' : 'Changed from Automatic (256K)'}
            control={
              <Slider
                aria-label="Context length"
                value={context}
                min={8}
                max={256}
                step={8}
                onChange={setContext}
                formatValue={formatContext}
              />
            }
          />
          <FormRow
            label="Largest image size"
            disabled={textOnly}
            disabledReason="Not used while Text only is on."
            control={
              <Slider
                aria-label="Largest image size"
                value={image}
                min={0.1}
                max={4.2}
                step={0.1}
                onChange={setImage}
                formatValue={formatMegapixels}
              />
            }
          />
        </FormGroup>
      </FormSection>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Launch settings, part 2: cache, network and security                        */
/* -------------------------------------------------------------------------- */

export function LaunchNetworkDemo() {
  const [kv, setKv] = useState<KvFormat>('int8');
  const [ssd, setSsd] = useState(32);
  const [persist, setPersist] = useState(true);
  const [port, setPort] = useState(8000);
  const [listen, setListen] = useState<ListenId>('127.0.0.1');
  const [requireKey, setRequireKey] = useState(true);

  return (
    <Sheet title="Launch settings" subtitle={sheetSubtitle}>
      <FormSection title="Cache" footnote={cacheFootnote}>
        <FormGroup>
          <FormRow
            label="Working memory precision"
            control={
              <Segmented
                aria-label="Working memory precision"
                value={kv}
                options={kvOptions}
                onChange={setKv}
              />
            }
          />
          <FormRow
            label="SSD cache"
            control={
              <Slider
                aria-label="SSD cache size"
                value={ssd}
                min={0}
                max={128}
                step={4}
                onChange={setSsd}
                formatValue={formatGigabytes}
              />
            }
          />
          <FormRow
            label="Keep SSD cache across restarts"
            disabled={ssd === 0}
            disabledReason="Needs an SSD cache. Set SSD cache above Off first."
            control={
              <Switch
                aria-label="Keep SSD cache across restarts"
                checked={persist && ssd > 0}
                onCheckedChange={setPersist}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Network & security" footnote={networkFootnote}>
        <FormGroup>
          <FormRow
            label="Port"
            control={
              <Stepper aria-label="Port" value={port} min={1024} max={65535} onChange={setPort} />
            }
          />
          <FormRow
            label="Listen on"
            control={
              <PopUpButton
                aria-label="Listen on"
                value={listen}
                options={listenOptions}
                onChange={setListen}
              />
            }
          />
          <FormRow
            label="Require an API key"
            help={
              requireKey ? (
                <>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{maskedApiKey}</span>
                  <br />
                  <FormTextButton>Regenerate…</FormTextButton>
                </>
              ) : (
                'Any app on this Mac can use the server without a key.'
              )
            }
            control={
              <Switch
                aria-label="Require an API key"
                checked={requireKey}
                onCheckedChange={setRequireKey}
              />
            }
          />
          <FormRow
            label="Allowed web origins"
            help="Web pages that may call the server, Splashboard included."
            control={
              <>
                <FormValue monospace>tauri://localhost</FormValue>
                <Button>Edit…</Button>
              </>
            }
          />
        </FormGroup>
      </FormSection>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Launch settings, part 3: advanced, "More options" grown in the same group   */
/* -------------------------------------------------------------------------- */

export function LaunchAdvancedDemo({
  moreOpen: initialMoreOpen = true,
  commandOpen = false,
}: {
  moreOpen?: boolean;
  commandOpen?: boolean;
}) {
  const [queue, setQueue] = useState(32);
  const [timeLimit, setTimeLimit] = useState<TimeLimitId>('none');
  const [share, setShare] = useState(2);
  const [webui, setWebui] = useState(true);
  const [traces, setTraces] = useState(false);
  const [revision, setRevision] = useState<RevisionId>('latest');
  const [requestMb, setRequestMb] = useState(128);
  const [moreOpen, setMoreOpen] = useState(initialMoreOpen);

  return (
    <Sheet title="Launch settings" subtitle={sheetSubtitle}>
      <FormSection title="Advanced">
        <FormGroup>
          <FormRow
            label="Request queue"
            help="Splash runs up to 4 requests at once. The rest wait here."
            control={
              <Stepper
                aria-label="Request queue size"
                value={queue}
                min={1}
                max={1024}
                onChange={setQueue}
              />
            }
          />
          <FormRow
            label="Request time limit"
            control={
              <PopUpButton
                aria-label="Request time limit"
                value={timeLimit}
                options={timeLimitOptions}
                onChange={setTimeLimit}
              />
            }
          />
          <FormRow
            label="Reply share during long prompts"
            help="Higher keeps other chats and agents flowing while a long prompt is read; that prompt finishes later."
            control={
              <Slider
                aria-label="Reply share during long prompts"
                value={share}
                min={0}
                max={4}
                step={1}
                onChange={setShare}
                formatValue={(step) => replyShareSteps[step] ?? String(step)}
                ends={['Long prompt first', 'Replies first']}
              />
            }
          />
          <FormRow
            label="Built-in chat page"
            help="Splash’s own page at 127.0.0.1:8000. Splashboard doesn’t need it."
            control={
              <Switch aria-label="Built-in chat page" checked={webui} onCheckedChange={setWebui} />
            }
          />
          <FormRow
            label="Record crash traces"
            help="Traces can contain conversation text."
            control={
              <Switch
                aria-label="Record crash traces"
                checked={traces}
                onCheckedChange={setTraces}
              />
            }
          />
          <Disclosure variant="row" label="More options" open={moreOpen} onOpenChange={setMoreOpen}>
            <FormRow
              label="Model revision"
              help="A branch, tag or commit. Pin a commit to freeze the model."
              control={
                <PopUpButton
                  aria-label="Model revision"
                  value={revision}
                  options={revisionOptions}
                  onChange={setRevision}
                />
              }
            />
            <FormRow
              label="Model aliases"
              help="Other names apps can use for this model."
              control={
                <>
                  <FormValue monospace>local-qwen</FormValue>
                  <Button>Edit…</Button>
                </>
              }
            />
            <FormRow
              label="Extra host names"
              help="Names such as mymac.local that clients may put in the address."
              control={
                <>
                  <FormValue>None</FormValue>
                  <Button>Edit…</Button>
                </>
              }
            />
            <FormRow
              label="Largest request"
              help="Images and PDFs travel inside a request. Larger ones are refused."
              control={
                <Stepper
                  aria-label="Largest request"
                  value={requestMb}
                  min={1}
                  max={2048}
                  unit="MB"
                  onChange={setRequestMb}
                />
              }
            />
            <FormRow
              label="SSD cache folder"
              help="Where the kept SSD cache lives. Choose another disk if you like."
              control={
                <>
                  <FormValue>Default</FormValue>
                  <Button>Choose…</Button>
                </>
              }
            />
          </Disclosure>
        </FormGroup>
      </FormSection>

      <div style={{ marginTop: 24 }}>
        <Disclosure label="Show command" openLabel="Hide command" defaultOpen={commandOpen}>
          <div style={{ marginTop: 8 }}>
            <CodeBlock code={serveCommand} language="shell" />
          </div>
          <p className="sb-form-footnote">{commandFootnote}</p>
        </Disclosure>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* States: disabled with a reason, invalid, destructive                        */
/* -------------------------------------------------------------------------- */

export function FormStatesDemo() {
  const [textOnly, setTextOnly] = useState(true);
  const [image, setImage] = useState(4.2);
  const [port, setPort] = useState(8000);
  const [hosts, setHosts] = useState('my mac.local');
  const [temperature, setTemperature] = useState(1);

  const hostsInvalid = /\s/.test(hosts);

  return (
    <Sheet title="Form states" subtitle="Disabled with a reason, invalid, destructive">
      <FormSection title="Disabled, with a reason">
        <FormGroup>
          <FormRow
            label="Text only"
            help="Frees memory for a longer context. Images and PDFs are turned off."
            control={
              <Switch aria-label="Text only" checked={textOnly} onCheckedChange={setTextOnly} />
            }
          />
          <FormRow
            label="Largest image size"
            help="Lower values use less memory per image."
            disabled={textOnly}
            disabledReason="Not used while Text only is on."
            control={
              <Slider
                aria-label="Largest image size"
                value={image}
                min={0.1}
                max={4.2}
                step={0.1}
                onChange={setImage}
                formatValue={formatMegapixels}
              />
            }
          />
          <FormRow
            label="Temperature"
            disabled
            disabledReason="Set by the Thinking preset. Choose Custom to change it."
            control={
              <Slider
                aria-label="Temperature"
                value={temperature}
                min={0}
                max={2}
                step={0.05}
                onChange={setTemperature}
                formatValue={formatSampling}
              />
            }
          />
          <FormRow
            label="Keep SSD cache across restarts"
            disabled
            disabledReason="Needs an SSD cache. Set SSD cache above Off first."
            control={
              <Switch
                aria-label="Keep SSD cache across restarts"
                checked={false}
                onCheckedChange={() => undefined}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection
        title="Invalid"
        footnote="A problem is named in the row, in place of its help line, until it is fixed."
      >
        <FormGroup>
          <FormRow
            label="Port"
            error="Port 8000 is in use by another app. Choose another port or quit that app."
            control={
              <Stepper aria-label="Port" value={port} min={1024} max={65535} onChange={setPort} />
            }
          />
          <FormRow
            label="Extra host names"
            help="Names such as mymac.local that clients may put in the address."
            error={
              hostsInvalid ? 'Use letters, numbers, dots and dashes, without spaces.' : undefined
            }
            control={
              <TextField
                aria-label="Extra host names"
                monospace
                value={hosts}
                onChange={setHosts}
                width={180}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection footnote="Removes Splash 1.2.0 and its SSD cache. Downloaded models stay in ~/.cache/huggingface.">
        <FormGroup>
          <FormActionRow destructive label="Uninstall Splash…" />
        </FormGroup>
      </FormSection>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Fields: text, secure, search, segmented, copy                               */
/* -------------------------------------------------------------------------- */

export function FormFieldsDemo() {
  const [appearance, setAppearance] = useState<AppearanceId>('system');
  const [token, setToken] = useState(hfTokenSample);
  const [alias, setAlias] = useState('local-qwen');
  const [endpoint, setEndpoint] = useState('');
  const [search, setSearch] = useState('Qwen3.8');
  const [emptySearch, setEmptySearch] = useState('');
  const [queue, setQueue] = useState(32);
  const [tokenSent, setTokenSent] = useState(false);

  return (
    <Sheet title="Fields" subtitle="Text, secure, search, segmented and copy">
      <FormSection>
        <FormGroup>
          <FormRow
            label="Appearance"
            control={
              <Segmented
                aria-label="Appearance"
                value={appearance}
                options={appearanceOptions}
                onChange={setAppearance}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection
        title="Downloads"
        footnote="Existing downloads stay where they are. Splash reads model files at every start, so keep the disk connected."
      >
        <FormGroup>
          <FormRow
            label="Hugging Face token"
            help={
              tokenSent
                ? 'Token works. Gated models can download.'
                : 'Only for private or gated models. Kept in your Keychain.'
            }
            control={
              <>
                <SecureField
                  aria-label="Hugging Face token"
                  value={token}
                  onChange={setToken}
                  placeholder="hf_…"
                  width={200}
                />
                <Button onClick={() => setTokenSent(true)}>Test</Button>
              </>
            }
          />
          <FormRow
            label="Hugging Face endpoint"
            help="Leave empty for huggingface.co."
            control={
              <TextField
                aria-label="Hugging Face endpoint"
                value={endpoint}
                onChange={setEndpoint}
                placeholder="https://huggingface.co"
                monospace
              />
            }
          />
          <FormRow
            label="Model alias"
            help="Another name apps can use for this model."
            control={
              <TextField
                aria-label="Model alias"
                value={alias}
                onChange={setAlias}
                monospace
                width={160}
              />
            }
          />
          <FormRow
            label="Request queue"
            control={
              <Stepper
                aria-label="Request queue size"
                value={queue}
                min={1}
                max={1024}
                onChange={setQueue}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="API">
        <FormGroup>
          <FormRow
            label="Base URL"
            control={
              <>
                <FormValue monospace>http://127.0.0.1:8000/v1</FormValue>
                <CopyButton text="http://127.0.0.1:8000/v1" label="Copy base URL" />
              </>
            }
          />
          <FormRow
            label="API key"
            control={
              <>
                <FormValue monospace>{maskedApiKey}</FormValue>
                <CopyButton text="sk-splash-2b9c41e07d5a7f3a" label="Copy API key" />
              </>
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Search">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '4px 2px' }}>
          <SearchField
            aria-label="Search Hugging Face"
            placeholder="Search Hugging Face"
            value={emptySearch}
            onChange={setEmptySearch}
            shortcut="⌘K"
          />
          <SearchField
            aria-label="Search Hugging Face, with text"
            placeholder="Search Hugging Face"
            value={search}
            onChange={setSearch}
            autoFocus
          />
        </div>
      </FormSection>
    </Sheet>
  );
}
