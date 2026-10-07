/**
 * Sample data for browser mode (`pnpm web`) and tests: a Mac with one
 * official package installed, one GGUF installed text-only, an MLX download
 * in the hub cache, and the catalog as Splash 1.2.0 ships it. Sizes are
 * the real Hugging Face sizes where known.
 */
import type {
  Catalog,
  CatalogEntry,
  InstalledReport,
  RemovePlan,
  RepoVariants,
  TokenStatus,
} from './types';

function entry(
  partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'label' | 'format'>,
): CatalogEntry {
  const [repo = partial.id, variant = null] = partial.id.split(':');
  return {
    repo,
    variant,
    family: null,
    description: null,
    sources: ['upstream'],
    servable: partial.format !== 'draft',
    recommended: false,
    minRamGb: null,
    sizeBytes: null,
    sizeSource: null,
    sizeFetchedAtMs: null,
    gated: false,
    ...partial,
  };
}

export const SAMPLE_CATALOG: Catalog = {
  entries: [
    entry({
      id: 'incoai/Qwen3.8-27B-Splash',
      label: 'Qwen3.8 27B (Splash package)',
      format: 'package',
      family: 'Qwen3.8-27B',
      sources: ['official', 'cachedCatalog', 'upstream'],
      minRamGb: 36,
      sizeBytes: 17_382_691_384,
      sizeSource: 'hub',
    }),
    entry({
      id: 'incoai/Qwen3.6-35B-A3B-Splash',
      label: 'Qwen3.6 35B-A3B (Splash package)',
      format: 'package',
      family: 'Qwen3.6-35B-A3B',
      sources: ['official', 'cachedCatalog', 'upstream'],
      minRamGb: 36,
      sizeBytes: 20_949_497_305,
      sizeSource: 'hub',
    }),
    entry({
      id: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
      label: 'Qwen3.8 27B · GGUF UD-Q4_K_M',
      format: 'gguf',
      family: 'Qwen3.8-27B',
      description: "The README's quick-start model.",
      recommended: true,
      minRamGb: 36,
      sizeBytes: 16_464_440_224,
      sizeSource: 'hub',
    }),
    entry({
      id: 'unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M',
      label: 'Qwen3.6 35B-A3B · GGUF UD-Q4_K_M',
      format: 'gguf',
      family: 'Qwen3.6-35B-A3B',
      recommended: true,
      minRamGb: 36,
      sizeBytes: 22_134_528_992,
      sizeSource: 'hub',
    }),
    entry({
      id: 'mlx-community/Qwen3.8-27B-4bit',
      label: 'Qwen3.8 27B · MLX 4-bit',
      format: 'mlx',
      family: 'Qwen3.8-27B',
      sources: ['suggested', 'upstream'],
      minRamGb: 36,
      sizeBytes: 16_081_490_933,
      sizeSource: 'hub',
    }),
    entry({
      id: 'unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS',
      label: 'Qwen3.8 27B · GGUF UD-IQ3_XXS',
      format: 'gguf',
      family: 'Qwen3.8-27B',
      description: 'For 24 GB Macs.',
      minRamGb: 24,
      sizeBytes: 10_934_860_704,
      sizeSource: 'hub',
    }),
    entry({
      id: 'prism-ml/Ternary-Bonsai-2-27B-gguf:PQ2_0',
      label: 'Ternary Bonsai 2 27B · PQ2_0',
      format: 'gguf',
      family: 'Bonsai',
      minRamGb: 24,
      sizeBytes: 7_206_168_928,
      sizeSource: 'hub',
    }),
    entry({
      id: 'incoai/Qwen3.8-27B-DFlash2',
      label: 'Qwen3.8 27B DFlash2 draft',
      format: 'draft',
      family: 'Qwen3.8-27B',
      sizeBytes: 3_849_113_004,
      sizeSource: 'hub',
    }),
  ],
  offline: false,
  errors: [],
  refreshedAtMs: null,
};

export const SAMPLE_INSTALLED: InstalledReport = {
  modelsDir: '/Users/you/Library/Application Support/Splash/models',
  hfCacheDir: '/Users/you/.cache/huggingface/hub',
  installations: [
    {
      id: 'incoai/Qwen3.8-27B-Splash',
      model: 'incoai/Qwen3.8-27B-Splash',
      linkPath: '/Users/you/Library/Application Support/Splash/models/incoai/Qwen3.8-27B-Splash',
      targetPath:
        '/Users/you/.cache/huggingface/hub/models--incoai--Qwen3.8-27B-Splash/snapshots/9d27070b71f7142c6b6025f03ac011d70a73cb48',
      kind: 'package',
      hashed: false,
      options: null,
      family: 'Qwen3.8-27B',
      targetFormat: 'package',
      visionFormat: null,
      target: {
        repo: 'incoai/Qwen3.8-27B-Splash',
        revision: '9d27070b71f7142c6b6025f03ac011d70a73cb48',
      },
      draft: null,
      repos: ['incoai/Qwen3.8-27B-Splash'],
      sizeOnDisk: 17_870_000_000,
      fileCount: 82,
      complete: true,
      problems: [],
      inUse: false,
      modifiedMs: 1_758_340_260_000,
    },
    {
      id: '.selections/8adbe2a0c214994a2a91f41368859f94a95fa7e3713f61bc02be21a7a4a66f32',
      model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
      linkPath:
        '/Users/you/Library/Application Support/Splash/models/.selections/8adbe2a0c214994a2a91f41368859f94a95fa7e3713f61bc02be21a7a4a66f32',
      targetPath: '/Users/you/Library/Application Support/Splash/models/.resolved/3f1c',
      kind: 'assembly',
      hashed: true,
      options: { revision: null, draftModel: null, languageOnly: true },
      family: 'Qwen3.8-27B',
      targetFormat: 'gguf',
      visionFormat: 'none',
      target: {
        repo: 'unsloth/Qwen3.8-27B-GGUF',
        revision: '4ca720788d1e01f1bff70c033e0d0028fd02e502',
      },
      draft: {
        repo: 'incoai/Qwen3.8-27B-DFlash2',
        revision: '0d3c7a9e1f2b4c6d8e0f1a2b3c4d5e6f7a8b9c0d',
      },
      repos: ['incoai/Qwen3.8-27B-DFlash2', 'unsloth/Qwen3.8-27B-GGUF'],
      sizeOnDisk: 21_020_000_000,
      fileCount: 14,
      complete: true,
      problems: [],
      inUse: false,
      modifiedMs: 1_759_000_000_000,
    },
  ],
  cached: [
    {
      repo: 'mlx-community/Qwen3.8-27B-4bit',
      path: '/Users/you/.cache/huggingface/hub/models--mlx-community--Qwen3.8-27B-4bit',
      sizeOnDisk: 9_300_000_000,
      // An interrupted download: a partial blob and a missing shard link.
      incompleteBytes: 1_200_000_000,
      incompleteFiles: 1,
      snapshots: [],
      splashPins: 0,
      complete: false,
      role: 'target',
      family: 'Qwen3.8-27B',
      format: 'mlx',
      linkedBy: [],
      inCatalog: true,
      matchedBy: 'catalog',
    },
    {
      repo: 'incoai/Qwen3.8-27B-DFlash2',
      path: '/Users/you/.cache/huggingface/hub/models--incoai--Qwen3.8-27B-DFlash2',
      sizeOnDisk: 3_400_000_000,
      incompleteBytes: 0,
      incompleteFiles: 0,
      snapshots: [],
      splashPins: 1,
      complete: true,
      role: 'draft',
      family: 'Qwen3.8-27B',
      format: 'draft',
      linkedBy: ['.selections/8adbe2a0c214994a2a91f41368859f94a95fa7e3713f61bc02be21a7a4a66f32'],
      inCatalog: true,
      matchedBy: 'catalog',
    },
  ],
  cachedBytes: 12_700_000_000,
};

export const SAMPLE_VARIANTS: RepoVariants = {
  repo: 'unsloth/Qwen3.8-27B-GGUF',
  sha: '4ca720788d1e01f1bff70c033e0d0028fd02e502',
  source: 'hub',
  variants: [
    {
      variant: 'UD-IQ2_XXS',
      file: 'Qwen3.8-27B-UD-IQ2_XXS.gguf',
      sizeBytes: 8_400_000_000,
      supported: true,
      note: null,
    },
    {
      variant: 'UD-IQ3_XXS',
      file: 'Qwen3.8-27B-UD-IQ3_XXS.gguf',
      sizeBytes: 11_500_000_000,
      supported: true,
      note: null,
    },
    {
      variant: 'UD-Q4_K_M',
      file: 'Qwen3.8-27B-UD-Q4_K_M.gguf',
      sizeBytes: 17_620_000_000,
      supported: true,
      note: null,
    },
    {
      variant: 'Q8_0',
      file: 'Qwen3.8-27B-Q8_0.gguf',
      sizeBytes: 28_600_000_000,
      supported: true,
      note: null,
    },
    {
      variant: 'UD-Q8_K_XL',
      file: 'Qwen3.8-27B-UD-Q8_K_XL.gguf',
      sizeBytes: 35_000_000_000,
      supported: false,
      note: 'UD-Q8_K_XL targets are not supported by Splash',
    },
  ],
  projectors: [
    { name: 'mmproj-BF16.gguf', size: 931_000_000 },
    { name: 'mmproj-F16.gguf', size: 931_000_000 },
  ],
  visionLikely: true,
  textOnlyRecommended: false,
  hasSafetensors: false,
};

export const SAMPLE_TOKEN: TokenStatus = {
  hasToken: false,
  source: null,
  path: '/Users/you/.cache/huggingface/token',
  username: null,
  role: null,
  valid: null,
  error: null,
};

export function sampleRemovePlan(id: string, alsoFreeDownloads: boolean): RemovePlan {
  const installation = SAMPLE_INSTALLED.installations.find((i) => i.id === id);
  const items: RemovePlan['items'] = [
    { kind: 'selectionLink', path: installation?.linkPath ?? id, bytes: 0, repo: null },
  ];
  if (alsoFreeDownloads) {
    for (const repo of installation?.repos ?? []) {
      items.push({
        kind: 'hubRepo',
        path: `/Users/you/.cache/huggingface/hub/models--${repo.replace('/', '--')}`,
        bytes: installation ? Math.round(installation.sizeOnDisk / installation.repos.length) : 0,
        repo,
      });
    }
  }
  return {
    id,
    model: installation?.model ?? null,
    alsoFreeDownloads,
    items,
    bytesFreed: items.reduce((sum, item) => sum + item.bytes, 0),
    kept: [],
    blocked: null,
  };
}
