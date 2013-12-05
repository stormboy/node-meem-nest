/**
 * instantiate meem and run
 */
var NestMeem = require("./nest");
var settings = require("./settings.json");

var nestMeem = new NestMeem(settings);
nestMeem.start();