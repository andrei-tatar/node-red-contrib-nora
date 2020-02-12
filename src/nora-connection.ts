import { BehaviorSubject, EMPTY, Observable, Subject } from 'rxjs';
import {
    debounceTime, publishReplay, refCount,
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
    private connected = new BehaviorSubject<boolean>(false);
    private errors = new Subject<{ device: string, msg: string }>();
    readonly connected$ = this.connected.asObservable();
    readonly errors$ = this.errors.asObservable();

    constructor(
        private socket: SocketIOClient.Socket,
        logger: Logger,
    ) {
        socket.on('connect', () => this.connected.next(true));
        socket.on('disconnect', () => this.connected.next(false));
        this.connected.pipe(
            switchMap(
                connected => connected === true
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
            socket.emit('sync', syncDevices, 'req:sync');
        });

        const update$ = new Subject<{ [deviceId: string]: any }>();
        update$.pipe(
            withLatestFrom(this.devices$),
            takeUntil(this.destroy$),
        ).subscribe(([updates, devices]) => {
            const updateIds = Object.keys(updates);
            for (const id of updateIds) {
                const device = devices.find(d => d.id === id);
                if (!device) {
                    logger.warn(`received update for missing device ${id}`);
                    continue;
                }

                const newState = updates[id];
                device.setState(newState);
            }
        });

        const activate$ = new Subject<{ ids: string[], deactivate: boolean }>();
        activate$.pipe(
            withLatestFrom(this.devices$),
            takeUntil(this.destroy$),
        ).subscribe(([activate, devices]) => {
            for (const id of activate.ids) {
                const device = devices.find(d => d.id === id);
                if (!device) {
                    logger.warn(`received activate state for missing device ${id}`);
                    continue;
                }

                device.activateScene(activate.deactivate);
            }
        });
        socket.on('update', (changes) => update$.next(changes));
        socket.on('action-error', (reqId: string, msg: string) => {
            if (reqId === 'req:sync') {
                logger.warn(`nora: sync error (${msg})`);
            } else {
                this.errors.next({ device: reqId.substring(4), msg });
            }
        });
        socket.on('activate-scene', (ids: string[], deactivate: boolean) => activate$.next({ ids, deactivate }));
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
        this.socket.emit('update', { [id]: newState }, `req:${id}`);
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
