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
    mongojs = require("mongojs"),
    db = mongojs.connect(databaseUrl, collections),
    ObjectId = mongojs.ObjectId,
    increment = 604800000,//valid for 1 week
    currentTime,
    expiredTime,
    ip_address,
    external_address = require('external-address');

//Updating server info
var updateServerInfo = function(){
    // Get all nameless or old server entries from the database 
    // and query their name 
    logger.log('info', 'Updating server name info');
    currentTime = new Date().getTime();
    expiredTime = currentTime - increment;

    db.servers.find({ $or: [ {city: null }, { last_updated: null }, 
                    { last_updated: { $lt: expiredTime } }]}, function(err, entries){
        if (err){
            logger.log("error", "Couldn't find entries to update. Error: " + err);
        } else {
            var i = entries ? entries.length : 0,
                dest,
                id;

            while (i--){
                if (entries[i].ip){ 
                    //create destination
                    if (ip_address){
                        console.log("\nip_address is " + ip_address + "'" );
                        console.log("\nentries[i].ip'" + entries[i].ip + "'");
                        console.log("\nentries[i].ip.indexOf(ip_address) " + entries[i].ip.indexOf(ip_address));

                        if( entries[i].ip.indexOf(ip_address) !== -1){//resolve any requests to TaxiDash servers
                            entries[i].ip = entries[i].ip.replace(ip_address, "localhost");//on same machine
                        }
                    }
                    dest = 'http://' + entries[i].ip + '/general_info.json';

                    id = entries[i]._id;

                    //get names of each entry and update it
                    console.log('info:\t'+ 'Updating name for ' + entries[i].ip + '( ' + dest + ' )' );
                    http.get(dest, function(resp){
                        console.log("resp is " + resp.statusCode);
                        var res = "";
                        resp.on('data', function(chunk){
                            res += chunk;
                            logger.log("info","Querying city, state. Received " + chunk);

                        }).on('end', function(){
                            //Update the entry after retrieving the entry's city, state name
                          res = JSON.parse(res);
                          db.servers.update({ _id: ObjectId(id) }, { $set: { city: res.city, 
                                            state: res.state,
                                            last_updated: currentTime } }, function(err, updated){
                                                console.log("err\t" + err);
                                                console.log("updated\t" + JSON.stringify(updated));
                                                if(err || !updated){
                                                    logger.log("error", "Update to entry " + id + " failed with error: " + err);
                                                }else{
                                                    logger.log("info", "Updated entry " + id);
                                                }
                                            });
                        }).on("error", function(err){
                            logger.log("error", "Updating TaxiDash entry with ip " + entries[i].ip + " failed with error: " + err);
                            console.log("error:\t"+ "Updating TaxiDash entry with ip " + entries[i].ip + " failed with error: " + err);
                        });
                    }).on('error', function(err){
                        logger.log("error", "Updating TaxiDash entry failed with error: " + err);
                        console.log("error", "Updating TaxiDash entry failed with error: " + err);
                    });

                }
            }
        }
    });
};

var cron = require('cron'),
    updateTaxiDashServers = cron.job("0 * * * * *", updateServerInfo);

//Get external ip address to resolve any addresses of taxidash servers on same machine or LAN
external_address.lookup(function(error, address){
    console.log("external_address finished with ERROR:\t" + error + "\nMSG:\t" + address);

    if(!error && address){
        ip_address = address.replace("\n","");
        console.log("external ip_address is " + ip_address);
        updateServerInfo();
    }
});

//Start the update job
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
        var response = {};
        logger.log('info', "Request for TaxiDash server near " 
                   + request.query.latitude + ", " + request.query.longitude);

        if (request.query.latitude && request.query.longitude){
            //Look up TaxiDash server nearest the given latitude, longitude
            var lat = request.query.latitude,
                lon = request.query.longitude;

            logger.log('info', "Searching for TaxiDash server near " + lat + ", " + lon);

            db.servers.find({ loc: { $near: { $geometry: { type: "Point", coordinates: [lon, lat]} , $maxDistance: 9999999 }}}, 
                function(err, result){
                    if (err){
                        logger.log('error', "Could not find nearby servers: " + err);
                        response.error = err;
                    } else {
                        var i = -1,
                            data,
                            length = Math.min(result.length, 3);

                        response.cities = [];

                        while(++i < length){
                            data = { 
                                city: result[i].city,
                                state: result[i].state,
                                ip: result[i].ip
                            };
                            response.cities.push(data);
                        }
                        //Respond
                        logger.log('info', "Found the following nearby servers: " + result);
                    }

                    reply(response);
            });
        } else {
            response.error = "Need both a latitude and longitude to get a nearby server.";
            reply(response);
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
        var response = {},
            q = {};//query

        if (request.query.city){
            q.city = request.query.city;
        } 
        if (request.query.state){
            q.state = request.query.state;
        }

        if (Object.keys(q).length){
            //Look up TaxiDash by ip address for city
            logger.log('info', "Searching for TaxiDash server for " + request.query.city + ", " + request.query.state);
            db.servers.find(q, function(err, result){
                if (result){
                    var entry;

                    response.cities = [];
                    while(result.length){
                        entry = result.pop();
                        response.cities.push({ city: entry.city,
                                                     state: entry.state,
                                                     address: entry.ip });
                    }
                } else {
                    response.error = "Could not find server by name " + request.query.city+ ", " + request.query.state;
                }
                reply(response);
            });
        } else {
            response.error = "Need a server name.";
            reply(reponse);
        }
    },
    validate: {
        query: {
            city: Joi.string().min(1).max(100),
            state: Joi.string().min(1).max(2)
        }
    }
};

server.route({
    path: "/getTaxiDashByName",
    method: "GET",
    config: nameConfig
});

//Get All TaxiDash Servers By Name
server.route({
    path: "/getAllTaxiDashServers",
    method: "GET",
    handler: function(request, reply) {
        var response = {};

        logger.log('info', "Getting all server names...");
        db.servers.find({}, function(err, result){
            if (result){
                var entry;

                response.cities = [];
                while(result.length){
                    entry = result.pop();
                    response.cities.push({ city: entry.city, state: entry.state, address: entry.ip });
                }
            } else {
                response.error = "Could not find all servers";
            }

            reply(response);
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
