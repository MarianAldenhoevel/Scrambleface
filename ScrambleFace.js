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
var sqlite3 = require('sqlite3').verbose();
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

var db = new sqlite3.Database(path.join(config.dbdir, "data.db"));

// Encapsulate a SQLite DDL-Statement as promise.
function dbRunDDL(file, sql, params) {
    return new Promise(function (resolve, reject) {
        logger.trace("dbRunDDL():\n" + sql + (params ? ("\n" + JSON.stringify(params, null, 4)) : ""));

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(file);
            }
        })
    })
}

// Encapsulate a SQLite DML-Statement as promise.
function dbRunDML(file, sql, params) {
    return new Promise(function (resolve, reject) {
        logger.trace("dbRunDML():\n" + sql + (params ? ("\n" + JSON.stringify(params, null, 4)) : ""));

        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(file);
            }
        })
    })
}

// Encapsulate a SQLite SELECT-Statement as promise.
function dbRunSELECT(sql, params) {
    return new Promise(function (resolve, reject) {
        logger.trace("dbRunSELECT():\n" + sql + (params ? ("\n" + JSON.stringify(params, null, 4)) : ""));

        db.all(sql, params, function (err, rows) {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        })
    })
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

app.use(fileUpload());

function createModel(req, err) {
    var model = {
        "err": err,
        "site": config.site || {},
        "screen": config.screen
    };

    model.site.version = package_json.version;

    return model;
}

app.get("/", function (req, res) {
    res.redirect("index");
});

function serveErr(req, res, err) {
    logger.error(err);
    res.setHeader("Content-Type", "application/json");
    return res
        .status(500)
        .send({ "message": err.message });
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
        // Insert the metadata for this upload into the DB to make it available for list operations.
        return dbRunDML(file,
            "INSERT INTO images (id, name, uploadtime) VALUES ($id, $name, $uploadtime)",
            { "$id": file.id, "$name": file.name, "$uploadtime": new Date().getTime() });
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
    logger.trace("/upload");

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
        res.setHeader("Content-Type", "text/plain");
        return res
            .status(500)
            .send('No files were uploaded.');
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

            res.setHeader("Content-Type", "application/json");
            return res.status(responseOK ? 200 : 500).send(JSON.stringify(response, null, 4));
        });
    }
});

app.get('/faces', function (req, res) {
    logger.trace("/faces");

    pageindex = req.query.pageindex || 0;
    pagesize = req.query.pagesize || 100;
    if (pagesize > 100) {
        serveErr(req, res, "Pagesize is limited to 100 entries.");
    } else {
        dbRunSELECT(
            "SELECT * FROM images ORDER BY uploadtime LIMIT $limit OFFSET $offset",
            { "$limit": pagesize, "$offset": pagesize * pageindex }).then(function (rows) {
                res.setHeader("Content-Type", "application/json");
                return res
                    .status(200)
                    .send(JSON.stringify(rows, null, 4));
            }).catch(function (err) {
                serveErr(req, res, err);
            })
    }
});

app.get('/face', function (req, res) {
    logger.trace("/face");

    function serveImage(id) {
        var filename = path.join(config.datadir, id, "face.jpg");

        if (fs.existsSync(filename)) {
            res.sendFile(filename);
        } else {
            serveErr(req, res, new Error("Image not found"));
        }
    };

    id = req.query.id
    if (!id) {
        // return a random image
        dbRunSELECT("SELECT id FROM images ORDER BY RANDOM() LIMIT 1").then(function (rows) {
            if (rows.length == 0) {
                serveErr(req, res, new Error("No images"));
            } else {
                serveImage(rows[0].id);
            }
        })
    } else {
        // return the selected full image.
        serveImage(id);
    }
});

function clamp(val, min, max) {
    if (val < min) {
        return min;
    } else if (val > max) {
        return max;
    } else {
        return val;
    }
}

function rand(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
}

app.get('/tile', function (req, res) {
    logger.trace("/tile");

    function serveTile(id, x, y) {
        var filename = path.join(config.datadir, id, "tile_" + x + "_" + y + ".jpg");

        if (fs.existsSync(filename)) {
            res.sendFile(filename);
        } else {
            serveErr(req, res, new Error("Image not found"));
        }
    };

    id = req.query.id;
    x = clamp(req.query.x || rand(0, config.screen.tilesHorizontal) , 0, config.screen.tilesHorizontal - 1);
    y = clamp(req.query.y || rand(0, config.screen.tilesVertical), 0, config.screen.tilesVertical - 1);

    if (!id) {
        // return a random image
        dbRunSELECT("SELECT id FROM images ORDER BY RANDOM() LIMIT 1").then(function (rows) {
            if (rows.length == 0) {
                serveErr(req, res, new Error("No images"));
            } else {
                serveTile(rows[0].id, x, y);
            }
        })
    } else {
        // return the selected full image.
        serveTile(id, x, y);
    }
});

app.get("/site", function (req, res) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify(createModel(req), null, 4));
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

// Set up database
logger.trace("Setting up DB");

var db = new sqlite3.Database(path.join(config.dbdir, "data.db"));
var ops = dbRunDDL(db, "CREATE TABLE IF NOT EXISTS images (id VARCHAR(40) PRIMARY KEY, uploadtime TIMESTAMP, name VARCHAR(200))");
ops = ops.then(function (db) { dbRunDDL(db, "CREATE INDEX IF NOT EXISTS ix_images_uploadtime ON images (uploadtime)") });
ops = ops.then(function (db) {

    logger.trace("DB is ready");

    http.createServer(app).listen(config.http.port, function () {
        logger.info("ScrambleFace http server " + package_json.version + " listening on port " + config.http.port);
    });
})