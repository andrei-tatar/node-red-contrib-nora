import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

interface GarageState {
    online: boolean;
    openPercent: number;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-garage', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<GarageState>({
            online: true,
            openPercent: 0,
        });
        const stateString$ = new Subject<string>();

        const { value: openValue, type: openType } =
            convertValueType(RED, config.openvalue, config.openvalueType, { defaultValue: true });
        const { value: closeValue, type: closeType } =
            convertValueType(RED, config.closevalue, config.closevalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'garage',
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
            if (state.openPercent === 0) {
                this.send({
                    payload: getValue(RED, this, closeValue, closeType),
                    topic: config.topic
                });
            } else {
                this.send({
                    payload: getValue(RED, this, openValue, openType),
                    topic: config.topic
                });
            }
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myOpenValue = getValue(RED, this, openValue, openType);
            const myCloseValue = getValue(RED, this, closeValue, closeType);
            if (RED.util.compareObjects(myOpenValue, msg.payload)) {
                state$.next({ ...state$.value, openPercent: 100 });
            } else if (RED.util.compareObjects(myCloseValue, msg.payload)) {
                state$.next({ ...state$.value, openPercent: 0 });
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: GarageState) {
            if (state.openPercent === 0) {
                stateString$.next(`(closed)`);
            } else {
                stateString$.next(`(open)`);
            }
        }
    });
};
