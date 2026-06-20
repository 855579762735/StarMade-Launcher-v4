import React from 'react';
import { TrashIcon, CloseIcon } from './icons';

interface DeleteConfirmModalProps {
    isOpen: boolean;
    itemName: string;
    itemTypeName: string;
    /**
     * Absolute path of the installation on disk. Shown to the user so they can
     * see exactly what "Delete files" would remove before committing.
     */
    itemPath?: string;
    error?: string | null;
    /** Remove the item from the launcher only; files on disk are left untouched. */
    onRemoveFromLauncher: () => void;
    /** Move the item's files to the Recycle Bin, then remove it from the launcher. */
    onDeleteFiles: () => void;
    onCancel: () => void;
}

/**
 * Two-step removal dialog.
 *
 * The safe, primary action is "Remove from launcher" — it only drops the record
 * and never touches disk. "Delete files" is a clearly-marked secondary action
 * that shows the exact path and moves the folder to the Recycle Bin (recoverable),
 * so a user who accidentally tracked the wrong folder (e.g. Downloads) sees the
 * path and stops before destroying data.
 */
const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
    isOpen,
    itemName,
    itemTypeName,
    itemPath,
    error,
    onRemoveFromLauncher,
    onDeleteFiles,
    onCancel,
}) => {
    if (!isOpen) {
        return null;
    }

    const lowerType = itemTypeName.toLowerCase();

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-danger/30 rounded-xl shadow-2xl shadow-starmade-danger/10 w-full max-w-lg p-8 animate-fade-in-scale">
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-danger-dark/50 border-2 border-starmade-danger/50">
                        <TrashIcon className="w-8 h-8 text-starmade-danger-light" />
                    </div>

                    <h2 className="font-display text-2xl font-bold uppercase text-white tracking-wider">
                        Remove {itemTypeName}?
                    </h2>
                    <p className="mt-3 text-gray-300 max-w-sm mx-auto leading-relaxed">
                        Remove{' '}
                        <span className="font-semibold text-white">{itemName}</span>{' '}
                        from the launcher. Choose whether to keep the files on disk or
                        move them to the Recycle Bin.
                    </p>

                    {itemPath && (
                        <div className="mt-4 w-full text-xs text-gray-300 bg-black/30 border border-white/10 rounded-md px-3 py-2 text-left break-all">
                            <span className="font-semibold text-gray-400">Folder on disk: </span>
                            <span className="font-mono text-white">{itemPath}</span>
                        </div>
                    )}

                    <p className="mt-3 text-sm text-gray-400 max-w-sm mx-auto leading-relaxed">
                        <span className="font-semibold text-gray-300">Remove from launcher</span>{' '}
                        leaves every file where it is. <span className="font-semibold text-red-300">Delete files</span>{' '}
                        moves the folder above to the Recycle Bin — recoverable from there if it was a mistake.
                    </p>

                    {error && (
                        <div className="mt-4 w-full text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded-md px-3 py-2 text-left break-words">
                            <span className="font-semibold">Error: </span>{error}
                        </div>
                    )}
                </div>

                <div className="mt-8 flex justify-center items-center gap-4 flex-wrap">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 transition-colors text-sm font-semibold uppercase tracking-wider"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onRemoveFromLauncher}
                        className="px-6 py-2 rounded-md bg-starmade-accent hover:brightness-110 transition-colors text-sm font-bold uppercase tracking-wider"
                    >
                        Remove from launcher
                    </button>
                    <button
                        onClick={onDeleteFiles}
                        className="px-6 py-2 rounded-md bg-starmade-danger hover:bg-starmade-danger-hover transition-colors text-sm font-bold uppercase tracking-wider shadow-danger hover:shadow-danger-hover"
                    >
                        Delete files
                    </button>
                </div>

                <p className="mt-3 text-center text-[11px] text-gray-500">
                    "Remove from launcher" is the safe option — it never deletes any {lowerType} files.
                </p>

                <button
                    onClick={onCancel}
                    className="absolute top-3 right-4 p-2 rounded-full hover:bg-starmade-danger/20 transition-colors"
                    aria-label="Close"
                >
                    <CloseIcon className="w-6 h-6 text-gray-400 hover:text-starmade-danger-light" />
                </button>
            </div>
        </div>
    );
};

export default DeleteConfirmModal;
