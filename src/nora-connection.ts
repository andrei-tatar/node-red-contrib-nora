export class NoraConnection {
    constructor(
        private socket: SocketIOClient.Socket,
    ) {
        // socket.on('connect', function () {
        //     socket.emit('sync', {
        //         'light1': {
        //             type: 'light',
        //             name: 'light',
        //             brightnessControl: true,
        //             state: {
        //                 online: true,
        //                 brightness: 67,
        //                 on: true,
        //             },
        //         },
        //     });
        // });
    }
}
