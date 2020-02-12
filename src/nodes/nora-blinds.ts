import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';

interface BlindsState {
    online: boolean;
    openPercent: number;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-blinds', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<BlindsState>({
            online: true,
            openPercent: 100,
        });
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'blinds',
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
                payload: {
                    openPercent: adjustPercent(state.openPercent),
                },
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            if (typeof msg === 'object' && typeof msg.payload === 'object') {
                const payload = msg.payload;
                if ('openPercent' in payload && typeof payload.openPercent === 'number' && isFinite(payload.openPercent)) {
                    const openPercent = Math.floor(Math.max(0, Math.min(100, payload.openPercent)));
                    state$.next({
                        ...state$.value,
                        openPercent: adjustPercent(openPercent),
                    });
                }
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: BlindsState) {
            stateString$.next(`(${adjustPercent(state.openPercent)}%)`);
        }

        function adjustPercent(openPercent: number) {
            return config.invert ? 100 - openPercent : openPercent;
        }
    });
};

