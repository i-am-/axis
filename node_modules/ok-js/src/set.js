'use strict';

var utils = require('./utils');

/**
 * Set the property specified by the property path in the context object to
 * the provided value.
 *
 * @param  {Object} context      The context in which to set the property.
 * @param  {String} property     The path of the property. Specify nested
 *                               properties by sperating with `.`.
 *                               @see options.seperator
 * @param  {Any} value          The value which will be set on the target
 *                               property
 * @return {[type]}              returns the passed in context
 */
module.exports = function (context, property, value) {
  if (!utils.isValue(context)) {
    context = {};
  }

  return utils.split(property, context, function (ctx, token, next, last) {
    if (last) {
      ctx[token] = value;
      return context;
    }

    return ctx[token] = utils.isValue(next) ? next : {};
  });
};
