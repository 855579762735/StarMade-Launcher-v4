import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../../contexts/DataContext';
import { useApp } from '../../contexts/AppContext';

const SK_IGNORED_UPDATES = 'ignoredGameUpdates';

const GameUpdateNotice: React.FC = () => {
  const { installations, selectedInstallationId, versions } = useData();
  const { navigate } = useApp();
  const [ignoredUpdates, setIgnoredUpdates] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.launcher?.store?.get(SK_IGNORED_UPDATES).then((val) => {
      if (val && typeof val === 'object') setIgnoredUpdates(val as Record<string, string>);
    }).catch(() => {});
  }, []);

  const selectedInstallation = useMemo(
    () => installations.find((i) => i.id === selectedInstallationId) ?? null,
    [installations, selectedInstallationId],
  );

  const availableUpdate = useMemo(() => {
    if (!selectedInstallation || !versions.length) return null;

    const currentVersion = selectedInstallation.version;
    const branch = selectedInstallation.type;

    const branchVersions = versions.filter((v) => v.type === branch);
    if (branchVersions.length === 0) return null;

    const latest = branchVersions[0];
    if (!latest || latest.id === currentVersion) return null;

    if (ignoredUpdates[selectedInstallation.id] === latest.id) return null;

    return { from: currentVersion, to: latest.id, toName: latest.name };
  }, [selectedInstallation, versions, ignoredUpdates]);

  useEffect(() => {
    setDismissed(false);
  }, [selectedInstallationId]);

  if (!availableUpdate || dismissed) return null;

  const handleUpdate = () => {
    navigate('Installations');
  };

  const handleIgnore = async () => {
    if (!selectedInstallation) return;
    const next = { ...ignoredUpdates, [selectedInstallation.id]: availableUpdate.to };
    setIgnoredUpdates(next);
    setDismissed(true);
    await window.launcher?.store?.set(SK_IGNORED_UPDATES, next);
  };

  return (
    <div className="fixed top-16 right-6 z-40 animate-fade-in-scale">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-900/90 backdrop-blur-sm border border-starmade-accent/30 shadow-lg shadow-black/30">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Update:</span>
          <span className="font-mono text-gray-500">{availableUpdate.from}</span>
          <span className="text-gray-600">&rarr;</span>
          <span className="font-mono text-starmade-accent font-semibold">{availableUpdate.to}</span>
        </div>
        <button
          onClick={handleUpdate}
          className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-white"
        >
          Update
        </button>
        <button
          onClick={() => void handleIgnore()}
          className="px-2 py-1 text-xs font-medium rounded hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
        >
          Ignore
        </button>
      </div>
    </div>
  );
};

export default GameUpdateNotice;
