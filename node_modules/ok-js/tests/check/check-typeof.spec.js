'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.typeof', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Primitives', function () {

    it('Should work for numbers', function () {
      actual = check(123).is.typeof('number');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings', function () {
      actual = check('abc').is.typeof('string');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans', function () {
      actual = check(true).is.typeof('boolean');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for undefined', function () {
      actual = check(undefined).is.typeof('undefined');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for null', function () {
      actual = check(null).is.typeof('object');
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

  describe('Objects and Arrays', function () {
    it('Should work for objects', function () {
      actual = check({}).is.typeof('object');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for arrays', function () {
      actual = check([]).is.typeof('object');
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

});
