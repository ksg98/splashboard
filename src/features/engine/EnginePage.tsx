import { useCallback } from 'react';
import { toast } from '@/components/ui/Toast';
import { restartEngine, startEngine } from '@/lib/launch';
import { useEngineStore } from '@/lib/splash/engine-store';
import { useEngineDisplay, useTelemetry } from './useEngineDisplay';
import { ActivityView } from './views/ActivityView';

function report(result: unknown, fallback: string) {
  if (result) return;
  const error = useEngineStore.getState().error;
  toast(error?.message ?? fallback, { tone: 'error' });
}

export function EnginePage() {
  useTelemetry();
  const display = useEngineDisplay();
  const stop = useEngineStore((s) => s.stop);
  const saveLog = useEngineStore((s) => s.saveLog);

  const onStart = useCallback(() => {
    void startEngine().then((result) => report(result, 'Splash could not start.'));
  }, []);
  const onRestart = useCallback(() => {
    void restartEngine().then((result) => report(result, 'Splash could not restart.'));
  }, []);
  const onStop = useCallback(() => {
    void stop().then((result) => report(result, 'Splash could not stop.'));
  }, [stop]);

  return (
    <ActivityView
      model={display.model}
      status={display.status}
      stats={display.stats}
      speed={display.speed}
      details={display.details}
      log={display.log}
      onStart={onStart}
      onStop={onStop}
      onRestart={onRestart}
      onSaveLog={() =>
        void saveLog().then((path) => {
          if (path) toast(`Saved the log to ${path}`);
        })
      }
    />
  );
}
