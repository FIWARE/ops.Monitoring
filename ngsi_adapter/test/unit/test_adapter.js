/*
 * Copyright 2015 Telefónica I+D
 * All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */


/**
 * Module that defines unit tests for the adapter.
 *
 * @module test_adapter
 */


'use strict';
/* jshint maxparams: 6 */


/** Fake command line arguments (required to load `adapter` without complaining) */
process.argv = [];


var url = require('url'),
    util = require('util'),
    path = require('path'),
    http = require('http'),
    dgram = require('dgram'),
    sinon = require('sinon'),
    assert = require('assert'),
    Emitter = require('events').EventEmitter,
    factory = require('../../lib/parsers/common/factory'),
    parser = require('../../lib/parsers/common/base').parser,
    logger = require('../../lib/logger'),
    config = require('../../lib/config'),
    adapter = require('../../lib/adapter');


suite('adapter', function () {

    suiteSetup(function () {
        this.contentType = parser.getContentType();
        this.processEvents = ['SIGINT', 'SIGTERM', 'uncaughtException', 'exit'];
        this.baseurl = 'http://hostname:1234';
        this.resource = 'check_load';
        this.body = 'some load data';
        this.headers = {'Content-Type': this.contentType, 'Accept': this.contentType};
        this.udpParser = 'udp_parser';
        this.udpHost = 'localhost';
        this.udpPort = 1234;
        config.udpEndpoints = util.format('%s:%d:%s', this.udpHost, this.udpPort, this.udpParser);
        config.parsersPath = path.normalize(__dirname);  // include current directory in search
        logger.stream = require('dev-null')();
        logger.setLevel('DEBUG');
    });

    suiteTeardown(function () {
    });

    setup(function () {
        var self = this;
        sinon.stub(http, 'createServer', function () {
            self.httpListener = arguments[0];
            return {
                listen: function (port, host, callback) {
                    this.address = sinon.stub().returns({ address: host, port: port });
                    callback.call(this);
                }
            };
        });
        sinon.stub(dgram, 'createSocket', function () {
            var udpSocket = new Emitter();
            udpSocket.bind = function (port, host, callback) {
                self.udpServer = this;
                this.address = sinon.stub().returns({ address: host, port: port });
                callback.call(this);
            };
            udpSocket.send = function (buf, offset, length, port, address, callback) {
                self.udpServer.emit('message', buf.toString('utf8', offset, length - offset));
                callback.call(this, null, length - offset);
            };
            udpSocket.close = sinon.stub();
            return udpSocket;
        });
        self.request = new Emitter();
        self.request.method = 'POST';
        self.request.headers = {};
        adapter.main();
    });

    teardown(function () {
        http.createServer.restore();
        dgram.createSocket.restore();
        this.udpServer.removeAllListeners();
        this.processEvents.map(function (event) { process.removeListener(event, process.listeners(event).pop()); });
        delete this.request;
        delete this.udpServer;
        delete this.httpListener;
        delete config.brokerApi;
    });

    test('request_fails_if_not_post_method', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl;
        this.request.method = 'GET';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 405);  // not allowed
    });

    test('request_fails_missing_entity_id', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '?type=type';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 400);  // bad request
    });

    test('request_fails_missing_entity_type', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '?id=id';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 400);  // bad request
    });

    test('request_fails_missing_url_resource', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '/' + '?id=id&type=type';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 404);  // not found
    });

    test('request_fails_unknown_url_resource', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '/unknown_resource' + '?id=id&type=type';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 404);  // not found
    });

    test('request_fails_valid_url_resource_loading_invalid_parser', function () {
        var resource = path.basename(__filename, '.js');   // current file as invalid module for parser
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '/' + resource + '?id=id&type=type';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 404);  // not found
    });

    test('request_ok_valid_url_resource', function () {
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        this.request.url = this.baseurl + '/' + this.resource + '?id=id&type=type';
        this.httpListener(this.request, response);
        assert(response.writeHead.calledOnce);
        assert.equal(response.writeHead.args[0][0], 200);  // ok
    });

    test('request_fails_when_domain_error', function (done) {
        var self = this;
        var response = {
            writeHead: function () {},
            end: sinon.stub()
        };
        // Force an error when invoking url.parse()
        sinon.stub(url, 'parse', function () {
            url.parse.restore();
            self.request.emit('error', new Error('detail of error'));
            return url.parse.apply(null, arguments);
        });
        // Ensure a HTTP 500 status in response
        sinon.stub(response, 'writeHead', function (status) {
            response.writeHead.restore();
            assert.equal(status, 500);
            done();
        });
        self.timeout(500);
        self.request.url = self.baseurl + '/' + self.resource + '?id=id&type=type';
        self.httpListener(self.request, response);
    });

    test('request_asynchronous_callback_error_on_invalid_resource_data', function (done) {
        var self = this;
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        var callback = (function () {
            var original = adapter.updateContextCallback;
            return sinon.stub(adapter, 'updateContextCallback', function () {
                original.apply(null, arguments);
                callback.restore();
                assert(callback.calledOnce);
                var err = callback.args[0][0];
                assert.notEqual(err, null);
                done();
            });
        }());
        self.timeout(500);
        self.request.url = self.baseurl + '/' + self.resource + '?id=id&type=type';
        self.httpListener(self.request, response);
        self.request.emit('data', self.body);
        self.request.emit('end');
    });

    test('request_asynchronous_callback_error_after_all_cb_connection_retries', function (done) {
        var self = this;
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        var factoryGetParser = sinon.stub(factory, 'getParser', function () {
            var mockParser = Object.create(parser);
            mockParser.getUpdateRequest = function (reqdomain) {
                reqdomain.options = {headers: self.headers};
                return '';
            };
            return mockParser;
        });
        var httpRequest = sinon.stub(http, 'request', function () {
            var clientRequest = new Emitter();
            clientRequest.end = function () { this.emit('error', new Error()); };
            return clientRequest;
        });
        var callback = (function () {
            var original = adapter.updateContextCallback;
            return sinon.stub(adapter, 'updateContextCallback', function () {
                original.apply(null, arguments);
                callback.restore();
                httpRequest.restore();
                factoryGetParser.restore();
                assert(callback.calledOnce);
                var err = callback.args[0][0];
                assert.notEqual(err, null);
                done();
            });
        }());
        config.retries = 1;
        self.timeout(1500);
        self.request.url = self.baseurl + '/' + self.resource + '?id=id&type=type';
        self.httpListener(self.request, response);
        self.request.emit('data', self.body);
        self.request.emit('end');
    });

    test('request_asynchronous_callback_cb_error_response', function (done) {
        var self = this;
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        var factoryGetParser = sinon.stub(factory, 'getParser', function () {
            var mockParser = Object.create(parser);
            mockParser.getUpdateRequest = function (reqdomain) {
                reqdomain.options = {headers: self.headers};
                return '';
            };
            return mockParser;
        });
        var httpRequest = sinon.stub(http, 'request', function (opts, callback) {
            var clientRequest = new Emitter();
            var serverResponse = new Emitter();
            serverResponse.setEncoding = sinon.stub();
            serverResponse.statusCode = 200;
            callback(serverResponse);
            serverResponse.emit('data', '{"orionError": {"code": 500}}');
            serverResponse.emit('end');
            clientRequest.end = sinon.stub();
            return clientRequest;
        });
        var loggerError = sinon.spy(logger, 'error');
        var callback = (function () {
            var original = adapter.updateContextCallback;
            return sinon.stub(adapter, 'updateContextCallback', function () {
                original.apply(null, arguments);
                callback.restore();
                httpRequest.restore();
                factoryGetParser.restore();
                loggerError.restore();
                assert(callback.calledOnce);
                var err = callback.args[0][0];
                var status = callback.args[0][1];
                assert.equal(err, null);
                assert.equal(status, 200);
                assert(loggerError.calledOnce);
                done();
            });
        }());
        self.timeout(500);
        self.request.url = self.baseurl + '/' + self.resource + '?id=id&type=type';
        self.httpListener(self.request, response);
        self.request.emit('data', self.body);
        self.request.emit('end');
    });

    test('request_asynchronous_callback_ok_with_valid_resource_data', function (done) {
        var self = this;
        var response = {
            writeHead: sinon.stub(),
            end: sinon.stub()
        };
        var factoryGetParser = sinon.stub(factory, 'getParser', function () {
            var mockParser = Object.create(parser);
            mockParser.getUpdateRequest = function (reqdomain) {
                reqdomain.options = {headers: self.headers};
                return '';
            };
            return mockParser;
        });
        var httpRequest = sinon.stub(http, 'request', function (opts, callback) {
            var clientRequest = new Emitter();
            var serverResponse = new Emitter();
            serverResponse.setEncoding = sinon.stub();
            serverResponse.statusCode = 200;
            callback(serverResponse);
            serverResponse.emit('data', '{"key": "value"}');
            serverResponse.emit('end');
            clientRequest.end = sinon.stub();
            return clientRequest;
        });
        var loggerError = sinon.spy(logger, 'error');
        var callback = (function () {
            var original = adapter.updateContextCallback;
            return sinon.stub(adapter, 'updateContextCallback', function () {
                original.apply(null, arguments);
                callback.restore();
                httpRequest.restore();
                factoryGetParser.restore();
                loggerError.restore();
                assert(callback.calledOnce);
                var err = callback.args[0][0];
                var status = callback.args[0][1];
                assert.equal(err, null);
                assert.equal(status, 200);
                assert(loggerError.notCalled);
                done();
            });
        }());
        self.timeout(500);
        self.request.url = self.baseurl + '/' + self.resource + '?id=id&type=type';
        self.httpListener(self.request, response);
        self.request.emit('data', self.body);
        self.request.emit('end');
    });

    test('udp_request_to_unknown_parser_fails_and_logs_error', function () {
        var self = this,
            message = new Buffer('valid_data'),
            client = dgram.createSocket('udp4'),
            parserNotFoundError = 'not found';
        var factoryGetParserByName = sinon.stub(factory, 'getParserByName', function () {
            throw new Error(parserNotFoundError);
        });
        var httpRequest = sinon.spy(http, 'request');
        var logError = sinon.stub(logger, 'error', function (errmsg) {
            var httpRequestCount = httpRequest.callCount;
            logError.restore();
            httpRequest.restore();
            factoryGetParserByName.restore();
            assert.equal(errmsg, parserNotFoundError);
            assert.equal(httpRequestCount, 0);
        });
        client.send(message, 0, message.length, self.udpPort, self.udpHost, function (err, bytes) {
            client.close();
            assert.equal(err, null);
            assert.equal(bytes, message.length);
        });
    });

    test('udp_request_to_parser_not_setting_entity_id_fails_and_logs_error', function () {
        var self = this,
            message = new Buffer('valid_data'),
            client = dgram.createSocket('udp4'),
            missingEntityIdentificationError = 'Missing entityId and/or entityType';
        var factoryGetParserByName = sinon.stub(factory, 'getParserByName', function (name) {
            var mockParser = Object.create(parser);
            mockParser.parseRequest = function (reqdomain) {
                reqdomain.entityType = 'type1';
                return;
            };
            mockParser.getContextAttrs = function () {
                return {foo: 'bar'};
            };
            assert.equal(name, self.udpParser);
            return mockParser;
        });
        var httpRequest = sinon.spy(http, 'request');
        var logError = sinon.stub(logger, 'error', function (errmsg) {
            var httpRequestCount = httpRequest.callCount;
            logError.restore();
            httpRequest.restore();
            factoryGetParserByName.restore();
            assert.equal(errmsg, missingEntityIdentificationError);
            assert.equal(httpRequestCount, 0);
        });
        client.send(message, 0, message.length, self.udpPort, self.udpHost, function (err, bytes) {
            client.close();
            assert.equal(err, null);
            assert.equal(bytes, message.length);
        });
    });

    test('udp_request_to_parser_not_setting_entity_type_fails_and_logs_error', function () {
        var self = this,
            message = new Buffer('valid_data'),
            client = dgram.createSocket('udp4'),
            missingEntityIdentificationError = 'Missing entityId and/or entityType';
        var factoryGetParserByName = sinon.stub(factory, 'getParserByName', function (name) {
            var mockParser = Object.create(parser);
            mockParser.parseRequest = function (reqdomain) {
                reqdomain.entityId = 'id1';
                return;
            };
            mockParser.getContextAttrs = function () {
                return {foo: 'bar'};
            };
            assert.equal(name, self.udpParser);
            return mockParser;
        });
        var httpRequest = sinon.spy(http, 'request');
        var logError = sinon.stub(logger, 'error', function (errmsg) {
            var httpRequestCount = httpRequest.callCount;
            logError.restore();
            httpRequest.restore();
            factoryGetParserByName.restore();
            assert.equal(errmsg, missingEntityIdentificationError);
            assert.equal(httpRequestCount, 0);
        });
        client.send(message, 0, message.length, self.udpPort, self.udpHost, function (err, bytes) {
            client.close();
            assert.equal(err, null);
            assert.equal(bytes, message.length);
        });
    });

    test('udp_request_to_valid_parser_ok_asynchronous_http_request_callback', function (done) {
        var self = this,
            message = new Buffer('valid_data'),
            client = dgram.createSocket('udp4');
        var factoryGetParserByName = sinon.stub(factory, 'getParserByName', function (name) {
            var mockParser = Object.create(parser);
            mockParser.parseRequest = function (reqdomain) {
                reqdomain.entityId = 'id1';
                reqdomain.entityType = 'type1';
                return;
            };
            mockParser.getContextAttrs = function () {
                return {foo: 'bar'};
            };
            assert.equal(name, self.udpParser);
            return mockParser;
        });
        var httpRequest = sinon.stub(http, 'request', function (opts, callback) {
            var clientRequest = new Emitter();
            var serverResponse = new Emitter();
            serverResponse.setEncoding = sinon.stub();
            serverResponse.statusCode = 200;
            callback(serverResponse);
            serverResponse.emit('data', '{"key": "value"}');
            serverResponse.emit('end');
            clientRequest.end = sinon.stub();
            httpRequest.restore();
            factoryGetParserByName.restore();
            done();
        });
        self.timeout(500);
        client.send(message, 0, message.length, self.udpPort, self.udpHost, function (err, bytes) {
            client.close();
            assert.equal(err, null);
            assert.equal(bytes, message.length);
        });
    });

});
