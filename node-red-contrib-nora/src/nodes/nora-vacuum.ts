import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { VacuumDevice } from '../nora-common/models/vacuum';

module.exports = function (RED) {
    RED.nodes.registerType('nora-vacuum', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<VacuumDevice['state']>({
            online: true,
            isRunning: false,
            isPaused: false,
            isDocked: true
        });
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'vacuum',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: state$.value,
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
        ).subscribe(state => {
            notifyState(state);
            this.send({
                payload: { action: state.isRunning ? state.isPaused ? 'pause' : 'start' : state.isDocked ? 'dock' : 'stop' },
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const started = msg.payload.action === 'pause' ? true : msg.payload.action === 'start';
            const paused = msg.payload.action === 'pause';
            const docked = msg.payload.action === 'dock';
            const state = {
                isRunning: started,
                isPaused: paused,
                isDocked: docked,
                online: true
            };
            notifyState(state);
            this.send({
                payload: msg.payload,
                topic: config.topic
            });
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: VacuumDevice['state']) {
            stateString$.next(state.isRunning ? state.isPaused ? '(paused)' : '(cleaning)' : state.isDocked ? '(docked)' : '(stopped)');
        }
    });
};
