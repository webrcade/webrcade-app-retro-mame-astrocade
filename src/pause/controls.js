import React from 'react';

import { ControlsTab } from '@webrcade/app-common';

const getDefaultName = (value) => {
  if (value === 'fire') return 'Fire';
  // All keypad labels map to "Keypad <label>"
  const KEYPAD_LABELS = [
    'C', '↑', '↓', '%',
    'MR', 'MS', 'CH', '/',
    '7', '8', '9', '×',
    '4', '5', '6', '-',
    '1', '2', '3', '+',
    'CE', '0', '.', '=',
  ];
  if (KEYPAD_LABELS.indexOf(value) >= 0) return `Keypad ${value}`;
  return null;
};

const getName = (emulator, button) => {
  const mappings = emulator.mappings || {};
  const descriptions = emulator.descriptions || {};
  const value = mappings[button];
  if (!value) return null;
  return descriptions[value] || getDefaultName(value);
};

const getKeypadName = (label, emulator) => {
  const descriptions = emulator.descriptions || {};
  return descriptions[label] || `Keypad ${label}`;
};

export class GamepadControlsTab extends ControlsTab {
  render() {
    const { emulator } = this.props;

    if (emulator.icbm) {
      return (
        <>
          {this.renderControl('start',   'Show Keypad')}
          {this.renderControl('lanalog', 'Move Crosshair')}
          {this.renderControl('x',       'Fire Left Base')}
          {this.renderControl('b',       'Fire Right Base')}
          {this.renderControl('y',       'Fire Center Base')}
          {this.renderControl('a',       'Start Game')}
        </>
      );
    }

    if (emulator.dualController) {
      const aName  = getName(emulator, 'a');
      const xName  = getName(emulator, 'x');
      const yName  = getName(emulator, 'y');
      const lbName = getName(emulator, 'lb');
      const ltName = getName(emulator, 'lt');
      const rtName = getName(emulator, 'rt');
      return (
        <>
          {this.renderControl('start',   'Show Keypad')}
          {this.renderControl('lanalog', 'Move (Player 1)')}
          {this.renderControl('dpad',    'Move (Player 1)')}
          {aName  && this.renderControl('a',     aName)}
          {xName  && this.renderControl('x',     xName)}
          {yName  && this.renderControl('y',     yName)}
          {lbName && this.renderControl('lbump', lbName)}
          {ltName && this.renderControl('ltrig', ltName)}
          {rtName && this.renderControl('rtrig', rtName)}
          {this.renderControl('ranalog', 'Player 2 Joystick')}
          {this.renderControl('b',       'Player 2 Fire')}
          {this.renderControl('rbump',   'Player 2 Fire')}
        </>
      );
    }

    const aName  = getName(emulator, 'a');
    const bName  = getName(emulator, 'b');
    const xName  = getName(emulator, 'x');
    const yName  = getName(emulator, 'y');
    const lbName = getName(emulator, 'lb');
    const rbName = getName(emulator, 'rb');
    const ltName = getName(emulator, 'lt');
    const rtName = getName(emulator, 'rt');

    return (
      <>
        {this.renderControl('start', 'Show Keypad')}
        {this.renderControl('lanalog', 'Move')}
        {this.renderControl('dpad', 'Move')}
        {aName  && this.renderControl('a',     aName)}
        {bName  && this.renderControl('b',     bName)}
        {xName  && this.renderControl('x',     xName)}
        {yName  && this.renderControl('y',     yName)}
        {lbName && this.renderControl('lbump', lbName)}
        {rbName && this.renderControl('rbump', rbName)}
        {ltName && this.renderControl('ltrig', ltName)}
        {rtName && this.renderControl('rtrig', rtName)}
        {this.renderControl('ranalog', 'Paddle / Knob')}
      </>
    );
  }
}

export class KeyboardControlsTab extends ControlsTab {
  render() {
    const { emulator } = this.props;

    const aName  = getName(emulator, 'a');
    const bName  = getName(emulator, 'b');
    const xName  = getName(emulator, 'x');
    const yName  = getName(emulator, 'y');
    const lbName = getName(emulator, 'lb');
    const rbName = getName(emulator, 'rb');
    const ltName = getName(emulator, 'lt');
    const rtName = getName(emulator, 'rt');

    return (
      <>
        {this.renderKey('Enter', 'Show Keypad')}
        {this.renderKey('ArrowUp',    'Move Up')}
        {this.renderKey('ArrowDown',  'Move Down')}
        {this.renderKey('ArrowLeft',  'Move Left')}
        {this.renderKey('ArrowRight', 'Move Right')}
        {aName  && this.renderKey('KeyZ', aName)}
        {bName  && this.renderKey('KeyX', bName)}
        {xName  && this.renderKey('KeyA', xName)}
        {yName  && this.renderKey('KeyS', yName)}
        {lbName && this.renderKey('KeyW', lbName)}
        {rbName && this.renderKey('KeyE', rbName)}
        {ltName && this.renderKey('KeyQ', ltName)}
        {rtName && this.renderKey('KeyR', rtName)}
        {this.renderKey('Digit1', getKeypadName('1', emulator))}
        {this.renderKey('Digit2', getKeypadName('2', emulator))}
        {this.renderKey('Digit3', getKeypadName('3', emulator))}
        {this.renderKey('Digit4', getKeypadName('4', emulator))}
        {this.renderKey('Digit5', getKeypadName('5', emulator))}
        {this.renderKey('Digit6', getKeypadName('6', emulator))}
        {this.renderKey('Digit7', getKeypadName('7', emulator))}
        {this.renderKey('Digit8', getKeypadName('8', emulator))}
        {this.renderKey('Digit9', getKeypadName('9', emulator))}
        {this.renderKey('Digit0', getKeypadName('0', emulator))}
        {this.renderKey('KeyPeriod',  getKeypadName('.', emulator))}
        {this.renderKey('Minus',      getKeypadName('-', emulator))}
        {this.renderKey('Slash',      getKeypadName('/', emulator))}
        {this.renderKey('Equal',      getKeypadName('=', emulator))}
        {this.renderKey('Backspace',  getKeypadName('CE', emulator))}
        {this.renderKeys(['ShiftLeft', 'Equal'],  getKeypadName('+', emulator))}
        {this.renderKeys(['ShiftLeft', 'Digit8'], getKeypadName('×', emulator))}
        {this.renderKeys(['ShiftLeft', 'Digit5'], getKeypadName('%', emulator))}
      </>
    );
  }
}
