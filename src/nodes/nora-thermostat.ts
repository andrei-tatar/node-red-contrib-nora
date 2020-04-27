import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { ThermostatDevice } from '../nora-common/models/thermostat';
import { R, updateState } from './util';

type ThermostatState = ThermostatDevice['state'];

module.exports = function (RED) {
    RED.nodes.registerType('nora-thermostat', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const state$ = new BehaviorSubject<ThermostatState>({
            online: true,
            thermostatMode: 'off',
            thermostatTemperatureAmbient: 25,
            thermostatTemperatureSetpoint: 20,
            thermostatTemperatureSetpointLow: 20,
            thermostatTemperatureSetpointHigh: 30,
        });
        const stateString$ = new Subject<string>();
        const availableModes: string[] = config.modes.split(',');

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'thermostat',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    availableModes,
                    temperatureUnit: config.unit,
                    state: state$.value,
                    bufferRangeCelsius: parseInt(config.bufferRangeCelsius, 10) || undefined,
                    commandOnlyTemperatureSetting: config.commandOnly ?? undefined,
                    queryOnlyTemperatureSetting: config.queryOnly ?? undefined,
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
                    mode: state.thermostatMode,
                    setpoint: state.thermostatTemperatureSetpoint,
                    setpointLow: state.thermostatTemperatureSetpointLow,
                    setpointHigh: state.thermostatTemperatureSetpointHigh,
                    humidity: state.thermostatHumidityAmbient,
                },
                topic: config.topic,
            });
        });

        this.on('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }

            updateState(msg?.payload, state$, [
                {
                    from: 'mode',
                    to: 'thermostatMode',
                },
                {
                    from: 'setpoint',
                    to: 'thermostatTemperatureSetpoint',
                },
                {
                    from: 'setpointHigh',
                    to: 'thermostatTemperatureSetpointHigh',
                },
                {
                    from: 'setpointLow',
                    to: 'thermostatTemperatureSetpointLow',
                },
                {
                    from: 'temperature',
                    to: 'thermostatTemperatureAmbient',
                },
                {
                    from: 'humidity',
                    to: 'thermostatHumidityAmbient',
                },
            ]);
        });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(state: ThermostatState) {
            stateString$.next(
                R`(${state.thermostatMode}/T:${state.thermostatTemperatureAmbient}/S:${state.thermostatTemperatureSetpoint})`
            );
        }
    });
};
