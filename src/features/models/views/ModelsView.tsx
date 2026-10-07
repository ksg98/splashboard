import { ScrollEdge } from '@/components/ui/Dialog';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { ModelRow } from './ModelRow';
import { RunningModelCard } from './RunningModelCard';
import type { ModelSearch, ModelsViewProps } from './types';
import './ModelsView.css';

/**
 * Models: the running model on top, then Installed and Available lists of
 * Splash packages and MLX 4-bit models, or Hugging Face search results while
 * the search field has text. Presentational: everything comes in as props.
 */
export function ModelsView({
  diskUsage,
  downloadsFolder,
  running,
  installed,
  available,
  search,
  onSearchChange,
  onOpenLaunchSettings,
  onStart,
  onStop,
  onRun,
  onGet,
  onCancelDownload,
  onVersionChange,
  onStopModel,
}: ModelsViewProps) {
  const searching = search.query.trim() !== '' && search.status !== 'idle';
  const rowHandlers = {
    onRun,
    onGet,
    onCancelDownload,
    onVersionChange,
    onStop: onStopModel,
  };

  return (
    <ScrollEdge className="mv-page">
      <div className="mv-page__inner">
        <header className="mv-head">
          <div className="mv-head__text">
            <h1 className="mv-head__title">Models</h1>
            <p className="mv-head__sub">
              Splash runs one model at a time.{' '}
              {diskUsage ? (
                <>
                  Models use <span className="tabular-nums">{diskUsage}</span> on this Mac.
                </>
              ) : (
                'No models on this Mac yet.'
              )}
            </p>
          </div>
          <div className="mv-head__actions">
            <div className="mv-search">
              <SearchField
                value={search.query}
                onChange={onSearchChange}
                placeholder="Search Hugging Face"
              />
            </div>
          </div>
        </header>

        {running ? (
          <RunningModelCard
            model={running}
            onOpenLaunchSettings={onOpenLaunchSettings}
            onStart={onStart}
            onStop={onStop}
          />
        ) : (
          <section className="mv-running mv-running--empty" aria-label="Running model">
            <div className="mv-running__text">
              <div className="mv-running__name">No model is running</div>
              <div className="mv-running__meta">Run an installed model, or get one below.</div>
            </div>
          </section>
        )}

        {searching ? (
          <SearchResults search={search} downloadsFolder={downloadsFolder} handlers={rowHandlers} />
        ) : (
          <>
            {installed.length > 0 ? (
              <section aria-labelledby="mv-installed">
                <h2 className="mv-section-title" id="mv-installed">
                  Installed
                </h2>
                <div className="mv-group">
                  {installed.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      onOpen={onOpenLaunchSettings}
                      {...rowHandlers}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {available.length > 0 ? (
              <section aria-labelledby="mv-available">
                <h2 className="mv-section-title" id="mv-available">
                  Available
                </h2>
                <div className="mv-group">
                  {available.map((model) => (
                    <ModelRow key={model.id} model={model} {...rowHandlers} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        {searching ? null : (
          <p className="mv-footnote">
            Downloads go to <span className="mv-path">{downloadsFolder}</span>. Splash reads them at
            every start, so keep the disk connected.
          </p>
        )}
      </div>
    </ScrollEdge>
  );
}

interface SearchResultsProps {
  search: ModelSearch;
  downloadsFolder: string;
  handlers: Pick<
    Parameters<typeof ModelRow>[0],
    'onRun' | 'onGet' | 'onCancelDownload' | 'onVersionChange' | 'onStop'
  >;
}

function SearchResults({ search, downloadsFolder, handlers }: SearchResultsProps) {
  const query = search.query.trim();
  return (
    <section aria-labelledby="mv-results" aria-busy={search.status === 'loading' || undefined}>
      <h2 className="mv-section-title" id="mv-results">
        Hugging Face
      </h2>
      <div className="mv-group">
        {search.status === 'loading' ? (
          <div className="mv-note-row" role="status">
            <Spinner size={14} />
            <span>Searching for “{query}”…</span>
          </div>
        ) : search.status === 'error' ? (
          <div className="mv-note-row" role="alert">
            {search.error ?? 'Hugging Face didn’t answer. Try again in a moment.'}
          </div>
        ) : search.results.length === 0 ? (
          <div className="mv-note-row" role="status">
            No Splash packages or MLX 4-bit models match “{query}”.
          </div>
        ) : (
          search.results.map((model) => <ModelRow key={model.id} model={model} {...handlers} />)
        )}
      </div>
      <p className="mv-footnote">
        Only Splash packages and MLX 4-bit models are listed, the formats Splash runs. Downloads go
        to <span className="mv-path">{downloadsFolder}</span>.
      </p>
    </section>
  );
}
