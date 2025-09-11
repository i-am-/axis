# ok.js

[![Build Status](https://travis-ci.org/StickyCube/ok-js.svg?branch=master)](https://travis-ci.org/StickyCube/ok-js)
[![Coverage Status](https://coveralls.io/repos/StickyCube/ok-js/badge.svg?branch=master&service=github)](https://coveralls.io/github/StickyCube/ok-js?branch=master)

> ok.js is a small object utility library for manipulating and testing object properties.

## Installation
ok.js is available for both node.js and browser.

```
Through npm:
  npm install ok-js --save
```
```
Through bower
  bower install ok-js
```

Or build it yourself. Get the latest from git [here](https://github.com/StickyCube/object-props) and `gulp build` from the root directory.

## What does it do?
I got sick of writing long, ugly lines of code to test and set defaults on nested object properties all the time, so i wrote this. I hope you find it useful.

ok-js aims to clean up the following situations:

```javascript
// testing nested object properties
if (some && some.nested && some.nested.property) {
  doSomething();
}

// setting defaults on nested object properties
this.object = this.object || {};
this.object.should = this.object.should || {};
this.object.should.exist = this.object.should.exist || [];

// getting a nested property
var h = ((session || {}).user || {}).name || 'Spiderman';
```

##### At a glance

```javascript
var make = { it: null };

// instead of this (yuk)
make.it = make.it || {};
make.it.look = make.it.look || {};
make.is.look.nice = make.it.look.nice || true;

// do this
ok.ensure(make, 'it.look.nice', true);
```

## API

#### ok.ensure(context, [path], value)
Ensure a property exists at a given `path` within a given `context`.<br/> If the resolved property is either null or undefined then the given `value` will be set. <br/>If the given context is null or undefined, ensure will return a new object with this property set.

- arguments
  * `context`: _Object_ - The context in which to ensure the property exists.
  * `path`: _String_ - An optional path to a property. To target nested properties delimit with dots `.`.
  * `value`: _Any_ - the value to set.


- returns the given `context` or a new Object if context was null or undefined.


#### ok.get(context, path, [default])
Get the property specified by `path` within the given `context`.<br/> The `default` will be returned, if specified, only when get yields null or undefined.

- arguments
  * `context`: _Object_ - The context in which to find the property.
  * `path`: _String_ - The path to a property. To target nested properties delimit with dots `.`.
  * `default`: _Any_ - An optional value to return when get yields null or undefined.

- returns the resolved property or default value.

#### ok.set(context, path, value)
Set the property specified by `path` within the given `context` to `value`.<br/>If context is null or undefined, set will return a new object.

- arguments
  * `context`: _Object_ - The context in which to set the property.
  * `path`: _String_ - The path to a property. To target nested properties delimit with dots `.`.
  * `value`: _Any_ - The value to set.

- returns the given `context` or a new Object if context was null or undefined.


#### ok.check(context, [path])
Get an Assertion object which can be used to test the resolved property.

Inspired by chaijs, the assertion supports chainable `.is` and `.not` getters to be used in conjunction with the following complete list of endpoints:

```javascript
  var it = ok.check(foo, 'bar.baz');
    // each of the following return a boolean

    // use it with the following functions:
    it.is.truthy();
    it.is.falsy();

    it.is.typeof('string'); // typeof operator
    it.is.kindof('array'); // same as typeof but distinguises null and array
    it.is.instanceof(String);

    it.equals(123); // ===
    it.is.gt(Infinity); // >
    it.is.gte(9000); // >=
    it.is.lt(0); // <
    it.is.lte(567); // <=

    // or these getters
    it.is.undefined; // === undefined
    it.is.defined; // !== undefined
    it.is.null; // === null
    it.is.value; // != null
    it.is.primitive; // null|undefined|String|Boolean|Number

    // NOTE: negate the assertion using `.not` before the endpoint.
    // NOTE: `.is` is merely aesthetic, and can be safely omitted.
```

#### ok.config()
config accepts either:
  * A single argument - an `Object` of key-value pairs to set multiple config options.
  * Two arguments - a `String` key and `Any` value to set a single config option.
  * A single argument - a `String` identifying a config value to get.

#### options

##### options.seperator [default = `'.'`]
A `String` to use as the separating character/pattern between object keys in the `path` parameter of `ok.ensure`, `ok.get`, `ok.set` and `ok.check`.

```javascript
// by default
kkthxbye = ok.get(foo, 'kk.thx.bye');

// using a different seperator
ok.config('seperator', '_');
kkthxbye = ok.get(foo, 'kk_thx_bye');
```

## Issues and Requests
Please submit any issues or feature requests to the repository's github [issue tracker](https://github.com/StickyCube/ok-js/issues).

## Version History
  - v0.1.0 - Initial release
  - v0.2.0 - Added `instanceof` and `.primitive` to check API
  - v0.2.2 - Fixed an issue with ok.get when property is null or undefined
