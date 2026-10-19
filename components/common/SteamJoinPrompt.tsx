import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useData } from '../../contexts/DataContext';

/**
 * Lands a Steam friend join ("Join Game" / an accepted invite) on the host's
 * game version: launches an installed copy of it, or offers to download one.
 * The main process only forwards the join to a launch of that version.
 */
const SteamJoinPrompt: React.FC = () => {
    const { openLaunchModal } = useApp();
    const { isLoaded, installations, versions, isVersionsLoading, downloadStatuses, addInstallation, downloadVersion, getInstallationDefaults } = useData();
    const [join, setJoin] = useState<{ version?: string } | null>(null);
    const [downloadId, setDownloadId] = useState<string | null>(null);

    useEffect(() => {
        const app = window.launcher?.app;
        if (!app?.getPendingSteamJoin) return;
        const refresh = () => { app.getPendingSteamJoin().then(setJoin).catch(() => {}); };
        refresh();
        return app.onSteamJoinRequested(refresh);
    }, []);

    // Also fires when a download started below completes (installed flips to true).
    useEffect(() => {
        if (!join || !isLoaded) return;
        // Hosts on older builds send no version; their join goes with the next Play.
        if (!join.version) return setJoin(null);
        const match = installations.find(i => i.version === join.version && i.installed !== false && !i.isRemote);
        if (!match) return;
        setJoin(null);
        setDownloadId(null);
        void openLaunchModal(match);
    }, [join, isLoaded, installations, openLaunchModal]);

    const target = versions.find(v => v.id === join?.version);
    const status = downloadId ? downloadStatuses[downloadId] : undefined;

    const download = useCallback(async () => {
        if (!target) return;
        const defaults = (await window.launcher.store.get('defaultInstallationSettings').catch(() => null)) as { gameDir?: string } | null;
        const dir = defaults?.gameDir || await window.launcher.app.getDefaultGameDir(false).catch(() => '');
        const item = {
            ...getInstallationDefaults(),
            name: `StarMade ${target.id}`,
            version: target.id,
            type: target.type,
            icon: target.type,
            path: `${dir}/StarMade-${target.id}`,
            buildPath: target.buildPath,
            requiredJavaVersion: target.requiredJavaVersion,
        };
        addInstallation(item);
        downloadVersion(item.id);
        setDownloadId(item.id);
    }, [target, getInstallationDefaults, addInstallation, downloadVersion]);

    const cancel = () => {
        void window.launcher?.app?.clearPendingSteamJoin();
        setJoin(null);
        setDownloadId(null);
    };

    if (!join?.version || !isLoaded) return null;

    let message: string;
    if (status?.state === 'error') message = `Download failed: ${status.error ?? 'unknown error'}`;
    else if (downloadId) message = `Downloading StarMade ${join.version}… ${Math.round(status?.percent ?? 0)}%. The game starts when it finishes.`;
    else if (target) message = `Your friend is playing StarMade ${join.version}, which you don't have installed.`;
    else if (isVersionsLoading) message = `Your friend is playing StarMade ${join.version}. Checking available versions…`;
    else message = `Your friend is playing StarMade ${join.version}, which isn't available to download.`;

    return (
        <div className="fixed top-16 right-6 z-50 max-w-md animate-fade-in-scale" role="alertdialog" aria-label="Join friend">
            <div className="px-4 py-3 rounded-lg bg-slate-900/95 backdrop-blur-sm border border-starmade-accent/40 shadow-lg shadow-black/40">
                <p className="text-sm font-bold uppercase tracking-wider text-starmade-accent">Join friend</p>
                <p className="mt-1 text-sm text-gray-300 break-words">{message}</p>
                <div className="mt-3 flex justify-end gap-2">
                    {target && !downloadId && (
                        <button
                            onClick={() => void download()}
                            className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-white"
                        >
                            Download &amp; join
                        </button>
                    )}
                    <button
                        onClick={cancel}
                        className="px-2 py-1 text-xs font-medium rounded hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                    >
                        {downloadId ? 'Don’t join' : 'Cancel'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SteamJoinPrompt;
