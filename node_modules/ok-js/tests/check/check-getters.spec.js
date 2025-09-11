'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check - getters', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('undefined', function () {
    it('Should work when true', function () {
      actual = check(undefined).is.undefined;
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work when false', function () {
      actual = check(123).is.undefined;
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('defined', function () {
    it('Should work when true', function () {
      actual = check(123).is.defined;
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work when false', function () {
      actual = check(undefined).is.defined;
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('null', function () {
    it('Should work when true', function () {
      actual = check(null).is.null;
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work when false', function () {
      actual = check(123).is.null;
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('value', function () {
    it('Should work when true', function () {
      actual = check(123).is.value;
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work when false - null', function () {
      actual = check(null).is.value;
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should work when false - null', function () {
      actual = check(undefined).is.value;
      expected = false;

      expect(actual).to.equal(expected);
    });
  });
});
