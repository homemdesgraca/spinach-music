const modulo = (value, size) => ((value % size) + size) % size;
const getRemSize = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export const createLibraryDeckController = ({
    elements = {},
    createDeckCard,
    getDeckCards = () => [],
    updateLibraryBackButton = () => {},
} = {}) => {
    const { libraryDeck, libraryDeckTrack } = elements;
    const libraryMarquees = new Map();

    let deckAnimationFrame;
    let deckCurrentOffset = 0;
    let deckTargetOffset = 0;
    let deckLoopWidth = 0;
    let deckCardStep = 0;
    let deckCardWidth = 0;
    let deckCardGap = 0;
    let deckCanScroll = true;
    let deckIsFinite = false;
    let deckFiniteStartX = 0;
    let deckMaxOffset = 0;
    let deckMode = '';
    let deckSlotCards = [];
    let deckBaseCards = [];
    let libraryMarqueeToken = 0;
    let deckDropAnimationPending = false;
    let deckDropRun = 0;
    let deckDropDirection = 'down';

    const getDeckCardMetrics = () => {
        const rem = getRemSize();
        const cardWidth = Math.min(Math.max(13 * rem, window.innerWidth * 0.21), 18 * rem);
        const gap = 0.7 * rem;

        return { cardWidth, gap, step: cardWidth + gap };
    };

    const stopLibraryMarquee = (content) => {
        const state = libraryMarquees.get(content);
        clearTimeout(state?.timeout);
        state?.animation?.cancel();
        content?.classList.remove('is-overflowing');
        if (content) {
            content.style.transform = '';
        }
        libraryMarquees.delete(content);
    };

    const stopLibraryMarquees = () => {
        libraryMarqueeToken += 1;
        libraryMarquees.forEach((_, content) => stopLibraryMarquee(content));
    };

    const startLibraryMarquee = (line, content, token, pause = 1900, options = {}) => {
        const variant = options.variant || 'normal';
        const force = Boolean(options.force);

        if (token !== libraryMarqueeToken || !line || !content || !content.textContent.trim()) {
            return;
        }

        const existing = libraryMarquees.get(content);
        if (existing && existing.variant === variant && !force) {
            return;
        }

        if (existing) {
            stopLibraryMarquee(content);
        }

        const overflowDistance = content.scrollWidth - line.clientWidth;

        if (overflowDistance <= 4) {
            stopLibraryMarquee(content);
            return;
        }

        const travelDistance = overflowDistance + 16;
        const endTransform = `translateX(-${travelDistance}px)`;
        const travelDuration = variant === 'hover'
            ? Math.max(720, travelDistance * 13)
            : Math.max(1250, travelDistance * 23);
        const returnDuration = variant === 'hover'
            ? Math.max(260, travelDistance * 5)
            : Math.max(420, travelDistance * 8);

        content.classList.add('is-overflowing');
        content.style.transform = 'translateX(0)';

        const timeout = window.setTimeout(() => {
            if (token !== libraryMarqueeToken) {
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

            libraryMarquees.set(content, { animation, timeout: null, variant });

            animation.onfinish = () => {
                if (token !== libraryMarqueeToken) {
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

                libraryMarquees.set(content, { animation: returnAnimation, timeout: null, variant });

                returnAnimation.onfinish = () => {
                    if (token !== libraryMarqueeToken) {
                        return;
                    }

                    returnAnimation.cancel();
                    content.style.transform = 'translateX(0)';
                    libraryMarquees.delete(content);
                    requestAnimationFrame(() => startLibraryMarquee(line, content, token, pause, options));
                };
            };
        }, pause);

        libraryMarquees.set(content, { animation: null, timeout, variant });
    };

    const queueLibraryMarquees = (reset = true, options = {}) => {
        if (reset) {
            stopLibraryMarquees();
        }
        const token = libraryMarqueeToken;
        const immediateNew = Boolean(options.immediateNew);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                libraryDeckTrack?.querySelectorAll('.library-card-title').forEach((line, index) => {
                    const content = line.querySelector('.library-card-title-text');
                    const pause = immediateNew && !libraryMarquees.has(content)
                        ? 0
                        : 1600 + ((index % 4) * 180);
                    startLibraryMarquee(line, content, token, pause);
                });
            });
        });
    };

    const applyDeckTransform = () => {
        if (!deckLoopWidth || !deckCardStep || !deckSlotCards.length || !deckBaseCards.length) {
            return;
        }

        const baseCount = deckBaseCards.length;
        const offset = deckIsFinite
            ? Math.max(0, Math.min(deckCurrentOffset, deckMaxOffset))
            : deckCanScroll ? deckCurrentOffset : 0;
        const centerSlot = Math.floor(deckSlotCards.length / 2);
        const staticWidth = (baseCount * deckCardWidth) + (Math.max(0, baseCount - 1) * deckCardGap);
        const staticStartX = deckIsFinite ? deckFiniteStartX : -(staticWidth / 2);
        const dropDistance = Math.max(libraryDeck?.clientHeight || 300, 260);
        const recyclePadding = deckCardStep * 2;
        const leftRecycleEdge = -((libraryDeck?.clientWidth || window.innerWidth) / 2) - recyclePadding;
        const rightRecycleEdge = ((libraryDeck?.clientWidth || window.innerWidth) / 2) + recyclePadding;
        let changedContent = false;

        deckSlotCards.forEach((card, slotIndex) => {
            let virtualSlot = Number.parseInt(card.dataset.virtualSlot, 10);
            if (!Number.isFinite(virtualSlot)) {
                virtualSlot = slotIndex - centerSlot;
            }

            if (deckCanScroll && !deckIsFinite) {
                let virtualX = (virtualSlot * deckCardStep) - offset - (deckCardWidth / 2);
                const slotSpan = deckSlotCards.length * deckCardStep;

                while (virtualX < leftRecycleEdge) {
                    virtualSlot += deckSlotCards.length;
                    virtualX += slotSpan;
                }

                while (virtualX > rightRecycleEdge) {
                    virtualSlot -= deckSlotCards.length;
                    virtualX -= slotSpan;
                }
            }

            const dataIndex = deckIsFinite
                ? slotIndex
                : deckCanScroll ? modulo(virtualSlot, baseCount) : slotIndex;
            let activeCard = card;

            if (activeCard.dataset.itemIndex !== String(dataIndex)) {
                activeCard.querySelectorAll('.library-card-title-text').forEach(stopLibraryMarquee);
                const nextCard = createDeckCard(deckBaseCards[dataIndex], dataIndex);
                nextCard.dataset.itemIndex = String(dataIndex);
                nextCard.dataset.slotIndex = String(slotIndex);
                nextCard.dataset.virtualSlot = String(virtualSlot);
                libraryDeckTrack.replaceChild(nextCard, activeCard);
                deckSlotCards[slotIndex] = nextCard;
                activeCard = nextCard;
                changedContent = true;
            } else {
                activeCard.dataset.virtualSlot = String(virtualSlot);
            }

            const x = deckIsFinite
                ? staticStartX + (slotIndex * deckCardStep) - offset
                : deckCanScroll
                    ? (virtualSlot * deckCardStep) - offset - (deckCardWidth / 2)
                    : staticStartX + (slotIndex * deckCardStep);
            const finalTransform = `translate3d(${x}px, 0, 0) rotate(${activeCard.dataset.tilt})`;
            activeCard.style.transform = finalTransform;

            if (deckDropAnimationPending && activeCard.dataset.dropRun !== String(deckDropRun)) {
                activeCard.dataset.dropRun = String(deckDropRun);
                const isReverseDrop = deckDropDirection === 'up';
                const startY = isReverseDrop ? dropDistance : -dropDistance;
                const overshootY = isReverseDrop ? -18 : 18;
                const dropAnimation = activeCard.animate([
                    { opacity: 0, transform: `translate3d(${x}px, ${startY}px, 0) rotate(${activeCard.dataset.tilt})` },
                    { opacity: 1, transform: `translate3d(${x}px, ${overshootY}px, 0) rotate(${activeCard.dataset.tilt})`, offset: 0.82 },
                    { opacity: 1, transform: finalTransform },
                ], {
                    duration: 760 + (Math.min(slotIndex, 6) * 54),
                    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                    fill: 'none',
                });
                dropAnimation.onfinish = () => {
                    if (activeCard.dataset.dropRun === String(deckDropRun)) {
                        activeCard.style.opacity = '1';
                        activeCard.style.transform = finalTransform;
                    }
                    dropAnimation.cancel();
                };
            }
        });

        if (deckDropAnimationPending) {
            deckDropAnimationPending = false;
        }

        if (changedContent) {
            queueLibraryMarquees(false, { immediateNew: true });
        }
    };

    const measureDeckLoop = () => {
        if (!libraryDeck || !libraryDeckTrack || !deckMode) {
            return;
        }

        const { cardWidth, gap, step } = getDeckCardMetrics();
        deckBaseCards = getDeckCards(deckMode);
        const baseCount = deckBaseCards.length || 1;
        const visibleWidth = libraryDeck.clientWidth || window.innerWidth;
        const rem = getRemSize();
        const isFiniteTrackDeck = deckMode === 'albumTracks';
        const reservedWidth = isFiniteTrackDeck ? 8.4 * rem : deckMode === 'artistAlbums' ? 6.4 * rem : 1.2 * rem;
        const leftInset = isFiniteTrackDeck ? 7.35 * rem : 0;
        const rightInset = isFiniteTrackDeck ? 1.25 * rem : 0;
        const availableWidth = Math.max(cardWidth, visibleWidth - reservedWidth);
        const totalContentWidth = (baseCount * cardWidth) + (Math.max(0, baseCount - 1) * gap);
        const fitsWithoutScroll = (deckMode === 'artistAlbums' || isFiniteTrackDeck) && totalContentWidth <= availableWidth;
        const minimumSlots = Math.ceil((visibleWidth + (step * 4)) / step);
        const slotCount = isFiniteTrackDeck
            ? baseCount
            : fitsWithoutScroll ? baseCount : (baseCount === 1 ? 1 : Math.max(minimumSlots, 7));

        deckIsFinite = isFiniteTrackDeck;
        deckCanScroll = baseCount > 1 && (isFiniteTrackDeck ? !fitsWithoutScroll : !fitsWithoutScroll);
        deckCardWidth = cardWidth;
        deckCardGap = gap;
        deckCardStep = step;
        deckFiniteStartX = -(visibleWidth / 2) + leftInset;
        deckMaxOffset = isFiniteTrackDeck
            ? Math.max(0, totalContentWidth - Math.max(cardWidth, visibleWidth - leftInset - rightInset))
            : 0;
        deckLoopWidth = Math.max(baseCount * step, step);

        if (deckIsFinite) {
            deckCurrentOffset = deckCanScroll ? Math.max(0, Math.min(deckCurrentOffset, deckMaxOffset)) : 0;
        } else {
            deckCurrentOffset = deckCanScroll ? modulo(deckCurrentOffset, deckLoopWidth) : 0;
        }
        deckTargetOffset = deckCurrentOffset;

        const centerSlot = Math.floor(slotCount / 2);
        const firstVirtualSlot = deckCanScroll && !deckIsFinite ? Math.floor(deckCurrentOffset / step) : 0;

        stopLibraryMarquees();
        libraryDeckTrack.innerHTML = '';
        deckSlotCards = Array.from({ length: slotCount }, (_, index) => {
            const virtualSlot = deckCanScroll && !deckIsFinite ? firstVirtualSlot + index - centerSlot : index;
            const dataIndex = deckIsFinite ? index : deckCanScroll ? modulo(virtualSlot, baseCount) : index;
            const card = createDeckCard(deckBaseCards[dataIndex], dataIndex);
            card.dataset.itemIndex = String(dataIndex);
            card.dataset.slotIndex = String(index);
            card.dataset.virtualSlot = String(virtualSlot);
            libraryDeckTrack.append(card);
            return card;
        });
        applyDeckTransform();
        queueLibraryMarquees();
    };

    const render = (mode, options = {}) => {
        if (!libraryDeck || !libraryDeckTrack) {
            return;
        }

        const isSameMode = deckMode === mode;
        deckMode = mode;
        libraryDeck.dataset.deckMode = mode;
        libraryDeck.setAttribute('aria-hidden', 'false');
        document.body.classList.toggle('artist-albums-mode', mode === 'artistAlbums');
        document.body.classList.toggle('album-tracks-mode', mode === 'albumTracks');
        updateLibraryBackButton();

        if (deckAnimationFrame) {
            cancelAnimationFrame(deckAnimationFrame);
            deckAnimationFrame = null;
        }

        if (!isSameMode) {
            const restoredOffset = Number.isFinite(options.restoreOffset) ? options.restoreOffset : 0;
            deckCurrentOffset = restoredOffset;
            deckTargetOffset = restoredOffset;
        }

        if (options.drop) {
            deckDropRun += 1;
            deckDropDirection = options.direction === 'up' ? 'up' : 'down';
            requestAnimationFrame(() => {
                deckDropAnimationPending = true;
                measureDeckLoop();
            });
            return;
        }

        requestAnimationFrame(measureDeckLoop);
    };

    const refreshIfActive = (mode, options = {}) => {
        if (deckMode === mode) {
            if (options.drop) {
                deckDropAnimationPending = true;
                deckDropRun += 1;
            }
            requestAnimationFrame(measureDeckLoop);
        }
    };

    const animateDeckScroll = () => {
        if (deckIsFinite) {
            deckTargetOffset = Math.max(0, Math.min(deckTargetOffset, deckMaxOffset));
        }

        deckCurrentOffset += (deckTargetOffset - deckCurrentOffset) * 0.12;

        if (!deckIsFinite && Math.abs(deckCurrentOffset) > deckLoopWidth * 50 && deckLoopWidth) {
            const remainingDistance = deckTargetOffset - deckCurrentOffset;
            deckCurrentOffset = modulo(deckCurrentOffset, deckLoopWidth);
            deckTargetOffset = deckCurrentOffset + remainingDistance;
        }

        applyDeckTransform();

        if (Math.abs(deckTargetOffset - deckCurrentOffset) > 0.2) {
            deckAnimationFrame = requestAnimationFrame(animateDeckScroll);
        } else {
            deckCurrentOffset = deckIsFinite ? Math.max(0, Math.min(deckTargetOffset, deckMaxOffset)) : deckTargetOffset;
            deckTargetOffset = deckCurrentOffset;
            applyDeckTransform();
            deckAnimationFrame = null;
        }
    };

    const interruptDeckDrop = () => {
        deckDropAnimationPending = false;
        deckSlotCards.forEach((card) => {
            card.getAnimations().forEach((animation) => animation.cancel());
            card.style.opacity = '1';
        });
        applyDeckTransform();
    };

    const queueScroll = (delta) => {
        if (!libraryDeckTrack || !deckLoopWidth || !deckCanScroll) {
            return;
        }

        interruptDeckDrop();
        deckTargetOffset += delta;

        if (deckIsFinite) {
            deckTargetOffset = Math.max(0, Math.min(deckTargetOffset, deckMaxOffset));
        }

        if (!deckAnimationFrame) {
            deckAnimationFrame = requestAnimationFrame(animateDeckScroll);
        }
    };

    const restartCardMarquee = (card, hover = false) => {
        const line = card?.querySelector('.library-card-title');
        const content = line?.querySelector('.library-card-title-text');

        if (!line || !content) {
            return;
        }

        const slotIndex = Number.parseInt(card.dataset.slotIndex, 10) || 0;
        stopLibraryMarquee(content);
        startLibraryMarquee(line, content, libraryMarqueeToken, hover ? 1000 : 1600 + ((slotIndex % 4) * 180), {
            variant: hover ? 'hover' : 'normal',
            force: true,
        });
    };

    return {
        getBaseCards: () => deckBaseCards,
        getCurrentOffset: () => deckCurrentOffset,
        getMode: () => deckMode,
        measure: measureDeckLoop,
        queueScroll,
        refreshIfActive,
        render,
        restartCardMarquee,
        stopMarquees: stopLibraryMarquees,
    };
};
