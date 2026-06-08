import { ENDPOINTS, PLAYER_SOURCES } from '../core/constants.js';

const MPRIS_URL = ENDPOINTS.MPRIS;
const MPRIS_CONTROL_URL = ENDPOINTS.MPRIS_CONTROL;
const MPRIS_POLL_INTERVAL = 1000;

export const createMprisController = ({
    isMprisSource,
    setPlayerSong,
    showSavedLastSong,
    setPlaybackState,
    setStatusText,
    setProgressSlider,
    setNowPlayingText,
}) => {
    let isFetchingMpris = false;
    let mprisPollTimer;
    let mprisFetchRun = 0;
    let pendingForcedMprisRefresh = false;

    const fetchSong = async ({ force = false } = {}) => {
        if (!isMprisSource()) {
            return;
        }

        if (isFetchingMpris) {
            pendingForcedMprisRefresh = pendingForcedMprisRefresh || force;
            return;
        }

        const run = ++mprisFetchRun;

        try {
            isFetchingMpris = true;
            const response = await fetch(MPRIS_URL, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error('mpris unavailable');
            }

            if (run !== mprisFetchRun || !isMprisSource()) {
                return;
            }

            setPlayerSong({ ...await response.json(), source: PLAYER_SOURCES.MPRIS }, { forceRender: force });
        } catch {
            if (run !== mprisFetchRun || !isMprisSource()) {
                return;
            }

            if (!showSavedLastSong('mpris unavailable')) {
                setPlaybackState('stopped');
                setStatusText('mpris unavailable');
                setProgressSlider(null, null);
                setNowPlayingText('nothing playing', 'empty');
            }
        } finally {
            isFetchingMpris = false;

            if (pendingForcedMprisRefresh && isMprisSource()) {
                pendingForcedMprisRefresh = false;
                fetchSong({ force: true });
            }
        }
    };

    const sendControl = async (action, params = {}) => {
        try {
            const controlUrl = new URL(MPRIS_CONTROL_URL, window.location.origin);
            controlUrl.searchParams.set('action', action);

            Object.entries(params).forEach(([key, value]) => {
                controlUrl.searchParams.set(key, value);
            });

            await fetch(controlUrl.toString(), { cache: 'no-store' });
            fetchSong();
        } catch {
            setStatusText('mpris control failed', { updateWidth: false });
        }
    };

    const stopPolling = () => {
        clearInterval(mprisPollTimer);
        mprisPollTimer = null;
        pendingForcedMprisRefresh = false;
        mprisFetchRun += 1;
    };

    const startPolling = ({ force = false } = {}) => {
        fetchSong({ force });

        if (mprisPollTimer) {
            return;
        }

        mprisPollTimer = setInterval(fetchSong, MPRIS_POLL_INTERVAL);
    };

    return {
        fetchSong,
        sendControl,
        startPolling,
        stopPolling,
    };
};
