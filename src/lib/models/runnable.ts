/**
 * The models Splashboard offers to run: Splash packages and MLX 4-bit
 * checkpoints that are on this Mac. GGUF builds and draft models are left out.
 */
import { displayModelName } from '@/lib/launch';
import type { CatalogEntry, InstalledReport } from './types';

export type RunnableFormat = 'package' | 'mlx';

export interface RunnableModel {
  /** What `--model` takes. */
  model: string;
  /** "Qwen3.8-27B", "Qwen3.8-27B (MLX 4-bit)". */
  name: string;
  publisher: string;
  format: RunnableFormat;
  sizeBytes: number | null;
  description: string | null;
}

function formatOf(model: string, hint: string | null | undefined): RunnableFormat | null {
  const lower = `${hint ?? ''} ${model}`.toLowerCase();
  if (lower.includes('gguf')) return null;
  if (/-splash\b/.test(model.toLowerCase()) || hint === 'package') return 'package';
  if (lower.includes('mlx')) return 'mlx';
  return null;
}

/** Installed Splash packages and complete MLX checkpoints in the HF cache, packages first. */
export function runnableModels(
  installed: InstalledReport | null,
  catalog: CatalogEntry[] = [],
): RunnableModel[] {
  const seen = new Map<string, RunnableModel>();
  const describe = (model: string) => catalog.find((entry) => entry.id === model)?.description ?? null;

  for (const installation of installed?.installations ?? []) {
    if (!installation.model || !installation.complete) continue;
    const format = formatOf(installation.model, installation.kind === 'package' ? 'package' : installation.targetFormat);
    if (!format) continue;
    seen.set(installation.model, {
      model: installation.model,
      name: displayModelName(installation.model),
      publisher: installation.model.split('/')[0] ?? '',
      format,
      sizeBytes: installation.sizeOnDisk || null,
      description: describe(installation.model),
    });
  }
  for (const cached of installed?.cached ?? []) {
    if (cached.role !== 'target' || !cached.complete || seen.has(cached.repo)) continue;
    const format = formatOf(cached.repo, cached.format);
    if (!format) continue;
    seen.set(cached.repo, {
      model: cached.repo,
      name: displayModelName(cached.repo),
      publisher: cached.repo.split('/')[0] ?? '',
      format,
      sizeBytes: cached.sizeOnDisk || null,
      description: describe(cached.repo),
    });
  }
  return [...seen.values()].sort(
    (a, b) => (a.format === b.format ? a.name.localeCompare(b.name) : a.format === 'package' ? -1 : 1),
  );
}

/** Catalog entries that can be downloaded and run (no GGUF, no drafts). */
export function isOfferedEntry(entry: CatalogEntry): boolean {
  return entry.servable && (entry.format === 'package' || entry.format === 'mlx');
}

export function formatLabel(format: RunnableFormat): string {
  return format === 'package' ? 'Splash package' : 'MLX 4-bit';
}

export function gigabytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
