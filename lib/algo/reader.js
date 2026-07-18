class Reader {
    /**
     * @param {Buffer | ArrayBuffer | Uint8Array} data
     */
    constructor(data) {
        if (data instanceof Buffer) {
            this._buf = data;
        } else {
            this._buf = Buffer.from(data);
        }
        this._offset = 0;
    }

    get readableLength() {
        return Math.max(0, this._buf.length - this._offset);
    }

    read(n) {
        if (arguments.length === 0) {
            n = this.readableLength;
        }
        if (typeof n !== "number") {
            throw new TypeError("n must be a number");
        }
        if (n <= 0 || this.readableLength === 0) {
            return null;
        }

        const r = this._buf.subarray(this._offset, this._offset + n);
        this._offset += n;
        return r;
    }

    readU8() {
        const value = this._buf.readUInt8(this._offset);
        this._offset += 1;
        return value;
    }

    readU16() {
        const value = this._buf.readUInt16BE(this._offset);
        this._offset += 2;
        return value;
    }

    readU32() {
        const value = this._buf.readUInt32BE(this._offset);
        this._offset += 4;
        return value;
    }

    read32() {
        const value = this._buf.readInt32BE(this._offset);
        this._offset += 4;
        return value;
    }

    readU64() {
        const value = this._buf.readBigUInt64BE(this._offset);
        this._offset += 8;
        return value;
    }

    readBytes(length) {
        const value = Buffer.from(this._buf.slice(this._offset, this._offset + length));
        this._offset += length;
        return value;
    }

    readWithLength() {
        const length = this.readU32() - 4;
        return this.readBytes(length);
    }

    readTlv() {
        const length = this.readU16();
        return this.readBytes(length);
    }
}

module.exports = Reader;
