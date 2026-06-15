import React from "react";

import {
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

  createEmulator(app, isDebug) {
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
        onSelect={(scancode, r, c) => { this.lastKeyRow = r; this.lastKeyCol = c; emulator.sendKeyDown(scancode); }}
        closeCallback={() => { this.resume(CONTROLLERS_MODE); }}
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
    const { mode } = this.state;
    const { CONTROLLERS_MODE } = this;

    return (
      <>
        {super.render()}
        {mode === CONTROLLERS_MODE ? this.renderControllersScreen() : null}
      </>
    );
  }
}

export default App;
