import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil } from 'rxjs/operators';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-outlet', function (config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const on$ = new BehaviorSubject(false);

        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig.token, this)
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

        combineLatest(device$, on$.pipe(skip(1)))
            .pipe(takeUntil(close$))
            .subscribe(([device, on]) => device.updateState({ on }));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(s => {
            const value = s.on;
            this.send({
                payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                topic: config.topic
            });
        });

        this.on('input', msg => {
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
    });
};

