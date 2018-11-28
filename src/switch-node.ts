import { ConfigNode } from './config-node';
import { NoraService } from './nora';

export class SwitchNode {
    constructor(nora: NoraService, red, config) {
        red.nodes.createNode(this, config);

        const noraConfig: ConfigNode = red.nodes.getNode(config.nora);
        if (!noraConfig) { return; }

        const socket = nora.getSocket(noraConfig.token).subscribe();

        (this as any).on('close', () => socket.unsubscribe());
    }
}
