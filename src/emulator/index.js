import {
  BasicRetroAppWrapper,
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

export class Emulator extends BasicRetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);

    window.emulator = this;

    // a5200's own keypad/keypadDown/keypadCount triplet, same shape and
    // same purpose: pollControls() gates its CIDS.SELECT ("show keypad
    // screen") check behind `if (!keypadInput)` so an Enter press that
    // just confirmed a key selection (CIDS.START, see keypadDown below -
    // a separate keyboard-confirm concern, unrelated to what opens the
    // screen) can't also be misread there. sendKeyDown()'s own key
    // simulation doesn't need this (it self-manages via setTimeout), but
    // the gate does -- unlike a5200/jaguar, astrocade has no natural
    // persistent "current keypad value" to reuse, so this exists purely
    // to drive the gate.
    this.keypad = [0, 0];
    this.keypadDown = [false, false];
    this.keypadCount = [0, 0];

    this.frequency = 60;
    this.audioStarted = 0;
    this.firstFrame = true;

    // WRC - tracks Control/Shift physical state directly, since this app
    // has no CIDS-based keyboard mapping to hook into like a5200/colem's
    // CONTROL_KEY pseudo-mapping does - all keyboard input here goes
    // straight through the raw document.onkeydown/onkeyup handlers below
    // instead. ctrlHeld/shiftHeld reflect the current physical state;
    // controlKeyDown is the previous-frame edge-detect flag, same naming
    // a5200 uses for its own equivalent.
    this.ctrlHeld = false;
    this.shiftHeld = false;
    this.controlKeyDown = false;
    this.controlKeyEscalated = false;
    this.gamepadVkPending = false;
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

      this.app.showCanvas();

      setTimeout(() => {
        const onTouch = () => { this.onTouchEvent() };
        window.addEventListener("touchstart", onTouch);
        window.addEventListener("touchend", onTouch);
        window.addEventListener("touchcancel", onTouch);
        window.addEventListener("touchmove", onTouch);

        const onMouse = () => { this.onMouseEvent() };
        window.addEventListener("mousedown", onMouse);
        window.addEventListener("mouseup", onMouse);
        window.addEventListener("mousemove", onMouse);

        document.onkeydown = (e) => {
          // WRC - Control opens the grid keypad screen (see
          // pollControls()), keyboard equivalent of the gamepad LT+RA
          // combo - intercepted here instead of forwarded to the native
          // core, same as a5200/colem/Jaguar repurposing Control despite
          // it being a real key on modern keyboards (none of these
          // systems have a Control-equivalent button, so there's no real
          // conflict). Shift is tracked the same way for the Ctrl+Shift
          // escalate-to-pause check, but is NOT intercepted - it still
          // needs to reach _browserCodeToRetrok's shiftMap below for
          // real shifted-symbol input. Both tracked BEFORE the `paused`
          // check below: pollControls() calls pause(true) the instant
          // Control goes down, so if this tracking lived after that
          // check, the matching keyup (Control's release) would be
          // silently swallowed once paused, leaving ctrlHeld stuck true
          // forever and the release-wait loop in pollControls() spinning
          // indefinitely - a real bug caught before shipping this.
          if (e.code === KCODES.CONTROL_LEFT || e.code === KCODES.CONTROL_RIGHT) {
            this.ctrlHeld = true;
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          if (e.code === KCODES.SHIFT_LEFT || e.code === KCODES.SHIFT_RIGHT) {
            this.shiftHeld = true;
          }

          if (this.paused) return;
          // WRC - feeds the shared on-screen-controls auto-detection
          // (BasicRetroAppWrapper's checkOnScreenControls()) the same
          // way every other app's onkeydown does. Added here rather
          // than a separate handler since document.onkeydown can only
          // ever hold one function - a second assignment would have
          // silently replaced this raw keyboard forwarding entirely.
          this.onKeyboardEvent(e);

          if (e.repeat !== undefined && e.repeat) return;
          const retrok = this._browserCodeToRetrok(e.code, e.shiftKey);
          if (retrok) {
            window.Module._wrc_on_key(retrok, 1);
            e.stopPropagation();
            e.preventDefault();
          }
        };

        document.onkeyup = (e) => {
          // WRC - see the matching comment in onkeydown above - tracked
          // unconditionally, before the `paused` check, so release is
          // never missed while paused.
          if (e.code === KCODES.CONTROL_LEFT || e.code === KCODES.CONTROL_RIGHT) {
            this.ctrlHeld = false;
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          if (e.code === KCODES.SHIFT_LEFT || e.code === KCODES.SHIFT_RIGHT) {
            this.shiftHeld = false;
          }

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

  // Base class default pauses on any tap anywhere on screen -- redundant
  // (and disruptive) now that there's a dedicated Pause button in the
  // touch overlay. Same override every other TouchOverlay app uses for
  // the same reason.
  createTouchListener() {}

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

  // keyPressed (a5200's own onKeypad naming/pattern): the browser key
  // code that triggered this selection, if it came from a real keyboard
  // press (e.g. "Enter"). showControllers() disables the main keyboard
  // listener for the life of the on-screen keypad screen, so it never
  // observes the keydown that made this selection -- without this
  // synthetic "down" event, isControlDown(CIDS.START) would read
  // stale/false even while Enter is still physically held, breaking the
  // keypadDown hold-check above.
  sendKeyDown(code, keyPressed = null) {
    const { controllers } = this;

    if (keyPressed && controllers) {
      controllers.addFakeKeyEvent(keyPressed, true);
    }

    // Same keypad/keypadDown/keypadCount update a5200's onKeypad() does,
    // unconditionally (not just for keyboard-driven selections) -- also
    // covers a gamepad A-button selection staying "held" via
    // isControlDown(CIDS.A) in pollControls(), same as a5200.
    this.keypad[0] = code;
    this.keypadDown[0] = true;
    this.keypadCount[0] = 10;

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

        // In dual controller mode, "b"/"rb" are the second virtual player's
        // fire button (see the dualController branch below). Skip them here
        // so the primary player doesn't also fire on the same press.
        if (this.dualController && (controller === 0 || controller === 2) &&
            (button.button === 'b' || button.button === 'rb')) {
          continue;
        }

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

      // Same keypadInput derivation as a5200's pollControls(): stays
      // truthy for as long as the physical select input (gamepad A, or
      // Enter for keyboard) stays held after a keypad selection, via
      // keypadDown/keypadCount (set in sendKeyDown()).
      let keypadInput = false;
      if (this.keypad[0]) {
        this.keypadCount[0]--;

        if (this.keypadDown[0]) {
          this.keypadDown[0] = (controllers.isControlDown(0, CIDS.A) || controllers.isControlDown(0, CIDS.START));
        }

        if (this.keypadCount[0] <= 0 && !this.keypadDown[0]) {
          this.keypad[0] = 0;
          this.keypadCount[0] = 0;
          this.keypadDown[0] = false;
        }

        if (this.keypad[0]) {
          keypadInput = true;
        }
      }

      if (!keypadInput) {
        // LT+RA opens the grid keypad screen -- same gesture Apple II/
        // Apple IIGS/Commodore 8-bit/DOSBox Pure/a5200/colem/Jaguar use
        // for their own on-screen keyboard/keypad, via the shared
        // CIDS.WRC_CUSTOM synthetic control. Per
        // docs/control-mapping-audit.md's GRP3 target row for this app -
        // "VKeypad Gamepad: LT+RA" / "VKeypad Keyboard: CTRL" - this was
        // never implemented at all until now.
        if (controllers.isControlDown(0, CIDS.WRC_CUSTOM)) {
          if (!this.gamepadVkPending) {
            this.gamepadVkPending = true;
            controllers
              .waitUntilControlReleased(0, CIDS.WRC_CUSTOM)
              .then(() => {
                this.gamepadVkPending = false;
                if (this.pause(true)) {
                  this.showControllers(0);
                }
              });
          }
        } else {
          // Control key opens the grid keypad screen -- keyboard
          // equivalent of LT+RA above, matching a5200/colem/Jaguar's
          // exact pattern (wait for release, escalate to the real pause
          // menu if Shift joins mid-press - the Ctrl+Shift muscle-memory
          // case) but reading this.ctrlHeld/shiftHeld directly (tracked
          // in the raw onkeydown/onkeyup handlers above) instead of a
          // CIDS keymap, since this app has no custom KeyCodeToControlMapping
          // to hook a pseudo-control into like those apps do.
          if (this.ctrlHeld && !this.controlKeyDown && this.pause(true)) {
            this.controlKeyEscalated = false;
            const CONTROL_KEY_WAIT_INTERVAL = 50;
            const waitForControlKeyRelease = () => {
              if (this.shiftHeld) {
                this.controlKeyEscalated = true;
              }
              if (this.ctrlHeld) {
                setTimeout(waitForControlKeyRelease, CONTROL_KEY_WAIT_INTERVAL);
              } else if (this.controlKeyEscalated) {
                this.showPauseMenu();
              } else {
                this.showControllers(0);
              }
            };
            setTimeout(waitForControlKeyRelease, CONTROL_KEY_WAIT_INTERVAL);
          }
          this.controlKeyDown = this.ctrlHeld;
        }
      }

      // WRC - explicit CIDS.ESCAPE check, positioned before the
      // CIDS.SELECT check below, matching a5200/colem's exact ordering -
      // a real bug the user caught: on a non-Xbox pad, CIDS.ESCAPE's own
      // synthesis includes SELECT+X (see controls.js), which overlaps
      // with literal CIDS.SELECT itself. This app has no explicit
      // CIDS.ESCAPE handling of its own - it relies entirely on
      // super.pollControls() below for that - so without this check,
      // pressing X+Select got caught by the CIDS.SELECT branch below
      // FIRST (which returns early), and super.pollControls() never got
      // a chance to run, meaning Select+X opened the keypad instead of
      // pausing. Checking ESCAPE first and returning here (before
      // reaching the SELECT branch) restores the correct priority:
      // Pause wins over the keypad whenever both combos are satisfied
      // at once.
      if (controllers.isControlDown(0, CIDS.ESCAPE)) {
        if (this.pause(true)) {
          controllers
            .waitUntilControlReleased(0, CIDS.ESCAPE)
            .then(() => this.showPauseMenu());
          return;
        }
      }

      // WRC - per docs/control-mapping-audit.md's GRP3 target: Select
      // opens the keypad (Astrocade has no physical Start button either,
      // so per the doc Start would be read but produce no defined
      // function) - this used to be on CIDS.START instead, fixed to
      // match the doc and retro-a5200/colem.
      if (!keypadInput && controllers.isControlDown(0, CIDS.SELECT)) {
        if (this.pause(true)) {
          controllers
            .waitUntilControlReleased(0, CIDS.SELECT)
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

