'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.gt', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Numbers', function () {
    it('Should work for numbers - when true', function () {
      actual = check(789).is.gt(456);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for numbers - when false', function () {
      actual = check(123).is.gt(789);
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('Strings', function () {
    it('Should work for strings - when true', function () {
      actual = check('def').is.gt('abc');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when false', function () {
      actual = check('abc').is.gt('def');
      expected = false;

      expect(actual).to.equal(expected);
    });
  });
});

describe('check.gte', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Numbers', function () {
    it('Should work for numbers - when true', function () {
      actual = check(123).is.gte(123);
      expected = true;

      expect(actual).to.equal(expected);
    });
  });

  describe('Strings', function () {
    it('Should work for strings - when true', function () {
      actual = check('abc').is.gte('abc');
      expected = true;

      expect(actual).to.equal(expected);
    });
  });
});
