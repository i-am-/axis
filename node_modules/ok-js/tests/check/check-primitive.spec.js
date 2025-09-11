'use strict';

var
  check   = require('../../index').check,
  expect  = require('chai').expect;

describe('check - primitive', function () {
  var
    actual,
    expected,
    foo,
    Klass;

  before(function () {
    Klass = function () {
      this.arms = 2;
      this.legs = 3;
    };

    foo = {
      numbar: 123,
      stringbar: 'abc',
      boolbar: true,
      regexbar: /ab[c]{1,3}/igm,
      arraybar: [1, 2, 3],
      objectbar: { foo: 'qqq' },
      nullbar: null,
      undefinedbar: undefined,
      classbar: new Klass()
    };
  });

  afterEach(function () {
    actual = expected = undefined;
  });

  it('Should identify number as a primitive', function () {
    expect(check(123).is.primitive).to.be.true;
  });

  it('Should identify string as a primitive', function () {
    expect(check('abc').is.primitive).to.be.true;
  });

  it('Should identify boolean as a primitive', function () {
    expect(check(false).is.primitive).to.be.true;
  });

  it('Should identify null as a primitive', function () {
    expect(check(null).is.primitive).to.be.true;
  });

  it('Should identify undefined as a primitive', function () {
    expect(check(undefined).is.primitive).to.be.true;
  });

  it('Should not identify regex as a primitive', function () {
    expect(check(/ab[c]/igm).is.primitive).to.be.false;
  });

  it('Should not identify array as a primitive', function () {
    expect(check([123, 345, 666]).is.primitive).to.be.false;
  });

  it('Should not identify object as a primitive', function () {
    expect(check({ foo: 'qqq' }).is.primitive).to.be.false;
  });

  it('Should not identify class as a primitive', function () {
    expect(check(new Klass()).is.primitive).to.be.false;
  });
});
