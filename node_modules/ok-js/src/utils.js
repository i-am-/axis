'use strict';

var config = require('./configuration');

/**
 * Test wherther a reference is null or undefined
 * @param  {Any}     v Value to test
 * @return {Boolean} returns false when `v` is null or undefined, true otherwise
 */
var isValue = module.exports.isValue = function (v) {
  return v != null;
};

/**
 * More advanced typeof function, distinguises array and null
 * @param  {Any}      v value to test
 * @return {String}     the kind of value
 */
var kindof = module.exports.kindof = function (v) {
  if (!isValue(v)) {
    return v === null ? 'null' : 'undefined';
  }

  if (v.constructor === Array) {
    return 'array';
  }

  if (v.constructor.name) {
    return v.constructor.name.toLowerCase();
  }

  return typeof v;
};

/**
 * Test whether the current index of an iteration is the last
 * @param  {Number}  idx    The current index
 * @param  {Number}  length The length of the container
 * @return {Boolean}        true when it is the last iteration, false otherwise
 */
var isLast = function (idx, length) {
  return idx === (length - 1);
};

/**
 * A utility function for splitting and reducing the property path
 * @param  {String}   property property path of the target value
 * @param  {Any}      context in which the target value resides
 * @param  {Function} an iterator which receives the current context,
 *                    the next property name, the next value
 *                    and whether the iteration is the last as arguments
 */
module.exports.split = function (property, context, iterator) {
  var seperator = config.get('seperator');

  return property
    .split(seperator)
    .reduce(function (ctx, token, i, a) {
      return iterator(ctx, token, ctx[token], isLast(i, a.length));
    }, context);
};
