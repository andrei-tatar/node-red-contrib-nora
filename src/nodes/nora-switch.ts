import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import { NoraService } from '../nora';

module.exports = function (RED) {
    RED.nodes.registerType('nora-switch', function (config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig) { return; }

        const close$ = new Subject();
        const on$ = new BehaviorSubject(false);

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig.token)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'switch',
                    name: config.switchname,
                    state: { online: true, on: on$.value },
                })),
                shareReplay(1),
                takeUntil(close$),
            );

        combineLatest(device$, on$)
            .pipe(takeUntil(close$))
            .subscribe(([device, on]) => device.updateState({ on }));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(s => this.send({
            payload: s.on,
            topic: config.topic
        }));

        this.on('input', msg => on$.next(!!msg.payload));

        this.on('close', () => {
            close$.next();
            close$.complete();
        });
    });
};

