import React, { useCallback, useEffect, useRef, useState } from 'react';

type SyncDirection = 'catalog-to-install' | 'install-to-catalog' | 'bidirectional';

interface SyncProgress {
  percent: number;
  currentItem: string;
  copiedCount: number;
  totalCount: number;
}

interface SyncToolbarProps {
  catalogPath: string;
  installationPath: string;
  kinds: Array<'blueprint' | 'exported' | 'template'>;
  autoSyncStoreKey: string;
  onSyncComplete: () => void;
}

const DIRECTION_LABELS: Record<SyncDirection, string> = {
  'catalog-to-install': 'Catalog → Install',
  'install-to-catalog': 'Install → Catalog',
  'bidirectional': 'Bidirectional (newer wins)',
};

const SyncToolbar: React.FC<SyncToolbarProps> = ({
  catalogPath,
  installationPath,
  kinds,
  autoSyncStoreKey,
  onSyncComplete,
}) => {
  const [direction, setDirection] = useState<SyncDirection>('catalog-to-install');
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const autoSyncRanRef = useRef(false);

  useEffect(() => {
    window.launcher?.store?.get(autoSyncStoreKey).then((val) => {
      if (typeof val === 'string') {
        setDirection(val as SyncDirection);
        setAutoSync(true);
      }
    }).catch(() => {});
  }, [autoSyncStoreKey]);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const runSync = useCallback(async (dir?: SyncDirection) => {
    const syncDir = dir ?? direction;
    if (!catalogPath || !installationPath) return;
    setIsSyncing(true);
    setProgress(null);
    setResult(null);
    setError(null);

    cleanupRef.current?.();
    const unsub = window.launcher.catalog.onSyncProgress((p) => setProgress(p));
    cleanupRef.current = unsub;

    try {
      if (syncDir === 'bidirectional') {
        // Bidirectional: compute diff, deploy new/modified from catalog, import new from install
        const diff = await window.launcher.catalog.syncDiff(catalogPath, installationPath, kinds);
        const toInstall = diff.items.filter((i) => i.status === 'new' || i.status === 'modified').map((i) => i.ref);

        // Also compute reverse diff (install → catalog) for items only in install
        const reverseDiff = await window.launcher.catalog.syncDiff(installationPath, catalogPath, kinds);
        const toCatalog = reverseDiff.items.filter((i) => i.status === 'new').map((i) => i.ref);

        let totalCopied = 0;
        let totalSkipped = 0;
        const allErrors: string[] = [];

        if (toInstall.length > 0) {
          const r = await window.launcher.catalog.syncApply(catalogPath, toInstall, installationPath, true, 'deploy');
          totalCopied += r.copiedCount ?? 0;
          totalSkipped += r.skippedCount ?? 0;
          if (r.errors?.length) allErrors.push(...r.errors);
        }

        if (toCatalog.length > 0) {
          const r = await window.launcher.catalog.syncApply(catalogPath, toCatalog, installationPath, true, 'import');
          totalCopied += r.copiedCount ?? 0;
          totalSkipped += r.skippedCount ?? 0;
          if (r.errors?.length) allErrors.push(...r.errors);
        }

        if (allErrors.length > 0) setError(allErrors.join('; '));
        else setResult(`Synced ${totalCopied} item(s)${totalSkipped ? `, skipped ${totalSkipped}` : ''}`);
      } else if (syncDir === 'catalog-to-install') {
        const diff = await window.launcher.catalog.syncDiff(catalogPath, installationPath, kinds);
        const items = diff.items.filter((i) => i.status === 'new' || i.status === 'modified').map((i) => i.ref);
        if (items.length === 0) {
          setResult('Already up to date');
        } else {
          const r = await window.launcher.catalog.syncApply(catalogPath, items, installationPath, true, 'deploy');
          if (r.success) setResult(`Deployed ${r.copiedCount ?? 0} item(s)`);
          else setError(r.errors?.join('; ') ?? 'Sync failed');
        }
      } else {
        // install-to-catalog
        const diff = await window.launcher.catalog.syncDiff(installationPath, catalogPath, kinds);
        const items = diff.items.filter((i) => i.status === 'new' || i.status === 'modified').map((i) => i.ref);
        if (items.length === 0) {
          setResult('Already up to date');
        } else {
          const r = await window.launcher.catalog.syncApply(catalogPath, items, installationPath, true, 'import');
          if (r.success) setResult(`Imported ${r.copiedCount ?? 0} item(s)`);
          else setError(r.errors?.join('; ') ?? 'Sync failed');
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      cleanupRef.current?.();
      cleanupRef.current = null;
      setIsSyncing(false);
      setProgress(null);
      onSyncComplete();
    }
  }, [catalogPath, installationPath, kinds, direction, onSyncComplete]);

  // Auto-sync on mount if enabled
  useEffect(() => {
    if (!autoSync || autoSyncRanRef.current || !catalogPath || !installationPath) return;
    autoSyncRanRef.current = true;
    void runSync();
  }, [autoSync, catalogPath, installationPath, runSync]);

  const handleAutoSyncToggle = async (enabled: boolean) => {
    setAutoSync(enabled);
    if (enabled) {
      await window.launcher?.store?.set(autoSyncStoreKey, direction);
    } else {
      await window.launcher?.store?.delete(autoSyncStoreKey);
    }
  };

  const handleDirectionChange = async (dir: SyncDirection) => {
    setDirection(dir);
    if (autoSync) {
      await window.launcher?.store?.set(autoSyncStoreKey, dir);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/20 border border-white/5">
      <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Sync</span>

      <select
        value={direction}
        onChange={(e) => void handleDirectionChange(e.target.value as SyncDirection)}
        disabled={isSyncing}
        className="px-2 py-1 text-xs rounded bg-black/30 border border-white/10 text-gray-300 focus:outline-none focus:border-starmade-accent/50"
      >
        {Object.entries(DIRECTION_LABELS).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>

      <button
        onClick={() => void runSync()}
        disabled={isSyncing || !catalogPath || !installationPath}
        className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded bg-starmade-accent/80 hover:bg-starmade-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-white"
      >
        {isSyncing ? 'Syncing...' : 'Sync Now'}
      </button>

      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer ml-1">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => void handleAutoSyncToggle(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50"
        />
        Auto-sync
      </label>

      {/* Progress bar */}
      {isSyncing && progress && (
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <div className="flex-1 h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-starmade-accent transition-all duration-150 rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 whitespace-nowrap">
            {progress.copiedCount}/{progress.totalCount}
          </span>
          <span className="text-[10px] text-gray-600 truncate max-w-32">
            {progress.currentItem}
          </span>
        </div>
      )}

      {/* Result */}
      {!isSyncing && result && (
        <span className="text-xs text-green-400 ml-2">{result}</span>
      )}
      {!isSyncing && error && (
        <span className="text-xs text-red-400 ml-2 truncate max-w-60" title={error}>{error}</span>
      )}
    </div>
  );
};

export default SyncToolbar;
