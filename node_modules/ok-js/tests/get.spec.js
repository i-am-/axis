'use strict';

var
  get     = require('../index').get,
  expect  = require('chai').expect;

describe('get', function () {

  var
    foo,
    actual,
    expected;

  afterEach(function () {
    actual = expected = undefined;
  });

  describe('Sanity checks', function () {

    it('Should not throw when context is undefined', function () {
      expected = undefined;

      expect(function () {
        actual = get(undefined, 'bar.baz');
      }).not.to.throw();

      expect(actual).to.equal(expected);
    });

    it('Should not throw when context is null', function () {
      expected = null;

      expect(function () {
          actual = get(null, 'bar.baz');
      }).not.to.throw();

      expect(actual).to.equal(expected);
    });
  });

  describe('Single properties', function () {

    beforeEach(function () {
      foo = {
        zerobar: 0,
        numbar: 123,
        emptybar: '',
        stringbar: 'abc',
        falsebar: false,
        truebar: true,
        arraybar: [],
        objectbar: {},
        nullbar: null,
        undefinedbar: undefined
      };
    });

    it('Should retreive a falsy number', function () {
      actual = get(foo, 'zerobar');
      expected = 0;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy number', function () {
      actual = get(foo, 'numbar');
      expected = 123;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a falsy string', function () {
      actual = get(foo, 'emptybar');
      expected = '';
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy string', function () {
      actual = get(foo, 'stringbar');
      expected = 'abc';
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy boolean', function () {
      actual = get(foo, 'truebar');
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a falsy boolean', function () {
      actual = get(foo, 'falsebar');
      expected = false;
      expect(actual).to.equal(expected);
    });

    it('Should retreive an array', function () {
      actual = get(foo, 'arraybar');
      expected = [];
      expect(actual).to.deep.equal(expected);
    });

    it('Should retreive an object', function () {
      actual = get(foo, 'objectbar');
      expected = {};
      expect(actual).to.deep.equal(expected);
    });

    it('Should retreive a null value', function () {
      actual = get(foo, 'nullbar');
      expected = null;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a undefined value', function () {
      actual = get(foo, 'undefined');
      expected = undefined;
      expect(actual).to.equal(expected);
    });
  });

  describe('Default values', function () {

    beforeEach(function () {
      foo = {
        zerobar: 0,
        numbar: 123,
        emptybar: '',
        stringbar: 'abc',
        falsebar: false,
        truebar: true,
        arraybar: [],
        objectbar: {},
        nullbar: null,
        undefinedbar: undefined
      };
    });

    it('Should retreive a falsy number', function () {
      actual = get(foo, 'zerobar', 999);
      expected = 0;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy number', function () {
      actual = get(foo, 'numbar', 999);
      expected = 123;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a falsy string', function () {
      actual = get(foo, 'emptybar', 999);
      expected = '';
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy string', function () {
      actual = get(foo, 'stringbar', 999);
      expected = 'abc';
      expect(actual).to.equal(expected);
    });

    it('Should retreive a truthy boolean', function () {
      actual = get(foo, 'truebar', 999);
      expected = true;
      expect(actual).to.equal(expected);
    });

    it('Should retreive a falsy boolean', function () {
      actual = get(foo, 'falsebar', 999);
      expected = false;
      expect(actual).to.equal(expected);
    });

    it('Should retreive an array', function () {
      actual = get(foo, 'arraybar', 999);
      expected = [];
      expect(actual).to.deep.equal(expected);
    });

    it('Should retreive an object', function () {
      actual = get(foo, 'objectbar', 999);
      expected = {};
      expect(actual).to.deep.equal(expected);
    });

    it('Should retreive the default for a null value', function () {
      actual = get(foo, 'nullbar', 999);
      expected = 999;
      expect(actual).to.equal(expected);
    });

    it('Should retreive the default for an undefined value', function () {
      actual = get(foo, 'undefinedbar', 999);
      expected = 999;
      expect(actual).to.equal(expected);
    });
  });

  describe('Nested Properties', function () {

    beforeEach(function () {
      foo = { a: { nested: { property: 123 } } }
    });

    it('Should get a nested property', function () {
      actual = get(foo, 'a.nested.property');
      expected = 123;
      expect(actual).to.equal(expected);
    });

    it('Should get undefined for a property which does not exist', function () {
      actual = get(foo, 'a.property.which.dosnt.exist');
      expected = undefined;
      expect(actual).to.equal(expected);
    });
  });
});
