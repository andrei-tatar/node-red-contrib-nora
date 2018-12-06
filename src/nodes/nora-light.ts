import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

interface LightDeviceState {
    on: boolean;
    brightness?: number;
    color?: {
        spectrumHsv: {
            hue: number;
            saturation: number;
            value: number;
        }
    };
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-light', function (config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const brightnessControl = !!config.brightnesscontrol;
        const statepayload = !!config.statepayload;
        const colorControl = !!config.lightcolor;
        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const close$ = new Subject();
        const initialState: LightDeviceState = {
            on: false
        };
        if (brightnessControl) {
            initialState.brightness = 100;
        }
        if (colorControl) {
            initialState.color = {
                spectrumHsv: {
                    hue: 0,
                    saturation: 0,
                    value: 1,
                },
            };
        }
        const state$ = new BehaviorSubject(initialState);
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig.token, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'light',
                    brightnessControl: brightnessControl,
                    colorControl: colorControl,
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: {
                        online: true,
                        ...state$.value,
                    },
                })),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        combineLatest(device$, state$)
            .pipe(
                tap(([_, state]) => notifyState(state)),
                skip(1),
                takeUntil(close$)
            )
            .subscribe(([device, state]) => device.updateState({ ...state }));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe((state: LightDeviceState) => {
            notifyState(state);
            state$.value.on = state.on;
            if (brightnessControl) {
                state$.value.brightness = state.brightness;
            }
            if (colorControl) {
                state$.value.color = state.color;
            }

            if (!brightnessControl) {
                const value = state.on;
                this.send({
                    payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                    topic: config.topic
                });
            } else {
                if (statepayload) {
                    this.send({
                        payload: {
                            on: state.on,
                            brightness: state.brightness,
                        },
                        topic: config.topic
                    });
                } else {
                    this.send({
                        payload: state.on ? state.brightness : 0,
                        topic: config.topic
                    });
                }
            }
        });

        this.on('input', msg => {
            if (!brightnessControl) {
                const myOnValue = getValue(RED, this, onValue, onType);
                const myOffValue = getValue(RED, this, offValue, offType);
                if (RED.util.compareObjects(myOnValue, msg.payload)) {
                    state$.next({ ...state$.value, on: true });
                } else if (RED.util.compareObjects(myOffValue, msg.payload)) {
                    state$.next({ ...state$.value, on: false });
                }
            } else {
                if (statepayload) {
                    const state = { ...state$.value };
                    let update = false;
                    if ('brightness' in msg.payload && typeof msg.payload.brightness === 'number' && isFinite(msg.payload.brightness)) {
                        state.brightness = Math.max(1, Math.min(100, Math.round(msg.payload.brightness)));
                        update = true;
                    }
                    if ('on' in msg.payload && typeof msg.payload.on === 'boolean') {
                        state.on = msg.payload.on;
                        update = true;
                    }
                    if (update) { state$.next(state); }
                } else {
                    const brightness = Math.max(0, Math.min(100, Math.round(msg.payload)));
                    if (isFinite(brightness)) {
                        state$.next({
                            on: brightness > 0,
                            brightness: brightness === 0 ? 100 : brightness,
                        });
                    }
                }
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: LightDeviceState) {
            let stateString = state.on ? 'on' : 'off';
            if (brightnessControl) {
                stateString += ` ${state.brightness}`;
            }
            stateString$.next(`(${stateString})`);
        }
    });
};

