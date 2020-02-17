const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express');
const app = express();
const AWS = require('aws-sdk');
const uuid = require('node-uuid');
const superagent = require('superagent');

const { POSITIONS_TABLE, POIS_TABLE, IS_OFFLINE } = process.env;
const endpointIFTTT = 'https://maker.ifttt.com/trigger/transition/with/key/bJQmYS7tQFaNdmfLChbr0b';
const TEN_MINUTES = 10 * 60 * 1000;

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

app.get('/poi', (req, res) => {
    const params = {
        TableName: POIS_TABLE,
    };
    dynamoDb.scan(params, (error, result) => {
        if (error) {
            res.status(400).json({ error: 'Error retrieving positions' });
        }
        const { Items: pois } = result;
        res.json({ pois });
    })
});

app.post('/position', (req, res) => {
    let { name, latitude, longitude } = req.body;
    name = name.toLowerCase();
    const positionId = uuid.v4();
    const timestamp = Math.floor(new Date().getTime() / 1000);
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

app.post('/poi', (req, res) => {
    const { poiname, latitude, longitude } = req.body;
    const positionId = uuid.v4();
    const timestamp = Date.now();
    const params = {
        TableName: POIS_TABLE,
        Item: {
            positionId,
            poiname,
            latitude,
            longitude,
            timestamp,
        },
    };
    dynamoDb.put(params, (error) => {
        if (error) {
            console.log('Error creating POI: ', error);
            res.status(400).json({ error: 'Could not create POI' });
        }
        res.json({ positionId, poiname, latitude, longitude, timestamp });
    });
});


app.post('/owntracks', (req, res) => {
    let _type = req.body._type;
    let username = req.query.u;
    console.log(username + " sent command: " + _type + " in body " + JSON.stringify(req.body));

    if (typeof _type == 'undefined') {
        console.error('Error creating Owntrack record');
        res.status(200).json({ status: 'Could not create record' });
    }
    
    if (_type == 'waypoints' || _type == "dump" || _type == "lwt" || _type == "configuration" || _type == "beacon" || _type == "cmd" || _type == "steps" || _type == "card" || _type == "encrypted") {
        console.log("Received command: " + _type + " in body " + JSON.stringify(req.body));
        res.status(200).json({ status: 'ok' });
    }

    if (_type == 'transition') {
        let { tid, desc, event, lat, lon, tst } = req.body;

        //TODO: Improve localization
        if (event == "enter") {
            event = "está llegando a";
        } else if (event == "leave") {
            event = "salió de";
        }

        addPositionForUser(username, lat, lon, tst).then(function (result) {
            if (result) {
                superagent
                    .post(endpointIFTTT)
                    .send(JSON.stringify({ value1: username, value2: desc, value3: event }))
                    .set('Content-Type', 'application/json')
                    .set('accept', 'json')
                    .end(function (err, response) {
                        if (err) {
                            console.error("Error contacting IFTTT");
                            res.status(200).json({ error: 'Error contacting IFTTT' });
                        }

                        console.log("Location updated due to a transition, notification sent to IFTTT");
                        res.status(200).json({ status: 'Location updated due to a transition, notification sent to IFTTT' });
                    })
            } else {
                console.log("Location not updated, transition data is older");
                res.status(200).json({ error: 'Location not updated, transition data is older' });
            }
        });
    }

    if (_type == 'location') {
        let { tst, lat, lon, topic } = req.body;
        latitude = lat;
        longitude = lon;
        positionId = uuid.v4();
        timestamp = tst;
        name = req.query.u;
        poi = "undefined";

        isPositionNewer(name, tst).then(function (result) {
            if (result) {

                isWhithinPOI(latitude, longitude, 20).then(function (result) {
                    if (result != "undefined") {
                        poi = result;
                    }

                    const params = {
                        TableName: POSITIONS_TABLE,
                        Item: {
                            positionId,
                            name,
                            latitude,
                            longitude,
                            timestamp,
                            poi
                        },
                    };
                    dynamoDb.put(params, (error) => {
                        if (error) {
                            console.error('Error creating position: ', error);
                            res.status(400).json({ error: 'Could not create position' });
                        }
                        const positionParams = {
                            TableName: POSITIONS_TABLE,
                        };
                        dynamoDb.scan(positionParams, (error, result) => {
                            if (error) {
                                res.status(400).json({ error: 'Error retrieving positions' });
                            }

                            for (let index = 0; index < result.Items.length; index++) {
                                result.Items[index]._type = "location";
                                if (result.Items[index].name == "victoria") {
                                    result.Items[index].tid = "to"
                                } else {
                                    result.Items[index].tid = result.Items[index].name.substring(0, 2);
                                }
                                result.Items[index].tst = result.Items[index].timestamp;
                                result.Items[index].lat = result.Items[index].latitude;
                                result.Items[index].lon = result.Items[index].longitude;
                                result.Items[index].topic = "owntracks/" + result.Items[index].name + "/iphone"
                            };

                            const { Items: positions } = result;
                            res.json(positions);
                        })
                    });
                });
            } else {
                console.log("Ignoring position update, newer entry already exists!");
                res.status(200).json({ status: 'ok' });
            }
        });
    } else if (_type == 'waypoint') {
        let { tst, desc, lat, lon } = req.body;
        latitude = lat;
        longitude = lon;
        positionId = uuid.v4();
        timestamp = tst;
        poiname = desc;

        if (poiname == "") {
            poiname = "undefined"
        }

        const params = {
            TableName: POIS_TABLE,
            Item: {
                positionId,
                poiname,
                latitude,
                longitude,
                timestamp,
            },
        };
        dynamoDb.put(params, (error) => {
            if (error) {
                console.error('Error creating POI: ', error);
                res.status(400).json({ error: 'Could not create POI' });
            }
            res.json({ positionId, poiname, latitude, longitude, timestamp });
        });
    }
});

app.get('/position/:name', (req, res) => {
    const { name } = req.params;
    const params = {
        TableName: POSITIONS_TABLE,
        Key: {
            name,
        },
    };
    console.log("PARAMS:" + JSON.stringify(params));
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

app.get('/poi/:poiname', (req, res) => {
    const { poiname } = req.params;
    const params = {
        TableName: POIS_TABLE,
        Key: {
            poiname,
        },
    };
    console.log("PARAMS:" + JSON.stringify(params));
    dynamoDb.get(params, (error, result) => {
        if (error) {
            res.status(400).json({ error: 'Error retrieving position' });
        }
        if (result.Item) {
            const { positionId, poiname, latitude, longitude, timestamp } = result.Item;
            res.json({ positionId, poiname, latitude, longitude, timestamp });
        } else {
            res.status(404).json({ error: `POI ${poiname} not found` });
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
    const { name } = req.params;
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

app.delete('/poi/:poiname', (req, res) => {
    const { poiname } = req.params;
    const params = {
        TableName: POIS_TABLE,
        Key: {
            poiname,
        },
    };
    dynamoDb.delete(params, (error) => {
        if (error) {
            console.log(`Error deleting POI ${poiname}`, error);
            res.status(400).json({ error: 'Could not delete POI' });
        }
        res.json({ success: true });
    });
});

app.get('/locate/:name', (req, res) => {
    var jsonResult = new Object();
    let { name } = req.params;
    name = name.toLowerCase();
    const params = {
        TableName: POSITIONS_TABLE,
        Key: {
            name,
        },
    };

    dynamoDb.get(params, (error, result) => {
        if (result.Item) {
            const poiparams = {
                TableName: POIS_TABLE,
            };
            dynamoDb.scan(poiparams, (error, data) => {
                if (error) {
                    res.status(500).json({ error: 'Error retrieving POIs' });
                } else {
                    res.contentType = "application/json"
                    jsonResult.name = name;
                    jsonResult.distance = gdistance("48.814130", "9.146436", result.Item.latitude, result.Item.longitude);

                    var found = false;
                    data.Items.forEach(function (item) {
                        if (isWhithinRadiusOfPOI(result.Item.latitude, result.Item.longitude, item.latitude, item.longitude, 20)) {
                            jsonResult.poi = item.poiname;
                            found = true;
                        }
                    });
                    if (!found) {
                        //Not near any POI
                        jsonResult.poi = "";

                        res.json(jsonResult);
                    } else {
                        res.json(jsonResult);
                    }
                }
            })
        } else {
            console.log("No location information found for " + name);
            jsonResult.name = name;
            jsonResult.poi = "undefined";
            res.json(JSON.stringify(jsonResult));
        }
    });
});


function gdistance(latitude1, longitude1, latitude2, longitude2, radius) {
    if (!latitude1 || !longitude1 || !latitude2 || !longitude2) {
        return null;
    };

    var lat1 = Number(latitude1), lon1 = Number(longitude1);
    var lat2 = Number(latitude2), lon2 = Number(longitude2);

    radius = (radius === undefined) ? 6371e3 : Number(radius);

    var R = radius;
    var φ1 = (lat1 * Math.PI / 180), λ1 = (lon1 * Math.PI / 180);
    var φ2 = (lat2 * Math.PI / 180), λ2 = (lon2 * Math.PI / 180);
    var Δφ = φ2 - φ1;
    var Δλ = λ2 - λ1;

    var a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2)
        + Math.cos(φ1) * Math.cos(φ2)
        * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;     // Meters
    var d2 = d / 1000; // Meters to KM
    return d2;
}

async function isPositionNewer(name, tst) {
    var positionIsNewer = true;
    const params = {
        TableName: POSITIONS_TABLE,
        KeyConditionExpression: "#n = :na",
        ExpressionAttributeNames:{
            "#n": "name"
        },
        ExpressionAttributeValues: {
            ":na": name
        }
    };
    try {
        await dynamoDb.query(params).promise().then(async function (result) {
            if (result && result.Items) {
                for (let index = 0; index < result.Items.length; index++) {
                    recordTimeStamp = result.Items[index].timestamp;
                    console.log("Checking record of user: " + result.Items[index].name);
                    console.log("Record timestamp: " + recordTimeStamp);
                    console.log("Request timestamp: " + tst);
                    if (Number(tst) < Number(recordTimeStamp)) {
                        positionIsNewer = false;
                    }
                };
            }
        });
        return positionIsNewer;
    } catch (error) {
        console.error(error);
        return false;
    }
}


async function addPositionForUser(username, latitude, longitude, tst) {
    name = username.toLowerCase();
    const positionId = uuid.v4();
    const timestamp = tst;
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
    var recordAdded = false;
    try {
        await isPositionNewer(name, tst).then(async function (result) {
            if (result) {
                await dynamoDb.put(params).promise();
                recordAdded = true;
            }
        });
    } catch (error) {
        console.error(error);
        recordAdded = false;
    }
    return recordAdded;
}

function isWhithinRadiusOfPOI(latitude1, longitude1, latitude2, longitude2, radius) {
    var distance = gdistance(latitude1, longitude1, latitude2, longitude2);
    var meters = distance * 1000; // KM to meters
    if (meters <= radius) {
        return true;
    } else {
        return false;
    }
}

async function isWhithinPOI(latitude, longitude, radius) {
    const poiparams = {
        TableName: POIS_TABLE,
    };
    var isNearThisPOI = "undefined";
    const result = await dynamoDb.scan(poiparams).promise();
    if (result && result.Items) {
        for (let index = 0; index < result.Items.length; index++) {
            if (isWhithinRadiusOfPOI(result.Items[index].latitude, result.Items[index].longitude, latitude, longitude, radius)) {
                isNearThisPOI = result.Items[index].poiname;
                console.log("user located in: " + isNearThisPOI);
            }
        };
    } else {
        isNearThisPOI = "undefined";
    }

    return isNearThisPOI;
}

module.exports.handler = serverless(app);