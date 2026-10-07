import { Droplet, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormGroup, FormRow, FormSection, FormValue } from '@/components/ui/Form';
import type { SettingsPaneProps } from './types';

/** About: what this is, the versions and the Mac it runs on, and where to learn more. */
export function AboutPane({ info, actions }: SettingsPaneProps) {
  return (
    <>
      <div className="sd-about">
        <span className="sd-about-tile" aria-hidden="true">
          <Droplet size={30} strokeWidth={1.25} />
        </span>
        <div>
          <div className="sd-about-name">Splashboard</div>
          <div className="sd-about-line">
            A Mac app for running Splash, Inco’s local LLM engine, without the terminal.
          </div>
        </div>
      </div>

      <FormSection>
        <FormGroup>
          <FormRow label="Version" control={<FormValue>{info.app.version}</FormValue>} />
          <FormRow label="Splash" control={<FormValue>{info.splash.version}</FormValue>} />
          <FormRow label="This Mac" control={<FormValue>{info.mac}</FormValue>} />
          <FormRow
            label="Server address"
            control={<FormValue monospace>{info.server}</FormValue>}
          />
          <FormRow label="License" control={<FormValue>{info.license}</FormValue>} />
        </FormGroup>
      </FormSection>

      {info.links.length > 0 ? (
        <FormSection title="Learn more">
          <FormGroup>
            {info.links.map((link) => (
              <FormRow
                key={link.url}
                label={link.label}
                help={link.help}
                control={
                  <Button
                    iconEnd={<ExternalLink size={14} strokeWidth={2} aria-hidden />}
                    aria-label={`Open ${link.label} in your browser`}
                    onClick={() => actions.onOpenLink?.(link.url)}
                  >
                    Open
                  </Button>
                }
              />
            ))}
          </FormGroup>
        </FormSection>
      ) : null}
    </>
  );
}
