import { Fragment } from 'react';
import type { TranscriptLine, TranscriptSegment } from './fixtures';
import './TerminalTranscript.css';

function Segment({ segment }: { segment: TranscriptSegment }) {
  if (typeof segment === 'string') return <>{segment}</>;
  if ('dim' in segment) return <span className="tt-dim">{segment.dim}</span>;
  return <span className="tt-b">{segment.b}</span>;
}

function Segments({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Segment key={index} segment={segment} />
      ))}
    </>
  );
}

/**
 * A static, styled terminal session for previews of the terminal sheet (the
 * app attaches xterm.js instead). Lines sit on a 20 px grid; a box adds
 * exactly one line, so the grid holds.
 */
export function TerminalTranscript({ lines }: { lines: TranscriptLine[] }) {
  return (
    <>
      {lines.map((line, index) => {
        if (Array.isArray(line)) {
          return (
            <Fragment key={index}>
              <Segments segments={line} />
              {'\n'}
            </Fragment>
          );
        }
        if ('box' in line) {
          return (
            <Fragment key={index}>
              <span className="tt-box">
                {line.box.map((row, rowIndex) => (
                  <Fragment key={rowIndex}>
                    {rowIndex > 0 ? '\n' : null}
                    <Segments segments={row} />
                  </Fragment>
                ))}
              </span>
              {'\n'}
            </Fragment>
          );
        }
        return (
          <Fragment key={index}>
            <span className="tt-input">
              <span className="tt-b">&gt;</span> <span className="tt-caret" aria-hidden="true" />
            </span>
            <span className="tt-dim">{line.hint}</span>
          </Fragment>
        );
      })}
    </>
  );
}
