'use strict';

var options = {

  /**
   * pattern on which to split object property paths
   * @type {String}
   */
  seperator: '.'

};

var get = function (key) {
  return options[key];
};

var set = function (key, value) {
  options[key] = value;
};

var merge = function (opt) {
  var name;

  for (name in opt) {
    if (opt.hasOwnProperty(name)) {
      options[name] = name;
    }
  }
};

module.exports = function () {
  var args = Array.prototype.slice.call(arguments);

  if (args.length === 2) {
    return set.apply(null, args);

  } else if (typeof args[0] === 'string') {
    return get.apply(null, args);

  } else if (typeof args[0] === 'object') {
    return merge.apply(null, args);

  }

};

module.exports.get = get;
module.exports.set = set;
