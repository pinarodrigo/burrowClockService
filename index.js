const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express');
const app = express();
const AWS = require('aws-sdk');
const uuid = require('node-uuid');

const { POSITIONS_TABLE, IS_OFFLINE } = process.env;

const dynamoDb = IS_OFFLINE === 'true' ?
    new AWS.DynamoDB.DocumentClient({
        region: 'localhost',
        endpoint: 'http://localhost:8000',
    }) :
    new AWS.DynamoDB.DocumentClient();

app.use(bodyParser.json({ strict: false }));

app.get('/position', (req, res) => {
    const params = {
        TableName: POSITIONS_TABLE,
    };
    dynamoDb.scan(params, (error, result) => {
        if (error) {
            res.status(400).json({ error: 'Error retrieving positions' });
        }
        const { Items: positions } = result;
        res.json({ positions });
    })
});


app.post('/position', (req, res) => {
    const { name, latitude, longitude } = req.body;
    const positionId = uuid.v4();
    const timestamp = Date.now();
    const params = {
        TableName: POSITIONS_TABLE,
        Item: {
            positionId,
            name,
            latitude,
            longitude,
            timestamp,
        },
    };
    dynamoDb.put(params, (error) => {
        if (error) {
            console.log('Error creating position: ', error);
            res.status(400).json({ error: 'Could not create position' });
        }
        res.json({ positionId, name, latitude, longitude });
    });
});


app.get('/position/:name', (req, res) => {
    const { name } = req.params;
    const params = {
        TableName: POSITIONS_TABLE,
        Key: {
            name,
        },
    };
    dynamoDb.get(params, (error, result) => {
        if (error) {
            res.status(400).json({ error: 'Error retrieving position' });
        }
        if (result.Item) {
            const { positionId, name, latitude, longitude, timestamp } = result.Item;
            res.json({ positionId, name, latitude, longitude, timestamp });
        } else {
            res.status(404).json({ error: `Position for: ${name} not found` });
        }
    });
});

app.put('/position', (req, res) => {
    const { name, latitude, longitude } = req.body;
    const timestamp = Date.now();
    var params = {
        TableName: POSITIONS_TABLE,
        Key: { name },
        UpdateExpression: 'set #lat = :latitude, #lon = :longitude, #ts = :timestamp',
        ExpressionAttributeNames: { '#lat': 'latitude', '#lon': 'longitude', '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':latitude': latitude, ':longitude': longitude, ':timestamp': timestamp },
    };
    dynamoDb.update(params, (error) => {
        if (error) {
            console.log(`Error updating position for ${name}: `, error);
            res.status(400).json({ error: 'Could not update position' });
        }
        res.json({ name, latitude, longitude, timestamp });
    })
});


app.delete('/position/:name', (req, res) => {
    const { positionId } = req.params;
    const params = {
        TableName: POSITIONS_TABLE,
        Key: {
            name,
        },
    };
    dynamoDb.delete(params, (error) => {
        if (error) {
            console.log(`Error updating position for ${name}`, error);
            res.status(400).json({ error: 'Could not delete position' });
        }
        res.json({ success: true });
    });
});

module.exports.handler = serverless(app);