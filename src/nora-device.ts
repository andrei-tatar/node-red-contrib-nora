import { Subject } from 'rxjs';
import { NoraConnection } from './nora-connection';

export class NoraDevice {
    private stateChanged = new Subject<any>();

    readonly state$ = this.stateChanged.asObservable();

    constructor(
        public readonly id: string,
        public readonly config,
        private connection: NoraConnection,
    ) {
    }

    updateState(partial) {
        const keys = Object.keys(partial);
        for (const key of keys) {
            const newValue = partial[key];
            const oldValue = this.config.state[key];
            if (typeof newValue === typeof oldValue && newValue !== oldValue) {
                this.config.state[key] = newValue;
            }
        }

        this.connection.sendDeviceUpdate(this.id, this.config.state);
    }

    setState(newState) {
        this.config.state = newState;
        this.stateChanged.next(newState);
    }
}
