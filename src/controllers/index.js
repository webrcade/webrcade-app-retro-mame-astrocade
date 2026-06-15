import React, { Component } from "react";

import {
  AstrocadeKeypad,
  GamepadEnum,
  ImageButton,
  KCODES,
  Screen,
  WebrcadeContext
} from '@webrcade/app-common';

import './style.scss'

// RETROK_* keycodes derived from MAME astrohome.cpp INPUT_PORTS definitions
// Layout: 6 rows × 4 columns, left-to-right matches physical keypad
const SCANCODES = [
  // Row 0: C (KEYCODE_C), ↑ (KEYCODE_PGUP), ↓ (KEYCODE_PGDN), % (KEYCODE_O)
  [99, 280, 281, 111],
  // Row 1: MR (KEYCODE_R), MS (KEYCODE_S), CH (KEYCODE_H), / (KEYCODE_SLASH_PAD)
  [114, 115, 104, 267],
  // Row 2: 7 (KEYCODE_7), 8 (KEYCODE_8), 9 (KEYCODE_9), × (KEYCODE_ASTERISK)
  [55, 56, 57, 268],
  // Row 3: 4 (KEYCODE_4), 5 (KEYCODE_5), 6 (KEYCODE_6), - (KEYCODE_MINUS_PAD)
  [52, 53, 54, 269],
  // Row 4: 1 (KEYCODE_1), 2 (KEYCODE_2), 3 (KEYCODE_3), + (KEYCODE_PLUS_PAD)
  [49, 50, 51, 270],
  // Row 5: CE (KEYCODE_E), 0 (KEYCODE_0), . (KEYCODE_STOP), = (KEYCODE_ENTER_PAD)
  [101, 48, 46, 271],
];

const KEY_LABELS = [
  ["C", "↑", "↓", "%"],
  ["MR", "MS", "CH", "/"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "+"],
  ["CE", "0", ".", "="],
];

export class ControllerButton extends ImageButton {
  render() {
    const { buttonRef, ...other } = this.props;
    return (
      <ImageButton
        ref={buttonRef}
        className={"controller-image-button"}
        {...other}
      />
    );
  }
}

export class Controller extends Component {

  constructor() {
    super();

    this.buttonRefs = Array.from({ length: 6 }, () =>
      Array.from({ length: 4 }, () => React.createRef())
    );
  }

  render() {
    const { buttonRefs } = this;
    const { controllerIndex, descriptions, row, col, onFocusChanged, onSelect } = this.props;

    const updateDescription = (r, c) => {
      setTimeout(() => {
        const descRow = document.getElementById("controller-description-row");
        if (!descRow) return;
        let description = "";
        if (r >= 0 && c >= 0) {
          const key = KEY_LABELS[r][c];
          description = (descriptions && descriptions[key]) ? descriptions[key] : key;
          if (description) {
            if (descRow.innerHTML !== description) {
              descRow.classList.remove("description-fade-in");
              setTimeout(() => descRow.classList.add("description-fade-in"), 50);
            }
          }
        }
        descRow.innerHTML = description;
      }, 0);
    };

    updateDescription(row, col);

    setTimeout(() => {
      if (row >= 0 && col >= 0) {
        const ref = buttonRefs[row][col];
        if (ref && ref.current) ref.current.focus();
      }
    }, 0);

    const onClick = (e, scancode, r, c) => {
      if (e && e.type && e.type === GamepadEnum.A) {
        if (e.index !== controllerIndex) return;
      }
      if (e.clientX !== undefined && e.clientX === 0) return;
      onSelect(scancode, r, c);
    };

    const rows = SCANCODES.map((rowCodes, r) => (
      <div key={r} className={`controller-row${r === 0 ? ' controller-first-row' : ''}`}>
        {rowCodes.map((scancode, c) => (
          <div key={c} className="controller-row-button">
            <ControllerButton
              buttonRef={buttonRefs[r][c]}
              onFocus={() => onFocusChanged(r, c)}
              onClick={(e) => onClick(e, scancode, r, c)}
              onMouseEnter={() => updateDescription(r, c)}
              onMouseLeave={() => updateDescription(row, col)}
            />
          </div>
        ))}
      </div>
    ));

    return (
      <div className="controller"
        style={{ backgroundImage: "url(" + AstrocadeKeypad + ")" }}
      >
        {rows}
        <div id="controller-description-row" className="controller-row controller-description-row"></div>
      </div>
    );
  }
}

export class ControllersScreen extends Screen {
  constructor() {
    super();

    this.gamepadNotifier.setImmediateA(true);
    this.state = {
      controllerIndex: null,
      row: -1,
      col: -1
    };
  }

  ModeEnum = {};

  componentDidMount() {
    const { controllerIndex } = this.state;
    super.componentDidMount();
    document.documentElement.addEventListener("keydown", this.handleKeyDownEvent);
    if (controllerIndex === null) {
      this.setState({
        controllerIndex: this.props.controllerIndex,
        row: this.props.initialRow !== undefined ? this.props.initialRow : 3,
        col: this.props.initialCol !== undefined ? this.props.initialCol : 2,
      });
    }
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    document.documentElement.removeEventListener("keydown", this.handleKeyDownEvent);
  }

  focus() {
    const { row, col } = this.state;
    if (this.gamepadNotifier.padCount > 0) {
      if (row < 0 || col < 0) {
        this.setState({ row: 3, col: 2 });
      }
    }
  }

  globalGamepadCallback = e => {
    const { controllerIndex, row, col } = this.state;
    let newRow = row;
    let newCol = col;

    if (controllerIndex !== e.index) return;

    if (row >= 0 && col >= 0) {
      if (e.type === GamepadEnum.LEFT) {
        if (col > 0) newCol = col - 1;
      } else if (e.type === GamepadEnum.RIGHT) {
        if (col < 3) newCol = col + 1;
      } else if (e.type === GamepadEnum.UP) {
        if (row > 0) newRow = row - 1;
      } else if (e.type === GamepadEnum.DOWN) {
        if (row < 5) newRow = row + 1;
      }
      this.setState({ row: newRow, col: newCol });
    }

    if (e.type === GamepadEnum.ESC || e.type === GamepadEnum.START) {
      this.close();
    }
  }

  handleKeyDownEvent = (e) => {
    const { controllerIndex, row, col } = this.state;
    const { onSelect } = this.props;

    if (e.code === KCODES.SPACE_BAR || e.code === KCODES.ENTER) {
      if (controllerIndex === 0) {
        if (row >= 0 && col >= 0) {
          this.close();
          onSelect(SCANCODES[row][col], row, col);
        } else if (e.code === KCODES.ENTER) {
          this.close();
        }
      }
    }
  }

  handleKeyUpEvent = (e) => {
    let { controllerIndex, row, col } = this.state;

    if (controllerIndex === 0) {
      let invalid = false;
      let key = false;
      if (row < 0) { invalid = true; row = 3; }
      if (col < 0) { invalid = true; col = 2; }
      let newRow = row;
      let newCol = col;
      if (e.code === KCODES.ARROW_LEFT) {
        key = true;
        if (col > 0) newCol = col - 1;
      } else if (e.code === KCODES.ARROW_RIGHT) {
        key = true;
        if (col < 3) newCol = col + 1;
      } else if (e.code === KCODES.ARROW_UP) {
        key = true;
        if (row > 0) newRow = row - 1;
      } else if (e.code === KCODES.ARROW_DOWN) {
        key = true;
        if (row < 5) newRow = row + 1;
      }

      if (invalid && key) {
        this.setState({ row: 3, col: 2 });
      } else if (col !== newCol || row !== newRow) {
        this.setState({ row: newRow, col: newCol });
      }
    }

    if (e.code === KCODES.ESCAPE) {
      this.close();
    }
  }

  onSelectFunc(scancode, r, c) {
    const { onSelect } = this.props;
    onSelect(scancode, r, c);
    this.close();
  }

  render() {
    const { screenContext, screenStyles } = this;
    const { controllerIndex, row, col } = this.state;
    const { emulator, descriptions } = this.props;

    const onFocusChanged = (r, c) => {
      if (r >= 0 && c >= 0) {
        if (r !== row || c !== col) {
          setTimeout(() => this.setState({ row: r, col: c }), 0);
        }
      }
    };

    const controller = (
      <Controller
        emulator={emulator}
        descriptions={descriptions}
        controllerIndex={controllerIndex}
        onSelect={(scancode, r, c) => this.onSelectFunc(scancode, r, c)}
        col={col}
        row={row}
        onFocusChanged={onFocusChanged}
      />
    );

    return (
      <>
        <WebrcadeContext.Provider value={screenContext}>
          <div className={screenStyles['screen-transparency']} />
          <div className={"controllers-screen"}>
            <div className={'controllers-screen-inner ' + screenStyles.screen}>
              <div className={"controllers-screen-inner-controllers"}>
                {controllerIndex === 0 ? controller : <div />}
                {controllerIndex === 1 ? controller : <div />}
              </div>
            </div>
          </div>
        </WebrcadeContext.Provider>
      </>
    );
  }
}
