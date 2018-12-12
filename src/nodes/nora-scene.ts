import { Subject } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-scene', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const { value: onValue, type: onType } = convertValueType(RED, config.onvalue, config.onvalueType, { defaultValue: true });
        const { value: offValue, type: offType } = convertValueType(RED, config.offvalue, config.offvalueType, { defaultValue: false });

        const close$ = new Subject();

        NoraService
            .getService(RED)
            .getConnection(noraConfig, this)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'scene',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    sceneReversible: !!config.scenereversible,
                    state: { online: true },
                })),
                switchMap(device => device.activateScene$),
                takeUntil(close$),
            ).subscribe(({ deactivate }) => {
                const value = !deactivate;
                this.send({
                    payload: getValue(RED, this, value ? onValue : offValue, value ? onType : offType),
                    topic: config.topic
                });
            });

        this.on('close', () => {
            close$.next();
            close$.complete();
        });
    });
};

