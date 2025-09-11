'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.kindof', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Primitives', function () {

    it('Should work for numbers', function () {
      actual = check(123).is.kindof('number');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings', function () {
      actual = check('abc').is.kindof('string');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans', function () {
      actual = check(true).is.kindof('boolean');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for undefined', function () {
      actual = check(undefined).is.kindof('undefined');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for null', function () {
      actual = check(null).is.kindof('null');
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

  describe('Objects and Arrays', function () {
    it('Should work for objects', function () {
      actual = check({}).is.kindof('object');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for arrays', function () {
      actual = check([]).is.kindof('array');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work with RegExp', function () {
      actual = check(/fwefwefwef/).is.kindof('regexp');
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work with a named function', function () {
      function Foo () {};

      actual = check(new Foo()).is.kindof('foo');
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work with a named variable', function () {
      var Foo = function () {};

      actual = check(new Foo()).is.kindof('object');
      expected = true;
      expect(actual).to.equal(expected);
    });
  });

});
