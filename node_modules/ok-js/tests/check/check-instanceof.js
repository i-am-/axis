'use strict';

var
  check   = require('../../index').check,
  expect  = require('chai').expect;

describe('check - instanceof', function () {
  var
    actual,
    expected,
    Klass;

  before(function () {
    Klass = function () {
      this.arms = 2;
      this.legs = 3;
    };
  });

  afterEach(function () {
    actual = expected = undefined;
  });

  it('Should not identify number as a Number', function () {
    expect(check(123).is.instanceof(Number)).to.be.false;
  });

  it('Should identify string as a String', function () {
    expect(check('abc').is.instanceof(String)).to.be.false;
  });

  it('Should identify boolean as a Boolean', function () {
    expect(check(false).is.instanceof(Boolean)).to.be.false;
  });

  it('Should identify regex as a RegExp', function () {
    expect(check(/ab[c]/igm).is.instanceof(RegExp)).to.be.true;
  });

  it('Should identify array as a Array', function () {
    expect(check([123, 345, 666]).is.instanceof(Array)).to.be.true;
  });

  it('Should identify object as Object', function () {
    expect(check({ foo: 'qqq' }).is.instanceof(Object)).to.be.true;
  });

  it('Should identify class as a Klass', function () {
    expect(check(new Klass()).is.instanceof(Klass)).to.be.true;
  });
});
