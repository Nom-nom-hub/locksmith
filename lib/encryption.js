'use strict';

const crypto = require('crypto');

class Encryption {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32;
        this.ivLength = 16;
        this.tagLength = 16;
    }

    encrypt(data, key) {
        const iv = crypto.randomBytes(this.ivLength);
        const cipher = crypto.createCipher(this.algorithm, key);
        cipher.setAAD(Buffer.from('locksmith'));
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const tag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        };
    }

    decrypt(encryptedData, key) {
        const decipher = crypto.createDecipher(this.algorithm, key);
        decipher.setAAD(Buffer.from('locksmith'));
        decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    generateKey() {
        return crypto.randomBytes(this.keyLength).toString('hex');
    }

    hashKey(key) {
        return crypto.createHash('sha256').update(key).digest('hex');
    }
}

module.exports = new Encryption(); 