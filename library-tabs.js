const libraryTabs = document.querySelector('.library-tabs');
const libraryTabButtons = document.querySelectorAll('.library-tab');
const subtitleText = document.querySelector('.subtitle-txt');
const nowPlayingBar = document.querySelector('.now-playing-bar');

let activeLibraryTab;
let subtitleExitAnimation;
let tabsMoveAnimation;

const flipElementToState = (element, applyState) => {
    if (!element) {
        applyState();
        return;
    }

    const first = element.getBoundingClientRect();
    element.getAnimations().forEach((animation) => animation.cancel());
    element.style.transition = 'none';

    applyState();

    const last = element.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;

    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    document.body.offsetWidth;
    element.style.transition = '';
    element.style.transform = '';
};

const getCurrentTranslate = (element) => {
    const transform = getComputedStyle(element).transform;

    if (!transform || transform === 'none') {
        return { x: 0, y: 0 };
    }

    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
};

const getTabCenterShift = (selectedTab) => {
    const tabsTranslate = getCurrentTranslate(libraryTabs);
    const tabRect = selectedTab.getBoundingClientRect();
    const visibleTabCenter = tabRect.left + tabRect.width / 2;
    const untransformedTabCenter = visibleTabCenter - tabsTranslate.x;

    return window.innerWidth / 2 - untransformedTabCenter;
};

const animateTabsToCenter = (selectedTab) => {
    const current = getCurrentTranslate(libraryTabs);
    const targetX = getTabCenterShift(selectedTab);
    const targetTransform = `translateX(${targetX}px)`;

    tabsMoveAnimation?.cancel();
    libraryTabs.getAnimations().forEach((animation) => animation.cancel());
    libraryTabs.style.setProperty('--library-tabs-shift', `${targetX}px`);
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

const animateSubtitleOut = () => {
    if (!subtitleText || subtitleText.classList.contains('is-leaving')) {
        return;
    }

    subtitleExitAnimation?.cancel();
    subtitleText.getAnimations().forEach((animation) => animation.cancel());

    const computed = getComputedStyle(subtitleText);
    const startTransform = computed.transform === 'none' ? 'translateX(0)' : computed.transform;

    subtitleText.classList.add('is-leaving');
    subtitleText.style.opacity = computed.opacity;
    subtitleText.style.transform = startTransform;

    subtitleExitAnimation = subtitleText.animate([
        { opacity: computed.opacity, transform: startTransform },
        { opacity: 0, transform: 'translateX(-130vw)' },
    ], {
        duration: 4200,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
    });

    subtitleExitAnimation.onfinish = () => {
        subtitleText.style.opacity = '0';
        subtitleText.style.transform = 'translateX(-130vw)';
    };
};

const openLibraryTab = (selectedTab) => {
    activeLibraryTab = selectedTab;
    animateSubtitleOut();

    flipElementToState(nowPlayingBar, () => {
        document.body.classList.add('library-mode');
        libraryTabs.classList.add('is-focused');
        libraryTabs.dataset.activeTab = selectedTab.dataset.libraryTab;

        libraryTabButtons.forEach((tab) => {
            const isSelected = tab === selectedTab;
            tab.classList.toggle('is-selected', isSelected);
            tab.classList.toggle('is-counterpart', !isSelected);
            tab.setAttribute('aria-selected', isSelected);
        });
    });

    animateTabsToCenter(selectedTab);
};

libraryTabButtons.forEach((tab) => {
    tab.addEventListener('click', () => openLibraryTab(tab));
});

window.addEventListener('resize', () => {
    if (activeLibraryTab) {
        animateTabsToCenter(activeLibraryTab);
    }
});
