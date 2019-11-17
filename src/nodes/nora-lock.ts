import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

interface LockState {
    online: boolean;
    locked: boolean;
    jammed: boolean;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-lock', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<GarageState>({
            online: true,
            locked: false,
            jammed: false,
        });
        const stateString$ = new Subject<string>();

        
        const lock$ = new BehaviorSubject(false);
        const { value: lockValue, type: lockType } = convertValueType(RED, config.lockvalue, config.lockvalueType, { defaultValue: true });
        const { value: unlockValue, type: unlockType } = convertValueType(RED, config.unlockvalue, config.unlockvalueType, { defaultValue: false });

        const jammed$ = new BehaviorSubject(false);
        const { value: jammedValue, type: jammedType } = convertValueType(RED, config.jammedvalue, config.jammedvalueType, { defaultValue: true });
        const { value: unjammedValue, type: unjammedType } = convertValueType(RED, config.unjammedvalue, config.unjammedvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'lock',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: state$.value,
                })),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        combineLatest(device$, state$)
            .pipe(
                tap(([_, state]) => notifyState(state)),
                skip(1),
                takeUntil(close$),
            )
            .subscribe(([device, state]) => device.updateState({ state }));

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(state => {
          notifyState(state);
            this.send({
                payload: {
                    locked: state.locked,
                    jammed: state.jammed,
                },
                topic: config.topic,
            });
        
 //           const value = s.lock;
 //           notifyState(s.lock);
 //           this.send({
 //               payload: getValue(RED, this, value ? lockValue : unlockValue, value ? lockType : unlockType),
 //               topic: config.topic
 //           });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myLockValue = getValue(RED, this, lockValue, lockType);
            const myUnlockValue = getValue(RED, this, unlockValue, unlockType);
            if (RED.util.compareObjects(myLockValue, msg.payload)) {
                lock$.next(true);
            } else if (RED.util.compareObjects(myUnlockValue, msg.payload)) {
                lock$.next(false);
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(lock: boolean) {
            stateString$.next(`(${lock ? 'lock' : 'unlock'})`);
        }
    });
};

