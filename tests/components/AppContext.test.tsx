// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { AppProvider, useApp } from '../../contexts/AppContext';
import type { ManagedItem } from '../../types';

const mockUseData = vi.fn();
const mockRecordSession = vi.fn();

vi.mock('../../contexts/DataContext', () => ({
  useData: () => mockUseData(),
}));

const installation: ManagedItem = {
  id: 'install-1',
  name: 'Test Installation',
  version: '0.203.175',
  type: 'release',
  icon: 'release',
  path: '/tmp/starmade',
  lastPlayed: 'Never',
};

const LaunchHarness: React.FC = () => {
  const { openLaunchModal, logViewerOpen } = useApp();

  return (
    <>
      <button onClick={() => void openLaunchModal(installation)}>Launch</button>
      <span data-testid="log-viewer-state">{logViewerOpen ? 'open' : 'closed'}</span>
    </>
  );
};

const ServerPanelHarness: React.FC = () => {
  const { serverPanelEnabled } = useApp();
  return <span data-testid="server-panel-state">{serverPanelEnabled ? 'on' : 'off'}</span>;
};

const serverItem: ManagedItem = {
  id: 'server-1',
  name: 'My Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: '/tmp/starmade-server',
  lastPlayed: 'Never',
};

const flushLaunch = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('AppContext post-launch behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRecordSession.mockReset();
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [installation],
      versions: [],
      recordSession: mockRecordSession,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the launcher after a successful launch when closeBehavior is set to close', async () => {
    const close = vi.fn();
    const hide = vi.fn();
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 1234 });

    (window as unknown as Record<string, unknown>).launcher = {
      game: {
        launch,
        listRunning: vi.fn().mockResolvedValue([]),
      },
      store: {
        get: vi.fn().mockResolvedValue({ closeBehavior: 'Close launcher', showLog: true }),
      },
      window: {
        close,
        hide,
        minimize: vi.fn(),
      },
    };

    render(
      <AppProvider>
        <LaunchHarness />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Launch'));
    });

    await flushLaunch();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
    expect(mockRecordSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('log-viewer-state')).toHaveTextContent('closed');
  });

  it('hides the launcher after a successful launch when closeBehavior is set to hide', async () => {
    const close = vi.fn();
    const hide = vi.fn();
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 9876 });

    (window as unknown as Record<string, unknown>).launcher = {
      game: {
        launch,
        listRunning: vi.fn().mockResolvedValue([]),
      },
      store: {
        get: vi.fn().mockResolvedValue({ closeBehavior: 'Hide launcher', showLog: false }),
      },
      window: {
        close,
        hide,
        minimize: vi.fn(),
      },
    };

    render(
      <AppProvider>
        <LaunchHarness />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Launch'));
    });

    await flushLaunch();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the launcher open and opens the log viewer when requested', async () => {
    const close = vi.fn();
    const hide = vi.fn();
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 5678 });

    (window as unknown as Record<string, unknown>).launcher = {
      game: {
        launch,
        listRunning: vi.fn().mockResolvedValue([]),
      },
      store: {
        get: vi.fn().mockResolvedValue({ closeBehavior: 'Keep the launcher open', showLog: true }),
      },
      window: {
        close,
        hide,
        minimize: vi.fn(),
      },
    };

    render(
      <AppProvider>
        <LaunchHarness />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Launch'));
    });

    await flushLaunch();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('log-viewer-state')).toHaveTextContent('open');
    expect(close).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });
});

describe('AppContext Java pre-launch (ensure + persist)', () => {
  const java21Install: ManagedItem = {
    id: 'install-21',
    name: 'Java 21 Install',
    version: '0.300.0',
    type: 'release',
    icon: 'release',
    path: '/tmp/sm21',
    lastPlayed: 'Never',
    requiredJavaVersion: 21,
    customJavaPath: '/old/java8',
  };

  const Java21Harness: React.FC = () => {
    const { openLaunchModal } = useApp();
    return <button onClick={() => void openLaunchModal(java21Install)}>Launch21</button>;
  };

  let updateInstallation: ReturnType<typeof vi.fn>;

  const flush = async () => {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };

  beforeEach(() => {
    updateInstallation = vi.fn();
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [java21Install],
      versions: [],
      recordSession: mockRecordSession,
      updateInstallation,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).launcher;
  });

  const setupLauncher = (ensureResult: Record<string, unknown>) => {
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 1 });
    const ensure = vi.fn().mockResolvedValue(ensureResult);
    const download = vi.fn();
    const set = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).launcher = {
      game: { launch, listRunning: vi.fn().mockResolvedValue([]) },
      java: { ensure, download },
      store: { get: vi.fn().mockResolvedValue({ closeBehavior: 'Keep the launcher open' }), set },
      window: { close: vi.fn(), hide: vi.fn(), minimize: vi.fn() },
    };
    return { launch, ensure, download, set };
  };

  it('does not download when a usable Java already exists, and launches with it', async () => {
    const { launch, ensure, download } = setupLauncher({
      success: true, path: '/old/java8', downloaded: false, usedPreferred: true,
    });

    render(<AppProvider><Java21Harness /></AppProvider>);
    await act(async () => { fireEvent.click(screen.getByText('Launch21')); });
    await flush();

    expect(ensure).toHaveBeenCalledWith(21, '/old/java8');
    expect(download).not.toHaveBeenCalled();
    expect(updateInstallation).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0]).toMatchObject({ customJavaPath: '/old/java8' });
  });

  it('refreshes the stale install path and default setting when a new runtime is resolved', async () => {
    const { launch, set } = setupLauncher({
      success: true, path: '/jre21/bin/javaw.exe', downloaded: false, usedPreferred: false,
    });

    render(<AppProvider><Java21Harness /></AppProvider>);
    await act(async () => { fireEvent.click(screen.getByText('Launch21')); });
    await flush();

    expect(updateInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'install-21', customJavaPath: '/jre21/bin/javaw.exe' }),
    );
    expect(set).toHaveBeenCalledWith(
      'defaultInstallationSettings',
      expect.objectContaining({ javaPath21: '/jre21/bin/javaw.exe' }),
    );
    expect(launch.mock.calls[0][0]).toMatchObject({ customJavaPath: '/jre21/bin/javaw.exe' });
  });

  it('aborts the launch when Java cannot be prepared', async () => {
    const { launch } = setupLauncher({ success: false, error: 'network down' });

    render(<AppProvider><Java21Harness /></AppProvider>);
    await act(async () => { fireEvent.click(screen.getByText('Launch21')); });
    await flush();

    expect(launch).not.toHaveBeenCalled();
  });
});

describe('AppContext server-panel migration', () => {
  beforeEach(() => {
    mockRecordSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).launcher;
  });

  const renderWithData = (data: Record<string, unknown>) => {
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [installation],
      versions: [],
      recordSession: mockRecordSession,
      ...data,
    });
    return render(
      <AppProvider>
        <ServerPanelHarness />
      </AppProvider>,
    );
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('grandfathers in existing hosts: no stored flag + existing servers → enabled', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).launcher = {
      store: { get: vi.fn().mockResolvedValue({ showLog: true }), set },
    };

    renderWithData({ servers: [serverItem], isLoaded: true });
    await flush();

    expect(screen.getByTestId('server-panel-state')).toHaveTextContent('on');
    expect(set).toHaveBeenCalledWith(
      'launcherSettings',
      expect.objectContaining({ enableServerPanel: true }),
    );
  });

  it('fresh install: no stored flag + no servers → hidden and persisted false', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).launcher = {
      store: { get: vi.fn().mockResolvedValue(null), set },
    };

    renderWithData({ servers: [], isLoaded: true });
    await flush();

    expect(screen.getByTestId('server-panel-state')).toHaveTextContent('off');
    expect(set).toHaveBeenCalledWith(
      'launcherSettings',
      expect.objectContaining({ enableServerPanel: false }),
    );
  });

  it('honours an explicit stored flag without re-migrating', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).launcher = {
      store: {
        get: vi.fn().mockResolvedValue({ enableServerPanel: false }),
        set,
      },
    };

    // Has servers, but the flag was explicitly turned off — must stay off.
    renderWithData({ servers: [serverItem], isLoaded: true });
    await flush();

    expect(screen.getByTestId('server-panel-state')).toHaveTextContent('off');
    expect(set).not.toHaveBeenCalled();
  });
});

