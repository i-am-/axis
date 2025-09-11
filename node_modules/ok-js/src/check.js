'use strict';

var
  get   = require('./get'),
  utils = require('./utils');

function Assertion (data) {
  this._data = data;

  this._functions().forEach(function (name) {
    var old = this[name];

    this[name] = function () {
      var ret = old.apply(this, arguments);
      return this._negate ? !ret : ret;
    };

  }, this);
};

Assertion.prototype = {
  constructor: Assertion,
  _data: null,
  _negate: false,
  _deep: false,

  _functions: function () {
    var
      names = [],
      name;

    for (name in Assertion.prototype) {
      if (!/^_/.test(name) && typeof Assertion.prototype[name] === 'function') {
        names.push(name);
      }
    }

    return names;
  },

  equals: function (value) {
    return this._data === value;
  },

  truthy: function () {
    return !!this._data;
  },

  falsy: function () {
    return !this._data;
  },

  typeof: function (type) {
    return typeof this._data === type;
  },

  kindof: function (type) {
    return utils.kindof(this._data) === type;
  },

  instanceof: function (Klass) {
    return this._data instanceof Klass;
  },

  lt: function (v) {
    return this._data < v;
  },

  lte: function (v) {
    return this._data <= v;
  },

  gt: function (v) {
    return this._data > v;
  },

  gte: function (v) {
    return this._data >= v;
  }
};

Object.defineProperty(Assertion.prototype, 'is', {
  get: function () {
    this._negate = false;
    return this;
  }
});

Object.defineProperty(Assertion.prototype, 'not', {
  get: function () {
    this._negate = true;
    return this;
  }
})

Object.defineProperty(Assertion.prototype, 'defined', {
  get: function () {
    return this._negate
      ? this._data === void 0
      : this._data !== void 0;
  }
});

Object.defineProperty(Assertion.prototype, 'undefined', {
  get: function () {
    return !this.defined;
  }
});

Object.defineProperty(Assertion.prototype, 'null', {
  get: function () {
    return this._negate
      ? this._data !== null
      : this._data === null;
  }
});

Object.defineProperty(Assertion.prototype, 'value', {
  get: function () {
    return this._negate
      ? !utils.isValue(this._data)
      : utils.isValue(this._data);
  }
});

Object.defineProperty(Assertion.prototype, 'primitive', {
  get: function () {
    var result;

    if (!utils.isValue(this._data)) {
      return !this._negate;
    }

    result = this.typeof('string') || this.typeof('number') || this.typeof('boolean');

    return this._negate ? !result : result;
  }
});

module.exports = function (context, property) {
  var value;

  if (arguments.length === 2) {
    value = get(context, property);
  } else {
    value = context;
  }

  return new Assertion(value);
};
