import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil } from 'rxjs/operators';
import { NoraService } from '../nora';

module.exports = function (RED) {
    RED.nodes.registerType('nora-light', function (config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject({ brightness: 100, on: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig.token)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'light',
                    brightnessControl: true,
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
            state$.value.brightness = state.brightness;
            state$.value.on = state.on;
            this.send({
                payload: {
                    on: state.on,
                    brightness: state.brightness,
                },
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (typeof msg.payload === 'number') {
                if (isFinite(msg.payload)) {
                    const newBrightness = Math.max(0, Math.min(100, Math.round(msg.payload)));
                    if (newBrightness === 0) {
                        state$.next({ ...state$.value, on: false });
                    } else {
                        state$.next({ on: true, brightness: newBrightness });
                    }
                }
            } else if (typeof msg.payload === 'boolean') {
                state$.next({ ...state$.value, on: msg.payload });
            } else if (typeof msg.payload === 'object') {
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
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });
    });
};

