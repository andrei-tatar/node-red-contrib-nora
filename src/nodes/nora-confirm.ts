import { ConfirmNode, NodeInterface } from '../node';

module.exports = function (RED) {
    RED.nodes.registerType('nora-confirm',
        function (this: NodeInterface & ConfirmNode, config) {
            RED.nodes.createNode(this, config);
            this.pin = this.credentials && this.credentials.pin;
            this.requireAck = config.requireack || false;
            this.requirePin = config.requirepin || false;
        },
        {
            credentials: {
                pin: { type: 'text' },
            },
        });
};

