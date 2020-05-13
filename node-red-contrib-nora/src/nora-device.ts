import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ExecuteCommandTypes, getStateChanges } from './nora-common/google/execute';
import { AllStates } from './nora-common/models';
import { NoraConnection } from './nora-connection';

export class NoraDevice {
    private _stateChanged = new Subject<any>();
    private _activateScene = new Subject<{ deactivate: boolean }>();

    readonly state$ = this._stateChanged.asObservable();
    readonly activateScene$ = this._activateScene.asObservable();
    readonly errors$ = this.connection.errors$.pipe(filter(e => e.device === this.id), map(e => e.msg));

    constructor(
        public readonly id: string,
        public readonly device,
        private connection: NoraConnection,
    ) {
    }

    updateState(partial: AllStates) {
        const keys = Object.keys(partial);
        for (const key of keys) {
            const newValue = partial[key];
            const oldValue = this.device.state[key];
            if (newValue !== oldValue) {
                this.device.state[key] = newValue;
            }
        }

        this.connection.sendDeviceUpdate(this.id, this.device.state);
    }

    setState(newState) {
        this.device.state = newState;
        this._stateChanged.next(newState);
    }

    activateScene(deactivate: boolean) {
        this._activateScene.next({ deactivate });
    }

    executeCommand(command: ExecuteCommandTypes, params: any) {
        if (command === ExecuteCommandTypes.ActivateScene) {
            this.activateScene(params?.deactivate ?? false);
        } else {
            const changes = getStateChanges(command, params, this.device);
            this.updateState(changes);
            this._stateChanged.next(this.device.state);
        }
    }
}
