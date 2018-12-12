import { NodeInterface } from '../node';

module.exports = function (RED) {
    RED.nodes.registerType('nora-config',
        function (this: NodeInterface & { token: string }, config) {
            RED.nodes.createNode(this, config);
            this.token = this.credentials && this.credentials.token;
        },
        {
            credentials: {
                token: { type: 'text' },
            },
        });
};

