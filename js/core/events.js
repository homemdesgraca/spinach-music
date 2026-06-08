export const emitSpinachEvent = (name, detail = undefined) => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
};

export const listenSpinachEvent = (name, handler, options) => {
    window.addEventListener(name, handler, options);
    return () => window.removeEventListener(name, handler, options);
};
