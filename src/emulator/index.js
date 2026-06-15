import {
  RetroAppWrapper,
  CIDS,
  KCODES,
  LOG,
  ScriptAudioProcessor,
  DisplayLoop,
} from '@webrcade/app-common';

export class Emulator extends RetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);

    window.emulator = this;

    // this.lastFrequency = 60;
    this.frequency = 60;
    // this.audioStarted = 0;

    // // Fractional sample carry (for 800.25)
    // this.audioCarry = 0;

    // this.total = 0;
    // this.count = 0;

    // this.audioCallback = (offset, length) => {
    //   // length = incoming frames (mono)
    //   //this.total += length;
    //   this.count++;

    //   // ---- target frames this callback ----
    //   const exactFrames = 48015 / this.frequency; // 800.25
    //   const framesWithCarry = exactFrames + this.audioCarry;
    //   const outFrames = Math.floor(framesWithCarry);
    //   this.audioCarry = framesWithCarry - outFrames;

    //   if (this.count >= this.frequency) {
    //     // console.log("frame: " + length + ", exact: " + exactFrames);
    //     // console.log("total:", this.total);
    //     this.total = 0;
    //     this.count = 0;
    //   }

    //   // ---- input samples (stereo interleaved) ----
    //   const inSamples = length << 1;
    //   const input = new Int16Array(
    //     window.Module.HEAP16.buffer,
    //     offset,
    //     inSamples
    //   );

    //   // ---- output buffer (stereo interleaved) ----
    //   const outSamples = outFrames << 1;
    //   const output = new Int16Array(outSamples);

    //   // ---- frame walking resampler (no timing drift) ----
    //   const step = length / outFrames;

    //   let srcFrame = 0;
    //   for (let i = 0; i < outFrames; i++) {
    //     const si = (srcFrame | 0) << 1;

    //     output[i * 2]     = input[si];
    //     output[i * 2 + 1] = input[si + 1];

    //     srcFrame += step;
    //   }

    //   this.total += (outSamples >> 1);

    //   this.audioProcessor.storeSoundCombinedInput(
    //     output,
    //     2,
    //     outSamples,
    //     0,
    //     32768
    //   );
    // };
  }

  // createAudioProcessor() {
  //   return new ScriptAudioProcessor(
  //     2,
  //     48000,
  //     8192 + 4096,
  //     2048
  //   ).setDebug(this.debug);
  // }

  // onFrame() {
  //   if (this.audioStarted !== -1) {
  //     if (this.audioStarted > 1) {
  //       this.audioStarted = -1;
  //       // Start the audio processor
  //       this.audioProcessor.start();
  //     } else {
  //       this.audioStarted++;
  //     }
  //   }
  // }

  sendKeyDown(scancode) {
    console.log('sendKeyDown: scancode=' + scancode);
    window.Module._wrc_on_key(scancode, 1);
    setTimeout(() => window.Module._wrc_on_key(scancode, 0), 50);
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

