// This is a registration server for TaxiDash
//
// A mobile device will request the ip address of the nearest
// TaxiDash server given it's current location
//
// The mobile device can also get the ip address of the city of
// it's choosing (if the city is chosen manually)
//
// That is, each server will need a location and an ip address. On server
// start up (or adding a new server) we will need to request the server
// name from the ip address.
//

"use strict";

/* * * * * * * * * * * * * * * LOGGER SET UP * * * * * * * * * * * * * * */
var fs = require("fs"),
    http = require("http"),
    logFile = fs.createWriteStream('./logFile.log', {flags: 'a'}),
    logger = require("caterpillar").createLogger(),
    human = require("caterpillar-human").createHuman();

//Set up the logger
logger.pipe(human).pipe(logFile);

/*
logger.prototype.info = function(msg){
    this.log('info', (new Date()) + " " + msg);
};
*/

logger.log('info', "Log file created on " + (new Date()));

/* * * * * * * * * * * * * * * END LOGGER SET UP * * * * * * * * * * * * * * */

/* * * * * * * * * * * * * * * TAXIDASH SERVER INFO * * * * * * * * * * * * * * */

var databaseUrl = "localhost:27017/taxidash",
    collections = ["servers"],
    db = require("mongojs").connect(databaseUrl, collections),
    increment = 604800000,//valid for 1 week
    expiredTime = new Date().getTime() + increment;

//Updating server info
var updateServerInfo = function(){
    // Get all nameless or old server entries from the database 
    // and query their name 
    logger.log('info', 'Updating server name info');
    db.servers.find({ $or: [ {city: null }, { last_updated: { $gt: expiredTime } }]}, function(err, entries){
        var i = entries.length,
            name,
            city;
        while (i--){
            //get names of each entry and update it
            logger.log('info', 'Updating name for ' + entries[i].ip);
            http.get(options, function(resp){
                resp.on('data', function(chunk){
                    console.log("info", "received " + chunk + " from " + entries[i].ip);
                    //TODO
                    //name = "Nashville";//TODO Get the right name
                    //city = 
                }).on("error", function(e){
                    logger.log("error", "Updating TaxiDash entry with ip " + entries[i].ip + " failed with error: " + e);
                });
            });

            /*
            db.servers.update(entries[i], function(err, updated){
                if(err || !updated){
                    logger.log('error', 'Entry not updated: ' + entries[i] + ' to name "' + name + '"');
                } else {
                    logger.log('info', 'Entry name updated: ' + entries[i] + ' to name "' + name + '"');
                }
            });
           */
        }
    });
};

var cron = require('cron'),
    updateTaxiDashServers = cron.job("0 0 0 * * *", updateServerInfo());

updateTaxiDashServers.start();

/* * * * * * * * * * * * * * * END TAXIDASH SERVER INFO * * * * * * * * * * * * * * */

/* * * * * * * * * * * * * * * ROUTES * * * * * * * * * * * * * * */
//Server Core 
var address = "0.0.0.0",
    port = 8888,
    Hapi = require("hapi"),
    server = new Hapi.Server(port, address);
    server.on('error', function(err){
        console.log("ERROR: " + err);
        switch (err.code){
            case 'EADDRINUSE':
                console.log("Address already in use. Is a registration server already running?");
                break;
        }
    });

//Validation
var Joi = require("joi");

//Get Nearby TaxiDash Server
var nearbyConfig = {
    handler: function(request, reply) {
        logger.log('info', "Request for TaxiDash server near " 
                   + request.query.latitude + ", " + request.query.longitude);

        if (request.query.latitude && request.query.longitude){
            //Look up TaxiDash server nearest the given latitude, longitude
            //consider using geoNear from mongo
            //use sphere-knn
            //TODO
            var lat = request.query.latitude,
                lon = request.query.longitude;

            logger.log('info', "Searching for TaxiDash server near " + lat + ", " + lon);

            db.servers.find({ loc: { $near: { $geometry: { type: "Point", coordinates: [lon, lat]} , $maxDistance: 9999999 }}}, 
                function(err, result){
                    if (err){
                        logger.log('error', "Could not find nearby servers: " + err);
                        reply("ERROR: " + err);
                    } else {
                        var response = { nearbyCities: [] },
                            i = -1,
                            data,
                            length = Math.min(result.length, 3);

                        while(++i < length){
                            data = { 
                                city: result[i].city,
                                state: result[i].state,
                                ip: result[i].ip
                            };
                            response.nearbyCities.push(data);
                        }
                        //Respond
                        logger.log('info', "Found the following nearby servers: " + result);
                        console.log(JSON.stringify(response));
                        reply(response);
                    }
            });
        } else {
            reply("Need both a latitude and longitude to get a nearby server.");
        }
    },

    validate: {
        query: {
            latitude: Joi.number().min(-90).max(90),
            longitude: Joi.number().min(-180).max(180)
        }
    }
};

server.route({
    path: "/getNearbyTaxiDash",
    method: "GET",
    config: nearbyConfig
});

//Get TaxiDash Server By Name
var nameConfig = {
    handler: function(request, reply) {
        var q = {};//query
        if (request.query.city){
            q.city = request.query.city;
        } 
        if (request.query.state){
            q.state = request.query.state;
        }

        if (Object.keys(q).length){
            //Look up TaxiDash by ip address for city
            logger.log('info', "Searching for TaxiDash server for " + request.query.city);
            db.servers.find(q, function(err, result){
                if (result){
                    var response = "";

                    while(result.length){
                        response += result.pop().ip + " ";
                    }
                    reply(response);
                } else {
                    reply("Could not find server by name " + request.query.city);
                }
            });
        } else {
            reply("Need a server name.");
        }
    },
    validate: {
        query: {
            city: Joi.string().min(1).max(100),
            state: Joi.string().min(1).max(2)
        }
    }
}
server.route({
    path: "/getTaxiDashByName",
    method: "GET",
    config: nameConfig
});

//Get All TaxiDash Servers By Name
server.route({
    path: "/getAllTaxiDashNames",
    method: "GET",
    handler: function(request, reply) {
        logger.log('info', "Getting all server names...");
        db.servers.find({}, function(err, result){
            if (result){
                var response = "",
                    entry;

                while(result.length){
                    entry = result.pop();
                    response += entry.city + "," + entry.state + " ";
                }
                reply(response);
            } else {
                reply("Could not find all servers");
            }

        });
    }
});

server.route({
    path: "/",
    method: "GET",
    handler: function(request, reply) {
        reply("Welcome to the TaxiDash Registration Server.");
    }
});


/* * * * * * * * * * * * * * * END ROUTES * * * * * * * * * * * * * * */
server.start(function() {
    console.log("TaxiDash registration server started at " + server.info.uri);
});
