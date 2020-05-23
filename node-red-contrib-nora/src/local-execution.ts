// tslint:disable: no-console

import * as cbor from 'cbor';
import * as dgram from 'dgram';
import { merge, Observable } from 'rxjs';
import { filter, ignoreElements, publish, refCount, tap } from 'rxjs/operators';

import { ExecuteCommandTypes } from './nora-common/google/execute';
import { NoraDevice } from './nora-device';

const DISCOVERY_PACKET = '92fcab490d518ccad4ad';
const DISCOVERY_PORT = 6778;
const CONTROL_PORT = 6777;

const registered: { id: string, device: NoraDevice }[] = [];

interface Command {
    deviceId: string;
    command: ExecuteCommandTypes;
    params: any;
}

const control$ = new Observable<Command>(observer => {
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        console.debug(`UDP: from ${rinfo.address} got`, msg);
        const input = cbor.decode(msg);
        console.log(input);
        observer.next(input);
    });
    socket.on('listening', () => {
        console.log(`UDP control listening on port ${CONTROL_PORT}`);
    });
    socket.bind(CONTROL_PORT);

    return () => socket.close();
}).pipe(publish(), refCount());

const discovery$ = new Observable<never>(_ => {
    const discoveryPacket = Buffer.from(DISCOVERY_PACKET, 'hex');
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg, rinfo) => {
        if (msg.compare(discoveryPacket) !== 0) { return; }
        console.log('UDP received discovery payload:', msg, 'from:', rinfo);

        registered.forEach(({ id }) => {
            const responsePacket = cbor.encode({ id });
            socket.send(responsePacket, rinfo.port, rinfo.address, (error) => {
                if (error !== null) {
                    console.error('UDP failed to send ack:', error);
                    return;
                }
                console.debug('UDP sent discovery response:', responsePacket, 'to:', rinfo);
            });
        });
    });
    socket.on('listening', () => {
        console.log('UDP discovery listening', socket.address());
    });
    socket.bind(DISCOVERY_PORT);

    return () => socket.close();
}).pipe(publish(), refCount());

export function registerDeviceForLocalExection(deviceId: string, device: NoraDevice) {
    return merge(discovery$, control$, new Observable<never>(_ => {
        const reg = { id: deviceId, device };
        registered.push(reg);

        return () => {
            const index = registered.indexOf(reg);
            registered.splice(index, 1);
        };
    })).pipe(
        filter(cmd => cmd.deviceId === deviceId),
        tap(cmd => device.executeCommand(cmd.command, cmd.params)),
        ignoreElements(),
    );
}
