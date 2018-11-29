import { BehaviorSubject, EMPTY, Observable, Subject } from 'rxjs';
import {
    bufferTime, debounceTime, filter, publishReplay, refCount,
    scan, switchMap, takeUntil, withLatestFrom
} from 'rxjs/operators';
import { Logger } from './logger';
import { NoraDevice } from './nora-device';

export class NoraConnection {
    private destroy$ = new Subject();
    private deviceEvents$ = new Subject<DeviceEvent>();
    private devices$ = this.deviceEvents$.pipe(
        scan((devices: NoraDevice[], event: DeviceEvent) => {
            switch (event.type) {
                case 'add':
                    return [...devices, event.device];
                case 'remove':
                    return devices.filter(d => d.id !== event.id);
            }
        }, []),
        publishReplay(1),
        refCount(),
    );
    private update$ = new Subject<{ [id: string]: any }>();

    constructor(
        logger: Logger,
        socket: SocketIOClient.Socket,
    ) {
        const connected$ = new BehaviorSubject(false);
        socket.on('connect', () => connected$.next(true));
        socket.on('disconnect', () => connected$.next(false));

        connected$.pipe(
            switchMap(
                connected => connected
                    ? this.devices$.pipe(debounceTime(1000))
                    : EMPTY
            ),
            takeUntil(this.destroy$)
        ).subscribe(devices => {
            const syncDevices = {};
            for (const device of devices) {
                syncDevices[device.id] = device.config;
            }
            logger.info(`nora: sync ${devices.length} devices`);
            socket.emit('sync', syncDevices);
        });

        const update$ = new Subject();
        update$.pipe(
            withLatestFrom(this.devices$),
            takeUntil(this.destroy$),
        ).subscribe(([updates, devices]) => {
            const updateIds = Object.keys(updates);
            for (const id of updateIds) {
                const device = devices.find(d => d.id === id);
                if (!device) {
                    logger.warn(`recevied update for missing device ${id}`);
                    continue;
                }

                const newState = updates[id];
                device.setState(newState);
            }
        });

        this.update$.pipe(
            bufferTime(500),
            filter(updates => updates.length > 0),
            takeUntil(this.destroy$),
        ).subscribe(updates => {
            const merged: any = {};
            for (const update of updates) {
                const deviceIds = Object.keys(update);
                for (const id of deviceIds) {
                    merged[id] = update[id];
                }
            }
            socket.emit('update', merged);
        });

        socket.on('update', (changes) => update$.next(changes));
    }

    addDevice(id: string, deviceConfig) {
        return new Observable<NoraDevice>(observer => {
            const device = new NoraDevice(id, deviceConfig, this);

            this.deviceEvents$.next({
                type: 'add',
                device,
            });

            observer.next(device);
            return () => {
                this.deviceEvents$.next({
                    type: 'remove',
                    id: device.id,
                });
            };
        });
    }

    destroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    sendDeviceUpdate(id: string, newState) {
        this.update$.next({ [id]: newState });
    }
}

type DeviceEvent = AddDeviceEvent | RemoveDeviceEvent;

interface AddDeviceEvent {
    type: 'add';
    device: NoraDevice;
}

interface RemoveDeviceEvent {
    type: 'remove';
    id: string;
}
