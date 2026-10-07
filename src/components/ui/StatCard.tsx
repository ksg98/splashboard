import clsx from 'clsx';
import type { ReactNode } from 'react';
import './StatCard.css';

/** The value a card shows when there is no data (server stopped or starting). */
export const STAT_EMPTY_VALUE = '—';

export interface StatCardProps {
  label: string;
  /** Already formatted ("92", "31.4"). Pass "—" (or "") when there is no data. */
  value: string;
  /** Small gray text after the number ("tok/s", "%", "of 48 GB"). Hidden while there is no data. */
  unit?: string;
  /** Footer text ("Average over 10 seconds", "5.6 of 7 kept", or "Not running" while stopped). */
  caption?: ReactNode;
  /** Footer graphic before the caption: a MeterBar or DotsMeter. */
  children?: ReactNode;
  className?: string;
}

/** One Activity summary card: label, big number with unit, one footer line. */
export function StatCard({ label, value, unit, caption, children, className }: StatCardProps) {
  const empty = value.trim() === '' || value.trim() === STAT_EMPTY_VALUE;
  const tight = unit !== undefined && unit.startsWith('%');
  return (
    <div className={clsx('sb-stat', className)} role="group" aria-label={label}>
      <div className="sb-stat__label" aria-hidden="true">
        {label}
      </div>
      <p className="sb-stat__value">
        {empty ? (
          <>
            <span className="sb-stat__dash" aria-hidden="true">
              {STAT_EMPTY_VALUE}
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          <>
            {value}
            {unit ? (
              <small className={clsx('sb-stat__unit', tight && 'sb-stat__unit--tight')}>
                {unit}
              </small>
            ) : null}
          </>
        )}
      </p>
      <div className="sb-stat__foot">
        {children}
        {caption !== undefined && caption !== null && caption !== '' ? (
          <span className="sb-stat__caption">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Four equal columns with 12 px gaps, as on the Activity page. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('sb-stat-grid', className)}>{children}</div>;
}
