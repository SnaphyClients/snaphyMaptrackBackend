'use strict';
module.exports = function(server, databaseObj, helper, packageObj) {
    var moment = require('moment');
    //Adding schedule for node.
    //https://github.com/node-schedule/node-schedule
    var schedule = require('node-schedule');
    //Load the push service plugin....just call this push method to send push message..(app, message, registrationId, from, callback)
    var push = helper.loadPlugin("pushService");
    var sms = helper.loadPlugin("smsService");
    var multiLogin = helper.loadPlugin("multilogin");
    var from = packageObj.eventPushFromMessage;
    //Expired status..
    var EXPIRED = "expired";
    var trackPath = packageObj.trackUrlPath || "track";
    var _ = require("lodash");
    var speakeasy = require("speakeasy");

    /**
     * Here server is the main app object
     * databaseObj is the mapped database from the package.json file
     * helper object contains all the helpers methods.
     * packegeObj contains the packageObj file of your plugin.
     */

    /**
     * Initialize the plugin at time of server start.
     * init method should never have any argument
     * It is a constructor and is populated once the server starts.
     * @return {[type]} [description]
     */
    var init = function() {
        beforeTrackDataSaved();
        //remind event one day before..
        addRecurrenceRule();
        //Add expired status..check every start of the day.
        checkExpiryRecurrenceRule();
        //Add Tracking code to the route..
        addTrackingCodeRoute();
        requestOtp();
        //Google login with code..
        loginWithCode();
        searchCustomer();
        //Shared location before saved..
        sharedLocationBeforeSaved();
    };




    var getErrorObj = function(message) {
        message = message || "Data validation failed";
        // If not return 400 response which means unauthroized.
        var err = new Error(message);
        err.status = 400;
        return err;
    };




    var sharedLocationBeforeSaved = function(){
        var LastUpdatedLocation = databaseObj.LastUpdatedLocation;
        var Customer = databaseObj.Customer;
        //Create a last UpdatedLocation before creating a customer..
        Customer.observe("after save", function(ctx, next){
            //validate data..
            var instance = ctx.instance;

            //Now add lastUpdatedLocation data code..
            if (ctx.isNewInstance) {
                var customerId = instance.id;
                //Now first create data..
                LastUpdatedLocation.create({
                    customerId: customerId
                }, function(err, obj){
                    if(err){
                        console.error(err);
                    }else{
                        //Now get the id of the object..
                        var lastUpdatedLocationId = obj.id;
                        //Now update customer..
                        instance.lastUpdatedLocationId = lastUpdatedLocationId;
                        instance.save({}, function(err, value){
                            if(err){
                                console.error(err);
                            }else{
                                //Data saved succesfully..
                            }
                        });
                    }
                });
            }

            //Call the next middleware...
            next();
        });


        LastUpdatedLocation.observe("before save", function(ctx, next){
            //validate data..
            var instance = ctx.instance || ctx.data;

            //First validate the data..
            if(instance.sharedLocation){
                if(instance.sharedLocation.length){
                    //Now format number..in the list..
                    instance.sharedLocation.forEach(function(numberObj){
                        if(numberObj.number){
                            numberObj.number =  formatNumber(numberObj.number);
                        }

                    });

                    //instance.friends = validateFriendsList(instance.friends);
                    instance.sharedLocation = validateFriendsList(instance.sharedLocation);

                }

            }

            next();
        });
    };





    var beforeTrackDataSaved = function() {
        var Customer = databaseObj.Customer;
        var Track = databaseObj.Track;
        //unique code to track the data..
        Track.validatesUniquenessOf('uniqueCode');
        Track.validatesUniquenessOf('locationId');

        Track.observe("before save", function(ctx, next) {
            //validate data..
            var instance = ctx.instance || ctx.data;
            //add unique code..
            if (ctx.isNewInstance) {
                instance.uniqueCode = generateRandomDigits();
            }

            if (instance.type === "location") {
                validateLocationType(instance, function() {
                    //Format data before saving..
                    formatData(instance);
                    //call the next middleware now
                    next();
                    //Meanwhile share info between friends...
                    if (instance.friends) {
                        if (instance.friends.length) {
                            //if (instance.isPublic === "private") {
                                //Send friends invites..
                                filterFriendList(instance.friends, instance, ctx.isNewInstance);
                            //}
                        }
                    }
                }, next);
            } else if (instance.type === "event") {
                validateEventType(instance, ctx.isNewInstance, function() {
                    //Format data before saving..
                    formatData(instance);

                    //call the next middleware..
                    next();

                    if (instance.friends) {
                        if (instance.friends.length) {
                            //if (instance.isPublic === "private") {
                                //Send friends invites..
                                filterFriendList(instance.friends, instance, ctx.isNewInstance);
                            //}
                        }
                    }
                }, next);
            } else {
                //console.info(instance);
                if (ctx.isNewInstance) {
                    return next(getErrorObj("Data validation failed. `type` should be either location or event"));
                } else {
                    next();

                    if (instance.friends) {
                        if (instance.friends.length) {
                            //if (instance.isPublic === "private") {
                                //Send friends invites..
                                filterFriendList(instance.friends, instance, ctx.isNewInstance);
                            //}
                        }
                    }

                }

            } //else..
        });

    };


    var loginWithCode = function() {
        var Customer = databaseObj.Customer;
        Customer.loginWithCode = function(accessToken, code, number, callback) {
            var err = new Error('Sorry, but that verification code does not work!');
            err.statusCode = 401;
            err.code = 'LOGIN_FAILED';


            if (number) {
                number = number.toString();
                var patt = /\+\d{12,12}/;
                var match = number.match(patt);

	            if (!match) {
	                number = "+91" + number;
	            }
            }


            var actualCode = speakeasy.totp({
                secret: packageObj.SECRET_CODE + number.toString(),
                digits: 4,
                step: 300
            });

            if(actualCode.toString() !== code.toString()){
            	console.error("Error matching");
                callback(err);
            }else{
            	//Now login user with callback..
            	multiLogin.loginWithGoogleManual(accessToken, callback, number);
            }

        };

        Customer.remoteMethod(
            'loginWithCode', {
                accepts: [{
                    arg: 'accessToken',
                    type: 'string',
                    required: true,
                    http: {
                        source: 'form'
                    }
                }, {
                    arg: 'code',
                    type: 'string',
                    required: true
                }, {
                    arg: 'number',
                    type: 'string',
                    required: true
                }],
                description: "Customer login by OTP verification of  Mapstrack App",
                returns: {
                    arg: 'accessToken',
                    type: 'object',
                    root: true,
                    description: 'The response body contains properties of the AccessToken created on login.\n' +
                        'Depending on the value of `include` parameter, the body may contain ' +
                        'additional properties:\n\n' +
                        '  - `user` - `{User}` - Data of the currently logged in user. (`include=user`)\n\n'
                },
                http: {
                    verb: 'post'
                }
            }
        ); //remoteMethod
    };


    var searchCustomer = function() {
        var Customer = databaseObj.Customer;
        Customer.search = function(filter, callback) {
            Customer.find(filter)
                .then(function(customerList){
                    callback(null, customerList);
                })
                .catch(function(err){
                    callback(err);
                });
        };

        Customer.remoteMethod(
            'search', {
                accepts: [{
                    arg: 'filter',
                    type: 'object',
                    required: true
                }],
                description: "Customer find by post method",
                returns: {
                    arg: 'data',
                    type: ['Customer'],
                    root: true,
                    description: 'List of logged in customers'
                },
                http: {
                    verb: 'post'
                }
            }
        ); //remoteMethod
    };



    var requestOtp = function() {
        var Customer = databaseObj.Customer;
        Customer.requestOtp = function(number, fn) {
            //matching the number..
            var patt = /\+\d{12,12}/,
                match = number.match(patt);

            if (!match) {
                number = "+91" + number;
            }

            //var code = notp.totp.gen(key, opt)

            // Note that you’ll want to change the secret to something a lot more secure!
            var code = speakeasy.totp({
                secret: packageObj.SECRET_CODE + number,
                digits: 4,
                step: 300
            });

            console.log('Sending code for verification process : ' + code);
            var message = "Verification code for Mapstrack application is : " + code;
            // [TODO] hook into your favorite SMS API and send your user their code!
            //Now sending the verification code to the app
            sms.send(message, number, function(err) {
	            if (err) {
                	console.error(err);
                    fn(err);
                }
                console.log("Successfully send verification message to customer at " + number);
	        });

            //Calling the callback.. function..
            fn(null, code);
        }; //requestCode function..


        Customer.remoteMethod(
            'requestOtp', {
                accepts: {
                    arg: 'number',
                    type: 'string',
                    required: true
                },
                returns: {
                    arg: 'code',
                    type: 'string',
                    required: true
                },
                description: "Request code for OTP verification of  Mapstrack App",
            }
        );
    };





    //Filter friends list before sending friend share request message..
    var filterFriendList = function(contactObjList, instance, isNew) {
        var numberList = [];
        if (isNew) {
            //Now get the friends list from the friends object list..
            //[{number: "8955674434"}] =>> [8955674437]
            var numberList = _.map(contactObjList, 'number');
            //send invite to these numbers..
            sendFriendShareInvites(numberList, instance, isNew);

        } else {
            //First search from data..
            //First find the new added data..
            var Track = databaseObj.Track;
            //Search 
             Track.findById(instance.id, {}, function(err, previousValue) {
                if (err) {
                    console.error(err);
                } else {
                    if (previousValue) {
                        //Now remove the previous phoneNumber because that  number notification already be send..
                        var newFriendsAdded = _.filter(contactObjList, function(contactObj) {
                            var previousContactValue = previousValue.friends;
                            for (var i = 0; i < previousContactValue.length; i++) {
                                if(previousContactValue[i].number){
                                    var previousNumber = formatNumber(previousContactValue[i].number);
                                    var addedNumber = formatNumber(contactObj.number);
                                    if (previousNumber === addedNumber) {
                                        return false;
                                    }
                                }
                            } //for loop..

                            //Only add those elements whose value is not found...
                            return true;
                        });
                        //[{number: "8955674434"}] =>> [8955674437]
                        var numberList = _.map(newFriendsAdded, 'number');

                        //send invite to these numbers..
                        //here send previousValue as instance..
                        sendFriendShareInvites(numberList, previousValue, isNew);

                    } //if data is fetched..
                } //else not error..
            });
        }
    };




    var formatNumber = function(number){
        number = number.toString();
        if(number){
            var patt = /^\+?[0-9]{12,12}$/;
            if(!patt.test(number)){
                //Remove zero..
                if(number.substring(0,1) === "0"){
                    //remove zero..
                    number = number.substring(1);
                }

                //Now add +91
                var indianStyle = /^\+91\d+/;
                if(!indianStyle.test(number)){
                    number = "+91" + number;
                }
            }
        }


        return number;
    };




    var sendFriendShareInvites = function(numberList, instance, isNew) {

        //Now check whom to check sms and whom to send push service..
        var Customer = databaseObj.Customer;
        if (numberList) {
            if (numberList.length) {
                //fetch list of customer whose contact number..
                Customer.find({
                    where: {
                        phoneNumber: {
                            inq: numberList
                        }
                    }
                })
                    .then(function(registeredUsers) {
                        if (instance.customerId) {
                            //get the event creator name..
                            Customer.findById(instance.customerId)
                                .then(function(owner) {
                                    if (owner) {
                                        var nonRegisteredUsers = [];
                                        //Now get the non-registered users list..
                                        if (registeredUsers) {
                                            //Filter the nonregistered users..
                                            nonRegisteredUsers = _.filter(numberList, function(number) {
                                                for (var i = 0; i < registeredUsers.length; i++) {
                                                    if (registeredUsers[i].phoneNumber.toString() === number.toString()) {
                                                        return false;
                                                    }
                                                } //for loop..
                                                //Only add those elements whose value is not found...
                                                return true;
                                            });

                                        } else {
                                            nonRegisteredUsers = numberList;
                                            registeredUsers = [];
                                        }

                                        //Now we have list of registred and nonregistred users..
                                        //send sms invite..
                                        sendNonregisteredInvite(nonRegisteredUsers, instance, owner);

                                        //Send push invitation to registered users..
                                        sendInvitePush(registeredUsers, instance, owner);

                                    }
                                })
                                .catch(function(err) {
                                    console.error(err);
                                });
                        } //if customerId is given..
                    })
                    .catch(function(err) {
                        console.error(err);
                    });
            }
        }
    };



    var sendInvitePush = function(usersList, instance, owner) {
        console.info("sending push ", usersList);
        var message = getMessage(instance, owner);
        if (usersList) {
            usersList.forEach(function(user) {
                if (user.registrationId) {
                    //Now send message to the registered user..
                    sendPush(user.registrationId, message);
                }
            });
        }

    };


    var sendPush = function(registrationId, message) {
        var from = packageObj.eventPushFromMessage || "Mapstrack";
        push.push(server, message, registrationId, from, function(err) {
            if (err) {
                //log error..
                console.error(err);
            }
        });
    };


    var getMessage = function(instance, owner) {
        var message = "";
        message = message + " " + capitalizeEachWord(owner.firstName);
        if (owner.lastName) {
            message = message + " " + capitalizeEachWord(owner.lastName);
        }

        var type;
        if(instance.type === "event"){
            type = "an event";
        }else{
            type = "a location"
        }

        message = message + " has shared " + type + " '" + capitalizeEachWord(instance.name) + "' with you through Mapstrack! Use Tracking code: " + instance.uniqueCode + " to track this event.\nTracking Link: " +
            packageObj.appUrl + trackPath + "/" + instance.uniqueCode + "";
        return message;
    };



    //send sms to non registered users..
    var sendNonregisteredInvite = function(numberList, instance, owner) {
        var message = getMessage(instance, owner);

        //Now send sms finally..
        sendGroupSms(numberList, message);
    };



    //send sms to list of people
    var sendGroupSms = function(numberList, message) {
        numberList.forEach(function(number) {
            sendSms(number, message);
        });
    };


    var sendSms = function(number, message) {
        //console.info("sending message ", number, message);
        sms.send(message, number, function(err) {
            if (err) {
                console.error(err);
            }
        });
    };









    //Validate location Type before saving..
    var validateLocationType = function(instance, callback, next) {
        if (instance.locationId === undefined) {
            return next(getErrorObj("Data validation failed. 'locationId' is required field"));
        } else {
            instance.name = instance.name || instance.locationId;
            if (instance.eventDate === "") {
                instance.eventDate = moment();
            }

            instance.locationId = instance.locationId.trim();

            //Test locationId unique name for spacess..
            var patt = /\s+/;
            if (patt.test(instance.locationId)) {
                return next(getErrorObj("Data validation failed. `locationId` must be a unique name  and should not contain spaces."));
            }

            //validate friendsList..
            if (instance.friends) {
                if (instance.friends.length) {
                    //Remove bad numbers..
                    instance.friends = validateFriendsList(instance.friends);
                }

            }


            //Now call the callback..
            callback();

        }
    };




    //Validate event Type before saving..
    var validateEventType = function(instance, isNew, callback, next) {
        var now = moment();
        if (instance.name === undefined) {
            return next(getErrorObj("Data validation failed. 'name' is a required field"));
        } else if (instance.eventDate === undefined || instance.eventDate === "") {
            //then show error..
            return next(getErrorObj("Data validation failed. `eventDate` is a required field"));
        } else {
            try {
                instance.eventDate = new Date(moment(instance.eventDate));
            } catch (err) {
                return next(err);
            }
            //Now check if the event date is expired or not..
            //Now check whether the event is expired..
            var expired = moment(instance.eventDate).isBefore(now, "day");
            if (expired) {
                //Now change the event status to expired...
                instance.status = EXPIRED;
            } else {
                //Now change the event status to expired...
                instance.status = "allow";
            }

            //validate friendsList..
            if (instance.friends) {
                if (instance.friends.length) {
                    //Remove bad numbers..
                    instance.friends = validateFriendsList(instance.friends);
                }

            }
            //Send the callback..
            callback();
        }
    };






    //add RecurrenceRule
    //Will run at every 12
    var checkExpiryRecurrenceRule = function() {
        var rule = new schedule.RecurrenceRule();
        rule.hour = packageObj.alarmManager.dailyHour;
        rule.minute = packageObj.alarmManager.dailyMinutes || 1;
    

        //Run job every this hour..
        var job = schedule.scheduleJob(rule, function() {
            console.info("waking up to check expiry dates");

            var yesturday = moment(moment()).subtract(1, 'days');
            //Found all those allowed events which gonna happen tomorrow. and send an push message to those users..
            var Track = databaseObj.Track;
            var where = {
                "type": "event",
                "status": "allow",
                "eventDate": {
                    lt: new Date(yesturday)
                }
            };

            /*
				Employee.updateAll({managerId: 'x001'}, {managerId: 'x002'}, function(err, info) {
			    	...
				});
			*/
            //Now adding modifying the expiry date..
            Track.updateAll(where, {
                status: EXPIRED
            }, function(err, info) {
                if (err) {
                    //log error..
                    console.error(err);
                } else {
                    console.info(info);
                }
            });
        });

    };

    //remove the bad phone number from the list..
    //Only add real phone number to the add..
    //Return real phonenumber list.. 
    var validateFriendsList = function(contactList) {
        if (contactList) {
            if (contactList.length) {
                var validNumberList =  _.filter(contactList, function(contactObj) {
                    return validatePhoneNumber(contactObj.number);
                });

                //Now only return the unique number and remove the redundant..
                return _.uniqBy(validNumberList, 'number');
            }
        }

        return [];
    };


    //True if the data is correct..
    var validatePhoneNumber = function(number) {
        var patt = /^\+?[0-9]{10,12}$/;
        return patt.test(number);
    };




    //add RecurrenceRule
    //Will run at every 12
    var addRecurrenceRule = function() {
        var rule = new schedule.RecurrenceRule();
        rule.hour = packageObj.alarmManager.dailyHour || 0;
        rule.minute = packageObj.alarmManager.dailyMinutes || 1;


        //Run job every this hour..
        var job = schedule.scheduleJob(rule, function() {
            console.info("waking up to check tomorrow events..");
            //Found all those allowed events which gonna happen tomorrow. and send an push message to those users..
            var Track = databaseObj.Track;
            var today = moment();
            var tomorrow = moment(moment()).add(1, 'days');
            var where = {
                "type": "event",
                "status": "allow",
                "eventDate": {
                    between: [today, tomorrow]
                }
            };

            var fields = {
                customerId: true,
                friends: true,
                name: true
            };

            Track.find({
                where: where,
                fields: fields
            })
                .then(function(values) {
                    if (values) {
                        if (values.length) {
                        	if(values.customerId)
                            remindUser(values, values.customerId);
                        }
                    }

                })
                .catch(function(err) {
                    //Log error occured..
                    console.error(err);
                });
        });

    };


    //Format data before saving..
    var formatData = function(data) {
        if (data.name) {
            data.name = capitalizeEachWord(data.name).trim();
        }

        if (data.description) {
            data.description = data.description.toLowerCase().trim();
        }

        if (data.isPublic) {
            data.isPublic = data.isPublic.toLowerCase().trim();
        }


        if (data.address) {
            data.address = data.address.toLowerCase().trim();
        }


        if (data.type) {
            data.type = data.type.toLowerCase().trim();
        }

        if (data.status) {
            data.status = data.status.toLowerCase().trim();
        }


        if (data.friends) {
            if (data.friends.length) {
                if (data.isPublic === "public" && data.type === "location") {
                    //clear the list..
                    data.friends = [];
                }

                //Now format number..
                data.friends.forEach(function(numberObj, index){
                    if(numberObj.number){
                        data.friends[index].number = formatNumber(numberObj.number);
                    }

                });
            }
        }
    };




    var remindUser = function(eventsList, ownerId) {
        eventsList.forEach(function(event) {
            var eventName = event.name;
            //Now get the friends list from the friends object list..
            //[{number: "8955674434"}] =>> [8955674437]
            var numberList = _.map(event.friends, 'number');

            //Now send message to users..
            sendPushMessage(eventName, numberList, ownerId);
        });
    };




    //Adding Tracking Route code ..
    var addTrackingCodeRoute = function() {
        server.get("/" + trackPath + '/:trackingCode', function(req, res) {
            var code = req.params.trackingCode;
            //Found all those allowed events which gonna happen tomorrow. and send an push message to those users..
            var Track = databaseObj.Track;
            var where = {
                "uniqueCode": code
            };
            var data = {};

            Track.find({
                    where: where
                })
                .then(function(values) {

                    if (values) {
                        if (values.length) {
                            var event = values[0];

                            if(event.geolocation){
                                data.lat = event.geolocation.lat;
                                data.lng = event.geolocation.lng;
                            }else{
                                data.lat = 0;
                                data.lng = 0;
                            }
                            res.render(__dirname + '/track/track', data);
                        }else{
                            data.lat = 0;
                            data.lng = 0;
                            res.render(__dirname + '/track/track', data);
                        }
                    }else{
                        data.lat = 0;
                        data.lng = 0;
                        res.render(__dirname + '/track/track', data);
                    }

                })
                .catch(function(err) {
                    //Log error occured..
                    console.error(err);
                    data.lat = 0;
                    data.lng = 0;
                    res.render(__dirname + '/track/track', data);
                });

        });
    };


    //generate 7 digits random digits..for tracking code..
    var generateRandomDigits = function() {
        return Math.floor(1000000 + Math.random() * 9000000);
    };





    var sendPushMessage = function(eventName, sharedUsers, ownerId) {
        if (eventName) {
            var message = capitalizeEachWord(eventName) + " event is going to happen tomorrow.";
            //Now find the customers related to given phone number
            var Customer = databaseObj.Customer;
            var fields = {
                registrationId: true
            };
            var where = {};
            if (sharedUsers) {
                if (sharedUsers.length) {
                    where.phoneNumber = {
                        inq: sharedUsers
                    };
                }
            }

            if (ownerId) {
                where.or = [];
                where.or.push({
                    id: ownerId
                });
            }

            Customer.find({
                where: where,
                fields: fields
            })
                .then(function(registrationIdList) {
                    //Now send push message to the users..
                    if (registrationIdList) {
                        registrationIdList.forEach(function(registrationIdObj) {
                            if (registrationIdObj.registrationId) {
                                //send push message
                                push(server, message, registrationIdObj.registrationId, from, function(err) {
                                    if (err) {
                                        //Log this error..
                                        console.error(err);
                                    }
                                });
                            }
                        });
                    }
                })
                .catch(function(err) {
                    //Log error
                    console.error(err);
                });
        }
    };





    var capitalize = function(text) {
        if (text) {
            if (text.length === 1) {
                return text.toUpperCase();
            } else {
                return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
            }
        }
    };


    function capitalizeEachWord(str) {
        var words = str.split(" ");
        var arr = [];
        for (var i in words) {
            var temp = words[i].toLowerCase();
            temp = temp.charAt(0).toUpperCase() + temp.substring(1);
            arr.push(temp);
        }
        return arr.join(" ");
    }


    //return all the methods that you wish to provide user to extend this plugin.
    return {
        init: init
    }
}; //module.exports