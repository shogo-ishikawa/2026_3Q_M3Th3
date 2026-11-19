export const SETTINGS_SECTIONS = ['profile', 'family', 'display', 'data', 'help', 'feedback'];

/** アプリの上位タブと独立した、設定内のキーボード操作とフォーカス。 */
export function setupSettingsTabs() {
  const buttons = [...document.querySelectorAll('#settings-tabs [role="tab"]')];
  function show(section, focus = false) {
    for (const button of buttons) {
      const active = button.dataset.settings === section;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) button.focus();
    }
  }
  function open(button, focus) {
    show(button.dataset.settings, focus);
    history.replaceState(null, '', '#settings-' + button.dataset.settings);
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => open(button, false));
    button.addEventListener('keydown', event => {
      const next = {ArrowLeft: (index + buttons.length - 1) % buttons.length,
        ArrowRight: (index + 1) % buttons.length, Home: 0, End: buttons.length - 1}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      open(buttons[next], true);
    });
  });
  return show;
}
