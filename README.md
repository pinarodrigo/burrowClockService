# BURROW CLOCK SERVICE

## INSTALL
1. npm install -g serverless
2. serverless login
3. npm i --save aws-sdk body-parser express node-uuid serverless-http
4. npm i --save serverless-dynamodb-local serverless-offline

## RUN
* sls offline start --migrate   // Runs local environment
    * Service available under:
        * http://localhost:3000/position
        * http://localhost:3000/poi

## DEPLOYMENT
* sls deploy // Deploys infrastructure and function changes
* sls deploy function -f burrowclock-app //Deploys changes in javascript only

## CLEAN AWS RESOURCES
* sls remove