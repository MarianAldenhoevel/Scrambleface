// *********************************************************
// ScrambleFace Node.js-powered web application
// *********************************************************

var package_json = require("./package.json");

// Does the user ask for the version string? If so report it and just quit.
// This is here to mimic standard behaviour of various applications and not
// require parsing of package.json by interested parties.
process.argv.forEach(function (val, index, array) {
  if (val.substring(0, 2) == "--")
  {
    val = val.substring(2);
  }
  
  if ((val.substring(0, 1) == "-") || (val.substring(0, 1) == "/"))
  {
    val = val.substring(1);
  } 
  
  val = val.toLowerCase();
  
  if ((val == "v") || (val == "version"))
  {
    console.log(package_json.version);
    process.exit(code=0);
  }
});

// Set up logging
var log4js = require("log4js");
log4js_config = require("./config/log4js.json");
log4js.configure(log4js_config);
var logger = log4js.getLogger("Main");

var helmet = require("helmet");
var compression = require("compression");
var express = require("express");
var morgan = require("morgan");
var body_parser = require("body-parser");
var favicon = require("serve-favicon");
var serve_static = require("serve-static")                                           
var ejs = require("ejs");
var http = require("http");
var https = require("https");
var path = require("path");
var templateengine = require("ejs-locals");
var fs = require("fs.extra");
var querystring = require("querystring");

var config = require("config").config;
          
var app = express();

// compression requested?
if (config.http.compression) {
	app.use(compression());
	logger.info("Will compress http responses.");
} else {
	logger.info("Compression of http responses is disabled.");
}

if (config.log4js && config.log4js.capture_connect) {
	app.use(log4js.connectLogger(log4js.getLogger("Connect"), { level: "auto" }));
}

app.engine("ejs", templateengine);
app.set("views", path.join(__dirname, "/resources/views"));        
app.set("view engine", "ejs"); 

app.use(morgan("dev"));

app.use(favicon("resources/static/img/favicon.png"));

// Implement various anti-attack-headers. See https://www.npmjs.org/package/helmet
app.use(helmet.frameguard({ action: "SAMEORIGIN" }));
app.use(helmet.xssFilter()); // (X-XSS-Protection for IE8+;
app.use(helmet.ieNoOpen()); // (X-Download-Options for IE8+)
app.use(helmet.noSniff()); // (X-Content-Type-Options)
app.use(helmet.hidePoweredBy()); // (remove X-Powered-By)

var oneYear = 31557600000;
app.use(serve_static(path.join(__dirname, "resources/static"), { maxAge: oneYear }));

app.use(body_parser.json());
app.use(body_parser.urlencoded({ extended: true }));

function createModel(req, err) {
    var model = {
        "err": err,
        "site": config.site || {},
    };

    model.site.version = package_json.version;

    return model;
}

app.get("/", function(req, res) {
    res.redirect("index");
});

app.get("/:viewname", function(req, res) {
    res.render(req.params.viewname, createModel(req));
});

// called after a view has been rendered.
function rendered(req, res, err, data) {
	req.error = null;
	if (err) {
		return req.next(err)
	} else { 
		res.send(data);
	}
}

http.createServer(app).listen(config.http.port, function () {
    logger.info("ScrambleFace http server " + package_json.version + " listening on port " + config.http.port);
});
	