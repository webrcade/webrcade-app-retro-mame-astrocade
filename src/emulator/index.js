import {
  RetroAppWrapper,
  CIDS,
  KCODES,
  LOG,
  ScriptAudioProcessor,
  DisplayLoop,
} from '@webrcade/app-common';

const LABEL_TO_RETROK = {
  "C":  99,  "↑": 280, "↓": 281, "%": 111,
  "MR": 114, "MS": 115, "CH": 104, "/": 267,
  "7":   55, "8":  56,  "9":  57,  "×": 268,
  "4":   52, "5":  53,  "6":  54,  "-": 269,
  "1":   49, "2":  50,  "3":  51,  "+": 270,
  "CE": 101, "0":  48,  ".":  46,  "=": 271,
};

export class Emulator extends RetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);

    window.emulator = this;

    this.frequency = 60;
    this.audioStarted = 0;
    this.firstFrame = true;
    this.mappings = app.mappings || {};
    this.descriptions = app.descriptions || {};
    this.mappingState = new Set();
    this.analogDirection = app.analogDirection ?? 0;
    this.analogInvert = app.analogInvert ?? false;
    this.dualController = app.dualController ?? false;
    this.icbm = app.icbm ?? false;

    // Fractional sample carry (for 800.25)
    this.audioCarry = 0;

    this.audioCallback = (offset, length) => {
      // length = incoming frames (mono)
      // Overproduce at 48015Hz then reduce during playback to handle timing variability

      // ---- target frames this callback ----
      const exactFrames = 48015 / this.frequency; // 800.25
      const framesWithCarry = exactFrames + this.audioCarry;
      const outFrames = Math.floor(framesWithCarry);
      this.audioCarry = framesWithCarry - outFrames;

      // ---- input samples (stereo interleaved) ----
      const inSamples = length << 1;
      const input = new Int16Array(
        window.Module.HEAP16.buffer,
        offset,
        inSamples
      );

      // ---- output buffer (stereo interleaved) ----
      const outSamples = outFrames << 1;
      const output = new Int16Array(outSamples);

      // ---- frame walking resampler (no timing drift) ----
      const step = length / outFrames;

      let srcFrame = 0;
      for (let i = 0; i < outFrames; i++) {
        const si = (srcFrame | 0) << 1;

        output[i * 2]     = input[si];
        output[i * 2 + 1] = input[si + 1];

        srcFrame += step;
      }

      this.audioProcessor.storeSoundCombinedInput(
        output,
        2,
        outSamples,
        0,
        32768
      );
    };
  }

  createAudioProcessor() {
    return new ScriptAudioProcessor(
      2,
      48000,
      8192 + 4096,
      2048
    ).setDebug(this.debug);
  }

  onFrame() {
    // Start audio processor after a few frames
    if (this.audioStarted !== -1) {
      if (this.audioStarted > 1) {
        this.audioStarted = -1;
        this.audioProcessor.start();
      } else {
        this.audioStarted++;
      }
    }

    if (this.firstFrame) {
      this.firstFrame = false;

      setTimeout(() => {
        document.onkeydown = (e) => {
          if (this.paused) return;
          if (e.repeat !== undefined && e.repeat) return;
          const retrok = this._browserCodeToRetrok(e.code, e.shiftKey);
          if (retrok) {
            window.Module._wrc_on_key(retrok, 1);
            e.stopPropagation();
            e.preventDefault();
          }
        };

        document.onkeyup = (e) => {
          if (this.paused) return;
          const retrok = this._browserCodeToRetrok(e.code, e.shiftKey);
          if (retrok) {
            window.Module._wrc_on_key(retrok, 0);
            e.stopPropagation();
            e.preventDefault();
          }
        };
      }, 10);
    }
  }

  _browserCodeToRetrok(code, shiftKey) {
    if (shiftKey) {
      const shiftMap = {
        'Equal':  270, // + → RETROK_KP_PLUS  → ITEM_ID_PLUS_PAD  (MAME: KEYCODE_PLUS_PAD)
        'Digit8': 268, // * → RETROK_KP_MULTIPLY → ITEM_ID_ASTERISK (MAME: KEYCODE_ASTERISK)
        'Digit5': 111, // % → RETROK_o        → ITEM_ID_O         (MAME: KEYCODE_O)
      };
      if (shiftMap[code]) return shiftMap[code];
    }
    const map = {
      'Digit0': 48, 'Digit1': 49, 'Digit2': 50, 'Digit3': 51, 'Digit4': 52,
      'Digit5': 53, 'Digit6': 54, 'Digit7': 55, 'Digit8': 56, 'Digit9': 57,
      'Period':    46,  // .  → RETROK_PERIOD   → ITEM_ID_STOP      (MAME: KEYCODE_STOP)
      'Minus':    269,  // -  → RETROK_KP_MINUS → ITEM_ID_MINUS_PAD (MAME: KEYCODE_MINUS_PAD)
      'Slash':    267,  // /  → RETROK_KP_DIVIDE → ITEM_ID_SLASH_PAD (MAME: KEYCODE_SLASH_PAD)
      'Equal':    271,  // =  → RETROK_KP_ENTER → ITEM_ID_ENTER_PAD (MAME: KEYCODE_ENTER_PAD)
      'Backspace': 101, // CE → RETROK_e       → ITEM_ID_E         (MAME: KEYCODE_E)
    };
    return map[code] || 0;
  }

  sendKeyDown(code) {
    const retrok = typeof code === 'number' ? code : this._browserCodeToRetrok(code);
    const { Module } = window;
    if (retrok && Module && Module._wrc_on_key) {
      Module._wrc_on_key(retrok, 1);
      setTimeout(() => Module._wrc_on_key(retrok, 0), 100);
    }
  }

  sendKeyUp(code) {
    const retrok = typeof code === 'number' ? code : this._browserCodeToRetrok(code);
    const { Module } = window;
    if (retrok && Module && Module._wrc_on_key) Module._wrc_on_key(retrok, 0);
  }

  BUTTONS = [
    { button: "a",  inp: this.INP_A  },
    { button: "b",  inp: this.INP_B },
    { button: "x",  inp: this.INP_X },
    { button: "y",  inp: this.INP_Y },
    { button: "lb", inp: this.INP_LBUMP },
    { button: "lt", inp: this.INP_LTRIG },
    { button: "rb", inp: this.INP_RBUMP },
    { button: "rt", inp: this.INP_RTRIG },
  ];

  sendInput(controller, input, analog0x, analog0y, analog1x, analog1y) {
    const { mappings, mappingState } = this;
    let outInput = input;

    if (!this.paused) {
      for (const button of this.BUTTONS) {
        const isDown = (input & button.inp) !== 0;
        if (isDown) outInput &= ~button.inp;

        const mapping = mappings[button.button];
        if (!mapping) continue;

        if (mapping === 'fire') {
          if (isDown) outInput |= this.INP_A;
        } else {
          if (controller === 0) {
            const retrok = LABEL_TO_RETROK[mapping];
            if (retrok) {
              const wasDown = mappingState.has(button.button);
              if (isDown && !wasDown) {
                mappingState.add(button.button);
                window.Module._wrc_on_key(retrok, 1);
              } else if (!isDown && wasDown) {
                mappingState.delete(button.button);
                window.Module._wrc_on_key(retrok, 0);
              }
            }
          }
        }
      }
    }

    if (!this.getDisableInput()) {
      if (this.icbm) {
        // ICBM
        // Player 1 Knob	Move crosshair left/right
        // Player 2 Knob	Move crosshair up/down
        // Player 1 Left	Fire left base
        // Player 1 Right	Fire right base
        // Player 1 Trigger	Fire center base
        // Player 2 Trigger	Start game
        outInput &= ~(this.INP_LEFT | this.INP_RIGHT | this.INP_UP | this.INP_DOWN | this.INP_A )
        if (controller === 0 ) {
          const xAnalog = this.controllers.getAxisValue(controller, 0, true);
          if (this.controllers.isControlDown(controller, CIDS.X)) {
            outInput |= this.INP_LEFT;
          }
          if (this.controllers.isControlDown(controller, CIDS.B)) {
            outInput |= this.INP_RIGHT;
          }
          if (this.controllers.isControlDown(controller, CIDS.Y)) {
            outInput |= this.INP_A;
          }
          window.Module._wrc_set_input(controller, outInput, 0, 0, xAnalog * -1, 0);
        } else if (controller === 1) {
          if (this.controllers.isControlDown(0, CIDS.A)) {
            outInput |= this.INP_A;
          }
          const yAnalog = this.controllers.getAxisValue(0, 0, false);
          window.Module._wrc_set_input(controller, outInput, 0, 0, yAnalog * -1, 0);
        }
      } else if (this.dualController) {
        if (controller === 0 || controller === 2) {
          window.Module._wrc_set_input(controller, outInput, 0, 0, 0, 0);
        } else if (controller === 1 || controller === 3) {
            outInput = 0;
            if (this.controllers.isAxisDown(controller - 1, 1)) {
              outInput |= this.INP_DOWN;
            }
            if (this.controllers.isAxisLeft(controller - 1, 1)) {
              outInput |= this.INP_LEFT;
            }
            if (this.controllers.isAxisUp(controller - 1, 1)) {
              outInput |= this.INP_UP;
            }
            if (this.controllers.isAxisRight(controller - 1, 1)) {
              outInput |= this.INP_RIGHT;
            }
            if (this.controllers.isControlDown(controller - 1, CIDS.B) ||
                this.controllers.isControlDown(controller - 1, CIDS.RBUMP)) {
                outInput |= this.INP_A;
            }
            window.Module._wrc_set_input(controller, outInput, 0, 0, 0, 0);
        }
      } else {
        let paddle = this.analogDirection === 1 ? analog1y : analog1x;
        if (this.analogInvert) paddle = -paddle;
        window.Module._wrc_set_input(controller, outInput, analog0x, analog0y, paddle, analog1y);
      }
    } else {
      window.Module._wrc_set_input(controller, 0, 0, 0, 0, 0);
    }
  }

  showControllers(index) {
    const { app, controllers } = this;

    if (controllers) {
      controllers.setEnabled(false);
      controllers.addFakeKeyEvent(KCODES.ENTER, false);
    }

    setTimeout(() => {
      this.showPauseDelay = 0;
      app.showControllers(index, false, () => {
        if (controllers) {
          controllers.setEnabled(true);
        }
        this.pause(false, true);
      });
    }, this.showPauseDelay);
  }

  pollControls() {
    const { controllers } = this;

    if (controllers) {
      controllers.poll();

      if (controllers.isControlDown(0, CIDS.START)) {
        if (this.pause(true)) {
          controllers
            .waitUntilControlReleased(0, CIDS.START)
            .then(() => this.showControllers(0));
          return;
        }
      }
    }

    super.pollControls();
  }

  setRoms(uid, frontendArray, biosBuffers, romBytes, ext) {
    super.setRoms(uid, frontendArray, biosBuffers, romBytes, ext);
    this.game = this.RA_DIR + 'astrocde/game';
  }


  getHashFileExtension() {
    return 'bin';
  }

  getScriptUrl() {
    return 'js/astrocade_libretro.js';
  }

  getPrefs() {
    return this.prefs;
  }

  // setIsNtsc(val) {
  //   this.frequency = val ? 60 : 50;
  //   console.log("Set frequency to: " + this.frequency);
  // }

  // isForcePAL() {
  //   const props = this.getProps();
  //   let force = false;
  //   if (props.pal) {
  //     force = true;
  //   }
  //   console.log("## Force PAL: " + force);
  //   return force;
  // }

  // getPort2() {
  //   const props = this.getProps();
  //   let port2 = 0;
  //   if (props.port2) {
  //     port2 = props.port2;
  //   }
  //   console.log("## Port 2: " + port2);
  //   return port2;
  // }

  async saveState() {
    const { saveStatePath, started } = this;
    const { FS, Module } = window;

    try {
      if (!started) {
        return;
      }

      // Save to files
      Module._cmd_savefiles();

      let path = '';
      const files = [];
      let s = null;

      path = `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`;
      LOG.info('Checking: ' + path);
      try {
        s = FS.readFile(path);
        if (s) {
          LOG.info('Found save file: ' + path);
          files.push({
            name: this.SAVE_NAME,
            content: s,
          });
        }
      } catch (e) {}

      if (files.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(files)) {
          await this.getSaveManager().save(
            saveStatePath,
            files,
            this.saveMessageCallback,
          );
        }
      } else {
        await this.getSaveManager().delete(path);
      }
    } catch (e) {
      LOG.error('Error persisting save state: ' + e);
    }
  }

  async loadState() {
    const { saveStatePath } = this;
    const { FS } = window;

    // // Warm the cloud check cache to eliminate delay when opening settings
    // try {
    //   await this.getSaveManager().isCloudEnabled(this.loadMessageCallback);
    // } finally {
    //   this.loadMessageCallback(null);
    // }

    try {
      // Load
      const files = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f.name === this.SAVE_NAME) {
            LOG.info(`writing ${this.GAME_SRAM_NAME} file`);
            FS.writeFile(
              `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`,
              f.content,
            );
          }
        }

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(files);
      }
    } catch (e) {
      LOG.error('Error loading save state: ' + e);
    }
  }

  isEscapeHackEnabled() {
    return false;
  }

  async applyGameSettings() {
  }

  async onWriteAdditionalFiles() {
    await super.onWriteAdditionalFiles();
    const { FS } = window;

    try { FS.mkdir('/home/web_user/retroarch/userdata/system/mame/bios'); } catch (e) {}
    try { FS.mkdir('/home/web_user/retroarch/userdata/system/mame/bios/astrocde'); } catch (e) {}

    // Write MAME.opt config
    const mameOpt =
      'mame_alternate_renderer = "disabled"\n' +
      'mame_altres = "640x480"\n' +
      'mame_auto_save = "disabled"\n' +
      'mame_autoloadfastforward = "disabled"\n' +
      'mame_boot_to_bios = "disabled"\n' +
      'mame_boot_to_osd = "disabled"\n' +
      'mame_buttons_profiles = "disabled"\n' +
      'mame_cheats_enable = "disabled"\n' +
      'mame_coin_limit = "0"\n' +
      'mame_cpu_overclock = "default"\n' +
      'mame_cpu_sound_overclock = "default"\n' +
      'mame_joystick_deadzone = "0.15"\n' +
      'mame_joystick_saturation = "0.85"\n' +
      'mame_joystick_threshold = "0.30"\n' +
      'mame_lightgun_mode = "none"\n' +
      'mame_lightgun_offscreen_mode = "free"\n' +
      'mame_mame_4way_enable = "disabled"\n' +
      'mame_mame_paths_enable = "disabled"\n' +
      'mame_media_type = "cart"\n' +
      'mame_mouse_enable = "enabled"\n' +
      'mame_read_config = "disabled"\n' +
      'mame_rotation_mode = "libretro"\n' +
      'mame_saves = "game"\n' +
      'mame_softlists_auto_media = "enabled"\n' +
      'mame_softlists_enable = "disabled"\n' +
      'mame_thread_mode = "enabled"\n' +
      'mame_throttle = "disabled"\n' +
      'mame_write_config = "disabled"\n';

    try {
      FS.writeFile('/home/web_user/retroarch/userdata/config/MAME/MAME.opt', mameOpt);
      console.log(FS.readFile('/home/web_user/retroarch/userdata/config/MAME/MAME.opt', { encoding: 'utf8' }));
    } catch (e) {
      LOG.error('Error writing MAME.opt config: ' + e);
    }

    // Write Astrocade BIOS to MAME-specific path
    const biosBuffers = this.biosBuffers;
    LOG.info('biosBuffers keys: ' + (biosBuffers ? Object.keys(biosBuffers).join(', ') : 'null'));
    if (biosBuffers && biosBuffers['astro.bin']) {
      try {
        FS.writeFile(
          '/home/web_user/retroarch/userdata/system/mame/bios/astrocde/astro.bin',
          biosBuffers['astro.bin'],
        );
        const verify = FS.readFile('/home/web_user/retroarch/userdata/system/mame/bios/astrocde/astro.bin');
        LOG.info('Wrote astro.bin BIOS, size: ' + verify.length);
      } catch (e) {
        LOG.error('Error writing Astrocade BIOS: ' + e);
      }
    }
  }

  isForceAspectRatio() {
    return false;
  }

  getDefaultAspectRatio() {
    return 1.333;
  }

  resizeScreen(canvas) {
    this.canvas = canvas;
    this.updateScreenSize();
  }

  createDisplayLoop(debug) {
    const loop = new DisplayLoop(
      this.frequency,
      true, // vsync
      debug, // debug
      false,
    );
    // loop.setAdjustTimestampEnabled(false);
    return loop;
  }

  // getDisplayLoopReturn() {
  //   if (this.lastFrequency !== this.frequency) {
  //     this.lastFrequency = this.frequency;
  //     console.log('returning: ' + this.frequency);
  //     return this.frequency;
  //   }
  //   return undefined;
  // }

  getShotAspectRatio() { return this.getDefaultAspectRatio(); }
}

