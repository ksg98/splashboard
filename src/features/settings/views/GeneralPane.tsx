import { FormGroup, FormRow, FormSection } from '@/components/ui/Form';
import { PopUpButton } from '@/components/ui/PopUpButton';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import type { AppearanceChoice, SettingsPaneProps } from './types';

const APPEARANCE: { value: AppearanceChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** General: appearance, what happens at login, and how the server behaves. */
export function GeneralPane({ values, onChange, info }: SettingsPaneProps) {
  const startOptions = [
    { value: 'none', label: 'Don’t start' },
    ...info.models.map((model) => ({
      value: model.value,
      label: model.label,
      description: model.description,
    })),
  ];
  return (
    <>
      <FormSection>
        <FormGroup>
          <FormRow
            label="Appearance"
            control={
              <Segmented
                aria-label="Appearance"
                value={values.appearance}
                options={APPEARANCE}
                onChange={(appearance) => onChange({ appearance })}
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Startup">
        <FormGroup>
          <FormRow
            label="Open Splashboard at login"
            control={
              <Switch
                aria-label="Open Splashboard at login"
                checked={values.openAtLogin}
                onCheckedChange={(openAtLogin) => onChange({ openAtLogin })}
              />
            }
          />
          <FormRow
            label="Start the server at login"
            help={
              values.startServerAtLogin !== 'none' && !values.openAtLogin
                ? 'Works only when Splashboard opens at login.'
                : undefined
            }
            control={
              <PopUpButton
                aria-label="Start the server at login"
                value={values.startServerAtLogin}
                options={startOptions}
                onChange={(startServerAtLogin) => onChange({ startServerAtLogin })}
                align="end"
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Server">
        <FormGroup>
          <FormRow
            label="Keep running when Splashboard quits"
            help="Splashboard reconnects the next time it opens."
            control={
              <Switch
                aria-label="Keep running when Splashboard quits"
                checked={values.keepRunningOnQuit}
                onCheckedChange={(keepRunningOnQuit) => onChange({ keepRunningOnQuit })}
              />
            }
          />
          <FormRow
            label="Restart if it quits unexpectedly"
            help="Up to 3 times in 5 minutes, then you’re notified."
            control={
              <Switch
                aria-label="Restart if it quits unexpectedly"
                checked={values.restartOnCrash}
                onCheckedChange={(restartOnCrash) => onChange({ restartOnCrash })}
              />
            }
          />
          <FormRow
            label="Prevent sleep while serving"
            help="The display can still turn off."
            control={
              <Switch
                aria-label="Prevent sleep while serving"
                checked={values.preventSleep}
                onCheckedChange={(preventSleep) => onChange({ preventSleep })}
              />
            }
          />
        </FormGroup>
      </FormSection>
    </>
  );
}
