export class ConfigNode {
    readonly token: string;

    constructor(red, config) {
        red.nodes.createNode(this, config);
        this.token = config.token;
    }
}
