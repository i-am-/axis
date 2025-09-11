'use strict';

var utils = require('./utils');

/**
 *	Ensures the existence of a property. if the value is undefined or null,
 *	the property withh be set to the provided value
 *
 * @param  {Object} context  the context in which to ensure a value exists
 * @param  {String} property the path of the property. Specify nested
 *                           properties by sperating with `.`.
 *                           @see options.seperator
 * @param  {Any}    value    The default to apply if the target value does not
 *                           exist.
 *
 * @return {Object}          returns the existing or ensured value.
 */
module.exports = function (context, property, value) {

  // if no property was given, we just need to check the given context
  if (arguments.length === 2) {
    return utils.isValue(context) ? context : property;
  }

  return utils.split(property, context, function (ctx, token, next, last) {
    // on the last iteration we set the default if it does not exist
    if (last) {
      return ctx[token] = utils.isValue(next) ? next : value;
    }

    // set the next property as an empty object if it does not exist
    return ctx[token] = utils.isValue(next) ? next : {};
  });

};
