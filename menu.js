const configMenu = document.querySelector('.config-menu');
const configButton = document.querySelector('.config-btn');
const configCards = document.querySelectorAll('.config-card');
const connectionsButton = document.querySelector('.connections-btn');
const themeButton = document.querySelector('.theme-btn');
const connectionsPanel = document.querySelector('.connections-panel');
const themePanel = document.querySelector('.theme-panel');
const panelClose = document.querySelector('.panel-close');
const themeClose = document.querySelector('.theme-close');

const closeConfigMenu = () => {
    configMenu.classList.remove('open');
    configButton.setAttribute('aria-expanded', 'false');
};

const closeThemePanel = () => {
    themePanel.classList.remove('open');
    themePanel.setAttribute('aria-hidden', 'true');
};

const closeConnectionsPanel = () => {
    connectionsPanel.classList.remove('open');
    connectionsPanel.setAttribute('aria-hidden', 'true');
};

const openThemePanel = () => {
    closeConnectionsPanel();
    themePanel.classList.add('open');
    themePanel.setAttribute('aria-hidden', 'false');
    closeConfigMenu();
};

const openConnectionsPanel = () => {
    closeThemePanel();
    connectionsPanel.classList.add('open');
    connectionsPanel.setAttribute('aria-hidden', 'false');
    closeConfigMenu();
};

configButton.addEventListener('click', () => {
    const isOpen = configMenu.classList.toggle('open');
    configButton.setAttribute('aria-expanded', isOpen);
});

configCards.forEach((card) => {
    card.addEventListener('click', closeConfigMenu);
});

themeButton.addEventListener('click', openThemePanel);
connectionsButton.addEventListener('click', openConnectionsPanel);
themeClose.addEventListener('click', closeThemePanel);
panelClose.addEventListener('click', closeConnectionsPanel);
