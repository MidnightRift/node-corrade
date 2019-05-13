const tls = require('tls');
const rl = require('readline');

const querystring = require('querystring');


const axios = require('axios');
const Promise = require('bluebird');


const ERRORS = require('./errors.js');

const auth = require('./models/authorization.js');
const helpers = require('./lib/helpers.js');
const logs = require('./lib/logs.js');

/**
 * Create an object that will interact with your corrade bot.
 * @class
 * @param {object} config - Configuration options needed to establish a TCP connection with the corrade bot.
 * @param {string} config.protocol - The protocol that you will use: http, https.
 * @param {string} config.host - fqdn hostname or ip where the corrade bot is.
 * @param {number} config.port - The port the tcp connection is on.
 * @param {string} config.group - Second Life group name.
 * @param {string} config.password - Second Life Corrade group password.
 * @param {array} config.types - array of notification types you will subscribe to.
 * @param {object} config.basicAuth - http basic auth credentials.
 * @param {string} config.basicAuth.user - http basis auth username.
 * @param {string} config.basicAuth.password - http basic auth password.

 * @example
 * let config = {};
 * config.host = 'bot.example.com';
 * config.protocol = 'https';
 * config.group = 'MyGroupHere';
 * config.password = 'SuperAwesomeStrongPassword';
 * config.basicAuth = {
 *     user: 'corrade',
 *     password: 'Somepassword'
 * };
 * config.port = 9000;
 * config.types = ['group', 'message', 'statistics'];
 *
 *
 * let Corrade = require('./corrade.js');
 * let corrade = new Corrade(config);
 */
function Corrade(config) {
    let _this = this;

    this.protocol = config.protocol;
    this.host = config.host;
    this.port = config.port;
    this.group = config.group;
    this.password = config.password;
    this.types = config.types;
    this.basicAuth = typeof config.basicAuth !== 'undefined' ? config.basicAuth : null;


    this.options = {
        host: config.host,
        port: config.port
        //      rejectUnauthorized: typeof obj.rejectUnauthorized !== 'undefined' ? obj.rejectUnauthorized : false
    };

    /**
     * Object containing registered modules.
     * @var {Object} REGISTERED_MODULES
     */
    this.REGISTERED_MODULES = {};
    this.INTERVALS = [];


    function handleReceivedLine(line) { // it is safe to have [Object: null prototype] in parsedData.
        let parsedDate = querystring.parse(line.replace(/\r?\n|\r/g, ''));

        let listeners = listenersByType[parsedDate.type];

        if (listeners) {
            listeners.forEach(function (item, index, arr) {
                item(parsedDate);
            });
        }
    }

    var corradeSocket;
    var rlInterface;

    /**
     * Establishes TCP connection with corrade.
     * @private
     * @memberOf Corrade
     * @returns {Object} - returns readline interface object that emits events.
     */

    function createSocket(options, group, password, types) {
        corradeSocket = tls.connect(options, function () {
            corradeSocket.write('group=' + group + '&password=' + password + '&type=' + types.toString() + '\r\n');
        });
        corradeSocket.setKeepAlive(true);
        corradeSocket.setEncoding('utf8');

        corradeSocket.on('end', function () {
            console.log('Fin');
        });

        corradeSocket.on('error', function (e) {
            // if (e &&
            //     e.errno === 'ECONNRESET' ||
            //     e.errno === 'ETIMEDOUT' ||
            //     e.errno === 'ENOTFOUND' ||
            //     e.errno === 'ENOENT') {
            //
            //     console.log('CONNECTION ERROR');
            // }
            console.log(e.Error, e.code, e.errno);
        });
        corradeSocket.on('close', function () {
            console.log((new Date()).toLocaleTimeString('en-US'), 'CONNECTION CLOSED: attempting to reestablish...');
            rlInterface.close();
            createSocket(_this.options, _this.group, _this.password, _this.types);
        });

        rlInterface = rl.createInterface(corradeSocket, corradeSocket);

        rlInterface.on('line', function (line) {
            handleReceivedLine(line);
        });


    }

    createSocket(this.options, this.group, this.password, this.types);


    let listenersByType = {};
    /**
     * corrade emit event.
     *
     * @event Corrade#line
     * @type {string}
     * @property {string} parsedDate - returns data that is emitted from the tcp Interface.
     */
    this.on = function (type, cb) {
        if (_this.types.indexOf(type) === -1) return cb(ERRORS[3] + ' type: ' + type);
        if (!listenersByType[type]) {
            listenersByType[type] = [];
        }
        listenersByType[type].push(cb);
    };

    /** @function Corrade~query
     *
     * @param {object} options - case specific options needed to send a http(s) query to corrade.
     * @param {boolean} autoEscape - querystring escape all contents of the options object.
     * @returns {Promise} parsedData - returns a promise object which will contain querystring parsed data, is csv format.
     *
     *
     * @example
     * corrade.query({
     *     command: 'tell',
     *     entity: 'avatar',
     *     agent: <agent uuid>,
     *     message: 'Some Text Here'
     * }, false)
     * */


    this.tcp_query = function (options, autoEscape) {
      if (autoEscape) {
        let keys = Object.keys(options);
        let len = keys.length;
        while (len--) {
          options[keys[len]] = querystring.escape(options[keys[len]]);
        }
      }

      options.group = _this.group;
      options.password = _this.password;

      corradeSocket.write(querystring.stringify(options)+'\r\n')
    };

    this.query = function (options, autoEscape) {

        if (autoEscape) {
            let keys = Object.keys(options);
            let len = keys.length;
            while (len--) {
                options[keys[len]] = querystring.escape(options[keys[len]]);
            }
        }

        options.group = _this.group;
        options.password = _this.password;

        let maybeBasicAuth = {};

        if (_this.basicAuth !== null) {
            maybeBasicAuth = {
                auth: {
                    username: _this.basicAuth.user,
                    password: _this.basicAuth.password
                }
            }
        }

        return axios.post(_this.protocol + '://' + _this.host, querystring.stringify(options), maybeBasicAuth
        ).then(function (res) {
            let parsedData = querystring.parse(res.data);

            if (!parsedData) {
                return Promise.reject(ERRORS[9]);
            }
            if (parsedData.success === 'False') {
                let errorMsg = {
                    code: ERRORS[10].code,
                    text: ERRORS[10].text + ' ERROR: ' + parsedData.error
                };

                return Promise.reject(errorMsg)
            }

            return Promise.resolve(parsedData);
        }, function (err) {
            console.log(err)
        })
    };


    /** @function Corrade~loadModules
     *
     * @param {array} modules - array of modules to load.
     * @param {array} authorizedRoles - array of authorized group roles from your second life group that have access to this module.
     * @param {array} allowedTypes - notification types this belongs to.
     *
     *
     * @example
     * corrade.loadModules([ban], ['Staff', 'Owners'], ['message']);
     * */
    this.loadModules = function (modules, authorizedRoles, allowedTypes) {

        modules.forEach(function (item, index, arr) {//TODO: add check to make sure modules dont have the same name.
            _this.REGISTERED_MODULES[item.name] = {
                authorizedRoles: Array.isArray(authorizedRoles) ? authorizedRoles : null,
                allowedTypes: Array.isArray(allowedTypes) ? allowedTypes : null,
                name: item.name,
                help: Array.isArray(authorizedRoles) ? item.help + ' | Restricted to: ' + authorizedRoles.join(', ') : item.help,
                func: item.func,
            };

        });


    };

    /** @function Corrade~runModule
     *
     * @param {string} moduleName - string name of the registered module.
     * @param {object} params - object of data for the module to run.
     * @returns {Promise} returns a promise object which will contain the data of the registered function after it runs.
     *
     *
     * @example
     * corrade.loadModules([ban], ['Staff', 'Owners'], ['message']);
     * */
    this.runModule = function (moduleName, params) {
        if (_this.REGISTERED_MODULES[moduleName].allowedTypes.indexOf(params.type) === -1 || _this.REGISTERED_MODULES[moduleName].allowedTypes === null) {
            return Promise.reject(ERRORS[8]);
        }

        if (_this.REGISTERED_MODULES[moduleName].authorizedRoles !== null) {
            return auth.isAuthorized(_this, _this.REGISTERED_MODULES[moduleName].authorizedRoles, params).then(function () {
                return _this.REGISTERED_MODULES[moduleName].func(_this, params);
            }, function (err) {
                _this.logs.append(err, 'access.log');
                return Promise.reject(ERRORS[7]);
            })

        } else {
            return _this.REGISTERED_MODULES[moduleName].func(_this, params);
        }
    };


    //this.isAuthorized = auth.isAuthorized;
    this.helpers = helpers;
    this.logs = logs;

    /** @function Corrade~corradeGetGroupMembersByName
     *
     * @param {array} arrayOfNames - array of legacy names or partial names.
     * @returns {Promise} returns a promise object which will contain a csv of names unless any one of the names do not match.
     *
     *
     * @example
     * corrade.corradeGetGroupMembersByName(['bunny','bob','sunny']).then(function (res) {
     *              //do things
     *          });
     * */
    this.corradeGetGroupMembersByName = function (arrayOfNames) {

        let len = arrayOfNames.length;

        let calls = [];
        for (let i = 0; i < len; ++i) {
            calls.push(_this.query({
                command: 'getmembers',
                sift: 'match,' + querystring.escape('(?i),?\\"([^\\",$]*' + arrayOfNames[i] + '[^\",$]*)\",?')
            }, false).then(function (res) {
                if (!res) return Promise.reject(ERRORS[2]);
                return res.data.replace(/["']/g, '');
            }));
        }

        return axios.all(calls).then(function (res) {

            res.forEach(function (item, index, arr) {
                if (!item) {
                    arr.splice(index, 1);
                }
            });
            return res;
        });
    };

    /** @function Corrade~corradeGetGroupMemberByName
     *
     * @param {string} singleName -single legacy name or partial name.
     * @returns {Promise} returns a promise object which will contain the full name unless it does not match anyone in the group.
     *
     *
     * @example
     * corrade.corradeGetGroupMembersByName('bunny').then(function (res) {
     *              //do things
     *          });
     * */
    this.corradeGetGroupMemberByName = function (singleName) {

        if (typeof singleName !== 'string') return Promise.reject(ERRORS[6]);

        return _this.corradeGetGroupMembersByName([singleName]).then(function (res) {
            return res;

        }).catch(function (err) {
            console.log(err)
        })
    };

    /** @function Corrade~checkIfCommandAndReturnFormattedData
     *
     * @description
     * expects the initial message from corrade (ater its been trasformed though querystring)  to go into this function then formats the data to be more
     * javascript friendly if the first part of the message string is a command.
     *
     * @param {object} data - corrade data object.
     * @returns {Promise} returns a promise object which will contain the firstName, lastName, messageAsString, messageAsArray, command, uuid, and type paramaters.
     *
     *
     * @example
     * corrade.corradeGetGroupMembersByName('bunny').then(function (res) {
     *              //do things
     *          });
     * */
    this.checkIfCommandAndReturnFormattedData = function (data) {

        //let messageAsArray = split(data.message, {separator: ' ',keepQuotes: false});

        let callbackUrl = null;
        let maybeMessageAndCallbackUrl = querystring.parse(data.message);

        let message = '';
        if (maybeMessageAndCallbackUrl.message) {
            message = maybeMessageAndCallbackUrl.message;
            callbackUrl = maybeMessageAndCallbackUrl.callback_url;
        } else {
            message = data.message;
        }


        if (data.type === 'objectim') {
            if (message && message.callback_url) callbackUrl = message.callback_url;
        }


        let messageAsArray = message.match(/(?:[^\s"]+|"[^"]*")+/g); //match(/[^\s"']+|"([^"]*)"|'([^']*)'/g);


        messageAsArray.forEach(function (item, index, arr) {
            arr[index] = item.replace(/^"|"$/g, '').replace(/^'|'$/g, '');// - /["']/g
        });

        return new Promise(function (resolve, reject) {

            if (messageAsArray[0].indexOf('~') === 0 || messageAsArray[0].indexOf('@') === 0) {
                let command = messageAsArray[0].substring(1);
                messageAsArray.shift();

                for (let i = 0; i < messageAsArray.length; ++i) {
                    if (messageAsArray[i].length < 4 && i !== 0) {
                        return reject({
                            code: ERRORS[0].code,
                            text: ERRORS[0].text,
                            callbackUrl: callbackUrl
                        });
                    }
                }

                if (!_this.REGISTERED_MODULES.hasOwnProperty(command)) {
                    return reject({
                        code: ERRORS[1].code,
                        text: ERRORS[1].text,
                        callbackUrl: callbackUrl
                    });
                }

                return resolve({
                    lastName: data.lastname,
                    firstName: data.firstname,
                    messageAsArray: messageAsArray,
                    messageAsString: message.match(/^(\S+)\s(.*)/) ? message.match(/^(\S+)\s(.*)/).slice(1)[1] : message,
                    command: command,
                    uuid: data.agent || data.owner ? data.agent || data.owner : null,
                    type: data.type,
                    group: data.group ? data.group : null,
                    callbackUrl: callbackUrl
                });

            }
            // return reject(ERRORS[1])//TODO: check if this is needed or to never resolve a promise is okay.
        })
    };


}

module.exports = Corrade;
