'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check.equal', function () {
  var
    actual,
    expected;

  beforeEach(function () {
    actual = expected = undefined;
  });

  describe('Primitives', function () {

    it('Should work for numbers - when true', function () {
      actual = check(123).equals(123);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for numbers - when false', function () {
      actual = check(123).equals(0);
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when true', function () {
      actual = check('abc').equals('abc');
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for strings - when false', function () {
      actual = check('abc').equals('qqq');
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans - when true', function () {
      actual = check(true).equals(true);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for booleans - when false', function () {
      actual = check(true).equals(false);
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should work for undefined - when true', function () {
      actual = check(undefined).equals(undefined);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for undefined - when false', function () {
      actual = check(undefined).equals(123);
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should work for null - when true', function () {
      actual = check(null).equals(null);
      expected = true;

      expect(actual).to.equal(expected);
    });

    it('Should work for null - when false', function () {
      actual = check(null).equals(123);
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

  describe('Objects and Arrays', function () {
    it('Should not work for objects', function () {
      actual = check({}).equals({});
      expected = false;

      expect(actual).to.equal(expected);
    });

    it('Should not work for arrays', function () {
      actual = check([]).equals([]);
      expected = false;

      expect(actual).to.equal(expected);
    });
  });

});
