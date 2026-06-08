import { buildNavidromeLibraryUrl } from '../services/navidrome-client.js';
import { formatTrackDuration, getCardColors, getStatusCard } from './cards.js';

const createInitialModeMap = (valueFactory) => ({
    artists: valueFactory(),
    albums: valueFactory(),
    artistAlbums: valueFactory(),
    albumTracks: valueFactory(),
});

export const createLibraryDataController = ({
    covers,
    getDeckMode = () => '',
    getDeckCurrentOffset = () => 0,
    onRefreshDeck = () => {},
    onRenderDeck = () => {},
} = {}) => {
    const deckCards = createInitialModeMap(() => []);
    const libraryLoadState = createInitialModeMap(() => 'idle');
    const libraryFetchControllers = createInitialModeMap(() => null);

    let libraryDataRun = 0;
    let artistAlbumContext = null;
    let albumTracksContext = null;
    let artistDeckReturnOffset = null;

    const getContextState = () => ({ artistAlbumContext, albumTracksContext });

    const getDeckCards = (mode) => deckCards[mode]?.length
        ? deckCards[mode]
        : [getStatusCard(mode, { libraryLoadState, artistAlbumContext, albumTracksContext })];

    const fetchLibraryMode = async (mode, force = false, context = null) => {
        const requestRun = libraryDataRun;
        const isContextMode = mode === 'artistAlbums' || mode === 'albumTracks';
        const requestContext = mode === 'artistAlbums'
            ? (context || artistAlbumContext)
            : mode === 'albumTracks' ? (context || albumTracksContext) : null;

        if (!force && !isContextMode && (libraryLoadState[mode] === 'loaded' || libraryLoadState[mode] === 'loading')) {
            return;
        }

        const url = buildNavidromeLibraryUrl(mode, requestContext);
        if (!url) {
            deckCards[mode] = [];
            libraryLoadState[mode] = 'idle';
            onRefreshDeck(mode);
            return;
        }

        libraryFetchControllers[mode]?.abort();
        libraryFetchControllers[mode] = new AbortController();
        libraryLoadState[mode] = 'loading';
        deckCards[mode] = [];
        onRefreshDeck(mode);

        try {
            const response = await fetch(url.toString(), {
                cache: 'no-store',
                signal: libraryFetchControllers[mode].signal,
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || 'library failed');
            }

            if (requestRun !== libraryDataRun
                || (mode === 'artistAlbums' && requestContext?.id !== artistAlbumContext?.id)
                || (mode === 'albumTracks' && requestContext?.id !== albumTracksContext?.id)) {
                return;
            }

            const useAlbumCoverForTracks = mode === 'albumTracks' && !covers.shouldFetchIndividualTrackCovers();
            const albumCoverSource = useAlbumCoverForTracks ? {
                id: requestContext?.id || '',
                coverArt: requestContext?.coverArt || '',
                imageUrl: requestContext?.imageUrl || '',
                type: 'album',
            } : null;
            const payloadItems = mode === 'albumTracks'
                ? (payload.tracks || []).map((track, index) => ({
                    ...track,
                    title: track.title || `track ${index + 1}`,
                    subtitle: [track.artist || requestContext?.artist || '', track.album || requestContext?.title || '']
                        .filter(Boolean)
                        .join(' · '),
                    tracks: 1,
                    countLabel: `#${track.track || index + 1}`,
                    durationLabel: formatTrackDuration(track.duration),
                    type: 'song',
                    coverArt: useAlbumCoverForTracks ? (albumCoverSource.coverArt || '') : track.coverArt,
                    imageUrl: useAlbumCoverForTracks ? (albumCoverSource.imageUrl || '') : track.imageUrl,
                }))
                : (payload.items || []);

            deckCards[mode] = payloadItems.map((item, index) => {
                const coverSource = useAlbumCoverForTracks ? albumCoverSource : item;
                const hasCoverPointer = Boolean(coverSource?.coverArt || coverSource?.imageUrl || coverSource?.type === 'artist');
                const coverKey = covers.getCoverKey(coverSource || item);
                const cachedCover = covers.hasCachedCover(coverKey) ? covers.getCachedCover(coverKey) : '';
                const coverRequestUrl = useAlbumCoverForTracks
                    ? (requestContext?.coverRequestUrl || (hasCoverPointer ? covers.buildCoverUrl(coverSource)?.toString() : '') || '')
                    : (covers.buildCoverUrl(coverSource)?.toString() || '');
                const coverCacheUrl = useAlbumCoverForTracks
                    ? (requestContext?.coverCacheUrl || (hasCoverPointer ? covers.buildCoverCacheUrl(coverSource)?.toString() : '') || '')
                    : (covers.buildCoverCacheUrl(coverSource)?.toString() || '');
                return {
                    ...item,
                    coverKey,
                    coverRequestUrl,
                    coverCacheUrl,
                    coverUrl: cachedCover || (useAlbumCoverForTracks ? requestContext?.coverUrl : '') || coverRequestUrl,
                    palette: covers.getPalette(coverKey) || (useAlbumCoverForTracks ? requestContext?.palette : null) || null,
                    colors: getCardColors(item.title, index),
                };
            });
            libraryLoadState[mode] = deckCards[mode].length ? 'loaded' : 'empty';
            if (deckCards[mode].length) {
                covers.queueCoverCaching(mode, deckCards[mode], requestRun);
            }
        } catch (error) {
            if (error?.name === 'AbortError') {
                return;
            }

            deckCards[mode] = [];
            libraryLoadState[mode] = 'error';
        } finally {
            if (mode === 'artistAlbums' && requestContext?.id === artistAlbumContext?.id) {
                onRenderDeck('artistAlbums', { drop: true });
                return;
            }

            if (mode === 'albumTracks' && requestContext?.id === albumTracksContext?.id) {
                onRenderDeck('albumTracks', { drop: true });
                return;
            }

            onRefreshDeck(mode);
        }
    };

    const resetLibraryDeckData = () => {
        Object.keys(deckCards).forEach((mode) => {
            libraryFetchControllers[mode]?.abort();
            deckCards[mode] = [];
            libraryLoadState[mode] = 'idle';
        });

        covers.resetAll();
        libraryDataRun += 1;
        artistAlbumContext = null;
        albumTracksContext = null;
        artistDeckReturnOffset = null;
        if (getDeckMode()) {
            onRefreshDeck(getDeckMode());
        }
    };

    const clearContexts = () => {
        artistAlbumContext = null;
        albumTracksContext = null;
        artistDeckReturnOffset = null;
    };

    const warmLibraryCache = () => {
        if (!buildNavidromeLibraryUrl('artists')) {
            return;
        }

        fetchLibraryMode('artists');
        fetchLibraryMode('albums');
    };

    const openArtistAlbums = (artist) => {
        if (!artist?.id) {
            return;
        }

        if (getDeckMode() === 'artists') {
            artistDeckReturnOffset = getDeckCurrentOffset();
        }

        artistAlbumContext = { id: artist.id, title: artist.title || 'artist' };
        libraryLoadState.artistAlbums = 'loading';
        deckCards.artistAlbums = [];
        fetchLibraryMode('artistAlbums', true, artistAlbumContext);
    };

    const openAlbumTracks = (album) => {
        if (!album?.id) {
            return;
        }

        covers.preloadNowPlayingBackground(album, {
            album: album.title || 'album',
            artist: album.subtitle || album.artist || artistAlbumContext?.title || '',
        });

        albumTracksContext = {
            id: album.id,
            title: album.title || 'album',
            artist: album.subtitle || album.artist || artistAlbumContext?.title || '',
            coverArt: album.coverArt || '',
            imageUrl: album.imageUrl || '',
            coverKey: album.coverKey || covers.getCoverKey(album),
            coverRequestUrl: album.coverRequestUrl || '',
            coverCacheUrl: album.coverCacheUrl || '',
            coverUrl: album.coverUrl || '',
            palette: album.palette || null,
            returnMode: getDeckMode() === 'artistAlbums' ? 'artistAlbums' : 'albums',
            returnOffset: getDeckCurrentOffset(),
            artistContext: artistAlbumContext ? { ...artistAlbumContext } : null,
        };
        libraryLoadState.albumTracks = 'loading';
        deckCards.albumTracks = [];
        fetchLibraryMode('albumTracks', true, albumTracksContext);
    };

    const backToPreviousLibraryView = () => {
        if (!document.body.classList.contains('library-mode')) {
            return;
        }

        if (getDeckMode() === 'albumTracks') {
            const context = albumTracksContext;
            const returnMode = context?.returnMode === 'artistAlbums' ? 'artistAlbums' : 'albums';
            const restoreOffset = context?.returnOffset;
            artistAlbumContext = returnMode === 'artistAlbums' ? context?.artistContext : null;
            albumTracksContext = null;
            onRenderDeck(returnMode, { drop: true, direction: 'up', restoreOffset });
            if (!deckCards[returnMode]?.length) {
                fetchLibraryMode(returnMode, false, artistAlbumContext);
            }
            return;
        }

        const restoreOffset = artistDeckReturnOffset;
        artistAlbumContext = null;
        albumTracksContext = null;
        onRenderDeck('artists', { drop: true, direction: 'up', restoreOffset });
        fetchLibraryMode('artists');
    };

    const handleRuntimeCacheCleared = (cache) => {
        covers.clearRuntimeCache(cache);

        Object.values(deckCards).flat().forEach((item) => {
            item.palette = null;
            if (cache === 'covers') {
                item.coverUrl = '';
            }
        });
    };

    return {
        backToPreviousLibraryView,
        clearContexts,
        fetchLibraryMode,
        getAllCards: () => Object.values(deckCards).flat(),
        getContextState,
        getDataRun: () => libraryDataRun,
        getDeckCards,
        handleRuntimeCacheCleared,
        openAlbumTracks,
        openArtistAlbums,
        resetLibraryDeckData,
        warmLibraryCache,
    };
};
