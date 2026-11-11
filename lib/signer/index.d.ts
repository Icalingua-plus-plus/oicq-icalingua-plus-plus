export type Bytes = Buffer | Uint8Array;
export type Uin = number | bigint | string;
export type Client = object;
export interface RegisterRequest {
    uin: Uin;
    androidid: string;
    guid: Bytes | string;
    qua: string;
    client: Client;
    force?: boolean;
}
export interface Registration {
    readonly uin: string;
    readonly androidid: string;
    readonly guid: string;
    readonly qua: string;
    readonly signVersion: 1;
    readonly deviceToken: string;
    readonly token: Buffer;
    readonly extra: Buffer;
    readonly registeredAt: number;
    readonly generation: number;
}
export interface SignRequest {
    uin: Uin;
    cmd: string;
    body?: Bytes;
    seq?: number;
    token?: Bytes;
}
export interface EnergyRequest {
    uin: Uin;
    salt: Bytes;
    cmd?: string;
    data?: string;
    seq?: number;
    token?: Bytes;
}
export interface SigningResult {
    readonly sign: Buffer;
    readonly extra: Buffer;
    readonly token: Buffer;
    readonly seq: number;
    readonly algorithm: "v1" | "xxsign";
}
export class SigningSystem {
    constructor();
    readonly size: Promise<number>;
    readonly signVersion: Promise<1>;
    register(request: RegisterRequest): Promise<Registration>;
    register(
        request: Omit<RegisterRequest, "client">,
        client: Client,
    ): Promise<Registration>;
    register(
        uin: Uin,
        androidid: string,
        guid: Bytes | string,
        qua: string,
        client: Client,
    ): Promise<Registration>;
    sign(request: SignRequest): Promise<SigningResult>;
    energy(request: EnergyRequest): Promise<SigningResult>;
    unregister(uin: Uin): Promise<boolean>;
    clear(): Promise<void>;
    close(): Promise<void>;
}
export function createSigningSystem(): SigningSystem;
export function register(request: RegisterRequest): Promise<Registration>;
export function register(
    request: Omit<RegisterRequest, "client">,
    client: Client,
): Promise<Registration>;
export function register(
    uin: Uin,
    androidid: string,
    guid: Bytes | string,
    qua: string,
    client: Client,
): Promise<Registration>;
export function sign(request: SignRequest): Promise<SigningResult>;
export function energy(request: EnergyRequest): Promise<SigningResult>;
export function unregister(uin: Uin): Promise<boolean>;
export function clear(): Promise<void>;
