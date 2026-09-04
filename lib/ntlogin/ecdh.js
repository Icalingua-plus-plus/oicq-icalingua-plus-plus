"use strict";
const { createECDH } = require("crypto");

const NTQQ_PUBLIC_KEY = Buffer.from("049D1423332735980EDABE7E9EA451B3395B6F35250DB8FC56F25889F628CBAE3E8E73077914071EEEBC108F4E0170057792BB17AA303AF652313D17C1AC815E79", "hex");

class Ecdh {
    constructor() {
        const ecdh = createECDH("prime256v1");
        this.public_key = ecdh.generateKeys();
        this.nt_share_key = ecdh.computeSecret(NTQQ_PUBLIC_KEY);
        this._ecdh = ecdh;
    }

    ntExchange(bobPublic) {
        return this._ecdh.computeSecret(bobPublic);
    }
}

module.exports = Ecdh;
