"use strict";

const { createPublicKey, publicEncrypt, constants } = require("crypto");

/**
 * @param {String|Buffer} data
 * @param {String} key
 * @returns {String}
 */
function encryptPKCS1(data, key) {
    const buf = Buffer.from(data);
    const pubKey = createPublicKey(key);
    const encrypted = publicEncrypt({
        key: pubKey,
        padding: constants.RSA_PKCS1_PADDING
    }, buf);
    return encrypted.toString("base64");
}

module.exports = {
    encryptPKCS1
};