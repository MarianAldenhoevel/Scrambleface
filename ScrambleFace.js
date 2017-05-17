// *********************************************************
// ScrambleFace Node.js-powered web application
// *********************************************************

var package_json = require("./package.json");

// Does the user ask for the version string? If so report it and just quit.
// This is here to mimic standard behaviour of various applications and not
// require parsing of package.json by interested parties.
process.argv.forEach(function (val, index, array) {
    if (val.substring(0, 2) == "--") {
        val = val.substring(2);
    }

    if ((val.substring(0, 1) == "-") || (val.substring(0, 1) == "/")) {
        val = val.substring(1);
    }

    val = val.toLowerCase();

    if ((val == "v") || (val == "version")) {
        console.log(package_json.version);
        process.exit(code = 0);
    }
});

// Set up logging.
var log4js = require("log4js");
log4js_config = require("./config/log4js.json");
log4js.configure(log4js_config);
var logger = log4js.getLogger("Main");

// Set up other dependencies.
var helmet = require("helmet");
var compression = require("compression");
var express = require("express");
var fileUpload = require('express-fileupload');
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
var uuidV4 = require("uuid/v4");
var gm = require("gm").subClass({ imageMagick: true });
var config = require("config").config;
var Faced = require('faced');
var faced = new Faced();

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

config.datadir = config.datadir || path.join(__dirname, "data");
logger.info("datadir = \"" + config.datadir + "\".");
fs.mkdirpSync(config.datadir);

config.incomingdir = config.incomingdir || path.join(config.datadir, "incoming");
fs.mkdirpSync(config.incomingdir);

config.dbdir = config.dbdir || path.join(config.datadir, "db");
fs.mkdirpSync(config.dbdir);

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

app.use(fileUpload());

function createModel(req, err) {
    var model = {
        "err": err,
        "site": config.site || {},
    };

    model.site.version = package_json.version;

    return model;
}

app.get("/", function (req, res) {
    res.redirect("index");
});

function serveErr(req, res, err) {
    logger.error(err);
    return res.status(500).send(err.toString());
}

function processorError(file, err) {
    var result = err;
    if (!(result instanceof Error)) {
        result = new Error(err);
        logger.error(result);
    }
    result.file = file;
    return result;
}

function checkFeature(file, face, featureName) {
    if ((!face[featureName]) || (face[featureName].length == 0)) {
        return processorError(file, featureName + " not found");
    } else if (face[featureName].length > 1) {
        return processorError(file, featureName + " found multiple times");
    } else {
        // great!
        return null;
    }
}

function processupload(file) {

    var ops = new Promise(function (resolve, reject) {
        // Create a unique ID for the file and save it
        // to the incoming folder unchanged.
        file.id = uuidV4();
        var filename = path.join(config.incomingdir, file.id);
        logger.trace(file.name + " - saving to \"" + filename + "\"");

        // Create an object with the metadata only.
        var filemetadata = Object.assign({}, file);
        delete filemetadata.data;

        // Save metadata
        fs.writeFile(filename + ".meta.json", JSON.stringify(filemetadata, null, 4), function (err) {
            if (err) {
                throw processorError(file, err);
            } else {
                // Save image data
                file.mv(filename, function (err) {
                    if (err) {
                        reject(processorError(file, err));
                    } else {
                        resolve(file);
                    }
                })
            }
        })
    });
    ops = ops.then(function (file) {
        // Read image using gm for preprocessing it before we
        // attempt face-detection.
        return new Promise(function (resolve, reject) {
            logger.trace(file.name + " - read");
            file.img = gm(file.data, file.name);
            logger.trace(file.name + " - identify");
            file.img.identify(function (err, data) {
                if (err) {
                    reject(processorError(file, "File not identified as image"));
                } else {
                    logger.trace(data);
                    file.identify = data;
                    resolve(file);
                }
            });
        });
    });
    ops = ops.then(function (file) {
        // Create folder for this uploaded image and all subordinate
        // files created from it.
        return new Promise(function (resolve, reject) {
            file.dirname = path.join(config.datadir, file.id);
            logger.trace(file.name + " - create folder \"" + file.dirname + "\"");

            fs.mkdirp(file.dirname, function (err) {
                if (err) {
                    reject(processorError(file, err));
                } else {
                    resolve(file);
                }
            })
        })
    });
    ops = ops.then(function (file) {
        // Preprocess image if required and save to the folder. This has to happen even
        // if nothing has actually happened in pre-processing because
        // face-detection will read that file.
        return new Promise(function (resolve, reject) {

            // Preprocessing:
            // Note: All this does is set up a command-line for imageMagick. So it
            // can be synchronously called and will take almost no time.
            // file.img.resize(256) // resize to fixed width

            file.preprocessed = path.join(file.dirname, "preprocessed.jpg");
            logger.trace(file.name + " - write preprocessed image to \"" + file.preprocessed + "\"");

            file.img.write(file.preprocessed, function (err) {
                if (err) {
                    reject(processorError(file, err));
                } else {
                    resolve(file);
                }
            })
        })
    });
    ops = ops.then(function (file) {
        // Attempt face-detection
        return new Promise(function (resolve, reject) {
            logger.trace(file.name + " - face detection");
            faced.detect(file.preprocessed, function (faces, matrix, filename) {

                // Have we detected exactly one face?
                if ((!faces) || (faces.length == 0)) {
                    reject(processorError(file, "No faces found"));
                } else if (faces.length > 1) {
                    reject(processorError(file, "Multiple faces found"));
                } else {
                    // Get single face detected. Have we got all the features we want.
                    var face = faces[0];
                    logger.trace(face);

                    if (r = checkFeature(file, face, "mouth")) reject(r);
                    else if (r = checkFeature(file, face, "nose")) reject(r);
                    else if (r = checkFeature(file, face, "eyeLeft")) reject(r);
                    else if (r = checkFeature(file, face, "eyeRight")) reject(r);
                    else {
                        // still here? We got a full-featured face.
                        file.face = face;
                        file.matrix = matrix;
                        resolve(file);
                    }
                }
            })
        })
    });
    if (config.saveMarkedFeatures) {
        ops = ops.then(function (file) {
            // Decorate the image marking the features that we detected.
            // (Nothing async here, so not a new promise with resolve, but a simple return)
            logger.trace(file.name + " - mark features");

            var colors = {
                "face": [0, 0, 0],
                "mouth": [255, 0, 0],
                "nose": [255, 255, 255],
                "eyeLeft": [0, 0, 255],
                "eyeRight": [0, 255, 0]
            };

            function draw(feature, color) {
                file.matrix.rectangle(
                    [feature.getX(), feature.getY()],
                    [feature.getWidth(), feature.getHeight()],
                    color,
                    2
                );
            }

            draw(file.face, colors.face);
            draw(file.face.mouth[0], colors.mouth);
            draw(file.face.nose[0], colors.nose);
            draw(file.face.eyeLeft[0], colors.eyeLeft);
            draw(file.face.eyeRight[0], colors.eyeRight);

            var filename = path.join(file.dirname, "features.jpg");
            logger.trace(file.name + " - write image with marked features to \"" + filename + "\"");

            file.matrix.save(filename);
            return (file);
        })
    }
    ops = ops.then(function (file) {
        // Crop preprocessed image to the actual face, scale it to the
        // actual dimensions of the target screen and save that to the folder.
        // Note that this may distort the face that was detected by coercing it
        // to the aspect ratio of the screen. We accept that because we want 
        // the faces to match anyway.
        return new Promise(function (resolve, reject) {
            file.img.crop(file.face.width, file.face.height, file.face.x, file.face.y)
            file.img.resize(
                config.screen.tilesHorizontal * config.screen.tilePixelHorizontal,
                config.screen.tilesVertical * config.screen.tilePixelVertical, "!");

            file.justface = path.join(file.dirname, "face.jpg");
            logger.trace(file.name + " - write cropped and resized face image to \"" + file.justface + "\"");

            file.img.write(file.justface, function (err) {
                if (err) {
                    reject(processorError(file, err));
                } else {
                    resolve(file);
                }
            })
        })
    });
    ops = ops.then(function (file) {
        // Cut the saved face into tiles and save each.
        var tiles = [];

        for (var x = 0; x < config.screen.tilesHorizontal; x++) {
            for (var y = 0; y < config.screen.tilesVertical; y++) {
                tiles.push(new Promise(function (resolve, reject) {
                    var tilename = path.join(file.dirname, "tile_" + x + "_" + y + ".jpg");
                    logger.trace(file.name + " - write tile (" + x + "," + y + ") to \"" + tilename + "\"");
                    gm(file.justface)
                        .crop(config.screen.tilePixelHorizontal, config.screen.tilePixelVertical, x * config.screen.tilePixelHorizontal, y * config.screen.tilePixelVertical)
                        .write(tilename, function (err) {
                            if (err) {
                                reject(processorError(file, err));
                            } else {
                                resolve(file);
                            }
                        })
                }))
            }
        }

        return Promise.all(tiles).then(function (result) { return file; });
    });
    ops = ops.then(function (file) {
        logger.trace(file.name + " - done");
        return (file);
    });

    return ops;
}

function reflect(promise) {
    return promise
        .then(function (result) {
            return { "status": "resolved", "file": result }
        })
        .catch(function (error) {
            var file = error.file;
            delete error.file;
            return { "status": "rejected", "file": file, "error": error };
        })
}

app.post('/upload', function (req, res) {

    var fileprocessors = [];

    for (var prop in req.files) {
        if (req.files.hasOwnProperty(prop)) {
            // might be a file object...
            var file = req.files[prop];

            if (file.name && file.data) {
                fileprocessors.push(reflect(processupload(file)));
            }
        }
    }

    if (fileprocessors.length == 0) {
        return res.status(500).send('No files were uploaded.');
    } else {

        // Resolve all processors. As they are all reflected we can be certain they
        // resolve and never reject.
        Promise.all(fileprocessors).then(function (results) {
            var response = [];
            var responseOK = true;

            for (var i = 0; i < results.length; i++) {
                var result = results[i];

                var entry = {
                    "name": result.file.name,
                    "id": result.file.id
                }

                if (result.status != "resolved") {
                    if (result.error.message) {
                        entry.error = result.error.message;
                    } else {
                        entry.error = result.error;
                    }
                    responseOK = false;
                }

                response.push(entry);

            };

            return res.status(responseOK ? 200 : 500).send(JSON.stringify(response, null, 4));
        });
    }
});

app.get("/:viewname", function (req, res) {
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
