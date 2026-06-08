export const CARD_COLORS = [
    ['#d8f3dc', '#40916c'],
    ['#b7e4c7', '#2d6a4f'],
    ['#95d5b2', '#1b4332'],
    ['#74c69d', '#52b788'],
    ['#d8f3dc', '#74c69d'],
    ['#52b788', '#081c15'],
];

const hashText = (value) => String(value || '').split('').reduce((hash, char) => (
    ((hash << 5) - hash) + char.charCodeAt(0)
), 0);

export const getCardColors = (title, index = 0) => CARD_COLORS[Math.abs(hashText(title) + index) % CARD_COLORS.length];

export const formatTrackDuration = (seconds) => {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }

    const minutes = Math.floor(value / 60);
    const remaining = Math.floor(value % 60);
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
};

export const formatAlbumDuration = (seconds) => {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }

    const totalMinutes = Math.max(1, Math.round(value / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) {
        return `${totalMinutes}m`;
    }

    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

export const getStatusCard = (mode, { libraryLoadState = {}, artistAlbumContext = null, albumTracksContext = null } = {}) => {
    const state = libraryLoadState[mode];
    const label = mode === 'artists' ? 'artists' : mode === 'albumTracks' ? 'tracks' : 'albums';

    if (state === 'loading') {
        return { title: `loading ${label}`, subtitle: 'navidrome', countLabel: 'please wait', colors: ['#d8f3dc', '#52b788'], isStatus: true };
    }

    if (state === 'error') {
        return { title: 'library failed', subtitle: 'check connection', countLabel: 'retry soon', colors: ['#b7e4c7', '#1b4332'], isStatus: true };
    }

    if (state === 'empty') {
        return { title: `no ${label} found`, subtitle: albumTracksContext?.title || artistAlbumContext?.title || 'navidrome', countLabel: 'empty', colors: ['#95d5b2', '#40916c'], isStatus: true };
    }

    return { title: 'connect navidrome', subtitle: 'open config', countLabel: 'needed', colors: ['#d8f3dc', '#40916c'], isStatus: true };
};

export const createDeckCard = (item, index = 0, covers = {}) => {
    const {
        title,
        subtitle = '',
        tracks = 0,
        duration = null,
        colors = CARD_COLORS[0],
        type = 'album',
        countLabel = '',
        durationLabel = '',
        coverKey = '',
        coverUrl = '',
        palette = null,
        isStatus = false,
    } = item;
    const card = document.createElement('article');
    const titleElement = document.createElement('h3');
    const titleText = document.createElement('span');
    const coverElement = document.createElement('div');
    const countElement = document.createElement('span');
    const durationElement = document.createElement('span');
    const tilts = ['-1deg', '1.2deg', '-0.35deg', '0.75deg'];
    const tilt = isStatus ? '-0.35deg' : tilts[index % tilts.length];
    const count = Number(tracks) || 0;
    const defaultCountLabel = type === 'artist'
        ? `${count} ${count === 1 ? 'album' : 'albums'}`
        : type === 'song' ? 'play' : `${count} ${count === 1 ? 'track' : 'tracks'}`;
    const defaultDurationLabel = type === 'album' ? formatAlbumDuration(duration) : '';
    const cardDurationLabel = durationLabel || defaultDurationLabel;

    card.className = 'library-card';
    card.classList.toggle('is-status-card', Boolean(isStatus));
    card.classList.toggle('is-album-card', type === 'album' && !isStatus);
    card.classList.toggle('is-track-card', type === 'song');
    card.tabIndex = isStatus ? -1 : 0;
    if (!isStatus) {
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', type === 'artist'
            ? `show albums by ${title}`
            : type === 'album' ? `show tracks from ${title}` : `play ${title}`);
    }
    card.dataset.tilt = tilt;
    if (coverKey) {
        card.dataset.coverKey = coverKey;
    }
    card.style.setProperty('--card-tilt', tilt);
    card.style.setProperty('--cover-a', colors[0]);
    card.style.setProperty('--cover-b', colors[1]);
    covers.applyPaletteToCard?.(card, palette);

    titleElement.className = 'library-card-title';
    titleText.className = 'library-card-title-text';
    titleText.textContent = title;
    titleElement.append(titleText);
    card.append(titleElement);

    if (subtitle) {
        const subtitleElement = document.createElement('p');
        subtitleElement.className = 'library-card-subtitle';
        subtitleElement.textContent = subtitle;
        card.append(subtitleElement);
    }

    coverElement.className = 'library-card-cover';
    coverElement.classList.toggle('has-cover', Boolean(coverUrl));
    coverElement.setAttribute('aria-hidden', 'true');
    if (coverUrl) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.setAttribute('aria-hidden', 'true');
        image.src = coverUrl;
        covers.queueImagePalette?.(card, image, coverKey);
        coverElement.append(image);
    }
    card.append(coverElement);

    countElement.className = 'library-card-count';
    countElement.textContent = countLabel || defaultCountLabel;
    card.append(countElement);

    if (cardDurationLabel) {
        durationElement.className = 'library-card-duration';
        durationElement.textContent = cardDurationLabel;
        card.append(durationElement);
    }

    return card;
};
