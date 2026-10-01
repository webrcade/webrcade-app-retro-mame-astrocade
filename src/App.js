import React from "react";

import {
  TouchOverlay,
  WebrcadeRetroApp
} from '@webrcade/app-common';

import { Emulator } from './emulator';
import { EmulatorPauseScreen } from './pause';
import { ControllersScreen } from './controllers';

import './App.scss';

class App extends WebrcadeRetroApp {

  CONTROLLERS_MODE = "controllers";
  lastKeyRow = 3;
  lastKeyCol = 2;

  constructor() {
    super();
    this.state = {
      ...this.state,
      showCanvas: false,
    };
  }

  showCanvas() {
    this.setState({ showCanvas: true });
  }

  createEmulator(app, isDebug) {
    const { appProps } = this;

    let mappings = appProps.mappings;
    if (!mappings || Object.keys(mappings).length === 0) {
      mappings = { "a": "fire", "b": "fire", "lb": "fire", "rb": "fire" };
    }
    this.mappings = mappings;
    this.descriptions = appProps.descriptions || {};
    this.analogDirection = appProps.analogDirection ?? 0;
    this.analogInvert = appProps.analogInvert ?? false;
    const controlMode = parseInt(appProps.controlMode ?? 0, 10);
    this.dualController = controlMode === 1;
    this.icbm = controlMode === 2;

    return new Emulator(app, isDebug);
  }

  isDiscBased() {
    return false;
  }

  isBiosRequired() {
    return true;
  }

  getBiosMap() {
    return {
      '7d25a26e5c4841b364cfe6b1735eaf03': 'astro.bin',
    };
  }

  getBiosUrls(appProps) {
    return appProps.astrocade_bios ? [appProps.astrocade_bios] : [];
  }

  renderControllersScreen() {
    const { controllerIndex } = this.state;
    const { CONTROLLERS_MODE, emulator, appProps } = this;
    const descriptions = appProps.descriptions || {};

    return (
      <ControllersScreen
        controllerIndex={controllerIndex}
        initialRow={this.lastKeyRow}
        initialCol={this.lastKeyCol}
        onSelect={(scancode, r, c, keyCode) => { this.lastKeyRow = r; this.lastKeyCol = c; emulator.sendKeyDown(scancode, keyCode); }}
        closeCallback={(r, c) => {
          // WRC - closing without picking a key (cancel) used to leave
          // lastKeyRow/lastKeyCol at wherever the last actual selection
          // was, not wherever the cursor was just navigated to -
          // reopening the keypad would jump back to the old selection
          // instead of where the player had last been looking.
          // ControllersScreen's close() now always passes its current
          // row/col here, same fix as retro-a5200/colem.
          if (r !== undefined && c !== undefined) {
            this.lastKeyRow = r;
            this.lastKeyCol = c;
          }
          this.resume(CONTROLLERS_MODE);
        }}
        descriptions={descriptions}
        emulator={emulator}
      />
    );
  }

  renderPauseScreen() {
    const { appProps, emulator } = this;

    return (
      <EmulatorPauseScreen
        emulator={emulator}
        appProps={appProps}
        closeCallback={() => this.resume()}
        exitCallback={() => {
          this.exitFromPause();
        }}
        isEditor={this.isEditor}
        isStandalone={this.isStandalone}
      />
    );
  }

  showControllers(index, swap, resumeCallback) {
    const { mode } = this.state;
    const { CONTROLLERS_MODE } = this;

    if (mode !== CONTROLLERS_MODE) {
      this.setState({
        mode: CONTROLLERS_MODE,
        resumeCallback: resumeCallback,
        controllerIndex: index,
      });
      return true;
    }
    return false;
  }

  isControllersScreen() {
    const { mode } = this.state;
    const { CONTROLLERS_MODE } = this;
    return mode === CONTROLLERS_MODE;
  }

  render() {
    const { mode, showCanvas } = this.state;
    const { CONTROLLERS_MODE } = this;

    return (
      <>
        {super.render()}
        {mode === CONTROLLERS_MODE ? this.renderControllersScreen() : null}
        <TouchOverlay
          show={showCanvas}
          showKeypad={true}
          onKeypadClick={() => {
            // WRC - must go through the emulator's showControllers()
            // wrapper (same as the LT+RA gamepad gesture in
            // emulator/index.js's pollControls()), not the bare App-level
            // showControllers() directly - the wrapper is what pauses the
            // emulator, disables real controller/keyboard input for the
            // life of the keypad screen, and re-enables/resumes on close.
            // Calling the App method directly skipped all of that, leaving
            // input live while the keypad was open and never resuming on
            // select/close.
            const { emulator } = this;
            if (emulator.pause(true)) {
              emulator.showControllers(0);
            }
          }}
        />
      </>
    );
  }
}

export default App;
