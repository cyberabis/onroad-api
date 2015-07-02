// BASE SETUP
// =============================================================================

// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var https = require('https');
var crypto = require('crypto');
var moment = require('moment');
var azure = require('azure');
var client = require('twilio')('AC2b02ea2ccb0064fa38476bced2fdeebe', process.env.TWILIO_KEY);
var Firebase = require("firebase");

var port = process.env.PORT || 3000;        // set our port

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

//Eventhubs Configs
var namespace = 'onroad-ns';
var hubname = 'onroad';
var my_key_name = 'SendRule';
var my_key = process.env.EVENTHUBS_KEY;
//Eventhubs config ends

//Servicebus Topic Configs
var ns_key = process.env.NS_KEY;
var serviceBusService = azure.createServiceBusService('Endpoint=sb://'+ namespace + '.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=' + ns_key);
var topicName = 'onroad-topic';
var alertTopicName = 'onroad-alerts';
//Service Topic Config ends

//Firebase configration
var alert_mobile = 9886165860;
var myFirebaseRef = new Firebase("https://logbasedev.firebaseio.com/");
myFirebaseRef.child("account/simplelogin:2/mobile").on("value", function(snapshot) {
  	alert_mobile = snapshot.val();
  	console.log('Alert Mobile updated to: ' + alert_mobile);
});
//Firebase config ends

// Route
router.get('/location/:devicename', function(req, res) {
	var data = req.query.data;
	var devicename = req.params.devicename;
	//send_to_eventhubs(devicename, data);
	//send_to_topic(devicename, data);
	send_loc_to_fb(devicename, data);
    res.status(200).end();   
});
router.get('/alert/:type/:devicename', function(req, res) {
	var data = req.query.data;
	var devicename = req.params.devicename;
	var alert_type = req.params.type;
	send_alert(devicename, alert_type, data);
    res.status(200).end();   
});

// more routes for our API will happen here

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/api', router);

// START THE SERVER
// =============================================================================
app.listen(port);
console.log('Started on port ' + port);



// APP SPECIFIC FUNCTIONS
// =============================================================================

//SAS token processing
function create_sas_token(uri, key_name, key) {
    // Token expires in one hour
    var expiry = moment().add(1, 'hours').unix();
    var string_to_sign = encodeURIComponent(uri) + '\n' + expiry;
    var hmac = crypto.createHmac('sha256', key);
    hmac.update(string_to_sign);
    var signature = hmac.digest('base64');
    var token = 'SharedAccessSignature sr=' + encodeURIComponent(uri) + '&sig=' + encodeURIComponent(signature) + '&se=' + expiry + '&skn=' + key_name;
    return token;
};

//Data parser
function convert(latitude, longitude){
	// convert latitude from minutes to decimal
	degrees = Math.floor(latitude / 100);
	minutes = latitude - (100 * degrees);
	minutes /= 60;
	degrees += minutes;
	//turn direction into + or -
	// if (latdir[0] == 'S') degrees *= -1;
	lat = degrees;
	//convert longitude from minutes to decimal
	degrees = Math.floor(longitude / 100);
	minutes = longitude - (100 * degrees);
	minutes /= 60;
	degrees += minutes;
	//turn direction into + or -
	//if (longdir[0] == 'W') degrees *= -1;
	lon = degrees;
	return [lat, lon];
}

function parse_data(devicename, data, condition) {
	//TODO data needs to changed to parsed_data
	//As JSON
	//data = '0,1101.444401,7700.254386,243.095589,20150629101258.011,0,0,0.000000,0.000000';
	//Chop last char
	console.log('Raw data: ' + data);
	data = data.substring(0, data.length - 1);
	var events = data.split('$');
	var parsed_data = [];
	for(var i in events) {
		var fields = events[i].split(',');
		var tsInput = fields[4];
		var match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}).(\d{3})$/.exec(tsInput);
		var ts = match[1] + '-' + match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5] + ':' + match[6] + '.' + match[7];
		var ttff = parseInt(fields[5]);
		var latlong = convert(parseFloat(fields[1]),parseFloat(fields[2]));
		if (((condition === 'filter') && (ttff > 0)) || (condition === 'nofilter')) {
			var eventObj = {
				device: devicename,
				lat: latlong[0],
				long: latlong[1],
				time: Date.parse(ts),
				speed: parseFloat(fields[7])
			};
			parsed_data.push(eventObj);
		}
	}
	console.log('Parsed Data: ' + JSON.stringify(parsed_data));
	//parsed_data = [{device: 'deviceid', lat: 11.0, long:77.0, time: 1435572381, speed:50.5}];
	return parsed_data;
};

//Main function to send to service bus topic
function send_to_topic(devicename, data) {
	var parsed_data = parse_data(devicename, data, 'filter');
	if(parsed_data.length > 0) {
		var payload = JSON.stringify(parsed_data);
		serviceBusService.sendTopicMessage(topicName, payload, function(error) {
		  if(!error) {
		    // Message sent
		    console.log('Message sent');
		  } else {
		  	console.log('Unable to send message: ' + error);
		  }
		}); 
	}
};

//Main function to send location tp firebase
function send_loc_to_fb(devicename, data) {
	var parsed_data = parse_data(devicename, data, 'filter');
	if(parsed_data.length > 0) {
		var recent_location = parsed_data[parsed_data.length - 1];
		var live_car = myFirebaseRef.child('/account/simplelogin:2/livecars/0');
		live_car.update({
			'latitude': recent_location.lat,
			'longitude': recent_location.long,
			'locationtime': recent_location.time,
			'devicenumber': devicename
		});
		/*
		var payload = JSON.stringify(parsed_data);
		serviceBusService.sendTopicMessage(topicName, payload, function(error) {
		  if(!error) {
		    // Message sent
		    console.log('Message sent');
		  } else {
		  	console.log('Unable to send message: ' + error);
		  }
		});
		*/ 
	}
};

function send_sms(alert){
	var msg = 'Alert received from car #555';
	if (alert.alert === 'panic')
		msg = 'Panic alert received from car #555';
	else if(alert.alert === 'unplugged')
		msg = 'Device unplugged from car #555';
	else if(alert.alert === 'plugged')
		msg = 'Device plugged into car #555';
	//Send an SMS text message
	console.log('Going to alert mobile: ' + alert_mobile);
	client.sendMessage({
	    to:'+91' + alert_mobile, // Any number Twilio can deliver to
	    from: '+16508648755', // A number you bought from Twilio and can use for outbound communication
	    body: msg // body of the SMS message
	}, function(err, responseData) { //this function is executed when a response is received from Twilio
	    if (!err) { // "err" is an error received during the request, if any
	        // "responseData" is a JavaScript object containing data received from Twilio.
	        // A sample response from sending an SMS message is here (click "JSON" to see how the data appears in JavaScript):
	        // http://www.twilio.com/docs/api/rest/sending-sms#example-1
	        console.log('Twilio sent msg from: '+ responseData.from); // outputs sender number
	        console.log('SMS sent: ' + responseData.body); // outputs message
	    }
	});
	/*
	client.sendMessage({
	    to:'+91' + '9791879840', // Any number Twilio can deliver to
	    from: '+16508648755', // A number you bought from Twilio and can use for outbound communication
	    body: msg // body of the SMS message
	}, function(err, responseData) { //this function is executed when a response is received from Twilio
	    if (!err) { // "err" is an error received during the request, if any
	        // "responseData" is a JavaScript object containing data received from Twilio.
	        // A sample response from sending an SMS message is here (click "JSON" to see how the data appears in JavaScript):
	        // http://www.twilio.com/docs/api/rest/sending-sms#example-1
	        console.log('Twilio sent msg from: '+ responseData.from); // outputs sender number
	        console.log('SMS sent: ' + responseData.body); // outputs message
	    }
	});
	client.sendMessage({
	    to:'+91' + '9886165860', // Any number Twilio can deliver to
	    from: '+16508648755', // A number you bought from Twilio and can use for outbound communication
	    body: msg // body of the SMS message
	}, function(err, responseData) { //this function is executed when a response is received from Twilio
	    if (!err) { // "err" is an error received during the request, if any
	        // "responseData" is a JavaScript object containing data received from Twilio.
	        // A sample response from sending an SMS message is here (click "JSON" to see how the data appears in JavaScript):
	        // http://www.twilio.com/docs/api/rest/sending-sms#example-1
	        console.log('Twilio sent msg from: '+ responseData.from); // outputs sender number
	        console.log('SMS sent: ' + responseData.body); // outputs message
	    }
	});
	client.sendMessage({
	    to:'+91' + '9677666498', // Any number Twilio can deliver to
	    from: '+16508648755', // A number you bought from Twilio and can use for outbound communication
	    body: msg // body of the SMS message
	}, function(err, responseData) { //this function is executed when a response is received from Twilio
	    if (!err) { // "err" is an error received during the request, if any
	        // "responseData" is a JavaScript object containing data received from Twilio.
	        // A sample response from sending an SMS message is here (click "JSON" to see how the data appears in JavaScript):
	        // http://www.twilio.com/docs/api/rest/sending-sms#example-1
	        console.log('Twilio sent msg from: '+ responseData.from); // outputs sender number
	        console.log('SMS sent: ' + responseData.body); // outputs message
	    }
	});
*/
};

//Main function to send to service bus alert 
function send_alert(devicename, alert_type, data) {
	var parsed_data = parse_data(devicename, data, 'nofilter');
	var alert_obj = {location: parsed_data, alert:alert_type};
	var payload = JSON.stringify(alert_obj);
	serviceBusService.sendTopicMessage(alertTopicName, payload, function(error) {
	  if(!error) {
	    // Message sent
	    console.log('Alert message sent: ' + payload);
	  } else {
	  	console.log('Unable to send alert message: ' + error);
	  }
	}); 
	send_sms(alert_obj);
};

//Main function to send to event hubs
/*
function send_to_eventhubs(devicename, data) {
	var parsed_data = parse_data(devicename, data);
	//TODO send only if TTFF > 0
	var payload = JSON.stringify(parsed_data);
	var my_uri = 'https://' + namespace + '.servicebus.windows.net' + '/' + hubname + '/publishers/' + devicename + '/messages';
	var my_sas = create_sas_token(my_uri, my_key_name, my_key);
	var options = {
	  hostname: namespace + '.servicebus.windows.net',
	  port: 443,
	  path: '/' + hubname + '/publishers/' + devicename + '/messages',
	  method: 'POST',
	  headers: {
	    'Authorization': my_sas,
	    'Content-Length': payload.length,
	    'Content-Type': 'application/atom+xml;type=entry;charset=utf-8'
	  }
	};
	var request = https.request(options, function(response) {
	  console.log("EventHubs response statusCode (201 is good): ", response.statusCode);
	});
	request.on('error', function(e) {
	  console.error(e);
	});
	request.write(payload);
	request.end();
};
*/
