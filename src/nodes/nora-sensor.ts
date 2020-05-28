import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { SensorDevice } from '../nora-common/models/sensor';
import { convertValueType, getValue, updateState } from './util';

/* Config
    defaults: {
        nora: {
            type: 'nora-config',
            required: true
        },
        devicename: {
            value: 'Sensor',
            required: true,
        },
        passthru: {
            value: false,
        },
        traits: {
            value: ''
        },
        temperatureunit: {
            value: 'C'
        },
        distanceunit: {
            value: 'KILOMETERS'
        },
        isrechargeable: {
            value: false
        },
        roomhint: {
            value: ''
        },
        topic: {
            value: ''
        },
        name: {
            value: ''
        },
    }
*/

module.exports = function (RED) {
    RED.nodes.registerType('nora-sensor', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        // Get Nora config, if there is no established Nora config, return nothing from this node on execution rather than erroring out...
        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        // close$ will issue command to stop mirroring observable values when node is deleted/re-created
        const close$ = new Subject();

        // BehaviorSubject - a variant of Subject that requires an initial value and emits its current value whenever it is subscribed to.
        const state$ = new BehaviorSubject<SensorDevice>({
            online: true
        });

        // A Subject is a special type of Observable that allows values to be multicasted to many Observerss.
        const stateString$ = new Subject<string>();

        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED) // Return a new NoraService instance, passing in the NodeRed node
            .getConnection(noraConfig, this, stateString$) // Takes stateString observable and returns new observable (NoraConnection)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'sensor',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: state$.value,
                })), // A new observable NoraDevice based on the config values of the node, returns values from last projected Observable
                publishReplay(1), // provides 1 cached value on subscription [returns ConnectableObservable]
                refCount(), // subscribes to ConnectableObservable (internally with subscribe()) if there is more than one observer
                takeUntil(close$), // Waits for the notifier 'close$' and will stop mirroring source values, otherwise will emit all values.
            ); // pipe returns takeUntil (e.g. emits all values passed to it)

        combineLatest([device$, state$])
            .pipe(
                // tap() side effect, returns identical Observable to source - essentially runs notifyState func & returns original observbl
                tap(([_, state]) => notifyState(state.on)),
                skip(1), // skip the first emitted value
                takeUntil(close$), // Waits for the notifier 'close$' and will stop mirroring source values, otherwise will emit all values.
            ) // pipe returns takeUntil (e.g. emits all values passed to it)
            .subscribe(([device, state]) => device.updateState(state)); // update the state of each device passed to the subscribe function

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(state => {
            const value = state.on;
            notifyState(state.on);
            this.send({
                payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                topic: config.topic
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myOnValue = getValue(RED, this, onValue, onType); // coercing values to type defined in config
            const myOffValue = getValue(RED, this, offValue, offType); // coercing values to type defined in config
            if (RED.util.compareObjects(myOnValue, msg.payload)) {
                state$.next({ ...state$.value, on: true }); // the next value sent by observable
            } else if (RED.util.compareObjects(myOffValue, msg.payload)) {
                state$.next({ ...state$.value, on: false }); // the next value sent by observable
            } else {
                // updateState() If the input payload doesn't actually expect values, state is updated, but no value sent
                updateState(msg?.payload, state$);
            }
        });

        this.on('close', () => {
            try {
                close$.next(); // sends final value
                close$.complete(); // complete does not send a value, but closes off from any further values
            } catch (err) {
                close$.error(err); // delivers an error if it caught one
            }
        });

        function notifyState(on: boolean) {
            stateString$.next(`(${on ? 'on' : 'off'})`);
        }
    });
};
