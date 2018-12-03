import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil } from 'rxjs/operators';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-light', function (config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const brightnessControl = !!config.brightnesscontrol;
        const statepayload = !!config.statepayload;
        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const close$ = new Subject();
        const initialState: { brightness?: number, on: boolean } = { on: false };
        if (brightnessControl) { initialState.brightness = 100; }
        const state$ = new BehaviorSubject(initialState);
        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig.token)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'light',
                    brightnessControl: brightnessControl,
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

        combineLatest(device$, state$.pipe(skip(1)))
            .pipe(takeUntil(close$))
            .subscribe(([device, state]) => device.updateState({ ...state }));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(state => {
            // TODO: use emit
            if (brightnessControl) {
                state$.value.brightness = state.brightness;
            }
            state$.value.on = state.on;

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
    });
};

