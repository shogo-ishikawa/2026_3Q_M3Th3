import test from 'node:test';
import assert from 'node:assert/strict';
import {setupTabs} from '../tabs.js';

function navigation(initialHash, run, startTab=()=>'planner') {
  const location = {hash: initialHash};
  const windowEvents = {};
  const documentEvents = {};
  const controls = new Map();
  const kitchen = [];
  const orientation = new Map();
  const layout = {matches: false, addEventListener(type, handler) {this[type] = handler;}};
  const tablist = {setAttribute: (key, value) => orientation.set(key, value)};
  const document = {
    body: {dataset: {}},
    activeElement: null,
    querySelectorAll: () => buttons,
    getElementById: id => controls.get(id),
    addEventListener: (type, fn) => {documentEvents[type] = fn;},
  };
  const main = {focus() {document.activeElement = this;}};
  controls.set('main', main);
  const buttons = ['planner', 'record', 'nutrition', 'catalog', 'kitchen', 'settings'].map(tab => {
    controls.set('panel-' + tab, {});
    const attrs = new Map([['aria-controls', 'panel-' + tab]]);
    return {
      dataset: {tab}, closest: () => tablist,
      getAttribute: key => attrs.get(key),
      setAttribute: (key, value) => attrs.set(key, value),
      addEventListener(type, fn) {this[type] = fn;},
      focus() {document.activeElement = this;},
    };
  });
  const before = {};
  const globals = {
    location, document, history: {replaceState: (_state, _title, hash) => {location.hash = hash;}},
    window: {matchMedia: () => layout, scrollTo() {}, addEventListener: (type, fn) => {windowEvents[type] = fn;}},
  };
  for (const [key, value] of Object.entries(globals)) {before[key] = globalThis[key];globalThis[key] = value;}
  try {
    setupTabs({onKitchenRoute: tab => kitchen.push(tab),startTab});
    const changeHash = hash => {location.hash = hash;windowEvents.hashchange();};
    function clickLink(hash, other = {}) {
      let prevented = false;
      const link = {getAttribute: () => hash};
      documentEvents.click({target: {closest: () => link}, preventDefault() {prevented = true;}, ...other});
      return prevented;
    }
    run({document, location, main, buttons, kitchen, orientation, layout, changeHash, clickLink});
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('the skip link moves focus to the current tab content and preserves its deep link', () => {
  navigation('#calendar', ({document, location, main, changeHash, clickLink}) => {
    assert.equal(document.body.dataset.activeTab, 'record');
    assert.equal(clickLink('#main'), true);
    assert.equal(document.activeElement, main);
    assert.equal(location.hash, '#calendar');
    changeHash('#main');
    assert.equal(document.body.dataset.activeTab, 'record');
    changeHash('#recipes');
    assert.equal(document.body.dataset.activeTab, 'catalog');
  });
});

test('pantry and shopping deep links open their actual kitchen subpanels', () => {
  navigation('#pantry', ({document, kitchen, changeHash, clickLink}) => {
    assert.equal(document.body.dataset.activeTab, 'kitchen');
    assert.deepEqual(kitchen, ['pantry']);
    changeHash('#shopping');
    assert.deepEqual(kitchen, ['pantry','checklist']);
    changeHash('#nutrition');
    clickLink('#pantry', {metaKey: true});
    assert.equal(document.body.dataset.activeTab, 'nutrition');
    clickLink('#pantry');
    assert.equal(document.body.dataset.activeTab, 'kitchen');
    assert.equal(kitchen.at(-1), 'pantry');
  });
});

test('layout changes update tab orientation and arrow keys retain the active focus stop', () => {
  navigation('', ({document, location, buttons, layout, orientation}) => {
    assert.equal(orientation.get('aria-orientation'), 'vertical');
    layout.matches = true;layout.change();
    assert.equal(orientation.get('aria-orientation'), 'horizontal');
    let prevented = false;
    buttons[0].keydown({key: 'ArrowLeft', preventDefault() {prevented = true;}});
    assert.ok(prevented);
    assert.equal(document.activeElement, buttons.at(-1));
    assert.deepEqual(buttons.filter(control => control.tabIndex === 0), [buttons.at(-1)]);
    assert.equal(location.hash, '#settings');
  });
});


test('a preferred start screen works with no hash and explicit shared links take precedence', () => {
  navigation('', ({document, changeHash}) => {
    assert.equal(document.body.dataset.activeTab,'catalog');
    changeHash('#calendar');
    assert.equal(document.body.dataset.activeTab,'record');
    changeHash('');
    assert.equal(document.body.dataset.activeTab,'catalog');
  }, ()=>'catalog');
  navigation('#pantry', ({document,kitchen}) => {
    assert.equal(document.body.dataset.activeTab,'kitchen');
    assert.deepEqual(kitchen,['pantry']);
  }, ()=>'catalog');
});
