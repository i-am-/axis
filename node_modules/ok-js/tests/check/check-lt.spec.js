'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.lt', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Numbers', function () {
    it('Should work for numbers - when true', function () {
      actual = check(123).is.lt(456);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for numbers - when false', function () {
      actual = check(123).is.lt(1);
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('Strings', function () {
    it('Should work for strings - when true', function () {
      actual = check('abc').is.lt('def');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when false', function () {
      actual = check('def').is.lt('abc');
      expected = false;

      expect(actual).to.equal(expected);
    });
  });
});

describe('check.lte', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Numbers', function () {
    it('Should work for numbers - when true', function () {
      actual = check(123).is.lte(123);
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

  describe('Strings', function () {
    it('Should work for strings - when true', function () {
      actual = check('abc').is.lte('abc');
      expected = true;

      expect(actual).to.equal(expected);
    });
  });
});
