import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

interface LockState {
    online: boolean;
    isLocked: boolean;
    isJammed: boolean;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-lock', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<LockState>({
            online: true,
            isLocked: false,
            isJammed: false,
        });
        const stateString$ = new Subject<string>();
        
//        const isLocked$ = new BehaviorSubject(false);
        const { value: lockValue, type: lockType } = convertValueType(RED, config.lockValue, config.lockValueType, { defaultValue: true });
        const { value: unlockValue, type: unlockType } = convertValueType(RED, config.unlockValue, config.unlockValueType, { defaultValue: false });

//        const isJammed$ = new BehaviorSubject(false);
        const { value: jammedValue, type: jammedType } = convertValueType(RED, config.jammedValue, config.jammedValueType, { defaultValue: true });
        const { value: unjammedValue, type: unjammedType } = convertValueType(RED, config.unjammedValue, config.unjammedValueType, { defaultValue: false });

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
            const lvalue = state.isLocked;
            const jvalue = state.isJammed;
            this.send({
                payload: {
                    isLocked: getValue(RED, this, lvalue ? lockValue : unlockValue, lvalue ? lockType : unlockType),
                    isJammed: getValue(RED, this, jvalue ? jammedValue : unjammedValue, jvalue ? jammedType : unjammedType),
                },
                topic: config.topic,
            });
        });
        
        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myLockValue = getValue(RED, this, lockValue, lockType);
            const myUnlockValue = getValue(RED, this, unlockValue, unlockType);
            if (RED.util.compareObjects(myLockValue, msg.payload.isLocked)) {
//                isLocked$.next(true);
                state$.next({ ...state$.value, isLocked: true });
            } else if (RED.util.compareObjects(myUnlockValue, msg.payload.isLocked)) {
//                isLocked$.next(false);
                state$.next({ ...state$.value, isLocked: false });
            }
            const myJammedValue = getValue(RED, this, jammedValue, jammedType);
            const myUnjammedValue = getValue(RED, this, unjammedValue, unjammedType);
            if (RED.util.compareObjects(myJammedValue, msg.payload.isJammed)) {
//                isJammed$.next(true);
                state$.next({ ...state$.value, isJammed: true });
            } else if (RED.util.compareObjects(myUnjammedValue, msg.payload.isJammed)) {
//                isJammed$.next(false);
                state$.next({ ...state$.value, isJammed: false });
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: LockState) {
               stateString$.next(`(${state.isLocked ? 'locked' : 'unlocked'}:${state.isJammed?'jammed':'-'})`);
        }

    });
};

