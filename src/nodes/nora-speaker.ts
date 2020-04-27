import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { SpeakerDevice } from '../nora-common/models/speaker';
import { updateState } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-speaker', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const step = Math.max(1, Math.min(50, (isFinite(config.step) ? config.step : 5) || 5));
        const close$ = new Subject();
        const state$ = new BehaviorSubject<SpeakerDevice['state']>({
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
        ).subscribe((state) => {
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
            updateState(msg?.payload, state$);
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: SpeakerDevice['state']) {
            stateString$.next(`(${state.on ? 'on' : 'off'}:${state.currentVolume})`);
        }
    });
};

