'use strict';

var
  check   = require('../../index').check,
  expect  = require('chai').expect;

describe('check - not', function () {
  var
    actual,
    expected,
    foo;

  afterEach(function () {
    actual = expected = undefined;
  });

  before(function () {
    foo = { stringbar: 'abc', nullbar: null, numbar: 123, nested: { property: 123456 } };
  });

  describe('With functions', function () {

    it('Should work in conjunction with equal', function () {
      actual = check(foo, 'stringbar').not.equals('def');
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with typeof', function () {
      actual = check(foo, 'numbar').not.typeof('number');
      expected = false;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with kindof', function () {
      actual = check(foo, 'nested').not.typeof('object');
      expected = false;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with truthy', function () {
      actual = check(foo, 'nullbar').not.truthy();
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with falsy', function () {
      actual = check(foo, 'stringbar').not.falsy();
      expected = true;
      expect(actual).to.equal(expected);
    });
  });

  describe('With getters', function () {
    it('Should work in conjunction with defined', function () {
      actual = check(foo, 'bar').is.not.defined;
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with undefined', function () {
      actual = check(foo, 'nullbar').is.not.undefined;
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with value', function () {
      actual = check(foo, 'nullbar').is.not.value;
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should work in conjunction with null', function () {
      actual = check(foo, 'nullbar').is.not.null;
      expected = false;
      expect(actual).to.equal(expected);
    });
  });

});
