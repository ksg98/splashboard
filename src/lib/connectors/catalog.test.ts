import { describe, expect, it } from 'vitest';
import params from '../../../docs/splash-params.json';
import {
  AGENT_IDS,
  CLIENT_CONFIGS,
  CONNECTORS,
  compareVersions,
  connectorFiles,
  connectorUndo,
  getConnector,
  isSupportedBy,
  minSplashVersion,
  parseConnector,
  profileName,
  renderClientConfig,
} from './catalog';

describe('connector catalog (docs/splash-params.json)', () => {
  it('has the five agents in order, matching the source JSON', () => {
    expect(CONNECTORS.map((c) => c.id)).toEqual([...AGENT_IDS]);
    expect(CONNECTORS).toHaveLength(params.connectors.length);
    for (const def of CONNECTORS) {
      expect(def.command).toBe(`splash ${def.id} [ARGS...]`);
      expect(def.binary).toBe(def.id);
      expect(def.needsTerminal).toBe(true);
      expect(def.installUrl).toMatch(/^https:\/\//);
      expect(def.envInputs).toContain('SPLASH_PORT');
    }
  });

  it('marks hermes and pi as writing config files, with an undo', () => {
    const writers = CONNECTORS.filter((c) => c.writesFiles).map((c) => c.id);
    expect(writers).toEqual(['hermes', 'pi']);
    for (const def of CONNECTORS) {
      if (def.writesFiles) {
        expect(def.files.length).toBeGreaterThan(0);
        expect(def.undo).toBeTruthy();
      } else {
        expect(def.files).toEqual([]);
        expect(def.undo).toBeNull();
      }
    }
  });

  it('carries env options and headless launches', () => {
    expect(getConnector('opencode').envOptions.map((o) => o.env)).toEqual([
      'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX',
      'OPENCODE_CONFIG_CONTENT',
    ]);
    expect(getConnector('codex').envOptions).toEqual([]);
    expect(getConnector('claude').envOptions[0]).toMatchObject({
      env: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
      control: 'number',
      unit: 'tokens',
    });
    expect(getConnector('codex').headless?.args).toEqual(['exec', '--json', '-']);
  });

  it('rejects malformed entries', () => {
    expect(() => parseConnector({ id: 'vim' })).toThrow(/unknown id/);
    expect(() => parseConnector({ id: 'claude' })).toThrow(/label/);
    expect(() => parseConnector(null)).toThrow();
  });
});

describe('port-specific names', () => {
  it('uses splash on 8000 and splash-<port> elsewhere', () => {
    expect(profileName(8000)).toBe('splash');
    expect(profileName(8123)).toBe('splash-8123');
  });

  it('fills file paths and undo text', () => {
    const hermes = getConnector('hermes');
    expect(connectorFiles(hermes, 8000)).toEqual([
      '~/.hermes/profiles/splash/config.yaml (API key in plain text)',
    ]);
    expect(connectorFiles(hermes, 9000)[0]).toContain('profiles/splash-9000/config.yaml');
    expect(connectorUndo(hermes, 9000)).toMatch(/^hermes profile delete splash-9000/);
    expect(connectorUndo(getConnector('pi'), 8000)).toBe(
      'remove providers.splash (or splash-8000) from models.json',
    );
    expect(connectorUndo(getConnector('claude'), 8000)).toBeNull();
    expect(connectorFiles(getConnector('claude'), 8000)).toEqual([]);
  });
});

describe('version gates', () => {
  it('reads the minimum Splash version', () => {
    expect(minSplashVersion(getConnector('pi'))).toBe('1.1.0');
    expect(minSplashVersion(getConnector('hermes'))).toBe('1.0');
  });

  it('compares versions', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.9', '1.1')).toBe(-1);
    expect(isSupportedBy(getConnector('pi'), '1.0.4')).toBe(false);
    expect(isSupportedBy(getConnector('pi'), '1.2.0')).toBe(true);
    expect(isSupportedBy(getConnector('pi'), null)).toBe(true);
  });
});

describe('client configs', () => {
  const byId = (id: string) => {
    const def = CLIENT_CONFIGS.find((c) => c.id === id);
    if (!def) throw new Error(id);
    return def;
  };

  it('lists the copy-config cards', () => {
    expect(CLIENT_CONFIGS.map((c) => c.id)).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'open-webui',
      'jan',
    ]);
    expect(byId('open-webui').steps.length).toBeGreaterThan(0);
    expect(byId('jan').serveRequirements).toMatchObject({ allowed_origin: ['tauri://localhost'] });
  });

  it('fills the running server values', () => {
    const openai = renderClientConfig(byId('openai-compatible'), {
      port: 8000,
      model: 'qwen3',
    });
    expect(openai).toMatchObject({
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKey: 'local',
      model: 'qwen3',
      unresolved: [],
    });
    const anthropic = renderClientConfig(byId('anthropic-compatible'), {
      port: 8001,
      apiKey: 'sk-1',
      model: 'm',
    });
    expect(anthropic.baseUrl).toBe('http://127.0.0.1:8001');
    expect(anthropic.apiKey).toBe('sk-1');
  });

  it('reports what it could not fill', () => {
    const webui = renderClientConfig(byId('open-webui'), { port: 8000 });
    expect(webui.baseUrl).toBe("http://<this Mac's LAN IP>:8000/v1");
    expect(webui.unresolved).toEqual(["<this Mac's LAN IP>", '<key>', '<model ID>']);
    const filled = renderClientConfig(byId('open-webui'), {
      port: 8000,
      lanIp: '192.168.1.5',
      apiKey: 'k',
      model: 'm',
    });
    expect(filled.baseUrl).toBe('http://192.168.1.5:8000/v1');
    expect(filled.unresolved).toEqual([]);
  });
});
