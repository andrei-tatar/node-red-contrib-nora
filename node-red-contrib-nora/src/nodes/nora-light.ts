import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { LightDevice } from '../nora-common/models/light';
import { convertValueType, getValue, updateState } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-light', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const brightnessControl = !!config.brightnesscontrol;
        const statepayload = !!config.statepayload;
        const colorControl = !!config.lightcolor;
        const turnOnWhenBrightnessChanges = !!config.turnonwhenbrightnesschanges;
        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });
        const brightnessOverride = Math.max(0, Math.min(100, Math.round(config.brightnessoverride))) || 0;

        const close$ = new Subject();
        const initialState: any = {
            online: true,
            on: false,
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
        const state$ = new BehaviorSubject<LightDevice['state']>(initialState);
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'light',
                    brightnessControl: brightnessControl,
                    turnOnWhenBrightnessChanges: brightnessControl ? turnOnWhenBrightnessChanges : undefined,
                    colorControl: colorControl,
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: {
                        online: true,
                        ...state$.value,
                    },
                } as LightDevice)),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        combineLatest([device$, state$])
            .pipe(
                tap(([_, state]) => notifyState(state)),
                skip(1),
                takeUntil(close$)
            )
            .subscribe(([device, state]) => device.updateState(state));

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe((state) => {
            notifyState(state);

            if (!brightnessControl) {
                const value = state.on;
                this.send({
                    payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                    topic: config.topic
                });
            } else {
                if (statepayload) {
                    this.send({
                        payload: { ...state },
                        topic: config.topic
                    });
                } else {
                    this.send({
                        payload: state.on && 'brightness' in state ? state.brightness : 0,
                        topic: config.topic
                    });
                }
            }
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            if (!brightnessControl) {
                const myOnValue = getValue(RED, this, onValue, onType);
                const myOffValue = getValue(RED, this, offValue, offType);
                if (RED.util.compareObjects(myOnValue, msg.payload)) {
                    state$.next({ ...state$.value, on: true });
                } else if (RED.util.compareObjects(myOffValue, msg.payload)) {
                    state$.next({ ...state$.value, on: false });
                } else {
                    updateState(msg?.payload, state$);
                }
            } else {
                if (!updateState(msg?.payload, state$)) {
                    const brightness = Math.max(0, Math.min(100, Math.round(msg.payload)));
                    if (isFinite(brightness)) {
                        if (brightness === 0) {
                            if (brightnessOverride !== 0) {
                                state$.next({
                                    ...state$.value,
                                    on: false,
                                    brightness: brightnessOverride,
                                });
                            } else {
                                state$.next({
                                    ...state$.value,
                                    on: false,
                                });
                            }
                        } else {
                            state$.next({
                                ...state$.value,
                                on: true,
                                brightness: brightness,
                            });
                        }
                    } else {
                        this.error('Payload must be a number in range 0-100');
                    }
                }
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: LightDevice['state']) {
            let stateString = state.on ? 'on' : 'off';
            if (brightnessControl && 'brightness' in state) {
                stateString += ` ${state.brightness}`;
            }
            if (colorControl && 'color' in state) {
                stateString += ` hue: ${Number(state.color.spectrumHsv.hue).toFixed(2)}°`;
                stateString += ` sat: ${Number(state.color.spectrumHsv.saturation * 100).toFixed(2)}%`;
                stateString += ` val: ${Number(state.color.spectrumHsv.value * 100).toFixed(2)}%`;
            }

            stateString$.next(`(${stateString})`);
        }
    });
};
