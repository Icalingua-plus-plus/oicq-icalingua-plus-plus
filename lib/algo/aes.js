"use strict";

const { createCipheriv, createDecipheriv } = require("crypto");

/**
 * @param {String|Buffer} data
 * @param {String} key
 * @param {String} cipher
 * @returns {String}
 */
function encrypt(data, key, cipher = "aes-128-cbc") {
    const iv = key.substring(0, 16)
    const encipher = createCipheriv(cipher, key, iv);
    const encrypted = encipher.update(data);
    return Buffer.concat([encrypted, encipher.final()]).toString("base64");
}

/**
 * @param {String} data
 * @param {String} key
 * @param {String} cipher
 * @returns {Buffer}
 */
function decrypt(data, key, cipher = "aes-128-cbc") {
    const iv = key.substring(0, 16)
    const encrypted = Buffer.from(data, "base64");
    const decipher = createDecipheriv(cipher, key, iv);
    const decrypted = decipher.update(encrypted);
    return Buffer.concat([decrypted, decipher.final()]);
}

module.exports = {
    encrypt, decrypt
};