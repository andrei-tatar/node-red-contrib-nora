module.exports = function (RED) {
    RED.nodes.registerType('nora-config',
        function (config) {
            RED.nodes.createNode(this, config);
            this.token = this.credentials && this.credentials.token;
        },
        {
            credentials: {
                token: { type: 'text' },
            },
        });
};

