/* tslint:disable */
/* eslint-disable */
export class Channel {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    begin(args: any[]): string;
    exchange(method: string, request: string, data: string): string;
}
