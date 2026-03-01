const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
// const ENCRYPTION_KEY = process.env.FILE_ENCRYPTION_KEY
//   ? Buffer.from(process.env.FILE_ENCRYPTION_KEY, "hex")
//   : (() => {
//       throw new Error("FILE_ENCRYPTION_KEY is not set in environment");
//     })();
const ENCRYPTION_KEY = process.env.FILE_ENCRYPTION_KEY
  ? Buffer.from(process.env.FILE_ENCRYPTION_KEY, "hex")
  : (() => { throw new Error("FILE_ENCRYPTION_KEY is not set in environment"); })();

console.log('Encryption key length (bytes):', ENCRYPTION_KEY.length); // should be 32

/**
 * Encrypt a buffer
 * @param {Buffer} buffer - file data
 * @returns {{ iv: string, encryptedData: Buffer }}
 */
function encrypt(buffer) {
  const iv = crypto.randomBytes(16); // 16 bytes for AES-256-CBC
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    encryptedData: encrypted,
  };
}

/**
 * Decrypt an encrypted buffer
 * @param {Buffer} encryptedBuffer - encrypted file data
 * @param {string} ivHex - initialization vector as hex string
 * @returns {Buffer}
 */
function decrypt(encryptedBuffer, ivHex) {
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}



module.exports = { encrypt, decrypt };