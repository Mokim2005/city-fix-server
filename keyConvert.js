const fs = require('fs');
const key = fs.readFileSync('./city-fix-firebase-adminsdk-fbsvc-822010d878.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)