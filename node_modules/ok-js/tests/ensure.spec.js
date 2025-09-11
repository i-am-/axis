'use strict';

var expect = require('chai').expect;
var ensure = require('../index').ensure;

describe('ensure', function () {
  var
    foo,
    actual,
    expected,
    returned;

  afterEach(function () {
    actual = expected = returned = undefined;
  });

  describe('Sanity checks', function () {

    it('Should return the default if context is undefined', function () {
      foo = undefined;

      actual = ensure(foo, 123);
      expected = 123;

      expect(actual).to.equal(expected);
    });

    it('Should return the default if context is undefined', function () {
      foo = null;

      actual = ensure(foo, 123);
      expected = 123;

      expect(actual).to.equal(expected);
    });

    it('Should return the context if it is defined', function () {
      foo = 'abc';

      actual = ensure(foo, 'def');
      expected = 'abc';

      expect(actual).to.equal(expected);
    });

    it('Should throw when a property is specified and context is undefined', function () {
      foo = undefined;

      expect(function () {
        ensure(foo, 'bar', 123);
      }).to.throw();
    });

    it('Should throw when a property is specified and context is null', function () {
      foo = null;

      expect(function () {
        ensure(foo, 'bar', 123);
      }).to.throw();
    });
  });

  describe('Single properties', function () {

    before(function () {
      foo = {
        zerobar: 0,
        numbar: 123,
        emptybar: '',
        stringbar: 'abc',
        truebar: true,
        falsebar: false,
        nullbar: null,
        undefinedbar: undefined,
        objectbar: {},
        arraybar: []
      };
    });

    it('Should not clobber a falsy number', function () {
      returned = ensure(foo, 'zerobar', 999);
      actual = foo.zerobar;
      expected = 0;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a truthy number', function () {
      returned = ensure(foo, 'numbar', 999);
      actual = foo.numbar;
      expected = 123;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a falsy string', function () {
      returned = ensure(foo, 'emptybar', 999);
      actual = foo.emptybar;
      expected = '';

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a truthy string', function () {
      returned = ensure(foo, 'stringbar', 999);
      actual = foo.stringbar;
      expected = 'abc';

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a falsy bool', function () {
      returned = ensure(foo, 'falsebar', 999);
      actual = foo.falsebar;
      expected = false;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a truthy bool', function () {
      returned = ensure(foo, 'truebar', 999);
      actual = foo.truebar;
      expected = true;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber an array', function () {
      returned = ensure(foo, 'arraybar', 999);
      actual = foo.arraybar;
      expected = [];

      expect(actual).to.deep.equal(expected);
      expect(returned).to.deep.equal(expected);
    });

    it('Should not clobber an object', function () {
      returned = ensure(foo, 'objectbar', 999);
      actual = foo.objectbar;
      expected = {};

      expect(actual).to.deep.equal(expected);
      expect(returned).to.deep.equal(expected);
    });

    it('Should clobber a null value', function () {
      returned = ensure(foo, 'nullbar', 999);
      actual = foo.nullbar;
      expected = 999;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should clobber an undefined value', function () {
      returned = ensure(foo, 'undefinedbar', 999);
      actual = foo.undefinedbar;
      expected = 999;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });
  });

  describe('Nested properties', function () {
    before(function () {
      foo = {
        some: {
          nested: {
            properties: {
              aaa: 123,
              bbb: 'abc',
              ccc: false,
              ddd: null
            }
          }
        }
      };
    });

    it('Should not clobber a number', function () {
      returned = ensure(foo, 'some.nested.properties.aaa', 999);
      actual = foo.some.nested.properties.aaa;
      expected = 123;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a string', function () {
      returned = ensure(foo, 'some.nested.properties.bbb', 999);
      actual = foo.some.nested.properties.bbb;
      expected = 'abc';

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should not clobber a boolean', function () {
      returned = ensure(foo, 'some.nested.properties.ccc', 999);
      actual = foo.some.nested.properties.ccc;
      expected = false;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should clobber null', function () {
      returned = ensure(foo, 'some.nested.properties.ddd', 999);
      actual = foo.some.nested.properties.ddd;
      expected = 999;

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should add a property which does not exist', function () {
      returned = ensure(foo, 'some.nested.properties.eee', 'deep');
      actual = foo.some.nested.properties.eee;
      expected = 'deep';

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });

    it('Should add a more deeply nested property which does not exist', function () {
      returned = ensure(foo, 'some.nested.properties.fff.ggg.hhh', 'deeper');
      actual = foo.some.nested.properties.fff.ggg.hhh;
      expected = 'deeper';

      expect(actual).to.equal(expected);
      expect(returned).to.equal(expected);
    });
  });
});
