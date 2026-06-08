const getCurrentTranslate = (element) => {
    const transform = getComputedStyle(element).transform;

    if (!transform || transform === 'none') {
        return { x: 0, y: 0 };
    }

    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
};

export const syncViewportVars = () => {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
    const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

    if (width) {
        const sideMargin = Math.min(Math.max(width * 0.006, 6), 18);
        const deckWidth = Math.max(320, width - (sideMargin * 2));
        document.documentElement.style.setProperty('--spinach-vw', `${width}px`);
        document.documentElement.style.setProperty('--library-deck-width', `${Math.round(deckWidth)}px`);
    }

    if (height) {
        const widthForHeight = width || window.innerWidth || 0;
        const maxHeight = 22 * rem;
        const minHeight = 15.2 * rem;
        const wideFlattening = Math.max(0, widthForHeight - (96 * rem)) * 0.018;
        const preferredHeight = Math.min(height * 0.48, (21.5 * rem) - wideFlattening);
        const deckHeight = Math.min(maxHeight, Math.max(minHeight, preferredHeight));
        document.documentElement.style.setProperty('--spinach-vh', `${height}px`);
        document.documentElement.style.setProperty('--library-deck-height', `${Math.round(deckHeight)}px`);
    }
};

export const createLibraryAnimationsController = ({ elements = {} } = {}) => {
    const { libraryTabs, libraryDeck, libraryProgressTooltip, subtitleText, nowPlayingBar } = elements;
    let subtitleExitAnimation;
    let subtitleAnimationRun = 0;
    let tabsMoveAnimation;
    let nowPlayingMoveAnimation;

    const setTooltipAnchor = (selectedTab = null) => {
        if (!libraryTabs || !libraryProgressTooltip) {
            return;
        }

        if (!selectedTab) {
            libraryTabs.style.setProperty('--library-tooltip-left', '50%');
            return;
        }

        const tabCenter = selectedTab.offsetLeft + (selectedTab.offsetWidth / 2);
        libraryTabs.style.setProperty('--library-tooltip-left', `${tabCenter}px`);
    };

    const getFocusedTabShift = (selectedTab) => {
        const tabsTranslate = getCurrentTranslate(libraryTabs);
        const tabRect = selectedTab.getBoundingClientRect();
        const visibleTabCenter = tabRect.left + tabRect.width / 2;
        const untransformedTabCenter = visibleTabCenter - tabsTranslate.x;
        const untransformedTabTop = tabRect.top - tabsTranslate.y;
        const deckBottom = libraryDeck ? libraryDeck.offsetTop + libraryDeck.offsetHeight : 0;
        const targetY = deckBottom ? deckBottom - 2 - untransformedTabTop : tabsTranslate.y;

        return {
            x: window.innerWidth / 2 - untransformedTabCenter,
            y: targetY,
        };
    };

    const animateTabsToCenter = (selectedTab) => {
        if (!libraryTabs || !selectedTab) {
            return;
        }

        setTooltipAnchor(selectedTab);
        const current = getCurrentTranslate(libraryTabs);
        const target = getFocusedTabShift(selectedTab);
        const targetTransform = `translate(${target.x}px, ${target.y}px)`;

        tabsMoveAnimation?.cancel();
        libraryTabs.getAnimations().forEach((animation) => animation.cancel());
        libraryTabs.style.setProperty('--library-tabs-shift', `${target.x}px`);
        libraryTabs.style.transform = `translate(${current.x}px, ${current.y}px)`;

        tabsMoveAnimation = libraryTabs.animate([
            { transform: `translate(${current.x}px, ${current.y}px)` },
            { transform: targetTransform },
        ], {
            duration: 1150,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards',
        });

        tabsMoveAnimation.onfinish = () => {
            libraryTabs.style.transform = targetTransform;
        };
    };

    const animateTabsHome = () => {
        if (!libraryTabs) {
            return;
        }

        setTooltipAnchor();
        const current = getCurrentTranslate(libraryTabs);

        tabsMoveAnimation?.cancel();
        libraryTabs.getAnimations().forEach((animation) => animation.cancel());
        libraryTabs.style.setProperty('--library-tabs-shift', '0px');
        libraryTabs.style.transform = `translate(${current.x}px, ${current.y}px)`;

        tabsMoveAnimation = libraryTabs.animate([
            { transform: `translate(${current.x}px, ${current.y}px)` },
            { transform: 'translate(0, 0)' },
        ], {
            duration: 950,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards',
        });

        tabsMoveAnimation.onfinish = () => {
            libraryTabs.style.transform = '';
        };
    };

    const animateSubtitleOut = () => {
        if (!subtitleText) {
            return;
        }

        const run = ++subtitleAnimationRun;
        const computed = getComputedStyle(subtitleText);
        const startOpacity = computed.opacity;
        const startTransform = computed.transform === 'none' ? 'translateX(0)' : computed.transform;

        subtitleExitAnimation?.cancel();
        subtitleText.getAnimations().forEach((animation) => animation.cancel());
        subtitleText.classList.add('is-leaving', 'is-layout-controlled');
        subtitleText.style.opacity = startOpacity;
        subtitleText.style.transform = startTransform;

        subtitleExitAnimation = subtitleText.animate([
            { opacity: startOpacity, transform: startTransform, offset: 0 },
            { opacity: 0.82, transform: 'translateX(-32vw)', offset: 0.25 },
            { opacity: 0.5, transform: 'translateX(-65vw)', offset: 0.5 },
            { opacity: 0.18, transform: 'translateX(-98vw)', offset: 0.75 },
            { opacity: 0, transform: 'translateX(-130vw)', offset: 1 },
        ], {
            duration: 2050,
            easing: 'cubic-bezier(0.34, 0.02, 0.2, 1)',
            fill: 'forwards',
        });

        subtitleExitAnimation.onfinish = () => {
            if (run !== subtitleAnimationRun) {
                return;
            }

            subtitleText.style.opacity = '0';
            subtitleText.style.transform = 'translateX(-130vw)';
        };
    };

    const animateSubtitleIn = () => {
        if (!subtitleText) {
            return;
        }

        const run = ++subtitleAnimationRun;
        const computed = getComputedStyle(subtitleText);
        const startOpacity = computed.opacity;
        const startTransform = computed.transform === 'none' ? 'translateX(-130vw)' : computed.transform;

        subtitleExitAnimation?.cancel();
        subtitleText.getAnimations().forEach((animation) => animation.cancel());
        subtitleText.classList.add('is-leaving', 'is-layout-controlled');
        subtitleText.style.opacity = startOpacity;
        subtitleText.style.transform = startTransform;

        subtitleExitAnimation = subtitleText.animate([
            { opacity: startOpacity, transform: startTransform },
            { opacity: 1, transform: 'translateX(0)' },
        ], {
            duration: 1250,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards',
        });

        subtitleExitAnimation.onfinish = () => {
            if (run !== subtitleAnimationRun) {
                return;
            }

            subtitleText.style.opacity = '1';
            subtitleText.style.transform = 'translateX(0)';
            subtitleText.classList.remove('is-leaving');
        };
    };

    const flipNowPlayingToState = (applyState, options = {}) => {
        const element = nowPlayingBar;
        if (!element) {
            applyState();
            return;
        }

        const {
            duration = 1750,
            easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
        } = options;
        element.classList.add('is-layout-controlled');
        const first = element.getBoundingClientRect();

        nowPlayingMoveAnimation?.cancel();
        element.style.transition = 'none';
        element.style.transform = '';

        applyState();

        const last = element.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;

        element.style.transition = '';

        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
            element.style.transform = '';
            return;
        }

        nowPlayingMoveAnimation = element.animate([
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' },
        ], {
            duration,
            easing,
            fill: 'both',
        });

        nowPlayingMoveAnimation.onfinish = () => {
            element.style.transform = '';
            nowPlayingMoveAnimation = null;
        };
    };

    return {
        animateSubtitleIn,
        animateSubtitleOut,
        animateTabsHome,
        animateTabsToCenter,
        flipNowPlayingToState,
        syncViewportVars,
    };
};
