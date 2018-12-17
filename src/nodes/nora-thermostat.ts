import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';

interface ThermostatState {
    online: boolean;
    thermostatMode: string;
    thermostatTemperatureAmbient: number;
    thermostatTemperatureSetpoint: number;
}

module.exports = function (RED) {
    RED.nodes.registerType('nora-thermostat', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<ThermostatState>({
            online: true,
            thermostatMode: 'auto',
            thermostatTemperatureAmbient: 21,
            thermostatTemperatureSetpoint: 23,
        });
        const stateString$ = new Subject<string>();

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'thermostat',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    availableModes: config.modes.split(','),
                    temperatureUnit: 'C',
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

        combineLatest(device$, state$)
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
                payload: { ...state },
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: ThermostatState) {
            stateString$.next(`(${state.thermostatMode}:${state.thermostatTemperatureAmbient}/${state.thermostatTemperatureSetpoint})`);
        }
    });
};
