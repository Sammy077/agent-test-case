'use strict';
const path=require('node:path');
const {resetLocalDatabase}=require('../lib/fresh-start');
console.log(JSON.stringify(resetLocalDatabase(process.env.DB_FILE||path.join(__dirname,'../data/test-center.db')),null,2));
console.log('Restart local server. Reset runs only when explicitly invoked.');
