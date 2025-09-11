'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.truthy check.falsy', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Primitives', function () {

    it('Should work for numbers - when truthy', function () {
      actual = check(123).is.truthy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for numbers - when falsy', function () {
      actual = check(0).is.falsy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when truthy', function () {
      actual = check('abc').is.truthy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when falsy', function () {
      actual = check('').is.falsy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans - when truthy', function () {
      actual = check(true).is.truthy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans - when falsy', function () {
      actual = check(false).is.falsy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for undefined', function () {
      actual = check(undefined).is.falsy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for null', function () {
      actual = check(null).is.falsy();
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

  describe('Objects and Arrays', function () {
    it('Should work for objects', function () {
      actual = check({}).is.truthy();
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for arrays', function () {
      actual = check([]).is.truthy();
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

});
