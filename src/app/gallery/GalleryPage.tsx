import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { GalleryEntry, GalleryModule } from './types';

const modules = import.meta.glob<GalleryModule>('/src/**/*.gallery.tsx', { eager: true });

function allEntries(): GalleryEntry[] {
  return Object.values(modules)
    .flatMap((module) => module.gallery ?? [])
    .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

/** ?theme=light|dark pins the theme so screenshots are deterministic. */
function useThemeParam() {
  const [params] = useSearchParams();
  const theme = params.get('theme');
  useEffect(() => {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
}

export function GalleryIndex() {
  useThemeParam();
  const entries = allEntries();
  const groups = [...new Set(entries.map((entry) => entry.group))];
  return (
    <main style={{ padding: 32, fontFamily: 'inherit', overflow: 'auto', height: '100vh' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Gallery</h1>
      {groups.map((group) => (
        <section key={group} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{group}</h2>
          <ul>
            {entries
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <li key={entry.id} style={{ fontSize: 13, lineHeight: '22px' }}>
                  <Link to={`/__gallery/${entry.id}`}>{entry.title}</Link>{' '}
                  <span style={{ opacity: 0.5 }}>{entry.id}</span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

export function GalleryEntryPage() {
  useThemeParam();
  const { id } = useParams();
  const entry = allEntries().find((candidate) => candidate.id === id);
  if (!entry) {
    return <p style={{ padding: 32 }}>No gallery entry “{id}”.</p>;
  }
  const frame = entry.frame ?? 'centered';
  if (frame === 'window') {
    return (
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>{entry.render()}</div>
    );
  }
  return (
    <div
      data-gallery-frame={frame}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'auto',
        background: 'var(--sb-bg, Canvas)',
        display: frame === 'centered' ? 'grid' : 'block',
        placeItems: frame === 'centered' ? 'center' : undefined,
        padding: frame === 'centered' ? 32 : 0,
      }}
    >
      {entry.render()}
    </div>
  );
}
