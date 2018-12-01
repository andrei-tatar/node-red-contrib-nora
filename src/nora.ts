import { Observable, Subject } from 'rxjs';
import { delay, finalize, publishReplay, refCount, retryWhen, takeUntil } from 'rxjs/operators';
import * as io from 'socket.io-client';
import { Logger } from './logger';
import { NoraConnection } from './nora-connection';

export class NoraService {

    private constructor(
        private logger: Logger,
    ) {
    }

    private static instance: NoraService;

    private socketByToken: {
        [token: string]: {
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

    getConnection(token: string) {
        let existing = this.socketByToken[token];
        if (!existing) {
            const stop = new Subject();
            this.socketByToken[token] = existing = {
                connection$: this.createSocketObservable(token, stop),
                uses: 0,
                stop,
            };
        }

        return new Observable<NoraConnection>(observer => {
            existing.uses++;
            if (existing.stopTimer) {
                clearTimeout(existing.stopTimer);
            }
            return existing.connection$.pipe(finalize(() => {
                existing.uses--;
                if (existing.uses === 0) {
                    clearTimeout(existing.stopTimer);
                    existing.stopTimer = setTimeout(() => {
                        if (existing.uses === 0) {
                            existing.stop.next();
                            existing.stop.complete();
                            delete this.socketByToken[token];
                        }
                    }, 10000);
                }
            })).subscribe(observer);
        });
    }

    private createSocketObservable(token: string, stop: Observable<any>) {
        const id = token.substr(-5);
        return new Observable<NoraConnection>(observer => {
            this.logger.info(`nora (${id}): connecting`);
            const socket = io(`https://node-red-google-home.herokuapp.com/?token=${token}`);
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
            retryWhen(err => err.pipe(delay(10000))),
            takeUntil(stop),
            publishReplay(1),
            refCount(),
        );
    }
}

