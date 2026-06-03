import type { DownloadStatus } from '../types';

/**
 * True while a download is in progress (verifying checksums or downloading
 * files). Used to keep an installation visible/selectable while it is being
 * (re-)downloaded even though its `installed` flag is temporarily `false`.
 */
export const isActivelyDownloading = (status?: DownloadStatus): boolean =>
    status?.state === 'checksums' || status?.state === 'downloading';
