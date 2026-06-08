export const createMarqueeController = (items = []) => {
    const marquees = new Map();
    let token = 0;

    const stopMarquee = (content) => {
        if (!content) {
            return;
        }

        const state = marquees.get(content);
        clearTimeout(state?.timeout);
        state?.animation?.cancel();
        content.classList.remove('is-overflowing');
        content.style.transform = '';
        marquees.delete(content);
    };

    const stopAll = () => {
        token += 1;
        items.forEach(({ content }) => stopMarquee(content));
    };

    const startMarquee = (line, content, activeToken, pause = 2000) => {
        if (activeToken !== token || !line || !content || !content.textContent.trim()) {
            return;
        }

        const overflowDistance = content.scrollWidth - line.clientWidth;

        if (overflowDistance <= 4) {
            stopMarquee(content);
            return;
        }

        const travelDistance = overflowDistance + 16;
        const endTransform = `translateX(-${travelDistance}px)`;
        const travelDuration = Math.max(1250, travelDistance * 23);
        const returnDuration = Math.max(420, travelDistance * 8);

        content.classList.add('is-overflowing');
        content.style.transform = 'translateX(0)';

        const timeout = setTimeout(() => {
            if (activeToken !== token) {
                return;
            }

            const animation = content.animate([
                { transform: 'translateX(0)' },
                { transform: endTransform },
            ], {
                duration: travelDuration,
                easing: 'linear',
                fill: 'forwards',
            });

            marquees.set(content, { animation, timeout: null });

            animation.onfinish = () => {
                if (activeToken !== token) {
                    return;
                }

                animation.cancel();
                content.style.transform = endTransform;
                const returnAnimation = content.animate([
                    { transform: endTransform },
                    { transform: 'translateX(0)' },
                ], {
                    duration: returnDuration,
                    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                    fill: 'forwards',
                });

                marquees.set(content, { animation: returnAnimation, timeout: null });

                returnAnimation.onfinish = () => {
                    if (activeToken !== token) {
                        return;
                    }

                    returnAnimation.cancel();
                    content.style.transform = 'translateX(0)';
                    marquees.delete(content);
                    requestAnimationFrame(() => startMarquee(line, content, activeToken, pause));
                };
            };
        }, pause);

        marquees.set(content, { animation: null, timeout });
    };

    const queue = () => {
        stopAll();
        const activeToken = token;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                items.forEach(({ line, content, pause }) => {
                    startMarquee(line, content, activeToken, pause);
                });
            });
        });
    };

    return {
        queue,
        stopAll,
    };
};
