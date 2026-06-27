import React from 'react';
import { Component } from 'react';

import {
  AppDisplaySettingsTab,
  EditorScreen,
  FieldsTab,
  FieldRow,
  FieldLabel,
  FieldControl,
  TelevisionWhiteImage,
  BlurImage,
  GamepadWhiteImage,
  Select,
  Switch,
  ShaderSettingsTab,
  WebrcadeContext,
} from '@webrcade/app-common';

export class AstrocadeSettingsEditor extends Component {
  constructor() {
    super();
    this.state = {
      tabIndex: null,
      focusGridComps: null,
      values: {},
    };

    this.busy = false;
  }

  componentDidMount() {
    const { emulator } = this.props;

    const values = {
      analogDirection: emulator.analogDirection ?? 0,
      analogInvert: emulator.analogInvert ?? false,
      origBilinearMode: emulator.getPrefs().getBilinearMode(),
      bilinearMode: emulator.getPrefs().getBilinearMode(),
      origScreenSize: emulator.getPrefs().getScreenSize(),
      screenSize: emulator.getPrefs().getScreenSize(),
    }

    this.shaderService = this.props.emulator.getShadersService();
    this.shaderService.addEditorValues(values);

    this.setState({ values });
  }

  render() {
    const { emulator, onClose, showOnScreenControls } = this.props;
    const { tabIndex, values, focusGridComps } = this.state;

    const setFocusGridComps = (comps) => {
      this.setState({ focusGridComps: comps });
    };

    const setValues = (values) => {
      this.setState({ values });
    };

    const tabs = [];
    let tab = 0;

    tabs.push({
      image: GamepadWhiteImage,
      label: 'Astrocade Settings (Session only)',
      content: (
        <AstrocadeSessionTab
          emulator={emulator}
          isActive={tabIndex === tab}
          setFocusGridComps={setFocusGridComps}
          values={values}
          setValues={setValues}
        />
      )
    });
    tab++;

    tabs.push({
      image: TelevisionWhiteImage,
      label: 'Display Settings',
      content: (
        <AppDisplaySettingsTab
          emulator={emulator}
          isBilinearMode={true}
          isActive={tabIndex === tab}
          showOnScreenControls={showOnScreenControls}
          setFocusGridComps={setFocusGridComps}
          values={values}
          setValues={setValues}
        />
      )
    });
    tab++;

    tabs.push({
      image: BlurImage,
      label: 'Shader Settings',
      content: (
        <ShaderSettingsTab
          shaderService={this.shaderService}
          emulator={emulator}
          isActive={tabIndex === tab}
          setFocusGridComps={setFocusGridComps}
          values={values}
          setValues={setValues}
        />
      )
    });

    return (
      <EditorScreen
        showCancel={true}
        onOk={async () => {
          if (this.busy) return;
          this.busy = true;

          emulator.analogDirection = parseInt(values.analogDirection ?? 0, 10);
          emulator.analogInvert = values.analogInvert ?? false;

          let change = false;
          if (values.origBilinearMode !== values.bilinearMode) {
            emulator.getPrefs().setBilinearMode(values.bilinearMode);
            change = true;
          }
          if (values.origScreenSize !== values.screenSize) {
            emulator.getPrefs().setScreenSize(values.screenSize);
            emulator.updateScreenSize();
            change = true;
          }
          if (change) {
            emulator.getPrefs().save();
          }

          await this.shaderService.setShader(values.shaderId);
          emulator.updateBilinearFilter();

          onClose();
        }}
        onClose={onClose}
        focusGridComps={focusGridComps}
        onTabChange={(oldTab, newTab) => this.setState({ tabIndex: newTab })}
        tabs={tabs}
      />
    );
  }
}

class AstrocadeSessionTab extends FieldsTab {
  constructor() {
    super();
    this.analogDirectionRef = React.createRef();
    this.analogInvertRef = React.createRef();
    this.gridComps = [
      [this.analogDirectionRef],
      [this.analogInvertRef],
    ];
  }

  componentDidUpdate(prevProps, prevState) {
    const { gridComps } = this;
    const { setFocusGridComps, isActive } = this.props;
    if (isActive && isActive !== prevProps.isActive) {
      setFocusGridComps(gridComps);
    }
  }

  render() {
    const { analogDirectionRef, analogInvertRef } = this;
    const { focusGrid } = this.context;
    const { setValues, values } = this.props;

    return (
      <>
        <FieldRow>
          <FieldLabel>Analog Direction</FieldLabel>
          <FieldControl>
            <Select
              ref={analogDirectionRef}
              options={[
                { value: 0, label: 'Horizontal' },
                { value: 1, label: 'Vertical' },
              ]}
              onChange={(value) => {
                setValues({ ...values, analogDirection: value });
              }}
              value={values.analogDirection}
              onPad={(e) => focusGrid.moveFocus(e.type, analogDirectionRef)}
            />
          </FieldControl>
        </FieldRow>
        <FieldRow>
          <FieldLabel>Invert Analog</FieldLabel>
          <FieldControl>
            <Switch
              ref={analogInvertRef}
              onChange={(e) => {
                setValues({ ...values, analogInvert: e.target.checked });
              }}
              checked={values.analogInvert}
              onPad={(e) => focusGrid.moveFocus(e.type, analogInvertRef)}
            />
          </FieldControl>
        </FieldRow>
      </>
    );
  }
}
AstrocadeSessionTab.contextType = WebrcadeContext;
