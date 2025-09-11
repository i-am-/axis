'use strict';

var utils = require('./utils');

/**
 * Get the property specified by the property path in the context object.
 * A default value can be passed which will be returned if the property is null
 * or undefined.
 *
 * @param  {Object} context         The context in which to find the property
 * @param  {String} property        the path of the property. Specify nested
 *                               		properties by sperating with `.`.
 *                               		@see options.seperator
 * @param  {[type]} [defaultValue]  an optional default which will be returned
 *                                  if the target property does not exist
 * @return {[type]}                 returns the property or undefined if not found
 */
module.exports = function (context, property, defaultValue) {
  var useDefault = arguments.length === 3;

  if (!utils.isValue(context)) {
    return context;
  }

  if (!utils.isValue(property)) {
    return context;
  }

  return utils.split(property, context, function (ctx, token, next, last) {
    if (last) {
      if (utils.isValue(next)) {
          return next;
      }

      if (useDefault) {
        return defaultValue;
      }

      return next;
    }
    return utils.isValue(next) ? next : {};
  });
};
