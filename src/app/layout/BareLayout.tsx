import { Outlet } from 'react-router';
import { Toaster } from '@/components/ui/Toast';

/** Full-window routes (first run): no sidebar, but still a draggable top strip. */
export function BareLayout() {
  return (
    <div className="sb-bare">
      <div
        className="fixed inset-x-0 top-0"
        style={{ height: 'var(--toolbar-height)' }}
        data-tauri-drag-region
      />
      <Outlet />
      <Toaster />
    </div>
  );
}
