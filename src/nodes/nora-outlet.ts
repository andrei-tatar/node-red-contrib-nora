import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-outlet', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const on$ = new BehaviorSubject(false);
        const stateString$ = new Subject<string>();

        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'outlet',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: { online: true, on: on$.value },
                })),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        combineLatest([device$, on$])
            .pipe(
                tap(([_, on]) => notifyState(on)),
                skip(1),
                takeUntil(close$),
            )
            .subscribe(([device, on]) => device.updateState({ on }));

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(s => {
            const value = s.on;
            notifyState(s.on);
            this.send({
                payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myOnValue = getValue(RED, this, onValue, onType);
            const myOffValue = getValue(RED, this, offValue, offType);
            if (RED.util.compareObjects(myOnValue, msg.payload)) {
                on$.next(true);
            } else if (RED.util.compareObjects(myOffValue, msg.payload)) {
                on$.next(false);
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(on: boolean) {
            stateString$.next(`(${on ? 'on' : 'off'})`);
        }
    });
};

