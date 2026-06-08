const topSection = document.querySelector('.top-section');
const titleText = document.querySelector('.title-txt');
const subtitleText = document.querySelector('.subtitle-txt');

const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointerQuery = window.matchMedia('(pointer: fine)');
const RETURN_EPSILON = 0.08;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOut = (value) => 1 - Math.pow(1 - value, 2.35);

const wrapLetters = (element) => {
    if (!element) {
        return [];
    }

    const originalText = element.textContent || '';
    const letters = Array.from(originalText);

    element.textContent = '';
    element.setAttribute('aria-label', originalText.trim());

    return letters.map((letter) => {
        const span = document.createElement('span');
        span.className = 'dodge-letter';
        span.setAttribute('aria-hidden', 'true');

        if (letter === ' ') {
            span.classList.add('is-space');
            span.innerHTML = '&nbsp;';
        } else {
            span.textContent = letter;
        }

        element.append(span);
        return span;
    }).filter((letter) => !letter.classList.contains('is-space'));
};

const createDodgeItem = (element, options = {}) => ({
    element,
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
    maxX: options.maxX || 24,
    maxY: options.maxY || 10,
    pad: options.pad || 9,
    strength: options.strength || 1,
});

const items = [
    ...wrapLetters(titleText).map((letter) => createDodgeItem(letter, { maxX: 26, maxY: 11, pad: 10, strength: 1 })),
    ...wrapLetters(subtitleText).map((letter) => createDodgeItem(letter, { maxX: 19, maxY: 8, pad: 7, strength: 0.78 })),
];

let pointer = null;
let animationFrame;
let isRunning = false;
let lastViewportWidth = window.innerWidth || 0;
let lastViewportHeight = window.innerHeight || 0;

const getRem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const getPointer = (event) => {
    const viewport = window.visualViewport;

    return {
        x: event.clientX + (viewport?.offsetLeft || 0),
        y: event.clientY + (viewport?.offsetTop || 0),
    };
};

const getBaseRect = (item) => {
    const rect = item.element.getBoundingClientRect();

    return {
        left: rect.left - item.currentX,
        right: rect.right - item.currentX,
        top: rect.top - item.currentY,
        bottom: rect.bottom - item.currentY,
        width: rect.width,
        height: rect.height,
    };
};

const getDodgeLane = () => {
    const sectionRect = topSection.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    const rem = getRem();
    const edgePad = Math.max(8, rem * 0.45);

    return {
        left: Math.max(viewportLeft + edgePad, sectionRect.left + edgePad),
        right: Math.min(viewportLeft + viewportWidth - edgePad, sectionRect.right - edgePad),
        top: Math.max(viewportTop + edgePad, sectionRect.top + edgePad),
        bottom: Math.min(viewportTop + viewportHeight - edgePad, sectionRect.bottom + (rem * 1.15)),
    };
};

const getBoundsForItem = (item, baseRect, lane) => ({
    minX: lane.left - baseRect.left,
    maxX: lane.right - baseRect.right,
    minY: lane.top - baseRect.top,
    maxY: lane.bottom - baseRect.bottom,
});

const resolveDodgeTarget = (item, lane) => {
    if (!pointer) {
        return { x: 0, y: 0 };
    }

    const baseRect = getBaseRect(item);
    const centerX = baseRect.left + (baseRect.width / 2);
    const centerY = baseRect.top + (baseRect.height / 2);
    const dx = pointer.x - centerX;
    const dy = pointer.y - centerY;
    const radiusX = (baseRect.width / 2) + item.pad;
    const radiusY = (baseRect.height / 2) + item.pad;
    const normalizedDistance = Math.max(Math.abs(dx) / radiusX, Math.abs(dy) / radiusY);

    if (normalizedDistance > 1) {
        return { x: 0, y: 0 };
    }

    const distance = Math.hypot(dx, dy);
    const strength = easeOut(clamp(1 - normalizedDistance, 0, 1)) * item.strength;
    const safeDistance = distance || 1;
    const bounds = getBoundsForItem(item, baseRect, lane);
    const desiredX = (-dx / safeDistance) * item.maxX * strength;
    let x = clamp(desiredX, bounds.minX, bounds.maxX);
    let y = clamp((-dy / safeDistance) * item.maxY * strength, bounds.minY, bounds.maxY);

    if (Math.abs(x) < Math.abs(desiredX) * 0.35) {
        const otherSideX = clamp(-desiredX * 0.78, bounds.minX, bounds.maxX);

        if (Math.abs(otherSideX) > Math.abs(x)) {
            x = otherSideX;
        }
    }

    if (Math.abs(x) < item.maxX * strength * 0.18) {
        const fallbackDirection = pointer.x < centerX ? 1 : -1;
        const fallbackX = clamp(fallbackDirection * item.maxX * strength * 0.72, bounds.minX, bounds.maxX);
        const oppositeFallbackX = clamp(-fallbackDirection * item.maxX * strength * 0.58, bounds.minX, bounds.maxX);

        if (Math.abs(fallbackX) > Math.abs(x)) {
            x = fallbackX;
        }

        if (Math.abs(oppositeFallbackX) > Math.abs(x)) {
            x = oppositeFallbackX;
        }
    }

    return { x, y };
};

const resetTargets = () => {
    pointer = null;
    items.forEach((item) => {
        item.targetX = 0;
        item.targetY = 0;
    });
    startAnimationLoop();
};

const updateTargets = () => {
    const lane = getDodgeLane();

    items.forEach((item) => {
        const target = resolveDodgeTarget(item, lane);
        item.targetX = target.x;
        item.targetY = target.y;
    });
};

const applyItemPosition = (item) => {
    item.element.style.setProperty('--dodge-letter-x', `${item.currentX.toFixed(2)}px`);
    item.element.style.setProperty('--dodge-letter-y', `${item.currentY.toFixed(2)}px`);
};

const tick = () => {
    let hasMotion = false;

    updateTargets();

    items.forEach((item) => {
        item.currentX += (item.targetX - item.currentX) * 0.22;
        item.currentY += (item.targetY - item.currentY) * 0.22;

        if (Math.abs(item.currentX) < RETURN_EPSILON && Math.abs(item.targetX) < RETURN_EPSILON) {
            item.currentX = 0;
        }

        if (Math.abs(item.currentY) < RETURN_EPSILON && Math.abs(item.targetY) < RETURN_EPSILON) {
            item.currentY = 0;
        }

        applyItemPosition(item);

        if (Math.abs(item.currentX - item.targetX) > RETURN_EPSILON || Math.abs(item.currentY - item.targetY) > RETURN_EPSILON) {
            hasMotion = true;
        }
    });

    if (hasMotion) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
    }

    animationFrame = null;
    isRunning = false;
};

function startAnimationLoop() {
    if (isRunning) {
        return;
    }

    isRunning = true;
    animationFrame = window.requestAnimationFrame(tick);
}

const handlePointerMove = (event) => {
    pointer = getPointer(event);
    startAnimationLoop();
};

const handlePointerLeave = () => {
    resetTargets();
};

const resetPositions = () => {
    pointer = null;

    items.forEach((item) => {
        item.currentX = 0;
        item.currentY = 0;
        item.targetX = 0;
        item.targetY = 0;
        applyItemPosition(item);
    });
};

const shouldRun = () => items.length > 0 && finePointerQuery.matches && !reduceMotionQuery.matches;

const attach = () => {
    if (!shouldRun()) {
        resetPositions();
        return;
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('blur', handlePointerLeave);
};

const detach = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerleave', handlePointerLeave);
    window.removeEventListener('blur', handlePointerLeave);

    if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    isRunning = false;
    resetPositions();
};

const syncMode = () => {
    detach();
    attach();
};

const handleViewportChange = () => {
    const width = window.innerWidth || 0;
    const height = window.innerHeight || 0;

    if (Math.abs(width - lastViewportWidth) < 1 && Math.abs(height - lastViewportHeight) < 1) {
        return;
    }

    lastViewportWidth = width;
    lastViewportHeight = height;
    resetTargets();
};

if (topSection && items.length) {
    attach();
    reduceMotionQuery.addEventListener?.('change', syncMode);
    finePointerQuery.addEventListener?.('change', syncMode);
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
}
