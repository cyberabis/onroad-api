// BASE SETUP
// =============================================================================

// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var https = require('https');
var azure = require('azure');
var client = require('twilio')('AC2b02ea2ccb0064fa38476bced2fdeebe', process.env.TWILIO_KEY);
var Firebase = require("firebase");
var uuid = require('node-uuid');

var port = process.env.PORT || 3000;        // set our port

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

//Firebase configration
var alert_mobile = 9886165860;
var myFirebaseRef = new Firebase("https://logbasedev.firebaseio.com/");
myFirebaseRef.child("account/simplelogin:2/mobile").on("value", function(snapshot) {
  	alert_mobile = snapshot.val();
  	console.log('Alert Mobile updated to: ' + alert_mobile);
});
var alertsCount;
var alertsFb = myFirebaseRef.child('/account/simplelogin:2/alerts');
alertsFb.once("value", function(snapshot) {
  console.log("Alerts count: ", snapshot.val().length);
  alertsCount = snapshot.val().length - 1;
});
//Firebase config ends

//For distance calc
var la1 = null;
var lo1 = null;
var la2 = null;
var lo2 = null;
var distance = 0.0;


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
	//send_alert(devicename, alert_type, data);
	send_alert_to_fb(devicename, alert_type, data);
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

function calc_distance(lat1, lon1, lat2, lon2, unit) {
	var radlat1 = Math.PI * lat1/180
	var radlat2 = Math.PI * lat2/180
	var radlon1 = Math.PI * lon1/180
	var radlon2 = Math.PI * lon2/180
	var theta = lon1-lon2
	var radtheta = Math.PI * theta/180
	var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
	dist = Math.acos(dist)
	dist = dist * 180/Math.PI
	dist = dist * 60 * 1.1515
	if (unit=='K') { dist = dist * 1.609344 }
	if (unit=='N') { dist = dist * 0.8684 }
	return dist
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
		if(la1 == null) {
			console.log('Setting lalo1s');
			la1 = recent_location.lat;
			lo1 = recent_location.long;
		} else {
			console.log('Setting lalo1s');
			la2 = recent_location.lat;
			lo2 = recent_location.long;
			var new_dist = calc_distance(la1, lo1, la2, lo2, 'K');
			la1 = la2;
			lo1 = lo2;
			console.log('New distance covered: ' + new_dist);
			if (new_dist > 0) {
				distance = distance + new_dist;
				distance = Math.round(distance * 100) / 100;
				var live_distance = myFirebaseRef.child('/account/simplelogin:2');
				live_distance.update({
					'distance': distance
				});
			}
		}
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
};

//Main function to send alert to fb 
function send_alert_to_fb(devicename, alert_type, data) {
	var parsed_data = parse_data(devicename, data, 'nofilter');
	var recent_location = parsed_data[parsed_data.length - 1];
	var alert_obj = {location: recent_location, alert:alert_type};
	alertsCount = alertsCount + 1;
	var alerts = myFirebaseRef.child('/account/simplelogin:2/alerts/' + alertsCount);
	alerts.set({
	  alertid: uuid.v1(),
	  alerttype: alert_obj.alert,
	  devicenumber: devicename,
	  latitude: alert_obj.location.lat,
	  longitude: alert_obj.location.long,
	  status: 'Open',
	  time: alert_obj.location.time
	});
	send_sms(alert_obj);
};