import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';

interface SpeakerState {
    on: boolean;
    online: boolean;
    currentVolume: number;
    isMuted: boolean;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-speaker', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const step = Math.max(1, Math.min(50, (isFinite(config.step) ? config.step : 5) || 5));
        const close$ = new Subject();
        const state$ = new BehaviorSubject<SpeakerState>({
            on: false,
            online: true,
            currentVolume: 50,
            isMuted: false,
        });
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'speaker',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: state$.value,
                    relativeVolumeStep: step,
                })),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        combineLatest([device$, state$])
            .pipe(
                tap(([_, state]) => notifyState(state)),
                skip(1),
                takeUntil(close$),
            )
            .subscribe(([device, state]) => device.updateState(state));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe((state: SpeakerState) => {
            notifyState(state);
            this.send({
                payload: {
                    on: state.on,
                    volume: state.currentVolume,
                },
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const update: Partial<SpeakerState> = {};
            if (typeof msg === 'object' && typeof msg.payload === 'object') {
                const payload = msg.payload;
                if ('on' in payload) {
                    update.on = !!payload.on;
                }
                if ('volume' in payload && typeof payload.volume === 'number' && isFinite(payload.volume)) {
                    update.currentVolume = Math.floor(Math.max(0, Math.min(100, payload.volume)));
                }
                if (Object.keys(update).length > 0) {
                    state$.next({
                        ...state$.value,
                        ...update,
                    });
                }
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: SpeakerState) {
            stateString$.next(`(${state.on ? 'on' : 'off'}:${state.currentVolume})`);
        }
    });
};

