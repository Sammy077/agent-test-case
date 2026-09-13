'use strict';
process.env.DEMO_MODE='true';
process.env.SERVERLESS='true';
if(!process.env.APP_SECRET)throw Error('Set APP_SECRET in Vercel environment variables before deploying demo.');
module.exports=require('../server').requestHandler;
