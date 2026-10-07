import { Button } from '@/components/ui/Button';
import { FormActionRow, FormGroup, FormRow, FormSection } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import type { SettingsPaneProps, UpdateStatus } from './types';

function updateLine(status: UpdateStatus): string {
  switch (status.state) {
    case 'up-to-date':
      return `Up to date (latest is ${status.latest}). Checked ${status.checkedAt}.`;
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Version ${status.latest} is available.`;
    case 'error':
      return `Couldn’t check for updates. ${status.message}`;
  }
}

/** Updates: Splash and Splashboard versions, Check for updates, and Uninstall Splash. */
export function UpdatesPane({ values, onChange, info, actions }: SettingsPaneProps) {
  const splash = info.splash.update;
  const app = info.app.update;
  const checking = splash.state === 'checking' || app.state === 'checking';
  return (
    <>
      <FormSection footnote="Updating stops running servers first, then offers to start them again. Models and settings are kept.">
        <FormGroup>
          <FormRow
            label={`Splash ${info.splash.version}`}
            help={updateLine(splash)}
            control={
              splash.state === 'available' && actions.onUpdateSplash ? (
                <Button variant="primary" onClick={actions.onUpdateSplash}>
                  Update to {splash.latest}
                </Button>
              ) : (
                <Button onClick={actions.onCheckForUpdates} loading={checking}>
                  Check for updates
                </Button>
              )
            }
          />
          <FormRow
            label={`Splashboard ${info.app.version}`}
            help={updateLine(app)}
            control={
              app.state === 'available' && actions.onUpdateApp ? (
                <Button onClick={actions.onUpdateApp}>Update to {app.latest}</Button>
              ) : null
            }
          />
          <FormRow
            label="Check automatically"
            control={
              <Switch
                aria-label="Check for updates automatically"
                checked={values.checkForUpdatesAutomatically}
                onCheckedChange={(checkForUpdatesAutomatically) =>
                  onChange({ checkForUpdatesAutomatically })
                }
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection footnote="Stops the server and removes the Splash engine with Homebrew. Your downloaded models, chats and settings stay on this Mac; delete models in Models to free their space.">
        <FormGroup>
          <FormActionRow
            label="Uninstall Splash…"
            destructive
            onClick={actions.onUninstallSplash}
          />
        </FormGroup>
      </FormSection>
    </>
  );
}
