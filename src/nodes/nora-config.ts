import { ConfigNode, NodeInterface } from '../node';

module.exports = function (RED) {
    RED.nodes.registerType('nora-config',
        function (this: NodeInterface & ConfigNode, config) {
            RED.nodes.createNode(this, config);
            this.token = this.credentials && this.credentials.token;
            this.group = (config.group || '').trim();
        },
        {
            credentials: {
                token: { type: 'text' },
            },
        });
};

