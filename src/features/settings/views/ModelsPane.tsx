import { Button } from '@/components/ui/Button';
import { FormGroup, FormRow, FormSection, FormValue } from '@/components/ui/Form';
import { SecureField } from '@/components/ui/SecureField';
import { StatusDot } from '@/components/ui/StatusDot';
import type { HfTokenStatus, SettingsPaneProps } from './types';

function TokenHelp({ status }: { status: HfTokenStatus }) {
  switch (status.state) {
    case 'signed-in':
      return (
        <span className="sd-status">
          <StatusDot tone="ok" />
          Signed in as {status.user}. Kept in your Keychain.
        </span>
      );
    case 'checking':
      return <>Checking the token with Hugging Face…</>;
    case 'invalid':
      return (
        <span className="sd-status">
          <StatusDot tone="error" />
          {status.message ?? 'Hugging Face didn’t accept this token.'}
        </span>
      );
    case 'none':
      return <>Only for private or gated models. Kept in your Keychain.</>;
  }
}

/** Models & downloads: the Hugging Face token, where downloads go, and the space they use. */
export function ModelsPane({ values, onChange, info, actions }: SettingsPaneProps) {
  const used = `${info.modelsCount} ${info.modelsCount === 1 ? 'model' : 'models'}${
    info.diskFree ? ` · ${info.diskFree} free on this disk` : ''
  }`;
  return (
    <FormSection footnote="Existing downloads stay where they are. Splash reads model files at every start, so keep the disk connected.">
      <FormGroup>
        <FormRow
          label="Hugging Face token"
          help={<TokenHelp status={info.hfToken} />}
          control={
            <>
              <SecureField
                aria-label="Hugging Face token"
                value={values.hfToken}
                onChange={(hfToken) => onChange({ hfToken })}
                placeholder="hf_…"
                width={190}
              />
              <Button
                onClick={actions.onTestToken}
                loading={info.hfToken.state === 'checking'}
                disabled={values.hfToken === ''}
              >
                Test
              </Button>
            </>
          }
        />
        <FormRow
          label="Download folder"
          help={<span className="sd-mono">{values.downloadFolder}</span>}
          control={
            <Button onClick={actions.onChooseFolder} aria-label="Choose download folder">
              Choose…
            </Button>
          }
        />
        <FormRow
          label="Used by models"
          help={used}
          control={
            <>
              <FormValue>{info.modelsDiskUsed}</FormValue>
              <Button onClick={actions.onManageModels} aria-label="Manage models">
                Manage…
              </Button>
            </>
          }
        />
      </FormGroup>
    </FormSection>
  );
}
