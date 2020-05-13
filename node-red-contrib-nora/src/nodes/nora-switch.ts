import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { SwitchDevice } from '../nora-common/models/switch';
import { convertValueType, getValue, updateState } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-switch', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<SwitchDevice['state']>({
            on: false,
            online: true,
        });
        const stateString$ = new Subject<string>();

        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'switch',
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
                tap(([_, state]) => notifyState(state.on)),
                skip(1),
                takeUntil(close$),
            )
            .subscribe(([device, state]) => device.updateState(state));

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
                state$.next({ ...state$.value, on: true });
            } else if (RED.util.compareObjects(myOffValue, msg.payload)) {
                state$.next({ ...state$.value, on: false });
            } else {
                updateState(msg?.payload, state$);
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

