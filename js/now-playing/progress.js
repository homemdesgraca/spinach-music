export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const formatPlaybackTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '--:--';
    }

    const rounded = Math.floor(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainingSeconds = String(rounded % 60).padStart(2, '0');

    return `${minutes}:${remainingSeconds}`;
};

export const createProgressController = ({ progressSlider, progressTimeBubble, sendPlayerControl }) => {
    let isScrubbingProgress = false;
    let currentDuration = 0;

    const setProgressBubble = (seconds, percent, bubbleLeft = `${clamp(percent, 0, 100)}%`) => {
        if (!progressTimeBubble) {
            return;
        }

        progressTimeBubble.textContent = formatPlaybackTime(seconds);
        progressTimeBubble.style.setProperty('--bubble-left', bubbleLeft);
    };

    const setProgressSlider = (position, duration) => {
        if (!progressSlider || isScrubbingProgress) {
            return;
        }

        const hasDuration = Number.isFinite(duration) && duration > 0;
        const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
        const progressPercent = hasDuration ? Math.min(100, (safePosition / duration) * 100) : 0;

        currentDuration = hasDuration ? duration : 0;
        progressSlider.disabled = !hasDuration;
        progressSlider.max = hasDuration ? String(Math.floor(duration)) : '100';
        progressSlider.value = hasDuration ? String(Math.min(Math.floor(safePosition), Math.floor(duration))) : '0';
        progressSlider.style.setProperty('--progress', `${progressPercent}%`);
        setProgressBubble(safePosition, progressPercent);
    };

    const bindEvents = () => {
        if (!progressSlider) {
            return;
        }

        const updateProgressPreview = (clientX) => {
            const duration = currentDuration || Number.parseFloat(progressSlider.max) || 0;

            if (!duration || progressSlider.disabled) {
                setProgressBubble(0, 0);
                return;
            }

            const rect = progressSlider.getBoundingClientRect();
            const pillRect = progressSlider.parentElement.getBoundingClientRect();
            const percent = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
            const bubbleLeft = `${clamp(clientX - pillRect.left, 0, pillRect.width)}px`;
            const seconds = (percent / 100) * duration;

            setProgressBubble(seconds, percent, bubbleLeft);
        };

        progressSlider.addEventListener('pointermove', (event) => {
            updateProgressPreview(event.clientX);
        });

        progressSlider.addEventListener('input', () => {
            isScrubbingProgress = true;
            const max = Number.parseFloat(progressSlider.max) || 0;
            const value = Number.parseFloat(progressSlider.value) || 0;
            const progressPercent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
            progressSlider.style.setProperty('--progress', `${progressPercent}%`);
            setProgressBubble(value, progressPercent);
        });

        progressSlider.addEventListener('change', () => {
            const position = Number.parseFloat(progressSlider.value) || 0;
            isScrubbingProgress = false;
            sendPlayerControl('seek', { position: String(position) });
        });
    };

    return {
        bindEvents,
        setProgressBubble,
        setProgressSlider,
    };
};
