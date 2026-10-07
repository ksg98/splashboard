import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// Do not import modules that load @tauri-apps/api here: a test file's
// vi.mock() of them would then come too late.
import { setStorage } from '@/lib/storage';

// jsdom has no matchMedia; the theme provider reads it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

afterEach(() => {
  cleanup();
  setStorage(undefined);
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// jsdom has no canvas. uPlot (Activity's chart) draws through a 2D context, so
// hand it a no-op one instead of null.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => undefined;
  const context = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'measureText' ? () => ({ width: 0 }) : key === 'canvas' ? undefined : noop,
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class {
      moveTo() {}
      lineTo() {}
      rect() {}
      arc() {}
      closePath() {}
      bezierCurveTo() {}
      addPath() {}
    } as unknown as typeof Path2D;
  }
}
