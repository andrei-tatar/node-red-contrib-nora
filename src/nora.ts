import { combineLatest, EMPTY, merge, Observable, Subject, timer } from 'rxjs';
import {
    delayWhen, distinctUntilChanged, finalize, ignoreElements,
    publishReplay, refCount, retryWhen, startWith, switchMap, takeUntil, tap
} from 'rxjs/operators';
import * as io from 'socket.io-client';
import { Logger } from './logger';
import { ConfigNode } from './node';
import { NoraConnection } from './nora-connection';

export class NoraService {

    private constructor(
        private logger: Logger,
    ) {
    }

    private static instance: NoraService;

    private sockets: {
        [key: string]: {
            stop: Subject<any>;
            connection$: Observable<NoraConnection>;
            uses: number;
            stopTimer?: NodeJS.Timeout;
        };
    } = {};

    static getService(RED) {
        if (!this.instance) {
            this.instance = new NoraService(RED.log);
        }
        return this.instance;
    }

    getConnection(config: ConfigNode, node, state: Observable<string> = EMPTY) {
        const key = `${config.group || ''}:${config.token}`;
        let existing = this.sockets[key];
        if (!existing) {
            const stop = new Subject();
            this.sockets[key] = existing = {
                connection$: this.createSocketObservable(config, stop),
                uses: 0,
                stop,
            };
        }

        return new Observable<NoraConnection>(observer => {
            existing.uses++;
            if (existing.stopTimer) {
                clearTimeout(existing.stopTimer);
            }
            const connected = new Subject<Observable<boolean>>();
            const connected$ = connected.pipe(
                switchMap(c => c),
                startWith(false),
                distinctUntilChanged()
            );
            const updateStatus$ = combineLatest([connected$, state])
                .pipe(
                    tap(([isConnected, currentState]) => {
                        node.status(isConnected
                            ? { fill: 'green', shape: 'dot', text: `connected ${currentState}` }
                            : { fill: 'red', shape: 'ring', text: 'not connected' });
                    }),
                    ignoreElements(),
                );

            return merge(updateStatus$, existing.connection$).pipe(
                tap(nora => connected.next(nora.connected$)),
                finalize(() => {
                    existing.uses--;
                    connected.complete();
                    if (existing.uses === 0) {
                        if (existing.stopTimer) {
                            clearTimeout(existing.stopTimer);
                        }
                        existing.stopTimer = setTimeout(() => {
                            if (existing.uses === 0) {
                                existing.stop.next();
                                existing.stop.complete();
                                delete this.sockets[key];
                            }
                        }, 10000);
                    }
                })
            ).subscribe(observer);
        });
    }

    private createSocketObservable({ token, group, notify }: ConfigNode, stop: Observable<any>) {
        const id = token.substr(-5);
        return new Observable<NoraConnection>(observer => {
            this.logger.info(`nora (${id}): connecting`);
            const version = require('../package.json').version;
            let uri = `https://node-red-google-home.herokuapp.com/?version=${version}&token=${encodeURIComponent(token)}&notify=${notify}`;
            if (group) {
                uri += `&group=${encodeURIComponent(group)}`;
            }
            const socket = io(uri);
            const connection = new NoraConnection(socket, this.logger);
            observer.next(connection);

            socket.on('connect', () => this.logger.info(`nora (${id}): connected`));
            socket.on('disconnect', reason => this.logger.warn(`nora (${id}): disconnected (${reason})`));
            socket.on('error', err => {
                this.logger.warn(`nora (${id}): socket connection error: ${err}`);
                observer.error(new Error(`nora: socket connection error: ${err}`));
            });

            return () => {
                this.logger.info(`nora (${id}): close connection`);
                connection.destroy();
                socket.close();
            };
        }).pipe(
            retryWhen(err => err.pipe(
                delayWhen(() => {
                    const seconds = Math.round(Math.random() * 120) / 2 + 5;
                    this.logger.warn(`nora (${id}): reconnecting in ${seconds} sec`);
                    return timer(seconds * 1000);
                })
            )),
            takeUntil(stop),
            publishReplay(1),
            refCount(),
        );
    }
}

