import {randomBytes} from 'node:crypto';
// Execute no seu computador. Copie a saída diretamente para a configuração segura.
console.log(randomBytes(32).toString('base64'));
