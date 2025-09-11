'use strict';

var
  config = require('../index').config,
  expect = require('chai').expect;

describe('config', function () {
  var
    actual,
    expected;

  afterEach(function () {
    actual = expected = undefined;
  });

  after(function () {
    // reset the defaults
    config('seperator', '.');
  })

  describe('Sanity checks', function () {

    // NOTE need to add a test where hasOwnProperty returns false

    it('Should be a no-op when argument is invalid', function () {
      expected = config.get('seperator');

      config(123);
      config(null);
      config();
      config(true);

      actual = config.get('seperator');

      expect(actual).to.equal(expected);
    });

    it('Should not throw when attempting to set with an object', function () {
      expect(function () {
        config({ foo: 123, bar: 'abc' });
      }).not.to.throw();
    });

    it('Should not throw when attempting to set with a key-value pair', function () {
      expect(function () {
        config('foo', 456);
      }).not.to.throw();
    });

    it('Should not throw when attempting to get a value', function () {
      expect(function () {
        config('foo');
      }).not.to.throw();
    });

    it('Should retreive the correct defaults', function () {
      actual = config.get('seperator');
      expected = '.';

      expect(actual).to.equal(expected);
    });

    it('Should overwrite the defaults', function () {
      config.set('seperator', '^^')
      actual = config.get('seperator');
      expected = '^^';

      expect(actual).to.equal(expected);
    });

  });

});
